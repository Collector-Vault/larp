import {decodedLength,publicKey} from './wallets.mjs';
export async function rpcLookup(address){
 const r=await fetch('https://api.mainnet.solana.com',{method:'POST',redirect:'error',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'getSignaturesForAddress',params:[address,{limit:10,commitment:'confirmed'}]}),signal:AbortSignal.timeout(10000)});
 if(!r.ok){await r.body?.cancel();throw Object.assign(new Error('Solana public RPC HTTP '+r.status),{status:r.status,retryAfter:r.headers.get('retry-after')})}
 if(!r.headers.get('content-type')?.includes('application/json')){await r.body?.cancel();throw new Error('RPC returned unsupported content')}
 let size=0;const chunks=[];for await(const chunk of r.body){size+=chunk.length;if(size>128*1024)throw new Error('RPC response too large');chunks.push(chunk)}
 const body=JSON.parse(Buffer.concat(chunks).toString());if(body.error)throw new Error('Public RPC method unavailable (code '+String(body.error.code).slice(0,12)+')');if(!Array.isArray(body.result))throw new Error('Unexpected RPC result');return body.result;
}
export function normalizeActivity(rows){if(!Array.isArray(rows))throw new Error('Unexpected RPC result');return rows.slice(0,10).map(r=>{if(decodedLength(r?.signature)!==64||!Number.isSafeInteger(r.slot)||r.slot<0)throw new Error('Invalid RPC transaction reference');return {signature:r.signature,slot:r.slot,blockTime:typeof r.blockTime==='number'&&Number.isFinite(r.blockTime)&&r.blockTime>=0?r.blockTime*1000:null,failed:r.err!=null,confirmation:['confirmed','finalized'].includes(r.confirmationStatus)?r.confirmationStatus:'unknown'}})}
export class WalletRPC{
 constructor(wallets,{lookup=rpcLookup}={}){this.retryAt=0;this.wallets=wallets;this.db=wallets.db;this.lookup=lookup;this.busy=false;this.priority=null;this.running=false;this.error=null}
 queue(address){if(!publicKey(address)||!this.db.prepare('SELECT 1 FROM wallets WHERE address=?').get(address))throw new Error('Unknown wallet');this.priority=address}
 summary(){const count=this.db.prepare('SELECT COUNT(*) n FROM wallets').get().n;return {running:this.running,busy:this.busy,error:this.error,nextAt:Math.max(this.db.prepare('SELECT next_at FROM wallet_rpc WHERE id=1').get().next_at,this.retryAt),count,cycleMinutes:Math.ceil(count*5/60),intervalSeconds:5,source:'Solana public mainnet RPC',mode:'Bounded recent transaction references, not a trade feed'}}
 async tick(){
  if(this.busy)return;this.busy=true;
  try{
   if(this.retryAt){this.db.prepare('UPDATE wallet_rpc SET next_at=MAX(next_at,?) WHERE id=1').run(this.retryAt);this.retryAt=0}
   if(this.db.prepare('SELECT next_at FROM wallet_rpc WHERE id=1').get().next_at>Date.now())return;
   const row=(this.priority&&this.db.prepare('SELECT * FROM wallets WHERE address=?').get(this.priority))||this.db.prepare('SELECT * FROM wallets ORDER BY COALESCE(checked,0),address LIMIT 1').get();if(!row){this.error=null;return}
   this.db.prepare('UPDATE wallet_rpc SET next_at=? WHERE id=1').run(Date.now()+5000);this.priority=null;
   let data;try{data=normalizeActivity(await this.lookup(row.address))}
   catch(error){
    this.error=String(error.message).slice(0,160);
    const now=Date.now();let delay=60000;if(error.status===403)delay=3600000;if(error.status===429){const seconds=Number(error.retryAfter),date=Date.parse(error.retryAfter);delay=Math.max(delay,Number.isFinite(seconds)?seconds*1000:Number.isFinite(date)?date-now:0)}
    this.retryAt=error.deferred?(error.retryAt||now+5000):Math.max(error.retryAt||0,now+Math.min(Math.max(delay,60000),86400000*30));
    this.db.prepare('UPDATE wallet_rpc SET next_at=? WHERE id=1').run(this.retryAt);this.retryAt=0;
    if(!error.deferred)this.db.prepare("UPDATE wallets SET checked=?,status='unavailable',error=? WHERE address=?").run(now,this.error,row.address);return;
   }
   this.db.prepare("UPDATE wallets SET activity=?,checked=?,fetched=?,status='checked',error=NULL WHERE address=?").run(JSON.stringify(data),Date.now(),Date.now(),row.address);this.error=null;
  }catch(error){this.error=String(error.message).slice(0,160)}finally{this.busy=false}
 }
 start(){if(this.running)return;this.running=true;const run=()=>this.tick().catch(e=>{this.error=String(e.message).slice(0,160)});run();this.timer=setInterval(run,1000)}
 stop(){this.running=false;clearInterval(this.timer)}
}


