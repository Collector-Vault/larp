import {publicKey} from './wallets.mjs';
export const RPC_SOURCE='https://api.mainnet.solana.com';
export async function rpcTransport(method,address){
 const options=method==='getAccountInfo'?{encoding:'jsonParsed',commitment:'confirmed'}:{limit:10,commitment:'confirmed'};
 const r=await fetch(RPC_SOURCE,{method:'POST',redirect:'error',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params:[address,options]}),signal:AbortSignal.timeout(10000)});
 if(!r.ok){await r.body?.cancel();throw Object.assign(new Error('Solana public RPC HTTP '+r.status),{status:r.status,retryAfter:r.headers.get('retry-after')})}
 if(!r.headers.get('content-type')?.includes('application/json')){await r.body?.cancel();throw new Error('RPC content type unsupported')}
 const chunks=[];let size=0;for await(const c of r.body){size+=c.length;if(size>128*1024)throw new Error('RPC response exceeds128KiB');chunks.push(c)}
 const body=JSON.parse(Buffer.concat(chunks).toString());if(body.error)throw new Error('RPC method error '+String(body.error.code).slice(0,12));if(body.id!==1||body.jsonrpc!=='2.0'||!('result'in body))throw new Error('Invalid RPC envelope');return body.result;
}
export class SharedRPC{
 constructor(store,{transport=rpcTransport,now=Date.now,wait=ms=>new Promise(r=>setTimeout(r,ms))}={}){this.db=store.db;this.transport=transport;this.now=now;this.wait=wait;this.chain=Promise.resolve();this.pending=0;this.cooldownUntil=0;this.unpersistedCooldown=0;this.error=null;this.db.exec('CREATE TABLE IF NOT EXISTS shared_rpc(id INTEGER PRIMARY KEY,next_at INTEGER,cooldown INTEGER);INSERT OR IGNORE INTO shared_rpc VALUES(1,0,0)');const old=this.db.prepare("SELECT name FROM sqlite_master WHERE name='wallet_rpc'").get();if(old){const at=this.db.prepare('SELECT next_at FROM wallet_rpc WHERE id=1').get()?.next_at||0;this.db.prepare('UPDATE shared_rpc SET next_at=MAX(next_at,?),cooldown=MAX(cooldown,?) WHERE id=1').run(at,at>this.now()+5000?at:0)}}
 summary(){const r=this.db.prepare('SELECT * FROM shared_rpc WHERE id=1').get();return {source:RPC_SOURCE,nextAt:Math.max(r.next_at,this.cooldownUntil),cooldownUntil:Math.max(r.cooldown,this.cooldownUntil),intervalSeconds:5,requestLimitPerMinute:12,queued:this.pending,error:this.error}}
 persistCooldown(){
  if(!this.unpersistedCooldown)return;
  this.db.prepare('UPDATE shared_rpc SET next_at=MAX(next_at,?),cooldown=MAX(cooldown,?) WHERE id=1').run(this.unpersistedCooldown,this.unpersistedCooldown);
  this.unpersistedCooldown=0;
 }
 async request(method,address){
  if(!['getAccountInfo','getSignaturesForAddress'].includes(method)||!publicKey(address))throw new Error('Unsupported read-only RPC request');
  if(this.pending>=4)throw new Error('RPC queue full');this.pending++;
  const work=this.chain.then(async()=>{
   // A cooldown whose write failed must be saved before any queued transport.
   try{this.persistCooldown()}catch(error){this.error=String(error.message).slice(0,160);throw Object.assign(new Error('Shared RPC cooldown persistence pending: '+this.error),{deferred:true,retryAt:Math.max(this.cooldownUntil,this.now()+5000)})}
   let state=this.summary();if(state.cooldownUntil>this.now())throw Object.assign(new Error('Shared Solana RPC cooldown until '+new Date(state.cooldownUntil).toISOString()),{deferred:true,retryAt:state.cooldownUntil});
   if(state.nextAt>this.now())await this.wait(Math.min(5000,state.nextAt-this.now()));state=this.summary();
   if(state.nextAt>this.now())throw Object.assign(new Error('Shared RPC budget wait'),{deferred:true,retryAt:state.nextAt});
   const reserved=this.db.prepare('UPDATE shared_rpc SET next_at=? WHERE id=1 AND next_at<=? AND cooldown<=?').run(this.now()+5000,this.now(),this.now());
   if(!reserved.changes)throw Object.assign(new Error('Shared RPC reservation occupied'),{deferred:true,retryAt:this.summary().nextAt});
   try{const result=await this.transport(method,address);this.error=null;return result}
   catch(error){
    const now=this.now(),seconds=Number(error.retryAfter),date=Number.isFinite(seconds)?NaN:Date.parse(error.retryAfter),floor=error.status===403?3600000:60000;
    const retry=Math.max(now+floor,error.retryAt||0,Number.isFinite(seconds)?now+seconds*1000:0,Number.isFinite(date)?date:0);
    // Preserve the provider error and deadline even if SQLite cannot save it yet.
    this.cooldownUntil=Math.max(this.cooldownUntil,retry);this.unpersistedCooldown=this.cooldownUntil;error.retryAt=this.cooldownUntil;this.error=String(error.message).slice(0,160);
    try{this.persistCooldown()}catch(storageError){this.error=String(storageError.message).slice(0,160)}
    throw error;
   }
  });
  this.chain=work.catch(()=>{});try{return await work}finally{this.pending--}
 }
}


