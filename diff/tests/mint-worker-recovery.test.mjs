import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../store.mjs';
import {MintControls} from '../mint-controls.mjs';

const mint='So11111111111111111111111111111111111111112';
const snapshot={context:{slot:1},value:null};
function setup(t,lookup){
 const store=new Store(':memory:');t.after(()=>store.close());store.ingest({mint,txType:'create'});
 let now=1000000;const worker=new MintControls(store,{lookup,now:()=>now});worker.enqueue(mint);
 return {store,worker,advance:ms=>{now+=ms}};
}
function faultOnce(worker,pattern,occurrence=1){
 const db=worker.db;let matches=0;
 worker.db=new Proxy(db,{get(target,key){
  if(key==='prepare')return sql=>{if(pattern.test(sql)&&++matches===occurrence)throw new Error('temporary database failure');return target.prepare(sql)};
  const value=target[key];return typeof value==='function'?value.bind(target):value;
 }});
 return ()=>{worker.db=db};
}

for(const [stage,pattern,initialCalls] of [
 ['limiter read',/SELECT next_at FROM mint_control_schedule/,0],
 ['reservation',/UPDATE mint_control_schedule SET next_at=/,0],
 ['cache write',/UPDATE mint_controls SET status='checked'/,1]
])test('mint worker clears activity and recovers after '+stage+' failure',async t=>{
 let calls=0;const {worker,advance}=setup(t,async()=>{calls++;return snapshot});
 const restore=faultOnce(worker,pattern);await assert.doesNotReject(()=>worker.tick());
 assert.equal(worker.busy,false);assert.equal(worker.current,null);assert.equal(worker.summary().active,null);
 assert.notEqual(worker.get(mint).status,'fetching');assert.match(worker.summary().error,/temporary database failure/);
 assert.equal(calls,initialCalls);restore();advance(5000);await worker.tick();
 assert.equal(calls,initialCalls+1);assert.equal(worker.get(mint).status,'checked');assert.equal(worker.summary().error,null);
});

for(const [name,error,wait] of [
 ['ordinary error',new Error('offline'),60000],
 ['403',Object.assign(new Error('forbidden'),{status:403}),3600000],
 ['429',Object.assign(new Error('limited'),{status:429,retryAfter:'7200'}),7200000],
 ['quota deferral',Object.assign(new Error('quota wait'),{deferred:true,retryAt:1060000}),60000]
])test('mint '+name+' backoff survives an error-record write failure',async t=>{
 let calls=0;const {store,worker,advance}=setup(t,async()=>{calls++;throw error});
 const restore=faultOnce(worker,error.deferred?/UPDATE mint_controls SET next_try=/:/UPDATE mint_controls SET status='unavailable'/);
 await assert.doesNotReject(()=>worker.tick());assert.equal(worker.busy,false);assert.equal(worker.current,null);
 assert.match(worker.summary().error,/temporary database failure/);assert.equal(calls,1);
 assert.equal(worker.summary().nextAt,1000000+wait);restore();worker.lookup=async()=>{calls++;return snapshot};worker.enqueue(mint,true);
 advance(5000);await worker.tick();assert.equal(calls,1);assert.equal(store.db.prepare('SELECT next_at FROM mint_control_schedule WHERE id=1').get().next_at,1000000+wait);
 advance(wait-5001);await worker.tick();assert.equal(calls,1);advance(1);await worker.tick();
 assert.equal(calls,2);assert.equal(worker.get(mint).status,'checked');assert.equal(worker.summary().error,null);
});

test('mint retries a failed cooldown write before another provider request',async t=>{
 let calls=0;const {store,worker,advance}=setup(t,async()=>{calls++;throw Object.assign(new Error('limited'),{status:429,retryAfter:'120'})});
 const restore=faultOnce(worker,/UPDATE mint_control_schedule SET next_at=/,2);
 await assert.doesNotReject(()=>worker.tick());assert.equal(worker.busy,false);assert.equal(worker.current,null);
 assert.match(worker.summary().error,/temporary database failure/);assert.equal(worker.summary().nextAt,4600000);
 restore();worker.lookup=async()=>{calls++;return snapshot};advance(5000);await worker.tick();
 assert.equal(calls,1);assert.equal(store.db.prepare('SELECT next_at FROM mint_control_schedule WHERE id=1').get().next_at,4600000);
 advance(3595000);await worker.tick();assert.equal(calls,2);assert.equal(worker.get(mint).status,'checked');
});
