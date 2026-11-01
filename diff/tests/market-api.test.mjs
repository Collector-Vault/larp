import test from 'node:test';import assert from 'node:assert/strict';
import {Store} from '../store.mjs';import {createApp} from '../server.mjs';
test('events expose independent provider values and choose only a fresh reported alternative cap',async()=>{
 const store=new Store(':memory:'),mint='A'.repeat(32);store.ingest({mint,txType:'create'});
 let observed=0;const quote=cap=>({status:'available',stale:false,fetchedAt:Date.now(),data:{marketCapUsd:cap,liquidityUsd:null}});
 const primary={get:()=>quote(100),observe:()=>observed++},alternative={get:()=>quote(120),observe:()=>observed++};
 const app=createApp(store,{status:{}},null,null,primary,null,null,alternative);await new Promise(r=>app.listen(0,'127.0.0.1',r));
 try{const {events}=await fetch('http://127.0.0.1:'+app.address().port+'/api/events').then(r=>r.json());assert.equal(events[0].market.source,'GeckoTerminal');assert.equal(events[0].marketComparison.primary.data.marketCapUsd,100);assert.equal(events[0].market.data.marketCapUsd,120);assert.equal(observed,2)}finally{await new Promise(r=>app.close(r));store.close()}
});
