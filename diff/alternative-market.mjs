import {fetchRemote} from './safe-fetch.mjs';
import {validMint} from './store.mjs';
import {rateRetryAt} from './metadata.mjs';
const SOURCE='GeckoTerminal',INTERVAL=60000,FRESH=90000;
const numeric=value=>{if(typeof value==='string'&&!/^(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value))return null;const n=typeof value==='string'?Number(value):value;return typeof n==='number'&&Number.isFinite(n)&&n>=0?n:null};
// Only established AMM venues; launchpad reserve figures are not pool liquidity.
const POOL_DEXES=new Set(['orca','raydium','raydium-clmm','raydium-cp','meteora','meteora-dlmm','meteora-damm-v2','pumpswap']);
export function parseGeckoToken(response,mint){
 const token=response?.data,attributes=token?.attributes,id='solana_'+mint;
 if(!validMint(mint)||token?.type!=='token'||token.id!==id||attributes?.address!==mint)throw new Error('Alternative token identity mismatch');
 const linked=new Set((token.relationships?.top_pools?.data||[]).filter(p=>p.type==='pool').map(p=>p.id));
 const launchpad=attributes.launchpad_details?.completed===false;
 const candidates=(response.included||[]).filter(p=>p?.type==='pool'&&linked.has(p.id)&&p.id==='solana_'+p.attributes?.address&&validMint(p.attributes?.address)&&[p.relationships?.base_token?.data?.id,p.relationships?.quote_token?.data?.id].includes(id));
 const pools=launchpad?[]:candidates.filter(p=>POOL_DEXES.has(p.relationships?.dex?.data?.id)&&numeric(p.attributes.reserve_in_usd)!==null).sort((a,b)=>numeric(b.attributes.reserve_in_usd)-numeric(a.attributes.reserve_in_usd));
 const pool=pools[0],a=pool?.attributes;
 return {mint,source:SOURCE,marketCapUsd:numeric(attributes.market_cap_usd),fdvUsd:numeric(attributes.fdv_usd),priceUsd:numeric(attributes.price_usd),liquidityUsd:a?numeric(a.reserve_in_usd):null,pairAddress:a?.address||null,dexId:pool?.relationships?.dex?.data?.id||null,sourceUrl:a?'https://www.geckoterminal.com/solana/pools/'+a.address:'https://www.geckoterminal.com/solana/tokens/'+mint,liquidityReason:a?'Provider-reported USD reserve of this exact linked AMM pool; not guaranteed withdrawable funds':launchpad?'Ungraduated bonding-curve token: launchpad reserve is not treated as pool liquidity':candidates.length?'No supported AMM pool reserve; launchpad or unknown venue reserves excluded':'No exact linked AMM pool supplied',marketCapReason:numeric(attributes.market_cap_usd)===null?'GeckoTerminal supplied no verified market cap; FDV is separate': 'Provider-reported market cap; circulation definitions may differ across sources'};
}
export class AlternativeMarket {
 constructor(store,{fetcher=fetchRemote}={}){this.selectedAt=0;this.error=null;this.retryAt=0;this.store=store;this.db=store.db;this.fetcher=fetcher;this.selected=null;this.observed=new Map();this.busy=false;this.db.exec('CREATE TABLE IF NOT EXISTS alternative_market(mint TEXT PRIMARY KEY,status TEXT,checked INTEGER,fetched INTEGER,payload TEXT,error TEXT);CREATE TABLE IF NOT EXISTS alternative_market_control(id INTEGER PRIMARY KEY,next_at INTEGER);INSERT OR IGNORE INTO alternative_market_control VALUES(1,0)')}
 focus(mint){if(validMint(mint)&&this.db.prepare('SELECT 1 FROM events WHERE mint=?').get(mint)){this.selected=mint;this.selectedAt=Date.now()}}
 observe(events){const now=Date.now();for(const [mint,at]of this.observed)if(now-at>FRESH)this.observed.delete(mint);for(const e of events||[])if(validMint(e?.mint)&&this.db.prepare('SELECT 1 FROM events WHERE mint=?').get(e.mint)){this.observed.delete(e.mint);this.observed.set(e.mint,now);while(this.observed.size>200)this.observed.delete(this.observed.keys().next().value)}}
 batch(){this.observe([]);const result=this.selected&&Date.now()-this.selectedAt<20000?[this.selected]:[];const candidates=[...this.observed.keys()].map(mint=>({mint,checked:this.db.prepare('SELECT checked FROM alternative_market WHERE mint=?').get(mint)?.checked||0})).sort((a,b)=>a.checked-b.checked||a.mint.localeCompare(b.mint));for(const r of candidates)if(result.length<4&&!result.includes(r.mint))result.push(r.mint);const history=this.db.prepare('SELECT e.mint FROM events e LEFT JOIN alternative_market a ON a.mint=e.mint GROUP BY e.mint ORDER BY COALESCE(a.checked,0),MAX(e.received) DESC LIMIT 10').all();for(const r of history)if(result.length<5&&!result.includes(r.mint))result.push(r.mint);return result}
 get(mint){const r=this.db.prepare('SELECT * FROM alternative_market WHERE mint=?').get(mint);return {source:SOURCE,sourceUrl:'https://www.geckoterminal.com/solana/tokens/'+mint,providerCacheSeconds:60,intervalSeconds:60,...(r?{status:r.status,checkedAt:r.checked,fetchedAt:r.fetched,stale:r.status!=='available'||!r.fetched||Date.now()-r.fetched>FRESH,data:r.payload?JSON.parse(r.payload):null,error:r.error}:{status:'pending',data:null,stale:false})}}
 summary(){let nextAt=null;try{nextAt=Math.max(this.db.prepare('SELECT next_at FROM alternative_market_control WHERE id=1').get().next_at,this.retryAt)}catch(error){this.error=String(error.message).slice(0,160)}return {source:SOURCE,intervalSeconds:60,batchLimit:5,providerCacheSeconds:60,visibilityLeaseSeconds:20,nextAt,busy:this.busy,error:this.error}}
 async tick(){
  if(this.busy)return;this.busy=true;
  try{
   if(this.retryAt){this.db.prepare('UPDATE alternative_market_control SET next_at=MAX(next_at,?) WHERE id=1').run(this.retryAt);this.retryAt=0}
   if(this.db.prepare('SELECT next_at FROM alternative_market_control WHERE id=1').get().next_at>Date.now())return;
   const mints=this.batch();if(!mints.length){this.error=null;return}
   this.db.prepare('UPDATE alternative_market_control SET next_at=? WHERE id=1').run(Date.now()+INTERVAL);
   let response;
   try{const r=await this.fetcher('https://api.geckoterminal.com/api/v2/networks/solana/tokens/multi/'+mints.join(',')+'?include=top_pools','json',{maxRedirects:0});response=JSON.parse(r.body.toString());if(!Array.isArray(response.data))throw new Error('Unexpected alternative market response')}
   catch(error){this.error=String(error.message).slice(0,160);this.retryAt=error.status===429?Math.max(Date.now()+INTERVAL,rateRetryAt(error)):Date.now()+(error.status===403?3600000:INTERVAL);this.db.prepare('UPDATE alternative_market_control SET next_at=? WHERE id=1').run(this.retryAt);this.retryAt=0;for(const mint of mints)this.failure(mint,error);return}
   for(const mint of mints){const token=response.data.find(t=>t?.id==='solana_'+mint),now=Date.now();if(!token){this.db.prepare("INSERT INTO alternative_market VALUES(?,'not indexed',?,NULL,NULL,'No exact token returned') ON CONFLICT(mint) DO UPDATE SET status='not indexed',checked=excluded.checked,error=excluded.error").run(mint,now);continue}
    let data;try{data=parseGeckoToken({data:token,included:response.included},mint)}catch(error){this.failure(mint,error,now);continue}
    this.db.prepare("INSERT INTO alternative_market VALUES(?,'available',?,?,?,NULL) ON CONFLICT(mint) DO UPDATE SET status='available',checked=excluded.checked,fetched=excluded.fetched,payload=excluded.payload,error=NULL").run(mint,now,now,JSON.stringify(data))
   }
   this.error=null;
  }catch(error){this.error=String(error.message).slice(0,160)}finally{this.busy=false}
 }
 failure(mint,error,now=Date.now()){this.db.prepare("INSERT INTO alternative_market(mint,status,checked,error) VALUES(?,'unavailable',?,?) ON CONFLICT(mint) DO UPDATE SET status='unavailable',checked=excluded.checked,error=excluded.error").run(mint,now,String(error.message).slice(0,160))}
 start(){if(this.timer)return;const run=()=>this.tick().catch(error=>{this.error=String(error.message).slice(0,160)});run();this.timer=setInterval(run,5000)}
 stop(){clearInterval(this.timer);this.timer=null}
}

