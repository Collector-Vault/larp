import {SharedRPC} from './shared-rpc.mjs';
import {MintControls} from './mint-controls.mjs';
import {AlternativeMarket} from './alternative-market.mjs';
import {chooseMarket} from './market-choice.mjs';
import {Wallets,publicKey} from './wallets.mjs';
import {WalletRPC} from './wallet-rpc.mjs';
import {Market} from './market.mjs';
import http from 'node:http';
import {readFileSync,mkdirSync} from 'node:fs';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {join,dirname} from 'node:path';
import {Store} from './store.mjs';
import {Feed} from './feed.mjs';
import {Metadata} from './metadata.mjs';
import {TechChecks} from './tech.mjs';
const root=dirname(fileURLToPath(import.meta.url));
const staticFiles={'/':['index.html','text/html'],'/app.js':['app.js','text/javascript'],'/project.js':['project.js','text/javascript'],'/scanner.js':['scanner.js','text/javascript'],'/market.js':['market.js','text/javascript'],'/fees.js':['fees.js','text/javascript'],'/wallets.js':['wallets.js','text/javascript'],'/style.css':['style.css','text/css']};
export function createApp(store,feed,metadata=null,tech=null,market=null,wallets=null,walletRpc=null,alternative=null,mintControls=null,sharedRpc=null) {
 return http.createServer(async(req,res)=>{
  const json=(code,data)=>{res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data))};
  const host=req.headers.host||'';
  if(!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host))return json(403,{error:'Local access only'});
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Content-Security-Policy',"default-src 'self'; connect-src 'self'; img-src 'self'; style-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
  const url=new URL(req.url,`http://${host}`);
  try {
   if(req.method==='GET'&&url.pathname==='/api/status')return json(200,{feed:feed.status,stats:store.stats(),scanner:metadata?{...metadata.scanSummary(),websiteActive:tech?.current||null}:null,market:market?.summary(),alternativeMarket:alternative?.summary(),mintControls:mintControls?.summary(),solanaRpc:sharedRpc?.summary(),serverTime:Date.now(),coverage:'PumpPortal new-token and migration events only. Offline periods are not backfilled.'});
   if(req.method==='GET'&&url.pathname==='/api/events'){
    const {events,page}=store.listPage({q:url.searchParams.get('q')||'',kind:url.searchParams.get('kind')||'',watch:url.searchParams.get('watch')==='1',offset:Number(url.searchParams.get('offset')||0)});
    if(metadata){events.slice(0,20).forEach(e=>metadata.enqueue(e.mint));events.forEach(e=>{e.project=metadata.get(e.mint);if(tech){tech.enqueue(e.mint,e.project);e.project.tech=tech.get(e.mint,e.project)}})}
    events.forEach(e=>{const primary=market?.get(e.mint),secondary=alternative?.get(e.mint);e.marketComparison={primary,alternative:secondary};e.market=chooseMarket(primary,secondary);e.fees={status:'unavailable',metric:'cumulative-token-trading-fees',unit:'SOL',value:null,verified:false,reason:'No supported free source for complete cumulative token trading fees'}});const visible=new Set((url.searchParams.get('visible')||'').split(',').slice(0,30));market?.observe?.(events.filter(e=>visible.has(e.mint)));events.forEach((e,i)=>{if(publicKey(e.mint)&&(visible.has(e.mint)||i<5))mintControls?.enqueue(e.mint,visible.has(e.mint));e.controls=mintControls?.get(e.mint)});alternative?.observe?.(events);return json(200,{events,page});
   }
   if(req.method==='GET'&&url.pathname==='/api/project'&&metadata){const mint=url.searchParams.get('mint');metadata.enqueue(mint,true);market?.focus(mint);alternative?.focus(mint);if(publicKey(mint))mintControls?.enqueue(mint,true);return json(200,metadata.get(mint||''))}
   if(req.method==='GET'&&url.pathname==='/api/image'&&metadata){
    const image=metadata.image(url.searchParams.get('mint')||'');if(!image)return json(404,{error:'Artwork unavailable'});
    res.writeHead(200,{'Content-Type':image.type,'Cache-Control':'private, max-age=3600','Content-Length':image.body.length});res.end(image.body);return;
   }
   if(req.method==='GET'&&url.pathname==='/api/wallets'&&wallets)return json(200,{wallets:wallets.list(),report:wallets.report(),rpc:walletRpc?.summary()});
   if(req.method==='GET'&&url.pathname==='/api/wallets/export'&&wallets){res.setHeader('Content-Disposition','attachment; filename="DIFF-private-wallets.json"');return json(200,wallets.export())}
   if(req.method==='POST'&&url.pathname==='/api/wallets'&&wallets){
    if((req.headers.origin&&req.headers.origin!==`http://${host}`)||req.headers['sec-fetch-site']==='cross-site')return json(403,{error:'Foreign origin denied'});
    let body='';for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>2200000)return json(413,{error:'Wallet import too large'})}
    const d=JSON.parse(body);let result={ok:true};
    if(d.action==='import')result=wallets.import(d.text);else if(d.action==='edit')wallets.update(d.address,d.label);else if(d.action==='remove')wallets.remove(d.address);else if(d.action==='check'&&walletRpc)walletRpc.queue(d.address);else throw new Error('Unknown wallet action');return json(200,result);
   }
   if(req.method==='POST'&&url.pathname==='/api/watch'){
    if((req.headers.origin&&req.headers.origin!==`http://${host}`)||req.headers['sec-fetch-site']==='cross-site')return json(403,{error:'Foreign origin denied'});
    let body='';for await(const chunk of req){body+=chunk;if(body.length>2048)return json(413,{error:'Request too large'})}
    const data=JSON.parse(body);if(typeof data.enabled!=='boolean')throw new Error('enabled must be boolean');store.setWatch(data.mint,data.enabled);return json(200,{ok:true});
   }
   if(req.method==='GET'&&staticFiles[url.pathname]){
    const [file,type]=staticFiles[url.pathname];res.writeHead(200,{'Content-Type':type+'; charset=utf-8','Cache-Control':'no-cache'});res.end(readFileSync(join(root,'public',file)));return;
   }
   json(404,{error:'Not found'});
  }catch(e){json(400,{error:e.message})}
 });
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 mkdirSync(join(root,'data'),{recursive:true});
 const store=new Store(join(root,'data','diff.sqlite'));const metadata=new Metadata(store);const tech=new TechChecks(metadata);metadata.onMetadata=(mint,p)=>tech.enqueue(mint,p);const feed=new Feed(store,{onEvent:e=>metadata.enqueue(e.mint)});const market=new Market(store);const alternative=new AlternativeMarket(store);const wallets=new Wallets(store);const sharedRpc=new SharedRPC(store);const walletRpc=new WalletRPC(wallets,{lookup:address=>sharedRpc.request('getSignaturesForAddress',address)});const mintControls=new MintControls(store,{lookup:mint=>sharedRpc.request('getAccountInfo',mint)});const app=createApp(store,feed,metadata,tech,market,wallets,walletRpc,alternative,mintControls,sharedRpc);
 app.on('error',e=>{console.error(e.code==='EADDRINUSE'?'DIFF port 4317 is already in use. Open http://127.0.0.1:4317 or stop the existing instance.':e.message);store.close();process.exitCode=1});
 app.listen(4317,'127.0.0.1',()=>{console.log('DIFF http://127.0.0.1:4317');store.list({limit:20}).forEach(e=>metadata.enqueue(e.mint));feed.start();metadata.start();tech.start();market.start();alternative.start();walletRpc.start();mintControls.start()});
 for(const sig of ['SIGINT','SIGTERM'])process.on(sig,()=>{feed.stop();metadata.stop();tech.stop();market.stop();alternative.stop();walletRpc.stop();mintControls.stop();app.close(()=>{store.close();process.exit(0)})});
}

