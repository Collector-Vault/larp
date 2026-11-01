import test from 'node:test';
import assert from 'node:assert/strict';
import dns from 'node:dns/promises';
import {EventEmitter} from 'node:events';
import {fetchRemote} from '../safe-fetch.mjs';
const source='https://resolver.example/token';
function transport(responses,inspect=()=>{}){return (url,options,callback)=>{
 inspect(url,options);const req=new EventEmitter();req.destroy=e=>{if(e)req.emit('error',e);req.emit('close')};
 req.end=()=>queueMicrotask(()=>{const spec=responses.shift();const res=new EventEmitter();res.statusCode=spec?.status||200;res.headers=spec?.headers||{'content-type':'application/json'};res.destroy=()=>req.emit('close');callback(res);if(res.statusCode===200){res.emit('data',Buffer.from('{}'));res.emit('end');req.emit('close')}});return req;
}}
test('default resolver uses OS IPv4 lookup and pins its validated public address',async t=>{
 let lookups=0;const pinned=[];
 t.mock.method(dns,'lookup',async(host,options)=>{lookups++;assert.equal(host,'resolver.example');assert.deepEqual(options,{family:4,all:true});return [{address:'1.1.1.1',family:4},{address:'8.8.8.8',family:4}]});
 const result=await fetchRemote(source,'json',{timeoutMs:100,request:transport([{}],(url,options)=>{options.lookup(url.hostname,{all:true},(error,value)=>{assert.equal(error,null);pinned.push(value)});options.lookup(url.hostname,{},(error,address,family)=>{assert.equal(error,null);assert.equal(address,'1.1.1.1');assert.equal(family,4)})})});
 assert.equal(result.body.toString(),'{}');assert.equal(lookups,1);assert.deepEqual(pinned,[[{address:'1.1.1.1',family:4}]]);
});
for(const [name,answers] of Object.entries({private:[{address:'127.0.0.1',family:4}],mixed:[{address:'1.1.1.1',family:4},{address:'10.0.0.1',family:4}],ipv6:[{address:'2606:4700:4700::1111',family:6}],mismatchedFamily:[{address:'1.1.1.1',family:6}],empty:[]}))test('OS resolver rejects '+name+' answers before transport',async t=>{
 t.mock.method(dns,'lookup',async()=>answers);let calls=0;
 await assert.rejects(fetchRemote(source,'json',{timeoutMs:100,request:()=>{calls++}}),/private|public|IPv4/);assert.equal(calls,0);
});
test('OS DNS lookup timeout releases fetch and late resolution cannot open transport',async t=>{
 let release,calls=0;t.mock.method(dns,'lookup',()=>new Promise(resolve=>release=resolve));
 await assert.rejects(fetchRemote(source,'json',{timeoutMs:15,request:()=>{calls++}}),/DNS lookup timed out/);
 assert.equal(typeof release,'function');release([{address:'1.1.1.1',family:4}]);await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,0);
});
test('redirect re-resolves with OS lookup and blocks a private rebinding answer',async t=>{
 let lookups=0,calls=0;t.mock.method(dns,'lookup',async()=>++lookups===1?[{address:'1.1.1.1',family:4}]:[{address:'127.0.0.1',family:4}]);
 await assert.rejects(fetchRemote(source,'json',{timeoutMs:100,request:transport([{status:302,headers:{location:'/next'}}],()=>calls++)}),/private|public/);
 assert.equal(lookups,2);assert.equal(calls,1);
});
