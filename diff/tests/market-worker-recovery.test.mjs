import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../store.mjs';
import {Market} from '../market.mjs';
import {AlternativeMarket} from '../alternative-market.mjs';
import {Wallets} from '../wallets.mjs';
import {WalletRPC} from '../wallet-rpc.mjs';
const mint='So11111111111111111111111111111111111111112';
function faultOnce(worker,pattern){const db=worker.db;let armed=true;worker.db=new Proxy(db,{get(target,key){if(key==='prepare')return sql=>{if(armed&&pattern.test(sql)){armed=false;throw new Error('temporary database failure')}return target.prepare(sql)};const value=target[key];return typeof value==='function'?value.bind(target):value}});return ()=>{worker.db=db}};
for(const [name,make,control,cache] of [
 ['DEX',s=>new Market(s,{fetcher:async()=>({body:Buffer.from('[]')})}),'market_control',/INSERT INTO market/],
 ['Gecko',s=>new AlternativeMarket(s,{fetcher:async()=>({body:Buffer.from('{"data":[]}')})}),'alternative_market_control',/INSERT INTO alternative_market/],
 ['wallet',s=>{const w=new Wallets(s);w.import(mint);return new WalletRPC(w,{lookup:async()=>[]})},'wallet_rpc',/UPDATE wallets SET activity/]
]){
 for(const [stage,pattern] of [['limiter read',new RegExp('SELECT .*FROM '+control)],['reservation',new RegExp('UPDATE '+control+' SET next_at')],['cache',cache]])test(name+' recovers after '+stage+' failure',async t=>{const s=new Store(':memory:');t.after(()=>s.close());s.ingest({mint,txType:'create'});const worker=make(s),restore=faultOnce(worker,pattern);await assert.doesNotReject(()=>worker.tick());assert.equal(worker.busy,false);assert.match(worker.summary().error,/temporary database failure/);restore();s.db.prepare('UPDATE '+control+' SET next_at=0').run();await worker.tick();assert.equal(worker.busy,false);assert.equal(worker.summary().error,null);if(name==='wallet')assert.equal(s.db.prepare('SELECT status FROM wallets').get().status,'checked');else assert.equal(worker.get(mint).status,'not indexed')});
 if(name!=='wallet')test(name+' scheduler contains a rejected tick and keeps running',async t=>{const s=new Store(':memory:');t.after(()=>s.close());const worker=make(s);worker.tick=async()=>{throw new Error('scheduler fault')};worker.start();t.after(()=>worker.stop());await new Promise(r=>setImmediate(r));assert.equal(worker.summary().error,'scheduler fault')});
 for(const status of [403,429])test(name+' retains cooldown if writing failure cache fails',async t=>{const s=new Store(':memory:');t.after(()=>s.close());s.ingest({mint,txType:'create'});const worker=make(s);const fail=async()=>{throw Object.assign(new Error('provider cooldown'),{status,retryAfter:'7200'})};if(name==='wallet')worker.lookup=fail;else worker.fetcher=fail;const restore=faultOnce(worker,name==='wallet'?/UPDATE wallets SET checked/:cache);await assert.doesNotReject(()=>worker.tick());assert.equal(worker.busy,false);restore();const deadline=worker.summary().nextAt;assert.ok(deadline>Date.now()+3599000);if(worker.observe)worker.observe([{mint,market:{data:{marketCapUsd:100}}}]);assert.equal(worker.summary().nextAt,deadline)});
}


for(const [name,make,control] of [
 ['DEX',s=>new Market(s,{fetcher:async()=>{throw Object.assign(new Error('rate limit'),{status:429,retryAfter:'120'})}}),'market_control'],
 ['Gecko',s=>new AlternativeMarket(s,{fetcher:async()=>{throw Object.assign(new Error('rate limit'),{status:429,retryAfter:'120'})}}),'alternative_market_control'],
 ['wallet',s=>{const w=new Wallets(s);w.import(mint);return new WalletRPC(w,{lookup:async()=>{throw Object.assign(new Error('rate limit'),{status:429,retryAfter:'120'})}})},'wallet_rpc']
])test(name+' retries a failed cooldown write before any new request',async t=>{const s=new Store(':memory:');t.after(()=>s.close());s.ingest({mint,txType:'create'});const worker=make(s),db=worker.db;let updates=0;worker.db=new Proxy(db,{get(target,key){if(key==='prepare')return sql=>{if(sql.startsWith('UPDATE '+control+' SET next_at')&&++updates===2)throw new Error('cooldown write failed');return target.prepare(sql)};const value=target[key];return typeof value==='function'?value.bind(target):value}});await worker.tick();assert.equal(worker.busy,false);assert.match(worker.summary().error,/cooldown write failed/);assert.ok(worker.summary().nextAt>Date.now()+119000);worker.db=db;const forbidden=async()=>{assert.fail('cooldown must prevent provider call')};if(name==='wallet')worker.lookup=forbidden;else worker.fetcher=forbidden;await worker.tick();assert.ok(worker.summary().nextAt>Date.now()+119000);assert.equal(worker.retryAt,0)});
