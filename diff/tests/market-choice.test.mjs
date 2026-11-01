import test from 'node:test';import assert from 'node:assert/strict';
import {chooseMarket} from '../market-choice.mjs';
const quote=(cap,at=100000)=>({status:'available',stale:false,fetchedAt:at,data:{marketCapUsd:cap,liquidityUsd:null,fdvUsd:99999}});
test('second source needs its own positive fresh reported cap; otherwise retain attributed primary',()=>{
 const p=quote(100);assert.equal(chooseMarket(p,quote(110),100000).source,'GeckoTerminal');
 for(const alt of [quote(null),quote(0),quote(NaN),quote(110,1),{...quote(110),status:'unavailable'},{...quote(110),stale:true}])assert.equal(chooseMarket(p,alt,100000).source,'DEX Screener');
});
test('whole quote retains pool provenance and does not combine unrelated liquidity',()=>{
 const p=quote(100);p.data.liquidityUsd=500;const a=quote(110);a.data.pairAddress='alternative';
 const r=chooseMarket(p,a,100000);assert.equal(r.data.liquidityUsd,null);assert.equal(r.data.pairAddress,'alternative');
});

test('newer eligible primary quote updates headline without mixing providers',()=>{assert.equal(chooseMarket(quote(100,100001),quote(110,100000),100001).source,'DEX Screener')});
