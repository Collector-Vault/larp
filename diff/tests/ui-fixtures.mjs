// Isolated synthetic browser QA. Never starts collectors or reads the live DB.
import {Wallets} from '../wallets.mjs';
import {Store} from '../store.mjs';
import {Metadata,normalizeMetadata} from '../metadata.mjs';
import {createApp} from '../server.mjs';
import {offlineFetch,seedOnce,syntheticTech,launchFixture} from './helpers/fixture-support.mjs';

export const syntheticWallets=[
 {address:'US517G5965aydkZ46HS38QLi7UQiSojurfbQfKCELFx',name:'SYNTHETIC QA wallet one'},
 {address:'YMN9Qj5jPNp7j14VPcML1B6xGgcPWVZUGLFU3Mnyfaf',name:'SYNTHETIC QA wallet two'},
];
export function createUiFixture({store,dbPath=':memory:'}={}){
 store??=new Store(dbPath);
 const metadata=new Metadata(store,{fetcher:offlineFetch}),wallets=new Wallets(store);
 seedOnce(store,'ui',()=>{
  const scenarios=[['A','broken image and long text'],['B','missing metadata / expired cap'],['C','fresh lower cap'],['D','missing cap / FDV only']];
  scenarios.forEach(([letter,label],i)=>{
   const mint=letter.repeat(32);store.ingest({mint,txType:'create',name:'QA ONLY - SYNTHETIC '+label,symbol:'QA'+(i+1),uri:letter==='A'?'https://example.invalid/test':undefined});metadata.enqueue(mint);
   if(letter==='A'){
    const payload=normalizeMetadata({description:'SYNTHETIC QA ONLY. <script>alert(1)</script> Our SDK provides a public API. '+('A project claim, not a verified feature. '.repeat(140)),image:'https://example.invalid/broken.png',website:'https://127.0.0.1/private',twitter:'javascript:alert(1)'});
    store.db.prepare("UPDATE metadata SET status='ready',payload=?,fetched=?,next_try=?,image=?,image_type='image/png',image_fetched=? WHERE mint=?").run(JSON.stringify(payload),Date.now(),Date.now()+86400000,Buffer.from('synthetic broken image bytes'),Date.now(),mint);
   }
  });
  wallets.import(JSON.stringify(syntheticWallets));
 });
 const quote=(cap,age=0)=>({status:'available',stale:false,checkedAt:Date.now()-age,fetchedAt:Date.now()-age,data:{marketCapUsd:cap,fdvUsd:999999,pairAddress:'synthetic-pool',dexId:'SYNTHETIC QA',sourceUrl:'https://example.invalid/synthetic-pool'}});
 const market={get(mint){return mint==='A'.repeat(32)?quote(10000,1000):mint==='B'.repeat(32)?quote(250000,91000):mint==='C'.repeat(32)?quote(5000):quote(null)},observe(){},focus(){},summary(){return {running:false,source:'SYNTHETIC QA ONLY'}}};
 const alternative={...market,get(mint){return mint==='A'.repeat(32)?quote(12000):{status:'not indexed',stale:false,checkedAt:Date.now(),fetchedAt:Date.now(),data:null}}};
 const rpc={queue(address){store.db.prepare("UPDATE wallets SET status='SYNTHETIC lookup queued; no provider contacted' WHERE address=?").run(address)},summary(){return {running:false,source:'SYNTHETIC QA ONLY / no RPC requests',intervalSeconds:0,cycleMinutes:0,nextAt:null}}};
 const feed={status:{state:'stopped',error:'SYNTHETIC ISOLATED QA ONLY - no collectors or provider requests'}};
 const tech=syntheticTech({observed:false});
 return {app:createApp(store,feed,metadata,tech,market,wallets,rpc,alternative),store,metadata,wallets,market,alternative,rpc,tech};
}
launchFixture(import.meta.url,createUiFixture);
