import test from 'node:test';import assert from 'node:assert/strict';import {controlsHtml} from '../public/project.js';
test('mint evidence keeps raw supply separate from valuation and never claims safety',()=>{const h=controlsHtml({mint:'So11111111111111111111111111111111111111112',controls:{status:'checked',fetchedAt:Date.now(),data:{status:'available',program:'Legacy Token',slot:123,owner:'Token program',supply:'18446744073709551615',decimals:9,mintAuthority:null,freezeAuthority:'authority',extensionNames:[],limitations:'Base controls only'}}});for(const x of ['18446744073709551615','123','Not circulating supply','None reported','authority'])assert.ok(h.includes(x));assert.ok(!h.includes('Safe'))});
test('unavailable controls retain historical evidence with stale warning and escaped errors',()=>{const h=controlsHtml({controls:{status:'unavailable',error:'<script>',fetchedAt:1,data:{status:'nonexistent'}}});assert.match(h,/STALE/);assert.ok(!h.includes('<script>'));assert.match(controlsHtml({}),/Not tested/)});

test('paused UI treats missing future expired and failed mint snapshots as historical',()=>{
 const now=1000000,data={status:'available',program:'Token',slot:12345,decimals:9,supply:'42',mintAuthority:null,freezeAuthority:null};
 for(const fetchedAt of [undefined,null,NaN,Infinity,-Infinity,now+1,now-300000]){const html=controlsHtml({controls:{status:'checked',stale:false,fetchedAt,data}},now);assert.match(html,/STALE \/ historical/,'fetched='+fetchedAt);assert.match(html,/42/);assert.doesNotMatch(html,/Base controls observed/)}
 const error=controlsHtml({controls:{status:'unavailable',stale:false,fetchedAt:now,data,error:'offline'}},now);assert.match(error,/STALE \/ historical/);assert.match(error,/offline/);
 assert.match(controlsHtml({controls:{status:'checked',fetchedAt:now,data}},now),/Base controls observed/);
});
