import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../store.mjs';
import {Metadata,normalizeMetadata} from '../metadata.mjs';
import {Market} from '../market.mjs';
const mint='A'.repeat(32), other='C'.repeat(32), pair='B'.repeat(32);
const quote={chainId:'solana',baseToken:{address:mint},pairAddress:pair,marketCap:12345,liquidity:{usd:6789}};

test('live deployment-tool boilerplate is retained as source text without calling it a coin narrative',()=>{
 const description='Deployed using https://j7tracker.io';const result=normalizeMetadata({description});assert.equal(result.description,description);assert.equal(result.summary,null);
 assert.equal(normalizeMetadata({description:'Deployed using a decentralized oracle to deliver weather data.'}).summary,'Deployed using a decentralized oracle to deliver weather data.');
});

test('temporary missing market coverage retains last verified quote as stale until recovery',async t=>{
 const s=new Store(':memory:');t.after(()=>s.close());s.ingest({mint,txType:'create'});let response=[quote];
 const m=new Market(s,{fetcher:async()=>({body:Buffer.from(JSON.stringify(response))})});
 await m.tick();const fetched=m.get(mint).fetchedAt;
 response=[];s.db.prepare('UPDATE market_control SET next_at=0').run();s.db.prepare('UPDATE market SET checked=0').run();await m.tick();
 const missing=m.get(mint);assert.equal(missing.status,'not indexed');assert.equal(missing.data?.marketCapUsd,12345);assert.equal(missing.fetchedAt,fetched);assert.equal(missing.stale,true);assert.match(missing.error,/last verified/i);
 response=[{...quote,marketCap:13000}];s.db.prepare('UPDATE market_control SET next_at=0').run();s.db.prepare('UPDATE market SET checked=0').run();await m.tick();assert.equal(m.get(mint).data.marketCapUsd,13000);assert.equal(m.get(mint).stale,false);assert.equal(m.get(mint).error,null);
});

test('shared redirected artwork rate limit retains full Retry-After before another token retries',async t=>{
 const s=new Store(':memory:');t.after(()=>s.close());let images=0;
 const m=new Metadata(s,{fetcher:async(url,kind)=>{if(kind==='image'){images++;throw Object.assign(new Error('Source HTTP 429'),{status:429,retryAfter:'7200',host:'cdn.example'})}return {url,body:Buffer.from('{"image":"https://images.example/original.png"}')}}});
 for(const key of [mint,other])s.ingest({mint:key,txType:'create',uri:'https://metadata.example/info'});
 m.enqueue(mint,true);await m.tick();await m.tick();
 const host=s.db.prepare('SELECT retry_at FROM metadata_hosts WHERE host=?').get('cdn.example');
 const failure=s.db.prepare('SELECT next_try FROM metadata_image_failures').get();
 assert.ok(failure.next_try>=host.retry_at);assert.ok(failure.next_try>Date.now()+7199000);
 m.enqueue(other,true);await m.tick();await m.tick();assert.equal(images,1);assert.ok(m.get(other).retryAt>Date.now()+7199000);
 assert.equal(m.get(other).sourceHost,'images.example');assert.equal(m.get(other).cooldownHost,'cdn.example');assert.equal(m.get(other).cooldownUntil,host.retry_at);
 const restarted=new Metadata(s);assert.equal(restarted.get(other).cooldownHost,'cdn.example');assert.equal(restarted.get(other).cooldownUntil,host.retry_at);
});

test('redirect cooldown exposes actual failed host across restart and clears after recovery',async t=>{
 const s=new Store(':memory:');t.after(()=>s.close());s.ingest({mint,txType:'create',uri:'https://origin.example/info'});
 let m=new Metadata(s,{fetcher:async()=>{throw Object.assign(new Error('Source HTTP 429'),{status:429,retryAfter:'7200',host:'cdn.example'})}});
 m.enqueue(mint);await m.tick();m=new Metadata(s);
 assert.equal(m.get(mint).sourceHost,'origin.example');assert.equal(m.get(mint).cooldownHost,'cdn.example');assert.ok(m.get(mint).cooldownUntil>Date.now()+7199000);
 let calls=0;m.fetcher=async()=>{calls++;throw new Error('must not fetch while redirect target blocked')};s.db.prepare('UPDATE metadata SET next_try=0').run();await m.tick();assert.equal(calls,0);assert.ok(m.get(mint).retryAt>Date.now()+7199000);
 s.db.prepare('UPDATE metadata SET source=? WHERE mint=?').run('https://new.example/info',mint);
 assert.equal(m.get(mint).cooldownHost,null);assert.equal(m.get(mint).cooldownUntil,null);
 s.db.prepare('UPDATE metadata SET source=?,next_try=0 WHERE mint=?').run('https://origin.example/info',mint);s.db.prepare('UPDATE metadata_hosts SET retry_at=0').run();
 m.fetcher=async url=>({url,body:Buffer.from('{"description":"Recovered published information"}')});await m.tick();assert.equal(m.get(mint).cooldownHost,null);assert.equal(m.get(mint).error,null);assert.equal(m.get(mint).summary,'Recovered published information');
});
