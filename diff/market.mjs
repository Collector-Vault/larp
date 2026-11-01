import {fetchRemote} from './safe-fetch.mjs';
import {validMint} from './store.mjs';
import {rateRetryAt} from './metadata.mjs';
const num=x=>typeof x==='number'&&Number.isFinite(x)&&x>=0?x:null;
// Authored contract for fields consumed by DIFF; this validates shape, not market truth.
function validateMarketFields(pairs,mints){
 for(const p of pairs){
  if(p?.chainId!=='solana'||!mints.includes(p.baseToken?.address)||!validMint(p.pairAddress))continue;
  for(const field of ['marketCap','fdv'])if(p[field]!=null&&num(p[field])===null)throw new Error('Invalid market payload field: '+field);
  if(p.priceUsd!=null&&(typeof p.priceUsd!=='string'||! /^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(p.priceUsd)||num(Number(p.priceUsd))===null))throw new Error('Invalid market payload field: priceUsd');
 }
}
export function selectMarket(pairs,mint){
 const valid=pairs.filter(p=>p?.chainId==='solana'&&p.baseToken?.address===mint&&validMint(p.pairAddress));
 valid.sort((a,b)=>(num(b.liquidity?.usd)??-1)-(num(a.liquidity?.usd)??-1)||(num(b.volume?.h24)??0)-(num(a.volume?.h24)??0));
 const p=valid[0];if(!p)return null;
 return {marketCapUsd:num(p.marketCap),fdvUsd:num(p.fdv),liquidityUsd:num(p.liquidity?.usd),priceUsd:typeof p.priceUsd==='string'&&p.priceUsd.trim()?num(Number(p.priceUsd)):null,pairAddress:p.pairAddress,dexId:String(p.dexId||'Unknown').slice(0,80),sourceUrl:'https://dexscreener.com/solana/'+p.pairAddress};
}
export class Market{
 constructor(store,{fetcher=fetchRemote,now=Date.now}={}){this.now=now;this.error=null;this.retryAt=0;this.failures=0;this.selectedAt=0;this.store=store;this.db=store.db;this.fetcher=fetcher;this.busy=false;this.selected=null;this.observed=new Map();this.db.exec(`CREATE TABLE IF NOT EXISTS market(mint TEXT PRIMARY KEY,status TEXT,checked INTEGER,fetched INTEGER,payload TEXT,error TEXT);CREATE TABLE IF NOT EXISTS market_control(id INTEGER PRIMARY KEY,next_at INTEGER);INSERT OR IGNORE INTO market_control(id,next_at) VALUES(1,0);`);if(!this.db.prepare('PRAGMA table_info(market_control)').all().some(c=>c.name==='reason'))this.db.exec("ALTER TABLE market_control ADD COLUMN reason TEXT NOT NULL DEFAULT 'legacy'")}
 focus(mint){if(validMint(mint)&&this.db.prepare('SELECT 1 FROM events WHERE mint=?').get(mint)){this.selected=mint;this.selectedAt=this.now()}}
 observe(events){
  const now=this.now();for(const [mint,at] of this.observed)if(now-at>=20000)this.observed.delete(mint);
  for(const e of events||[]){const cap=num(e?.market?.data?.marketCapUsd);if(!validMint(e?.mint)||!cap||!this.db.prepare('SELECT 1 FROM events WHERE mint=?').get(e.mint))continue;this.observed.delete(e.mint);this.observed.set(e.mint,now);while(this.observed.size>200)this.observed.delete(this.observed.keys().next().value)}
  // Visibility can accelerate ordinary background work, never a provider cooldown.
  if(this.observed.size)try{this.db.prepare("UPDATE market_control SET next_at=MIN(next_at,?) WHERE id=1 AND reason='background'").run(now+5000)}catch(error){this.error=String(error.message).slice(0,160)}
 }
 batch(){
  this.observe([]);const result=[];const add=(rows,limit)=>{if(limit<=0)return;let added=0;for(const row of rows){const mint=typeof row==='string'?row:row.mint;if(mint&&!result.includes(mint)&&result.length<30){result.push(mint);if(++added>=limit)break}}};
  if(this.selected&&this.now()-this.selectedAt<20000)add([this.selected],1);
  const saved=this.db.prepare('SELECT w.mint FROM watches w JOIN events e ON e.mint=w.mint LEFT JOIN market m ON m.mint=w.mint GROUP BY w.mint ORDER BY COALESCE(m.checked,0),MAX(e.received) DESC LIMIT 10').all();
  const now=this.now();const observed=[...this.observed.keys()].map(mint=>{const quote=this.get(mint);const fresh=quote.status==='available'&&!quote.stale&&num(quote.data?.marketCapUsd)>0&&Number.isFinite(quote.fetchedAt)&&quote.fetchedAt<=now&&now-quote.fetchedAt<=90000;return {mint,checked:quote.checkedAt||0,fresh}}).sort((a,b)=>Number(b.fresh)-Number(a.fresh)||a.checked-b.checked||a.mint.localeCompare(b.mint));
  const due=rows=>rows.filter(r=>this.now()-(this.get(r.mint).checkedAt||0)>=30000);add(observed,19);add(due(saved),Math.max(0,20-result.length));
  const newest=this.db.prepare('SELECT e.mint FROM (SELECT mint,MAX(received) received FROM events GROUP BY mint ORDER BY received DESC LIMIT 200) e LEFT JOIN market m ON m.mint=e.mint ORDER BY COALESCE(m.checked,0),e.received DESC').all();
  const history=this.db.prepare('SELECT e.mint FROM events e LEFT JOIN market m ON m.mint=e.mint GROUP BY e.mint ORDER BY COALESCE(m.checked,0),MAX(e.received),e.mint LIMIT 60').all();
  add(due(newest),5);add(due(history),5);add(due(history),30-result.length);return result;
 }
 get(mint){const r=this.db.prepare('SELECT * FROM market WHERE mint=?').get(mint);return r?{status:r.status,checkedAt:r.checked,fetchedAt:r.fetched,stale:r.status==='unavailable'||r.status==='not indexed'&&!!r.payload||!!r.fetched&&this.now()-r.fetched>90000,data:r.payload?JSON.parse(r.payload):null,error:r.error}:{status:'pending',data:null,stale:false}}
 summary(){let nextAt=null,reason=null;try{const row=this.db.prepare('SELECT next_at,reason FROM market_control WHERE id=1').get();nextAt=Math.max(row.next_at,this.retryAt);reason=row.reason}catch(error){this.error=String(error.message).slice(0,160)}return {source:'DEX Screener',intervalSeconds:5,backgroundIntervalSeconds:30,requestLimitPerMinute:12,visibilityLeaseSeconds:20,batchLimit:30,nextAt,reason,busy:this.busy,error:this.error}}
 async tick(){
  if(this.busy)return;this.busy=true;
  try{
   // Persist a previously failed cooldown write before considering another request.
   if(this.retryAt){this.db.prepare("UPDATE market_control SET next_at=MAX(next_at,?),reason='error' WHERE id=1").run(this.retryAt);this.retryAt=0}
   if(this.db.prepare('SELECT next_at FROM market_control WHERE id=1').get().next_at>this.now())return;
   const mints=this.batch();if(!mints.length){this.db.prepare("UPDATE market_control SET next_at=?,reason='idle' WHERE id=1").run(this.now()+1000);this.error=null;return}
   this.db.prepare('UPDATE market_control SET next_at=?,reason=? WHERE id=1').run(this.now()+(this.observed.size?5000:30000),this.observed.size?'active':'background');
   let pairs;
   try{const result=await this.fetcher('https://api.dexscreener.com/tokens/v1/solana/'+mints.join(','),'market',{maxRedirects:0});pairs=JSON.parse(result.body.toString());if(!Array.isArray(pairs))throw new Error('Unexpected market response');validateMarketFields(pairs,mints)}
   catch(error){
    const now=this.now();this.failures++;this.error=String(error.message).slice(0,160);
    this.retryAt=error.status===429?Math.max(now+30000,rateRetryAt(error)):error.status===403?now+3600000:now+Math.min(300000,30000*2**Math.min(this.failures-1,4));
    this.db.prepare("UPDATE market_control SET next_at=?,reason='error' WHERE id=1").run(this.retryAt);this.retryAt=0;
    for(const mint of mints)this.db.prepare("INSERT INTO market(mint,status,checked,error) VALUES(?,'unavailable',?,?) ON CONFLICT(mint) DO UPDATE SET status='unavailable',checked=excluded.checked,error=excluded.error").run(mint,now,this.error);
    return;
   }
   const now=this.now();for(const mint of mints){const data=selectMarket(pairs,mint);if(data)this.db.prepare("INSERT INTO market VALUES(?,'available',?,?,?,NULL) ON CONFLICT(mint) DO UPDATE SET status='available',checked=excluded.checked,fetched=excluded.fetched,payload=excluded.payload,error=NULL").run(mint,now,now,JSON.stringify(data));else this.db.prepare("INSERT INTO market VALUES(?,'not indexed',?,?,NULL,NULL) ON CONFLICT(mint) DO UPDATE SET status='not indexed',checked=excluded.checked,error=CASE WHEN market.payload IS NOT NULL THEN 'No matching pool in latest response; showing last verified quote' ELSE NULL END").run(mint,now,now)}
   this.failures=0;this.error=null;
  }catch(error){this.error=String(error.message).slice(0,160)}finally{this.busy=false}
 }
 start(){if(this.timer)return;const run=()=>this.tick().catch(error=>{this.error=String(error.message).slice(0,160)});run();this.timer=setInterval(run,1000)}
 stop(){clearInterval(this.timer);this.timer=null}
}

