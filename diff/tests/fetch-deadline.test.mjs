import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {fetchRemote} from '../safe-fetch.mjs';
function redirectTransport(location){return (url,options,callback)=>{const req=new EventEmitter();req.destroy=e=>{if(e)req.emit('error',e);req.emit('close')};req.end=()=>queueMicrotask(()=>{const res=new EventEmitter();res.statusCode=302;res.headers=location?{location}:{};res.destroy=()=>req.emit('close');callback(res)});return req}}
test('a fetch deadline covers DNS work across redirect hops',async t=>{
 let lookups=0,clock=0; t.mock.method(performance,'now',()=>clock);
 await assert.rejects(fetchRemote('https://example.com/one','json',{timeoutMs:150,maxRedirects:1,resolve:async()=>{lookups++;clock+=100;return ['1.1.1.1']},request:redirectTransport('/two')}),/timed out/);
 assert.equal(lookups,2);
});
test('redirect without Location is an unavailable response rather than a success',async()=>{
 await assert.rejects(fetchRemote('https://example.com/one','json',{resolve:async()=>['1.1.1.1'],request:redirectTransport()}),/redirect.*location/i);
});
