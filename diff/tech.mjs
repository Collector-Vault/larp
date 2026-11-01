import {fetchRemote,safeUrl} from './safe-fetch.mjs';
import {rateRetryAt} from './metadata.mjs';
const DAY=86400000;
const FUNCTIONAL_RECHECK=300000,FUNCTIONAL_EXPIRY=600000;
const SOL='So11111111111111111111111111111111111111112',USDC='EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const ADAPTER='raydium-quote-v1';
const quoteUrl=amount=>'https://transaction-v1.raydium.io/compute/swap-base-in?inputMint='+SOL+'&outputMint='+USDC+'&amount='+amount+'&slippageBps=50&txVersion=V0';
const functionalLimits='Only the linked Raydium quote service was exercised. Token affiliation, ownership, token-specific functionality, execution, contract security and investment safety are unverified. No transaction was built, signed or sent. No automatic fraud verdict.';
export function functionalAdapter(p){
 if(!/\b(swaps?|quotes?)\b/i.test(p?.description||''))return null;
 try{const u=safeUrl(p.links?.find(l=>l.label==='Website')?.url);return ['raydium.io','www.raydium.io','app.raydium.io'].includes(u.hostname)?ADAPTER:null}catch{return null}
}
export function validateFunctionalQuote(value,amount,source){
 const d=value?.data,integer=x=>typeof x==='string'&&/^[0-9]{1,30}$/.test(x),mint=x=>typeof x==='string'&&/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(x);
 if(value?.success!==true||d?.swapType!=='BaseIn'||d.inputMint!==SOL||d.outputMint!==USDC||d.inputAmount!==String(amount)||!integer(d.outputAmount)||BigInt(d.outputAmount)<=0n||!Array.isArray(d.routePlan)||!d.routePlan.length||d.routePlan.length>10||d.routePlan.some(r=>!mint(r.poolId)||!mint(r.inputMint)||!mint(r.outputMint)))throw new Error('Quote response did not demonstrate the supported capability; inconclusive, not fraud evidence');
 if(d.routePlan[0].inputMint!==SOL||d.routePlan.at(-1).outputMint!==USDC||d.routePlan.some((r,i)=>i&&r.inputMint!==d.routePlan[i-1].outputMint))throw new Error('Quote route continuity could not be verified; inconclusive');
 return {source,inputMint:SOL,outputMint:USDC,inputAmount:d.inputAmount,outputAmount:d.outputAmount,pools:d.routePlan.map(r=>r.poolId),unit:'raw token units (SOL 9 decimals, USDC 6 decimals)'};
}
export function findTechClaims(description) {
 if(typeof description!=='string')return [];
 const sentences=description.split(/(?<=[.!?])\s+/).filter(s=>/\b(api|sdk|software|protocol|application|platform|developer tool|trading bot|automation|smart contract|infrastructure|swap|swaps|quote|quotes)\b/i.test(s)&&!/^\s*(no|without)\s+(utility|software|tech)/i.test(s));
 return sentences.slice(0,3).map(s=>s.slice(0,350));
}
export function inspectPage(html,source) {
 const title=(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]||'').replace(/<[^>]+>/g,' ').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/[\u0000-\u001f\u202a-\u202e\u2066-\u2069]/g,' ').replace(/\s+/g,' ').trim().slice(0,200);
 return {kind:'website_response',source,title:title||null,httpStatus:200,statement:'Public HTTPS page returned HTML. This does not demonstrate working product functionality.'};
}
export class TechChecks {
 constructor(metadata,{fetcher=fetchRemote}={}){this.metadata=metadata;this.db=metadata.db;this.fetcher=fetcher;this.busy=false;this.current=null;this.db.exec('CREATE TABLE IF NOT EXISTS tech_functional_targets(mint TEXT PRIMARY KEY,source TEXT,adapter TEXT);CREATE TABLE IF NOT EXISTS tech_functional_cache(adapter TEXT PRIMARY KEY,checked INTEGER,next_try INTEGER,observation TEXT)');this.db.exec('CREATE TABLE IF NOT EXISTS tech_checks(mint TEXT PRIMARY KEY,source TEXT,checked INTEGER,next_try INTEGER NOT NULL DEFAULT 0,observation TEXT);CREATE TABLE IF NOT EXISTS tech_success(mint TEXT PRIMARY KEY,source TEXT,checked INTEGER,observation TEXT)');this.db.prepare('UPDATE tech_checks SET next_try=? WHERE next_try=0').run(Date.now());this.db.exec("INSERT OR IGNORE INTO tech_success SELECT mint,source,checked,observation FROM tech_checks WHERE json_extract(observation,'$.kind')='website_response'")}
 enqueue(mint,p) {
  const remove=()=>{this.db.prepare('DELETE FROM tech_functional_targets WHERE mint=?').run(mint);this.db.prepare('DELETE FROM tech_checks WHERE mint=?').run(mint);this.db.prepare('DELETE FROM tech_success WHERE mint=?').run(mint)};
  if(!findTechClaims(p.description).length){remove();return}
  const website=p.links?.find(l=>l.label==='Website')?.url;if(!website){remove();return}
  let u;try{u=safeUrl(website)}catch{remove();return}
  if(/(^|\.)github\.com$/.test(u.hostname)){remove();return}
  const adapter=functionalAdapter(p),previousAdapter=this.db.prepare('SELECT adapter FROM tech_functional_targets WHERE mint=?').get(mint)?.adapter||null;
  if(adapter!==previousAdapter)this.db.prepare('UPDATE tech_checks SET next_try=?,checked=NULL,observation=NULL WHERE mint=?').run(Date.now(),mint);
  if(adapter)this.db.prepare('INSERT OR REPLACE INTO tech_functional_targets VALUES(?,?,?)').run(mint,u.href,adapter);else this.db.prepare('DELETE FROM tech_functional_targets WHERE mint=?').run(mint);
  this.db.prepare('DELETE FROM tech_success WHERE mint=? AND source!=?').run(mint,u.href);
  this.db.prepare('INSERT INTO tech_checks(mint,source,next_try) VALUES(?,?,?) ON CONFLICT(mint) DO UPDATE SET source=excluded.source,next_try=CASE WHEN source!=excluded.source THEN excluded.next_try ELSE next_try END,checked=CASE WHEN source!=excluded.source THEN NULL ELSE checked END,observation=CASE WHEN source!=excluded.source THEN NULL ELSE observation END').run(mint,u.href,Date.now());
 }
 functional(p) {
  const adapter=functionalAdapter(p),base={color:'gray',affiliation:'unverified',capability:'SOL to USDC read-only quote computation',limitations:functionalLimits,criterion:'Two fixed-size quotes must echo the requested mints and amounts, provide continuous pool routes, and return increasing positive outputs.',documentation:'https://docs.raydium.io/sdk-api/trade-api',observations:[],checkedAt:null,expiresAt:null};
  if(!adapter)return {...base,status:'unsupported',label:'No supported functional check'};
  const row=this.db.prepare('SELECT * FROM tech_functional_cache WHERE adapter=?').get(adapter);
  if(!row)return {...base,status:'pending',label:'Linked service check queued'};
  const observation=JSON.parse(row.observation),expiresAt=row.checked+FUNCTIONAL_EXPIRY,valid=Number.isFinite(row.checked)&&row.checked<=Date.now()&&Date.now()<expiresAt;
  const observed=observation.kind==='functional_response';
  return {...base,status:observed?(valid?'observed':'expired'):'unavailable',color:observed&&valid?'green':'gray',label:observed?(valid?'Linked quote service works':'Linked service observation expired'):'Linked service check unavailable',checkedAt:row.checked,expiresAt,nextCheckAt:row.next_try,observations:observed?observation.observations:[],previousObservation:observation.previous||null,error:observation.error||null};
 }
 async tickFunctional(row) {
  const cached=this.db.prepare('SELECT * FROM tech_functional_cache WHERE adapter=?').get(ADAPTER);
  if(cached?.next_try>Date.now()){
   this.db.prepare('UPDATE tech_checks SET checked=?,next_try=?,observation=? WHERE mint=? AND source=?').run(cached.checked,cached.next_try,cached.observation,row.mint,row.source);return;
  }
  const source=quoteUrl(100000000);this.current={mint:row.mint,stage:'functional',source,startedAt:Date.now()};
  this.metadata.recordScan(row.mint,'functional','fetching','Testing two fixed read-only quotes from the linked service');
  let observation,next=Date.now()+FUNCTIONAL_RECHECK;
  try{
   const observations=[];
   for(const amount of [100000000,200000000]){
    const url=quoteUrl(amount),result=await this.fetcher(url,'json',{reserve:u=>this.metadata.reserve(u),maxRedirects:0});
    if(result.url!==url)throw new Error('Functional endpoint changed; inconclusive');
    observations.push(validateFunctionalQuote(JSON.parse(result.body.toString('utf8')),amount,url));this.metadata.hostSuccess(url);
   }
   if(BigInt(observations[1].outputAmount)<=BigInt(observations[0].outputAmount))throw new Error('Changed input did not produce increasing output; inconclusive, not fraud evidence');
   observation={kind:'functional_response',source,statement:'Linked quote service returned two parameter-dependent quotes. Token affiliation and token functionality remain unverified.',observations};
  }catch(e){
   if(e.retryAt&&/queued|waiting/i.test(e.message)){
    this.db.prepare('UPDATE tech_checks SET next_try=? WHERE mint=? AND source=?').run(e.retryAt,row.mint,row.source);this.metadata.recordScan(row.mint,'functional','queued','Waiting for shared request budget or source cooldown');return;
   }
   this.metadata.hostFailure(e,source);next=e.retryAt||(e.status===429?rateRetryAt(e):Date.now()+FUNCTIONAL_RECHECK);
   if(e.status===403)next=Math.max(next,rateRetryAt(e));
   if(e.status===429||e.status===403){this.db.prepare('DELETE FROM metadata_host_failures WHERE host=?').run(e.host||safeUrl(source).hostname);this.db.prepare('INSERT INTO metadata_hosts VALUES(?,?) ON CONFLICT(host) DO UPDATE SET retry_at=MAX(retry_at,excluded.retry_at)').run(e.host||safeUrl(source).hostname,next)}
   const old=cached?.observation?JSON.parse(cached.observation):null;
   observation={kind:'unavailable',source,error:String(e.message).slice(0,160),statement:'Check inconclusive; no fraud conclusion.',previous:old?.kind==='functional_response'?{checkedAt:cached.checked,observations:old.observations}:old?.previous||null};
  }
  const now=Date.now(),json=JSON.stringify(observation);this.db.prepare('INSERT OR REPLACE INTO tech_functional_cache VALUES(?,?,?,?)').run(ADAPTER,now,next,json);
  const result=this.db.prepare('UPDATE tech_checks SET checked=?,next_try=?,observation=? WHERE mint=? AND source=?').run(now,next,json,row.mint,row.source);

  if(result.changes)this.metadata.recordScan(row.mint,'functional',observation.kind==='functional_response'?'checked':'unavailable',observation.statement);
 }
 get(mint,p) {
  const claims=findTechClaims(p.description);const row=this.db.prepare('SELECT * FROM tech_checks WHERE mint=?').get(mint);const observation=row?.observation?JSON.parse(row.observation):null;
  const previous=this.db.prepare("SELECT * FROM tech_success WHERE mint=? AND json_extract(observation,'$.kind')='website_response'").get(mint);
  const supportingCheck=row?(this.db.prepare('SELECT 1 FROM tech_functional_targets WHERE mint=? AND source=?').get(mint,row.source)?'venue':'website'):null;
  return {supportingCheck,functional:this.functional(p),lastSuccess:previous?{checkedAt:previous.checked,observation:JSON.parse(previous.observation)}:null,candidate:claims.length>0,claims,status:'unverified',color:'gray',criterion:'Working functionality requires a reproducible independent functional check; project claims and page availability are insufficient.',checkedAt:row?.checked||null,stale:!!row?.checked&&Date.now()-row.checked>DAY,observation,limitations:'Generic checks read public page metadata; the supported adapter exercises only linked quote computation. No token affiliation, contract audit, execution or investment safety conclusion. No automatic good/fake verdict.',repository:p.links?.find(l=>l.label==='Repository')?.url||null};
 }
 async tick(){if(this.busy)return;this.busy=true;try{let row;for(const candidate of this.db.prepare('SELECT * FROM tech_checks WHERE next_try<=? ORDER BY next_try,rowid LIMIT 200').all(Date.now())){const target=this.db.prepare('SELECT * FROM tech_functional_targets WHERE mint=? AND source=?').get(candidate.mint,candidate.source);const cache=target?this.db.prepare('SELECT * FROM tech_functional_cache WHERE adapter=?').get(target.adapter):null;const quota=target?this.db.prepare('SELECT at FROM metadata_requests WHERE at>? ORDER BY at').all(Date.now()-60000):[];const wait=target&&cache?.next_try>Date.now()?null:target?(this.metadata.requestWait(quoteUrl(100000000))||(quota.length>10?quota[quota.length-11].at+60001:null)):this.metadata.requestWait(candidate.source);if(wait){this.db.prepare('UPDATE tech_checks SET next_try=? WHERE mint=?').run(wait,candidate.mint);continue}row=candidate;break}if(!row)return;if(this.db.prepare('SELECT 1 FROM tech_functional_targets WHERE mint=? AND source=?').get(row.mint,row.source)){await this.tickFunctional(row);return}this.current={mint:row.mint,stage:'website',source:row.source,startedAt:Date.now()};this.metadata.recordScan(row.mint,'website','fetching','Inspecting public page metadata');let observation,next=Date.now()+DAY;try{const r=await this.fetcher(row.source,'html',{reserve:u=>this.metadata.reserve(u)});this.metadata.hostSuccess(r.url);observation=inspectPage(r.body.toString('utf8'),r.url)}catch(e){this.metadata.hostFailure(e,row.source);observation={kind:'unavailable',source:row.source,error:String(e.message).slice(0,160),statement:'Check unavailable; this is not evidence of fake technology.'};next=e.retryAt||(e.status===429?rateRetryAt(e):Date.now()+3600000);if(e.status===429)this.db.prepare('DELETE FROM metadata_host_failures WHERE host=?').run(e.host||safeUrl(row.source).hostname);if(e.status===429)this.db.prepare('INSERT INTO metadata_hosts VALUES(?,?) ON CONFLICT(host) DO UPDATE SET retry_at=MAX(retry_at,excluded.retry_at)').run(e.host||safeUrl(row.source).hostname,next)}const result=this.db.prepare('UPDATE tech_checks SET checked=?,next_try=?,observation=? WHERE mint=? AND source=?').run(Date.now(),next,JSON.stringify(observation),row.mint,row.source);if(result.changes&&observation.kind==='website_response')this.db.prepare('INSERT OR REPLACE INTO tech_success VALUES(?,?,?,?)').run(row.mint,row.source,Date.now(),JSON.stringify(observation));if(result.changes)this.metadata.recordScan(row.mint,'website',observation.kind==='website_response'?'checked':'unavailable',observation.kind==='website_response'?'Public HTML page responded; functionality remains unverified':observation.error)}finally{this.busy=false;this.current=null}}
 start(){this.timer=setInterval(()=>this.tick().catch(e=>console.error('Tech check:',e.message)),7000)}
 stop(){clearInterval(this.timer)}
}


