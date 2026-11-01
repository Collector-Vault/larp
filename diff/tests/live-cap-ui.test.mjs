import test from 'node:test';
import assert from 'node:assert/strict';
import {hasLiveCap,comparisonHtml,rememberMarket,marketHtml} from '../public/market.js';
const now=1000000;
const event=value=>({market:{status:'available',stale:false,fetchedAt:now,data:{marketCapUsd:value,fdvUsd:100000}}});
test('provider switches are not price-movement animations and material disagreements are visible',()=>{
 const old={mint:'A',market:{...event(100).market,source:'DEX Screener'}},next={mint:'A',market:{...event(50).market,source:'GeckoTerminal'}};
 rememberMarket([old],[next]);assert.equal(next.marketChanged,false);
 const primary={...old.market,fetchedAt:Date.now()},alternative={...next.market,fetchedAt:Date.now()};
 assert.match(marketHtml({...next,marketComparison:{primary,alternative}}),/Providers disagree/);
});
test('comparison labels age locally even when saved stale flag is false',()=>{
 const html=comparisonHtml({marketComparison:{primary:{...event(10).market,fetchedAt:Date.now()-91000},alternative:{...event(11).market,fetchedAt:Date.now()}}});
 assert.match(html,/DEX Screener:.*stale/);assert.doesNotMatch(html,/GeckoTerminal:.*stale/);
});
test('live cap requires finite positive provider USD value and fresh successful response',()=>{
 for(const value of [null,undefined,0,-1,NaN,Infinity,'12000'])assert.equal(hasLiveCap(event(value),now),false);
 assert.equal(hasLiveCap(event(12000),now),true);
 const e=event(1);e.market.fetchedAt=now-90000;assert.equal(hasLiveCap(e,now),true);
 e.market.fetchedAt--;assert.equal(hasLiveCap(e,now),false);
 e.market.fetchedAt=now+1;assert.equal(hasLiveCap(e,now),false);
 e.market.fetchedAt=now;e.market.stale=true;assert.equal(hasLiveCap(e,now),false);
 e.market.stale=false;e.market.status='unavailable';assert.equal(hasLiveCap(e,now),false);
});
test('new cap and reconnect restore eligibility without FDV or SOL substitution',()=>{
 const e=event(null);e.marketCapSol=100;assert.equal(hasLiveCap(e,now),false);
 e.market.data.marketCapUsd=12345;assert.equal(hasLiveCap(e,now),true);
 e.market.status='not indexed';assert.equal(hasLiveCap(e,now),false);
 e.market.status='available';e.market.fetchedAt=now;assert.equal(hasLiveCap(e,now),true);
});
