import {test} from 'node:test';
import assert from 'node:assert/strict';
import {scannerHtml,scanLabel} from '../public/scanner.js';
test('scan panel shows counts and real cooldowns without invented progress',()=>{const html=scannerHtml({running:true,requestsLastMinute:4,requestLimit:12,queued:10,capacity:100,deferred:2,retrying:3,checked:5,unavailable:1,recent:[],cooldowns:[{host:'example.com',retryAt:1000}]});assert.match(html,/example.com/);assert.match(html,/1970-01-01/);assert.match(html,/deferred/);assert.ok(!html.includes('%'));assert.equal(scanLabel({status:'ready'}),'Metadata checked')});
