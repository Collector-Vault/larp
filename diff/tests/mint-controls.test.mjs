import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../store.mjs';
import {normalizeMint,MintControls,TOKEN_PROGRAM,TOKEN_2022_PROGRAM} from '../mint-controls.mjs';
const mint='So11111111111111111111111111111111111111112';
const authority='11111111111111111111111111111111';
const response=(owner=TOKEN_PROGRAM)=>({context:{slot:12345},value:{owner,executable:false,data:{parsed:{type:'mint',info:{isInitialized:true,decimals:9,supply:'18446744073709551615',mintAuthority:null,freezeAuthority:authority}}}}});
const setup=t=>{const s=new Store(':memory:');s.ingest({mint,txType:'create'});t.after(()=>s.close());return s};
function key(i){let n=(1n<<248n)+BigInt(i),s='';const a='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';while(n){s=a[Number(n%58n)]+s;n/=58n}return s}

test('mint fields retain exact u64 string and authorities without safety verdict',()=>{
 const p=normalizeMint(response(),mint);assert.equal(p.status,'available');assert.equal(p.supply,'18446744073709551615');assert.equal(p.mintAuthority,null);assert.equal(p.freezeAuthority,authority);assert.equal(p.slot,12345);assert.equal(p.owner,TOKEN_PROGRAM);assert.match(p.limitations,/not.*safety/i);
});
test('absent nonmint unsupported owner and uninitialized remain distinct neutral observations',()=>{
 assert.equal(normalizeMint({context:{slot:1},value:null},mint).status,'nonexistent');let r=response();r.value.data.parsed.type='account';assert.equal(normalizeMint(r,mint).status,'not mint');r=response(authority);assert.equal(normalizeMint(r,mint).status,'unsupported owner');r=response();r.value.data.parsed.info.isInitialized=false;assert.equal(normalizeMint(r,mint).status,'uninitialized');
});
test('malformed mint fields, authorities, public keys and context fail closed',()=>{
 assert.throws(()=>normalizeMint(response(),'A'.repeat(32)));for(const [field,value]of [['supply','18446744073709551616'],['supply',42],['decimals',256],['decimals',-1],['mintAuthority','bad'],['freezeAuthority',undefined],['isInitialized','true']]){const r=response();r.value.data.parsed.info[field]=value;assert.throws(()=>normalizeMint(r,mint),field)}
 const r=response();r.context.slot=-1;assert.throws(()=>normalizeMint(r,mint));
});
test('Token2022 reports only extension names and never claims supported semantics',()=>{
 const r=response(TOKEN_2022_PROGRAM);r.value.data.parsed.info.extensions=[{extension:'transferFeeConfig',state:{fee:123}},{extension:'futureUnknown'},{extension:'<script>'}];const p=normalizeMint(r,mint);assert.deepEqual(p.extensionNames,['transferFeeConfig','futureUnknown','unknown']);assert.equal(p.extensionsSupported,false);assert.equal(p.extensionStatus,'unsupported');assert.equal(p.extensionState,undefined);
});
test('five minute cache survives instances, expires and preserves success on outage then recovers',async t=>{
 const s=setup(t);let now=1000000,calls=0,fail=false;const lookup=async()=>{calls++;if(fail)throw new Error('offline');return response()};let m=new MintControls(s,{lookup,now:()=>now});m.enqueue(mint);await m.tick();assert.equal(m.get(mint).status,'checked');assert.equal(calls,1);m=new MintControls(s,{lookup,now:()=>now});m.enqueue(mint,true);await m.tick();assert.equal(calls,1);now+=300001;assert.equal(m.get(mint).stale,true);fail=true;await m.tick();assert.equal(m.get(mint).status,'unavailable');assert.equal(m.get(mint).data.supply,'18446744073709551615');now+=60001;fail=false;await m.tick();assert.equal(m.get(mint).stale,false);
});
test('queue is bounded, rejects unknown events and selected work yields to background',async t=>{
 const s=setup(t);let now=1000000;const seen=[];const m=new MintControls(s,{now:()=>now,lookup:async id=>{seen.push(id);return response()}});assert.throws(()=>m.enqueue(key(999)));for(let i=0;i<104;i++){s.ingest({mint:key(i),txType:'create'});m.enqueue(key(i),i>100)}assert.ok(m.summary().queued<=100);assert.ok(m.summary().deferred>=4);await m.tick();now+=5001;await m.tick();now+=5001;await m.tick();assert.ok(seen[2]!==key(101)&&seen[2]!==key(102)&&seen[2]!==key(103));assert.ok(m.summary().queued<=100);
});
test('429 imposes persisted cooldown and priority cannot force requests',async t=>{
 const s=setup(t);let now=1000000,calls=0;let m=new MintControls(s,{now:()=>now,lookup:async()=>{calls++;throw Object.assign(new Error('limited'),{status:429,retryAfter:'7200'})}});m.enqueue(mint);await m.tick();m=new MintControls(s,{now:()=>now,lookup:async()=>{calls++}});m.enqueue(mint,true);await m.tick();assert.equal(calls,1);assert.ok(m.summary().nextAt>=now+7200000);
});
test('403 waits at least an hour without discarding previous success',async t=>{
 const s=setup(t);let now=1000000;const m=new MintControls(s,{now:()=>now,lookup:async()=>response()});m.enqueue(mint);await m.tick();now+=300001;m.lookup=async()=>{throw Object.assign(new Error('forbidden'),{status:403})};await m.tick();assert.ok(m.summary().nextAt>=now+3600000);assert.equal(m.get(mint).data.slot,12345);assert.equal(m.get(mint).stale,true);
});
test('malformed single mint backs off that row without starving healthy queued mints',async t=>{
 const s=setup(t);let now=1000000;const other=key(999);s.ingest({mint:other,txType:'create'});const seen=[];const m=new MintControls(s,{now:()=>now,lookup:async id=>{seen.push(id);return id===mint?{}:response()}});m.enqueue(mint,true);m.enqueue(other);await m.tick();now+=5001;await m.tick();assert.deepEqual(seen,[mint,other]);assert.equal(m.get(other).status,'checked');assert.equal(m.get(mint).status,'unavailable');
});
test('expired selection priority rejoins background and cannot starve behind later selections',async t=>{
 const s=setup(t);let now=1000000;const seen=[];const m=new MintControls(s,{now:()=>now,lookup:async id=>{seen.push(id);return response()}});m.enqueue(mint,true);now+=20001;
 for(let i=0;i<4;i++){s.ingest({mint:key(i),txType:'create'});m.enqueue(key(i),true)}
 await m.tick();now+=5001;await m.tick();now+=5001;await m.tick();assert.equal(seen[2],mint);
});
test('no injected transport stays disconnected and quota wait does not invent a check',async t=>{
 const s=setup(t);const m=new MintControls(s,{now:()=>1000000});m.enqueue(mint);await m.tick();assert.equal(m.get(mint).checkedAt,null);assert.equal(m.summary().connected,false);
 m.lookup=async()=>{throw Object.assign(new Error('shared quota wait'),{deferred:true,retryAt:1005000})};await m.tick();assert.equal(m.get(mint).checkedAt,null);assert.equal(m.get(mint).retryAt,1005000);
});

test('mint snapshot freshness rejects missing future and nonfinite fetched times',async t=>{
 const s=setup(t);const now=1000000;const m=new MintControls(s,{now:()=>now,lookup:async()=>response()});m.enqueue(mint);await m.tick();
 for(const fetched of [null,now+1,Infinity,-Infinity,now-300000]){s.db.prepare('UPDATE mint_controls SET fetched=? WHERE mint=?').run(fetched,mint);assert.equal(m.get(mint).stale,true,'fetched='+fetched);assert.equal(m.get(mint).data.slot,12345)}
 s.db.prepare('UPDATE mint_controls SET fetched=? WHERE mint=?').run(now,mint);assert.equal(m.get(mint).stale,false);
 s.db.prepare("UPDATE mint_controls SET status='unavailable',error='offline' WHERE mint=?").run(mint);assert.equal(m.get(mint).stale,true);assert.equal(m.get(mint).data.slot,12345);
});
