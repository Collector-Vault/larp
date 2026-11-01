import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../store.mjs';
import {Market} from '../market.mjs';
const alphabet='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const mint=i=>'A'.repeat(29)+alphabet[Math.floor(i/3364)%58]+alphabet[Math.floor(i/58)%58]+alphabet[i%58];
const pairs=ids=>ids.map(id=>({chainId:'solana',baseToken:{address:id},pairAddress:mint(2000),marketCap:12000,liquidity:{usd:3000}}));
function fixture(t,count=350){const s=new Store(':memory:');t.after(()=>s.close());for(let i=0;i<count;i++)s.ingest({mint:mint(i),txType:'create'},i+1);return s}
const ids=url=>url.split('/').at(-1).split(',');
const force=m=>m.db.prepare('UPDATE market_control SET next_at=0').run();

test('visible positive-cap coins refresh alongside selected, new and old hidden candidates',async t=>{
 const s=fixture(t);let requested;const m=new Market(s,{fetcher:async url=>{requested=ids(url);return {body:Buffer.from('[]')}}});
 m.focus(mint(100));m.observe(Array.from({length:19},(_,i)=>({mint:mint(i+50),market:{data:{marketCapUsd:12000}}})));
 await m.tick();assert.equal(requested.length,30);assert.equal(new Set(requested).size,30);assert.ok(requested.includes(mint(100)));
 for(let i=50;i<69;i++)assert.ok(requested.includes(mint(i)));
 for(let i=345;i<350;i++)assert.ok(requested.includes(mint(i)));
 for(let i=0;i<5;i++)assert.ok(requested.includes(mint(i)));
});

test('hidden history advances fairly instead of rechecking the same newest batch',async t=>{
 const s=fixture(t);const batches=[];const m=new Market(s,{fetcher:async url=>{batches.push(ids(url));return {body:Buffer.from('[]')}}});
 await m.tick();force(m);await m.tick();assert.ok(batches[0].includes(mint(0)));assert.ok(!batches[1].includes(mint(0)));assert.ok(batches[1].some(id=>!batches[0].includes(id)));assert.equal(batches[1].length,30);
});

test('observation ignores zero missing and FDV-only caps and expires after ninety seconds',async t=>{
 let now=1000000;t.mock.method(Date,'now',()=>now);const s=fixture(t);const batches=[];const m=new Market(s,{fetcher:async url=>{batches.push(ids(url));return {body:Buffer.from('[]')}}});
 m.observe([{mint:mint(100),market:{data:{marketCapUsd:100}}},{mint:mint(101),market:{data:{marketCapUsd:0}}},{mint:mint(102),market:{data:{fdvUsd:50000}}}]);
 await m.tick();assert.ok(batches[0].includes(mint(100)));assert.ok(!batches[0].includes(mint(101)));assert.ok(!batches[0].includes(mint(102)));
 now+=90001;force(m);await m.tick();assert.ok(!batches[1].includes(mint(100)));
});

test('new candidate can gain real cap then stay refreshed and recover honestly from outage',async t=>{
 const s=fixture(t,1);let fail=false;const m=new Market(s,{fetcher:async url=>{if(fail)throw new Error('source outage');return {body:Buffer.from(JSON.stringify(pairs(ids(url))))}}});
 assert.equal(m.get(mint(0)).status,'pending');await m.tick();assert.equal(m.get(mint(0)).data.marketCapUsd,12000);m.observe([{mint:mint(0),market:m.get(mint(0))}]);
 fail=true;force(m);await m.tick();assert.equal(m.get(mint(0)).stale,true);assert.equal(m.get(mint(0)).data.marketCapUsd,12000);
 fail=false;force(m);await m.tick();assert.equal(m.get(mint(0)).stale,false);
});

test('cap coverage does not manufacture liquidity or borrow a different mint pool',async t=>{
 const s=fixture(t,2);const wrong=pairs([mint(1)])[0];const correct={...pairs([mint(0)])[0],liquidity:null,vSolInBondingCurve:90};
 const m=new Market(s,{fetcher:async()=>({body:Buffer.from(JSON.stringify([wrong,correct]))})});await m.tick();
 assert.equal(m.get(mint(0)).data.marketCapUsd,12000);assert.equal(m.get(mint(0)).data.liquidityUsd,null);assert.equal(m.get(mint(1)).data.liquidityUsd,3000);
});

test('active observation memory is capped at two hundred despite repeated refreshes',t=>{
 const s=fixture(t);const m=new Market(s);const observed=Array.from({length:350},(_,i)=>({mint:mint(i),market:{data:{marketCapUsd:100}}}));
 m.observe(observed);assert.equal(m.observed.size,200);assert.ok(!m.observed.has(mint(0)));assert.ok(m.observed.has(mint(349)));
 m.observe(observed.slice(0,10));assert.equal(m.observed.size,200);assert.ok(m.observed.has(mint(0)));
});

test('fresh visible quotes precede stale observed history without taking discovery slots',async t=>{
 const s=fixture(t);let requested;const m=new Market(s,{fetcher:async url=>{requested=ids(url);return {body:Buffer.from('[]')}}});
 const now=Date.now();for(let i=50;i<250;i++)s.db.prepare("INSERT INTO market VALUES(?,'available',?,?,?,NULL)").run(mint(i),i<231?now-120000:now-5000,i<231?now-120000:now-5000,JSON.stringify({marketCapUsd:12000}));
 m.observe(Array.from({length:200},(_,i)=>({mint:mint(i+50),market:m.get(mint(i+50))})));m.focus(mint(300));await m.tick();
 for(let i=231;i<250;i++)assert.ok(requested.includes(mint(i)),`fresh quote ${i} must retain a refresh slot`);
 for(let i=345;i<350;i++)assert.ok(requested.includes(mint(i)));
 for(let i=0;i<5;i++)assert.ok(requested.includes(mint(i)));
 assert.equal(requested.length,30);
});
