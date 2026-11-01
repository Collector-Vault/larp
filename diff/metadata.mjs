import {safeUrl,fetchRemote} from './safe-fetch.mjs';
import {validMint} from './store.mjs';
const DAY=86400000;
export function rateRetryAt(error,now=Date.now()) {
 const seconds=Number(error.retryAfter);const date=Date.parse(error.retryAfter);
 const delay=Number.isFinite(seconds)?Math.max(0,seconds*1000):Number.isFinite(date)?date-now:0;
 return Math.max(now+3600000,Number.isSafeInteger(Math.trunc(now+delay))?now+delay:now+DAY);
}
function clean(value,max=4000){if(typeof value!=='string')return null;const s=value.slice(0,20000).replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi,' ').replace(/<[^>]*>/g,' ').replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g,' ').replace(/\s+/g,' ').trim();return s?s.slice(0,max):null}
function url(value){try{return safeUrl(value).href}catch{return null}}
export function normalizeMetadata(data) {
 const description=clean(data.description);
 const boilerplate=description&&(/^(launched|created|minted|deployed)\s+(on|with|using)\s+\S+\.?$/i.test(description)||/^https?:\/\/\S+$/.test(description));
 const summary=description&&!boilerplate?(description.length>280?description.slice(0,277).replace(/\s+\S*$/,'')+'…':description):null;
 const links=[];
 for(const [label,value]of [['Website',data.website||data.external_url||data.extensions?.website],['Repository',data.repository||data.github||data.extensions?.github],['X / Twitter',data.twitter||data.extensions?.twitter],['Telegram',data.telegram||data.extensions?.telegram]]){const href=url(value);if(href&&!links.some(l=>l.url===href))links.push({label,url:href})}
 return {description,summary,links,image:url(data.image||data.image_url),name:clean(data.name,200)};
}
export function artworkUrl(value){
 const u=safeUrl(value);
 if(/^[a-z0-9-]+\.mypinata\.cloud$/.test(u.hostname)&&u.pathname.startsWith('/ipfs/')&&!u.search){for(const [key,val]of Object.entries({'img-width':'512','img-height':'512','img-fit':'scale-down','img-format':'webp','img-anim':'false','img-metadata':'none'}))u.searchParams.set(key,val)}
 return u.href;
}
export class Metadata {
 constructor(store,{fetcher=fetchRemote,onMetadata=()=>{},cacheMaxBytes=64*1024*1024}={}) {
  this.store=store;this.db=store.db;this.fetcher=fetcher;this.onMetadata=onMetadata;this.busy=false;this.current=null;this.running=false;this.lastWorkerError=null;this.priorityRuns=0;this.cacheMaxBytes=cacheMaxBytes;
  this.db.exec(`CREATE TABLE IF NOT EXISTS metadata(mint TEXT PRIMARY KEY,source TEXT,status TEXT NOT NULL,phase TEXT NOT NULL DEFAULT 'json',fetched INTEGER,next_try INTEGER NOT NULL DEFAULT 0,attempts INTEGER NOT NULL DEFAULT 0,priority INTEGER NOT NULL DEFAULT 0,payload TEXT,image BLOB,image_type TEXT,image_fetched INTEGER,error TEXT);
   CREATE TABLE IF NOT EXISTS metadata_requests(at INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS metadata_hosts(host TEXT PRIMARY KEY,retry_at INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS metadata_failure_hosts(mint TEXT PRIMARY KEY,source TEXT NOT NULL,host TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS metadata_artwork_keys(mint TEXT PRIMARY KEY,requested TEXT,resized INTEGER);
   CREATE TABLE IF NOT EXISTS metadata_image_sources(mint TEXT PRIMARY KEY,source TEXT);
   CREATE TABLE IF NOT EXISTS metadata_image_failures(source TEXT PRIMARY KEY,next_try INTEGER,error TEXT);
   CREATE TABLE IF NOT EXISTS metadata_image_failure_hosts(source TEXT PRIMARY KEY,host TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS metadata_image_access(mint TEXT PRIMARY KEY,accessed INTEGER);
   CREATE TABLE IF NOT EXISTS metadata_evictions(mint TEXT PRIMARY KEY,at INTEGER);
   CREATE TABLE IF NOT EXISTS metadata_host_failures(host TEXT PRIMARY KEY,attempts INTEGER NOT NULL,error TEXT);
   CREATE TABLE IF NOT EXISTS scan_activity(id INTEGER PRIMARY KEY,mint TEXT,stage TEXT,state TEXT,at INTEGER,message TEXT);`);
  this.db.prepare('UPDATE metadata SET next_try=? WHERE next_try=0').run(Date.now());this.trimImages();
  for(const r of this.db.prepare("SELECT m.mint,m.payload,s.source FROM metadata m JOIN metadata_image_sources s ON s.mint=m.mint LEFT JOIN metadata_artwork_keys k ON k.mint=m.mint WHERE k.mint IS NULL AND m.image_type IS NOT NULL LIMIT 500").all()){const original=JSON.parse(r.payload||'{}').image;if(original){const transformed=artworkUrl(original);this.db.prepare('INSERT OR IGNORE INTO metadata_artwork_keys VALUES(?,?,?)').run(r.mint,r.source===transformed?transformed:original,transformed!==original&&r.source===transformed?1:0)}}
  for(const r of this.db.prepare("SELECT mint,payload FROM metadata WHERE phase='image' AND error='Response exceeds size limit' LIMIT 100").all()){const original=JSON.parse(r.payload||'{}').image;if(original&&artworkUrl(original)!==original&&!this.db.prepare('SELECT 1 FROM metadata_image_failures WHERE source=?').get(artworkUrl(original)))this.db.prepare("UPDATE metadata SET next_try=?,status='deferred' WHERE mint=?").run(Date.now(),r.mint)}
 }
 enqueue(mint,priority=false) {
  if(!validMint(mint))return;
  const existing=this.db.prepare('SELECT mint,status,phase,error,image_type,payload FROM metadata WHERE mint=?').get(mint);
  if(existing){if(priority){this.db.prepare('INSERT OR REPLACE INTO metadata_image_access VALUES(?,?)').run(mint,Date.now());this.db.prepare('UPDATE metadata SET priority=? WHERE mint=?').run(Date.now(),mint);const original=JSON.parse(existing.payload||'{}').image;const derivative=original?artworkUrl(original):null;if(existing.phase==='image'&&original&&this.cachedArtwork(artworkUrl(original)))this.db.prepare("UPDATE metadata SET next_try=?,status='deferred' WHERE mint=?").run(Date.now(),mint);if(existing.phase==='image'&&existing.error==='Response exceeds size limit'&&derivative!==original&&!this.db.prepare('SELECT 1 FROM metadata_image_failures WHERE source=?').get(derivative))this.db.prepare("UPDATE metadata SET next_try=?,status='deferred' WHERE mint=?").run(Date.now(),mint);if(existing.status==='ready'&&!existing.image_type&&this.db.prepare('SELECT 1 FROM metadata_evictions WHERE mint=?').get(mint)&&JSON.parse(existing.payload||'{}').image)this.db.prepare("UPDATE metadata SET phase='image',status='deferred',next_try=? WHERE mint=?").run(Date.now(),mint)}return}
  const event=this.db.prepare("SELECT raw FROM events WHERE mint=? AND kind='create'").get(mint);
  if(!event)return;
  const source=url(JSON.parse(event.raw).uri);
  const full=this.db.prepare("SELECT COUNT(*) n FROM metadata WHERE status IN ('queued','image queued')").get().n>=100;
  const status=source?(full?'deferred':'queued'):'unavailable';
  this.db.prepare('INSERT INTO metadata(mint,source,status,next_try,priority,error) VALUES(?,?,?,?,?,?)').run(mint,source,status,source?Date.now():Date.now()+DAY,priority?Date.now():0,source?null:'No safe published metadata URL');
  this.recordScan(mint,'metadata',status,source?(full?'Ready queue full; scan deferred':'Launch metadata queued'):'No safe published metadata URL');
 }
 get(mint) {
  const row=this.db.prepare('SELECT mint,source,status,phase,priority,fetched,next_try,payload,image_type,image_fetched,error FROM metadata WHERE mint=?').get(mint);
  if(!row)return {status:'not queued',summary:null,imageAvailable:false};
  const p=row.payload?JSON.parse(row.payload):{};
  const actualSource=row.phase==='image'?p.image:row.source;const requestSource=actualSource?(row.phase==='image'?artworkUrl(actualSource):actualSource):null;const wait=requestSource?this.sourceCooldown(mint,requestSource):null;const cooldownHost=wait?.host;const cooldown=wait?.retry_at;
  const last=this.db.prepare('SELECT at,state,message FROM scan_activity WHERE mint=? ORDER BY id DESC LIMIT 1').get(mint);
  const cooldownReason=cooldownHost?this.db.prepare('SELECT error FROM metadata_host_failures WHERE host=?').get(cooldownHost)?.error:null;
  return {cooldownHost:cooldown>Date.now()?cooldownHost:null,imageResized:!!this.db.prepare('SELECT resized FROM metadata_artwork_keys WHERE mint=?').get(mint)?.resized,imageFetchedSource:row.image_type?(this.db.prepare('SELECT source FROM metadata_image_sources WHERE mint=?').get(mint)?.source||p.image):null,imageCacheState:row.image_type?'cached':this.db.prepare('SELECT 1 FROM metadata_evictions WHERE mint=?').get(mint)?'evicted':null,phase:row.phase,prioritized:row.priority>0,sourceHost:actualSource?safeUrl(actualSource).hostname:null,cooldownUntil:cooldown>Date.now()?cooldown:null,cooldownReason:cooldown>Date.now()?cooldownReason||'Source rate limit':null,status:this.current?.mint===mint?'fetching':row.status,scanStage:this.current?.mint===mint?this.current.stage:null,scanUpdatedAt:last?.at||row.fetched,lastScan:last||null,source:row.source,fetchedAt:row.fetched,retryAt:row.next_try,summary:normalizeMetadata({description:p.description}).summary,description:p.description||null,links:p.links||[],imageSource:p.image||null,imageAvailable:!!row.image_type,imageFetchedAt:row.image_fetched,error:row.error};
 }
 recordScan(mint,stage,state,message){this.db.prepare('INSERT INTO scan_activity(mint,stage,state,at,message) VALUES(?,?,?,?,?)').run(mint,stage,state,Date.now(),String(message).slice(0,240));this.db.exec('DELETE FROM scan_activity WHERE id NOT IN (SELECT id FROM scan_activity ORDER BY id DESC LIMIT 200)')}
 scanSummary(){
  const counts=Object.fromEntries(this.db.prepare('SELECT status,COUNT(*) n FROM metadata GROUP BY status').all().map(r=>[r.status,r.n]));
  return {running:this.running,workerError:this.lastWorkerError,capacity:100,requestLimit:12,requestsLastMinute:this.db.prepare('SELECT COUNT(*) n FROM metadata_requests WHERE at>?').get(Date.now()-60000).n,queued:Math.max(0,(counts.queued||0)+(counts['image queued']||0)-(this.current?.wasQueued?1:0)),deferred:counts.deferred||0,retrying:counts.retry||0,checked:counts.ready||0,unavailable:counts.unavailable||0,active:this.current,cooldowns:this.db.prepare('SELECT host,retry_at retryAt FROM metadata_hosts WHERE retry_at>? ORDER BY retry_at LIMIT 8').all(Date.now()),recent:this.db.prepare('SELECT a.*,COALESCE(e.name,e.symbol,substr(a.mint,1,10)) name FROM scan_activity a LEFT JOIN events e ON e.mint=a.mint AND e.kind=\'create\' ORDER BY a.id DESC LIMIT 8').all()};
 }
 image(mint){const r=this.db.prepare('SELECT image,image_type FROM metadata WHERE mint=?').get(mint);if(r?.image)this.db.prepare('INSERT OR REPLACE INTO metadata_image_access VALUES(?,?)').run(mint,Date.now());return r?.image?{body:Buffer.from(r.image),type:r.image_type}:null}
 hostFailure(error,source){
  if(!['EPROTO','ECONNRESET','ECONNREFUSED','ETIMEDOUT','ENOTFOUND','EAI_AGAIN','CERT_HAS_EXPIRED','UNABLE_TO_VERIFY_LEAF_SIGNATURE','ERR_TLS_CERT_ALTNAME_INVALID'].includes(error.code)&&!['DNS lookup timed out','Request timed out'].includes(error.message))return;
  const host=error.host||safeUrl(source).hostname;
  const attempts=(this.db.prepare('SELECT attempts FROM metadata_host_failures WHERE host=?').get(host)?.attempts||0)+1;
  const retryAt=Date.now()+[60000,300000,3600000,DAY][Math.min(attempts-1,3)];
  this.db.prepare('INSERT INTO metadata_host_failures VALUES(?,?,?) ON CONFLICT(host) DO UPDATE SET attempts=excluded.attempts,error=excluded.error').run(host,attempts,clean(error.message,160));
  this.db.prepare('INSERT INTO metadata_hosts VALUES(?,?) ON CONFLICT(host) DO UPDATE SET retry_at=MAX(retry_at,excluded.retry_at)').run(host,retryAt);
  error.retryAt=retryAt;
 }
 hostSuccess(source){this.db.prepare('DELETE FROM metadata_host_failures WHERE host=?').run(safeUrl(source).hostname)}
 reserve(source) {
  if(source){const r=this.db.prepare('SELECT retry_at FROM metadata_hosts WHERE host=?').get(safeUrl(source).hostname);if(r?.retry_at>Date.now()){const e=new Error(this.db.prepare('SELECT error FROM metadata_host_failures WHERE host=?').get(safeUrl(source).hostname)?'Source host cooldown; waiting':'Source host rate-limited; waiting');e.retryAt=r.retry_at;throw e}}
  const now=Date.now();this.db.prepare('DELETE FROM metadata_requests WHERE at<=?').run(now-60000);
  const r=this.db.prepare('SELECT COUNT(*) n,MIN(at) oldest FROM metadata_requests').get();
  if(r.n>=12){const e=new Error('Metadata rate limit; queued');e.retryAt=r.oldest+60001;throw e}
  this.db.prepare('INSERT INTO metadata_requests(at) VALUES(?)').run(now);
 }
 cachedArtwork(source,bytes=false){return this.db.prepare(`SELECT m.mint,m.image_type,m.image_fetched,s.source,k.resized${bytes?',m.image':''} FROM metadata_artwork_keys k JOIN metadata_image_sources s ON s.mint=k.mint JOIN metadata m ON m.mint=k.mint WHERE k.requested=? AND m.image IS NOT NULL AND m.image_fetched>? ORDER BY m.image_fetched DESC LIMIT 1`).get(source,Date.now()-DAY)}
 trimImages(){
  let bytes=this.db.prepare('SELECT COALESCE(SUM(length(image)),0) n FROM metadata').get().n;
  while(bytes>this.cacheMaxBytes){const row=this.db.prepare('SELECT m.mint,length(m.image) bytes FROM metadata m LEFT JOIN metadata_image_access a ON a.mint=m.mint WHERE m.image IS NOT NULL ORDER BY COALESCE(a.accessed,m.image_fetched),m.rowid LIMIT 1').get();if(!row)break;this.db.prepare('UPDATE metadata SET image=NULL,image_type=NULL,image_fetched=NULL WHERE mint=?').run(row.mint);this.db.prepare('INSERT OR REPLACE INTO metadata_evictions VALUES(?,?)').run(row.mint,Date.now());bytes-=row.bytes}
 }
 sourceCooldown(mint,source){const original=safeUrl(source).hostname;const mapped=this.db.prepare('SELECT host FROM metadata_failure_hosts WHERE mint=? AND source=?').get(mint,source)?.host;return this.db.prepare('SELECT host,retry_at FROM metadata_hosts WHERE host IN (?,?) ORDER BY retry_at DESC LIMIT 1').get(original,mapped||original)}
 requestWait(source){const host=this.db.prepare('SELECT retry_at FROM metadata_hosts WHERE host=?').get(safeUrl(source).hostname);if(host?.retry_at>Date.now())return host.retry_at;const quota=this.db.prepare('SELECT COUNT(*) n,MIN(at) oldest FROM metadata_requests WHERE at>?').get(Date.now()-60000);return quota.n>=12?quota.oldest+60001:null}
 async tick() {
  if(this.busy)return;this.busy=true;
  try {
   const fields="CASE WHEN phase='image' AND fetched IS NOT NULL THEN MIN(next_try,fetched+86400000) ELSE next_try END eligible_at,rowid ordinal,mint,source,status,phase,fetched,next_try,attempts,priority,payload,image_type";
   const due="source IS NOT NULL AND (next_try<=? OR (phase='image' AND fetched<=?))";
   const batch=(where,limit)=>this.db.prepare(`SELECT ${fields} FROM metadata WHERE ${due} AND ${where} ORDER BY priority DESC,eligible_at,rowid LIMIT ${limit}`).all(Date.now(),Date.now()-DAY);
   const candidates=[...batch('priority>0',100),...batch("priority=0 AND status!='deferred'",200),...batch("priority=0 AND status='deferred'",500)].sort((a,b)=>b.priority-a.priority||a.eligible_at-b.eligible_at||a.ordinal-b.ordinal);
   const eligible=[];for(const candidate of candidates){if(candidate.phase==='image'&&candidate.fetched&&candidate.fetched<=Date.now()-DAY){candidate.phase='json';candidate.attempts=0;this.db.prepare("UPDATE metadata SET phase='json',attempts=0,next_try=? WHERE mint=?").run(Date.now(),candidate.mint)}const src=candidate.phase==='image'?artworkUrl(JSON.parse(candidate.payload).image):candidate.source;if(candidate.phase==='image'&&this.cachedArtwork(src)){eligible.push(candidate);continue}const failed=candidate.phase==='image'?this.db.prepare('SELECT f.next_try,f.error,h.host FROM metadata_image_failures f LEFT JOIN metadata_image_failure_hosts h ON h.source=f.source WHERE f.source=?').get(src):null;if(failed?.next_try>Date.now()){if(failed.host)this.db.prepare('INSERT OR REPLACE INTO metadata_failure_hosts VALUES(?,?,?)').run(candidate.mint,src,failed.host);this.db.prepare("UPDATE metadata SET status='retry',next_try=?,error=? WHERE mint=?").run(failed.next_try,failed.error,candidate.mint);this.recordScan(candidate.mint,'artwork','unavailable','Cached source error; no repeat request sent');continue}const cooldown=this.sourceCooldown(candidate.mint,src)?.retry_at;if(cooldown>Date.now()){this.db.prepare("UPDATE metadata SET status='retry',next_try=?,error=? WHERE mint=?").run(cooldown,'Source host cooldown; waiting',candidate.mint);this.recordScan(candidate.mint,candidate.phase==='image'?'artwork':'metadata','unavailable','Source cooldown; no request sent')}else eligible.push(candidate)}
   let room=100-this.db.prepare("SELECT COUNT(*) n FROM metadata WHERE status IN ('queued','image queued')").get().n;
   for(let i=0;i<eligible.length;i++){const r=eligible[i];if(r.status==='deferred'){if(room>0){r.status=r.phase==='image'?'image queued':'queued';this.db.prepare('UPDATE metadata SET status=? WHERE mint=?').run(r.status,r.mint);room--;this.recordScan(r.mint,r.phase==='image'?'artwork':'metadata','queued','Deferred scan admitted to ready queue')}else if(!r.priority){eligible.splice(i--,1)}}}
   const row=(this.priorityRuns>=2?eligible.find(r=>!r.priority):null)||eligible[0];if(!row)return;
   const cachedImage=row.phase==='image'?this.cachedArtwork(artworkUrl(JSON.parse(row.payload).image),true):null;
   const quota=this.db.prepare('SELECT COUNT(*) n FROM metadata_requests WHERE at>?').get(Date.now()-60000);if(quota.n>=12&&!cachedImage)return;
   this.priorityRuns=row.priority?this.priorityRuns+1:0;
   this.current={mint:row.mint,stage:row.phase==='image'?'artwork':'metadata',startedAt:Date.now(),wasQueued:['queued','image queued'].includes(row.status),source:row.phase==='image'?artworkUrl(JSON.parse(row.payload).image):row.source};
   if(!cachedImage)this.recordScan(row.mint,this.current.stage,'fetching','Fetching published '+this.current.stage);
   try {
    if(row.phase==='image'){
     const p=JSON.parse(row.payload);const imageUrl=artworkUrl(p.image);const result=cachedImage?{body:Buffer.from(cachedImage.image),type:cachedImage.image_type,url:cachedImage.source}:await this.fetcher(imageUrl,'image',{reserve:u=>this.reserve(u)});
     this.db.prepare('DELETE FROM metadata_failure_hosts WHERE mint=?').run(row.mint);if(!cachedImage)this.hostSuccess(result.url||imageUrl);this.db.prepare('INSERT OR REPLACE INTO metadata_image_sources VALUES(?,?)').run(row.mint,result.url||imageUrl);this.db.prepare('INSERT OR REPLACE INTO metadata_artwork_keys VALUES(?,?,?)').run(row.mint,imageUrl,cachedImage?cachedImage.resized:imageUrl!==p.image?1:0);this.db.prepare('DELETE FROM metadata_image_failures WHERE source=?').run(imageUrl);this.db.prepare('DELETE FROM metadata_image_failure_hosts WHERE source=?').run(imageUrl);
     this.db.prepare("UPDATE metadata SET image=?,image_type=?,image_fetched=?,status='ready',phase='json',attempts=0,next_try=?,priority=0,error=NULL WHERE mint=?").run(result.body,result.type,cachedImage?.image_fetched||Date.now(),Date.now()+DAY,row.mint);
     this.db.prepare('DELETE FROM metadata_evictions WHERE mint=?').run(row.mint);this.trimImages();this.recordScan(row.mint,'artwork','checked',cachedImage?'Reused validated artwork cache; source fetch time preserved':'Raster artwork validated and cached');
    }else{
     const result=await this.fetcher(row.source,'json',{reserve:u=>this.reserve(u)});const p=normalizeMetadata(JSON.parse(result.body.toString('utf8')));
     this.db.prepare('DELETE FROM metadata_failure_hosts WHERE mint=?').run(row.mint);this.hostSuccess(result.url||row.source);
     const keepImage=!!row.image_type&&JSON.parse(row.payload||'{}').image===p.image;
     const room=this.current.wasQueued||this.db.prepare("SELECT COUNT(*) n FROM metadata WHERE status IN ('queued','image queued')").get().n<100;
     this.db.prepare('UPDATE metadata SET source=?,payload=?,fetched=?,status=?,phase=?,attempts=0,next_try=?,priority=?,image=CASE WHEN ? THEN image ELSE NULL END,image_type=CASE WHEN ? THEN image_type ELSE NULL END,image_fetched=CASE WHEN ? THEN image_fetched ELSE NULL END,error=NULL WHERE mint=?').run(result.url,JSON.stringify(p),Date.now(),p.image?(room?'image queued':'deferred'):'ready',p.image?'image':'json',p.image?Date.now():Date.now()+DAY,p.image?row.priority:0,keepImage?1:0,keepImage?1:0,keepImage?1:0,row.mint);
     this.recordScan(row.mint,'metadata','checked',`${p.summary?'Published description found':'No usable narrative'}; ${p.image?(room?'artwork queued':'artwork deferred; queue full'):'no artwork supplied'}`);this.onMetadata(row.mint,this.get(row.mint));
    }
   }catch(e){
    if(e.host)this.db.prepare('INSERT OR REPLACE INTO metadata_failure_hosts VALUES(?,?,?)').run(row.mint,this.current.source,e.host);
    this.hostFailure(e,this.current.source);
    const attempts=row.attempts+1;let delay=[60000,300000,3600000,DAY][Math.min(attempts-1,3)];
    if([403,404,410].includes(e.status)||['Response exceeds size limit','Unsupported or invalid raster image','Unsupported or excessive image dimensions'].includes(e.message))delay=DAY;
    if(e.status===429){this.db.prepare('DELETE FROM metadata_host_failures WHERE host=?').run(e.host||safeUrl(this.current.source).hostname);e.retryAt=rateRetryAt(e);delay=e.retryAt-Date.now();this.db.prepare('INSERT INTO metadata_hosts VALUES(?,?) ON CONFLICT(host) DO UPDATE SET retry_at=MAX(retry_at,excluded.retry_at)').run(e.host||safeUrl(this.current.source).hostname,e.retryAt)}
    if(row.phase==='image'){this.db.prepare('INSERT OR REPLACE INTO metadata_image_failures VALUES(?,?,?)').run(this.current.source,e.retryAt||Date.now()+delay,clean(e.message,160));this.db.prepare('INSERT OR REPLACE INTO metadata_image_failure_hosts VALUES(?,?)').run(this.current.source,e.host||safeUrl(this.current.source).hostname)}
    this.db.prepare("UPDATE metadata SET status='retry',attempts=?,next_try=?,priority=0,error=? WHERE mint=?").run(attempts,e.retryAt||Date.now()+delay,clean(e.message,160),row.mint);
    this.recordScan(row.mint,this.current.stage,'unavailable',clean(e.message,160)+'; retry scheduled');
   }
  }finally{this.busy=false;this.current=null}
 }
 start(){this.running=true;this.timer=setInterval(()=>{this.tick().then(()=>this.lastWorkerError=null).catch(e=>{this.lastWorkerError=e.message;console.error('Metadata cache:',e.message)})},5000)}
 stop(){this.running=false;clearInterval(this.timer)}
}
