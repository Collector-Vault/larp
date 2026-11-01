// Synthetic display evidence only. No live evidence file or provider requests.
import {Store} from '../store.mjs';
import {Metadata,normalizeMetadata} from '../metadata.mjs';
import {createApp} from '../server.mjs';
import {offlineFetch,seedOnce,syntheticTech,launchFixture} from './helpers/fixture-support.mjs';

export function createFunctionalUiFixture({store,dbPath=':memory:'}={}){
 // Pass an explicit temporary dbPath only when persistence is part of QA.
 store??=new Store(dbPath);
 const metadata=new Metadata(store,{fetcher:offlineFetch}),mint='A'.repeat(32);
 seedOnce(store,'functional',()=>{
  store.ingest({mint,txType:'create',name:'QA ONLY - SYNTHETIC linked service check',symbol:'TEST',uri:'https://example.invalid/synthetic-metadata'});
  metadata.enqueue(mint);
  const payload=normalizeMetadata({description:'SYNTHETIC QA ONLY: simulated linked swap quote evidence. No service was contacted; this is not a live observation.',website:'https://example.invalid/synthetic-service'});
  store.db.prepare("UPDATE metadata SET status='ready',payload=?,fetched=?,next_try=? WHERE mint=?").run(JSON.stringify(payload),Date.now(),Date.now()+86400000,mint);
 });
 const tech=syntheticTech(),feed={status:{state:'stopped',error:'SYNTHETIC ISOLATED QA ONLY - no collectors or provider requests'}};
 return {app:createApp(store,feed,metadata,tech),store,metadata,tech};
}
launchFixture(import.meta.url,createFunctionalUiFixture);
