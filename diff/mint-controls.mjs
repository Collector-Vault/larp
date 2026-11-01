import {publicKey} from './wallets.mjs';

// Authoritative program IDs and account model:
// https://solana.com/docs/intro/quick-start/reading-from-network
// https://solana.com/docs/rpc/http/getaccountinfo
// https://www.solana-program.com/docs/token-2022
export const TOKEN_PROGRAM='TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const TOKEN_2022_PROGRAM='TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const TTL=300000;
const LIMITATIONS='Read-only account snapshot, not a safety verdict, contract audit or proof of working technology. Token-2022 extension semantics are unsupported; absent base authorities do not rule out extension controls.';
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);

export function normalizeMint(result,mint){
 if(!publicKey(mint))throw new Error('Invalid mint public key');
 if(!object(result)||!object(result.context)||!Number.isSafeInteger(result.context.slot)||result.context.slot<0||!Object.hasOwn(result,'value'))throw new Error('Malformed account context');
 const base={mint,slot:result.context.slot,owner:null,program:null,extensionNames:[],extensionsSupported:false,extensionStatus:'unknown',limitations:LIMITATIONS};
 if(result.value===null)return {...base,status:'nonexistent'};
 const value=result.value;
 if(!object(value)||!publicKey(value.owner)||typeof value.executable!=='boolean')throw new Error('Malformed account envelope');
 if(value.pubkey!==undefined&&value.pubkey!==mint)throw new Error('Account public key mismatch');
 base.owner=value.owner;
 if(![TOKEN_PROGRAM,TOKEN_2022_PROGRAM].includes(value.owner))return {...base,status:'unsupported owner'};
 base.program=value.owner===TOKEN_PROGRAM?'Token':'Token-2022';
 if(value.executable)return {...base,status:'not mint'};
 const parsed=value.data?.parsed;
 if(!object(parsed)||typeof parsed.type!=='string')throw new Error('Mint account is not valid jsonParsed data');
 if(parsed.type!=='mint')return {...base,status:'not mint'};
 const info=parsed.info;
 if(!object(info)||typeof info.isInitialized!=='boolean')throw new Error('Malformed mint initialization');
 if(!info.isInitialized)return {...base,status:'uninitialized'};
 if(!Number.isInteger(info.decimals)||info.decimals<0||info.decimals>255)throw new Error('Malformed mint decimals');
 if(typeof info.supply!=='string'||!/^(0|[1-9][0-9]{0,19})$/.test(info.supply)||BigInt(info.supply)>18446744073709551615n)throw new Error('Malformed mint supply');
 for(const field of ['mintAuthority','freezeAuthority'])if(info[field]!==null&&!publicKey(info[field]))throw new Error('Malformed '+field);
 if(value.owner===TOKEN_2022_PROGRAM){
  if(info.extensions!==undefined){
   if(!Array.isArray(info.extensions)||info.extensions.length>64)throw new Error('Malformed mint extensions');
   base.extensionNames=[...new Set(info.extensions.map(e=>typeof e?.extension==='string'&&/^[A-Za-z][A-Za-z0-9]{0,79}$/.test(e.extension)?e.extension:'unknown'))];
   base.extensionStatus='unsupported';
  }
 }else base.extensionStatus='not applicable';
 return {...base,status:'available',decimals:info.decimals,supply:info.supply,mintAuthority:info.mintAuthority,freezeAuthority:info.freezeAuthority};
}

export class MintControls{
 constructor(store,{lookup=null,now=Date.now}={}){
  this.db=store.db;this.lookup=lookup;this.now=now;this.busy=false;this.running=false;this.current=null;this.priorityRuns=0;this.workerError=null;this.retryAt=0;
  this.db.exec(`CREATE TABLE IF NOT EXISTS mint_controls(mint TEXT PRIMARY KEY,status TEXT NOT NULL,queued INTEGER NOT NULL,priority INTEGER NOT NULL DEFAULT 0,checked INTEGER,fetched INTEGER,next_try INTEGER NOT NULL DEFAULT 0,attempts INTEGER NOT NULL DEFAULT 0,payload TEXT,error TEXT);
   CREATE TABLE IF NOT EXISTS mint_control_schedule(id INTEGER PRIMARY KEY,next_at INTEGER NOT NULL);INSERT OR IGNORE INTO mint_control_schedule VALUES(1,0);`);
 }
 enqueue(mint,priority=false){
  if(!publicKey(mint)||!this.db.prepare('SELECT 1 FROM events WHERE mint=?').get(mint))throw new Error('Unknown mint event');
  const row=this.db.prepare('SELECT * FROM mint_controls WHERE mint=?').get(mint),now=this.now();
  if(row){if(priority)this.db.prepare('UPDATE mint_controls SET priority=? WHERE mint=?').run(now,mint);return}
  const full=this.db.prepare("SELECT COUNT(*) n FROM mint_controls WHERE status='queued'").get().n>=100;
  this.db.prepare('INSERT INTO mint_controls(mint,status,queued,priority,next_try) VALUES(?,?,?,?,?)').run(mint,full?'deferred':'queued',now,priority?now:0,now);
 }
 get(mint){
  const r=this.db.prepare('SELECT * FROM mint_controls WHERE mint=?').get(mint);
  if(!r)return {status:'not queued',checkedAt:null,fetchedAt:null,retryAt:null,stale:false,data:null,error:null};
  return {status:this.current===mint?'fetching':r.status,checkedAt:r.checked,fetchedAt:r.fetched,retryAt:Math.max(r.next_try,this.summary().nextAt),stale:!!r.payload&&(r.status==='unavailable'||!Number.isFinite(r.fetched)||r.fetched>this.now()||this.now()-r.fetched>=TTL),data:r.payload?JSON.parse(r.payload):null,error:r.error};
 }
 summary(){const counts=Object.fromEntries(this.db.prepare('SELECT status,COUNT(*) n FROM mint_controls GROUP BY status').all().map(r=>[r.status,r.n]));return {running:this.running,connected:typeof this.lookup==='function',busy:this.busy,active:this.current,nextAt:Math.max(this.db.prepare('SELECT next_at FROM mint_control_schedule WHERE id=1').get().next_at,this.retryAt),queued:counts.queued||0,deferred:counts.deferred||0,capacity:100,cacheSeconds:300,error:this.workerError,source:'Solana public mainnet RPC',mode:'Read-only getAccountInfo jsonParsed; no safety verdict'}}
 async tick(){
  if(this.busy||typeof this.lookup!=='function')return;this.busy=true;
  try{
   // A failed error write must retain its cooldown before another request.
   if(this.retryAt){this.db.prepare('UPDATE mint_control_schedule SET next_at=MAX(next_at,?) WHERE id=1').run(this.retryAt);this.retryAt=0}
   if(this.db.prepare('SELECT next_at FROM mint_control_schedule WHERE id=1').get().next_at>this.now())return;
   const now=this.now();this.db.prepare('UPDATE mint_controls SET priority=0 WHERE priority>0 AND priority<=?').run(now-20000);const candidates=this.db.prepare('SELECT * FROM mint_controls WHERE next_try<=? ORDER BY priority DESC,next_try,queued,mint LIMIT 201').all(now);
   const row=(this.priorityRuns>=2?this.db.prepare('SELECT * FROM mint_controls WHERE priority=0 AND next_try<=? ORDER BY next_try,queued,mint LIMIT 1').get(now):null)||candidates[0];
   if(!row)return;
   this.current=row.mint;
   this.db.prepare('UPDATE mint_control_schedule SET next_at=? WHERE id=1').run(now+5000);
   this.priorityRuns=row.priority?this.priorityRuns+1:0;
   let data;
   try{data=normalizeMint(await this.lookup(row.mint),row.mint)}
   catch(e){
    const at=this.now();
    if(e.deferred&&Number.isSafeInteger(e.retryAt)&&e.retryAt>at){
     this.retryAt=e.retryAt;
     this.db.prepare('UPDATE mint_control_schedule SET next_at=MAX(next_at,?) WHERE id=1').run(this.retryAt);
     this.db.prepare('UPDATE mint_controls SET next_try=? WHERE mint=?').run(this.retryAt,row.mint);
    }else{
     let delay=[60000,300000,3600000,86400000][Math.min(row.attempts,3)];
     if(e.status===403)delay=Math.max(delay,3600000);
     if(e.status===429){const seconds=Number(e.retryAfter),date=Date.parse(e.retryAfter);delay=Math.max(delay,3600000,Number.isFinite(seconds)?seconds*1000:Number.isFinite(date)?date-at:0)}
     let retry=at+delay;if(Number.isSafeInteger(e.retryAt)&&e.retryAt>retry)retry=e.retryAt;if(!Number.isSafeInteger(retry))retry=Number.MAX_SAFE_INTEGER;
     const error=String(e.message||'Mint lookup unavailable').replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,180);
     this.retryAt=retry;
     if([403,429].includes(e.status)||Number.isSafeInteger(e.retryAt)&&e.retryAt>at)this.db.prepare('UPDATE mint_control_schedule SET next_at=MAX(next_at,?) WHERE id=1').run(retry);
     this.db.prepare("UPDATE mint_controls SET status='unavailable',checked=?,next_try=?,attempts=attempts+1,error=?,priority=0 WHERE mint=?").run(at,retry,error,row.mint);this.workerError=error;
    }
    this.retryAt=0;return;
   }
   const at=this.now();this.db.prepare("UPDATE mint_controls SET status='checked',checked=?,fetched=?,next_try=?,attempts=0,payload=?,error=NULL,priority=0 WHERE mint=?").run(at,at,at+TTL,JSON.stringify(data),row.mint);this.workerError=null;
  }catch(e){this.workerError=String(e.message||'Mint worker unavailable').replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,180)}finally{this.busy=false;this.current=null}
 }
 start(){if(this.running)return;this.running=true;this.timer=setInterval(()=>this.tick().catch(e=>{this.workerError=String(e.message).slice(0,180)}),1000)}
 stop(){this.running=false;clearInterval(this.timer)}
}
