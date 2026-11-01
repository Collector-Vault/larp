import test from 'node:test';
import assert from 'node:assert/strict';
import {Feed} from '../feed.mjs';
class Socket extends EventTarget {
 sent=[]; closed=0;
 send(value){this.sent.push(value)}
 close(){this.closed++}
 emit(name,props={}){this.dispatchEvent(Object.assign(new Event(name),props))}
}
function setup(t){
 t.mock.timers.enable({apis:['setTimeout','Date']});
 const sockets=[],events=[];
 const feed=new Feed({stats:()=>({}),ingest:data=>{events.push(data);return true}},{socketFactory:()=>{const s=new Socket();sockets.push(s);return s}});
 t.after(()=>feed.stop());return {feed,sockets,events};
}
test('repeated start owns one socket and never bypasses reconnect backoff',t=>{
 const {feed,sockets}=setup(t);feed.start();feed.start();assert.equal(sockets.length,1);
 sockets[0].emit('close',{code:1013});feed.start();assert.equal(sockets.length,1);
 t.mock.timers.tick(3600000);assert.equal(sockets.length,2);
});
test('stop rejects late open and data callbacks and cancels connection deadline',t=>{
 const {feed,sockets,events}=setup(t);feed.start();const socket=sockets[0];feed.stop();
 socket.emit('open');socket.emit('message',{data:'{"mint":"synthetic"}'});
 assert.equal(feed.status.state,'stopped');assert.equal(socket.sent.length,0);assert.equal(events.length,0);
 t.mock.timers.tick(3600000);assert.equal(sockets.length,1);assert.equal(socket.closed,1);
});
test('connection timeout schedules recovery even when socket never closes',t=>{
 const {feed,sockets}=setup(t);feed.start();t.mock.timers.tick(20000);
 assert.equal(feed.status.state,'offline');assert.match(feed.status.error,/timed out/i);
 t.mock.timers.tick(5000);assert.equal(sockets.length,2);
});
test('silent socket watchdog recovers without close acknowledgement',t=>{
 const {feed,sockets}=setup(t);feed.start();sockets[0].emit('open');t.mock.timers.tick(180000);
 assert.equal(feed.status.state,'offline');t.mock.timers.tick(5000);assert.equal(sockets.length,2);
 const before={...feed.status};sockets[0].emit('open');sockets[0].emit('close',{code:1008});
 assert.deepEqual(feed.status,before);
});
test('subscription send failure is contained and retried',t=>{
 const {feed,sockets}=setup(t);feed.start();sockets[0].send=()=>{throw new Error('socket unavailable')};
 sockets[0].emit('open');assert.equal(feed.status.state,'offline');assert.match(feed.status.error,/subscription/i);
 t.mock.timers.tick(5000);assert.equal(sockets.length,2);
});
test('policy close after transport error escalates retry to one hour',t=>{
 const {feed,sockets}=setup(t);feed.start();sockets[0].emit('error');sockets[0].emit('close',{code:1013});
 assert.equal(feed.status.retryAt,Date.now()+3600000);t.mock.timers.tick(5000);assert.equal(sockets.length,1);
 t.mock.timers.tick(3595000);assert.equal(sockets.length,2);
});
