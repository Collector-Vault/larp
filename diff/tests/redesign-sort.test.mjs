import test from 'node:test';
import assert from 'node:assert/strict';
import {sortEvents,marketHtml} from '../public/market.js';
import {projectHtml} from '../public/project.js';
test('market sort keeps unknown and stale values after fresh values, without mutating input',()=>{
 const quote=cap=>({status:'available',fetchedAt:Date.now(),data:{marketCapUsd:cap},stale:false});
 const events=[{id:1,receivedAt:1,market:{...quote(999),stale:true}},{id:2,receivedAt:2,market:quote(null)},{id:3,receivedAt:3,market:quote(0)},{id:4,receivedAt:4,market:quote(50)}];
 assert.deepEqual(sortEvents(events,'cap').map(e=>e.id),[4,3,2,1]);
 assert.deepEqual(events.map(e=>e.id),[1,2,3,4]);
});
test('cap sort rejects locally expired, future, missing-time and unsuccessful quotes despite stale false',()=>{
 const now=Date.now(),quote=(cap,fetchedAt=now,status='available')=>({status,fetchedAt,stale:false,data:{marketCapUsd:cap}});
 const events=[
  {id:1,receivedAt:1,market:quote(50)},
  {id:2,receivedAt:2,market:quote(900,now-90001)},
  {id:3,receivedAt:3,market:quote(800,now+60000)},
  {id:4,receivedAt:4,market:quote(700,NaN)},
  {id:5,receivedAt:5,market:quote(600,now,'unavailable')},
  {id:6,receivedAt:6,market:quote(30)},
  {id:7,receivedAt:7,market:quote(Infinity)},
  {id:8,receivedAt:8,market:quote('1000')},
  {id:9,receivedAt:9,market:quote(-5)},
  {id:10,receivedAt:10,market:quote(0)},
 ];
 assert.deepEqual(sortEvents(events,'cap').map(e=>e.id),[1,6,10,9,8,7,5,4,3,2]);
});
test('newest and oldest sorting use received timestamps and stable IDs',()=>{
 const events=[{id:1,receivedAt:2},{id:3,receivedAt:2},{id:2,receivedAt:1}];
 assert.deepEqual(sortEvents(events,'newest').map(e=>e.id),[3,1,2]);
 assert.deepEqual(sortEvents(events,'oldest').map(e=>e.id),[2,1,3]);
});
test('partial market quote omits liquidity and explains retained stale data',()=>{
 const html=marketHtml({market:{status:'not indexed',stale:true,error:'No matching pool; showing last verified quote',data:{marketCapUsd:12000,liquidityUsd:null}}},true);
 assert.match(html,/\$12K/);assert.doesNotMatch(html,/liquidity/i);assert.match(html,/STALE cached values/);assert.match(html,/showing last verified quote/);assert.match(html,/Market source &amp; refresh details/);
});
test('source cooldown identifies redirected blocked host while retaining safe published source',()=>{
 const html=projectHtml({project:{status:'retry',source:'https://source.example/meta',sourceHost:'source.example',cooldownHost:'cdn.example',cooldownUntil:1000}});
 assert.match(html,/cdn.example is rate-limited/);assert.match(html,/https:\/\/source.example\/meta/);
});
