import test from 'node:test';
import assert from 'node:assert/strict';
import {marketHtml,rememberMarket,sortEvents} from '../public/market.js';
import {readFileSync} from 'node:fs';
test('cards and source comparison omit liquidity while retaining cap and timestamps',()=>{
 const m={status:'available',fetchedAt:Date.now(),data:{marketCapUsd:15000,liquidityUsd:8000,liquidityReason:'Pool liquidity'}};
 const e={market:m,marketComparison:{primary:m,alternative:m}};
 for(const detail of [false,true]){const html=marketHtml(e,detail);assert.doesNotMatch(html,/liquidity/i);assert.match(html,/\$15K/);assert.match(html,/fetched/)}
 assert.doesNotMatch(readFileSync(new URL('../public/index.html',import.meta.url),'utf8'),/liquidity/i);
});
test('hidden liquidity changes never animate market cap',()=>{
 const before={mint:'a',market:{data:{marketCapUsd:100,liquidityUsd:20}}};
 const after=structuredClone(before);after.market.data.liquidityUsd=40;
 rememberMarket([before],[after]);assert.equal(after.marketChanged,false);
 after.market.data.marketCapUsd=101;rememberMarket([before],[after]);assert.equal(after.marketChanged,true);
});
test('removed liquidity sort falls back to newest',()=>{
 const events=[{id:1,receivedAt:1,market:{data:{liquidityUsd:900}}},{id:2,receivedAt:2,market:{data:{liquidityUsd:10}}}];assert.deepEqual(sortEvents(events,'liquidity').map(e=>e.id),[2,1]);
});
