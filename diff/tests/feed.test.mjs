import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Feed} from '../feed.mjs';
import {Store} from '../store.mjs';
class Socket extends EventTarget {sent=[];send(text){this.sent.push(JSON.parse(text))}close(){this.dispatchEvent(Object.assign(new Event('close'),{code:1000}))}}
test('single socket subscribes only to free streams and stores source event',()=>{
 const store=new Store(':memory:');let socket,calls=0;const feed=new Feed(store,{socketFactory:()=>{calls++;return socket=new Socket()}});feed.start();socket.dispatchEvent(new Event('open'));
 assert.deepEqual(socket.sent,[{method:'subscribeNewToken'},{method:'subscribeMigration'}]);assert.equal(calls,1);
 socket.dispatchEvent(new MessageEvent('message',{data:JSON.stringify({mint:'A'.repeat(32),txType:'create',name:'Real shape'})}));assert.equal(store.stats().total,1);assert.equal(feed.status.state,'connected');
 socket.close();assert.equal(feed.status.state,'offline');assert.ok(feed.status.retryAt>Date.now());feed.stop();store.close();
});
test('policy close waits an hour and malformed events do not populate feed',()=>{
 const store=new Store(':memory:');let socket;const feed=new Feed(store,{socketFactory:()=>socket=new Socket()});feed.start();socket.dispatchEvent(new Event('open'));socket.dispatchEvent(new MessageEvent('message',{data:'invalid'}));assert.equal(store.stats().total,0);socket.dispatchEvent(Object.assign(new Event('close'),{code:1008}));assert.ok(feed.status.retryAt-Date.now()>3599000);feed.stop();store.close();
});
test('silent open connection reconnects after three minutes',t=>{
 t.mock.timers.enable({apis:['setTimeout','setInterval','Date']});const store=new Store(':memory:');let socket;const feed=new Feed(store,{socketFactory:()=>socket=new Socket()});feed.start();socket.dispatchEvent(new Event('open'));t.mock.timers.tick(180001);assert.equal(feed.status.state,'offline');assert.match(feed.status.error,/quiet|silent|stale/i);feed.stop();store.close();
});
test('storage failure is reported as degraded instead of healthy',()=>{
 const store={stats:()=>({lastEventAt:null}),ingest:()=>{throw new Error('disk full')}};let socket;const feed=new Feed(store,{socketFactory:()=>socket=new Socket()});feed.start();socket.dispatchEvent(new Event('open'));socket.dispatchEvent(new MessageEvent('message',{data:'{"txType":"create"}'}));assert.equal(feed.status.state,'degraded');feed.stop();
});
