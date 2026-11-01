import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../store.mjs';
import {Market} from '../market.mjs';
const mint='A'.repeat(32),pair='B'.repeat(32);
const sample={chainId:'solana',baseToken:{address:mint},pairAddress:pair,marketCap:100,fdv:200,priceUsd:'0.12'};
for(const change of [{marketCap:{}},{marketCap:'100'},{fdv:[]},{priceUsd:'0x10'},{priceUsd:0.12}])test('malformed consumed fields retain old quote: '+JSON.stringify(change),async t=>{
 const s=new Store(':memory:');t.after(()=>s.close());s.ingest({mint,txType:'create'});let now=100000,payload=[sample];
 const m=new Market(s,{now:()=>now,fetcher:async()=>({body:Buffer.from(JSON.stringify(payload))})});await m.tick();const old=m.get(mint);
 now+=31000;payload=[{...sample,...change}];await m.tick();const failed=m.get(mint);
 assert.equal(failed.status,'unavailable');assert.equal(failed.stale,true);assert.equal(failed.fetchedAt,old.fetchedAt);assert.deepEqual(failed.data,old.data);assert.equal(failed.checkedAt,now);assert.match(failed.error,/field|payload/i);
 payload=[sample];now+=31000;await m.tick();assert.equal(m.get(mint).status,'available');assert.equal(m.get(mint).fetchedAt,now);
});
test('nullable unknown values remain valid provider coverage',async t=>{
 const s=new Store(':memory:');t.after(()=>s.close());s.ingest({mint,txType:'create'});
 const m=new Market(s,{fetcher:async()=>({body:Buffer.from(JSON.stringify([{...sample,marketCap:null,fdv:null,priceUsd:null}]))})});await m.tick();assert.equal(m.get(mint).status,'available');assert.equal(m.get(mint).data.marketCapUsd,null);
});
