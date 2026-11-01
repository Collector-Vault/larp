export function freshPositiveCap(m,now=Date.now()) {
 const cap=m?.data?.marketCapUsd;
 return m?.status==='available'&&!m.stale&&typeof cap==='number'&&Number.isFinite(cap)&&cap>0&&Number.isFinite(m.fetchedAt)&&m.fetchedAt<=now&&now-m.fetchedAt<=90000;
}
export function chooseMarket(primary,alternative,now=Date.now()) {
 // Choose the most recently fetched eligible whole quote; retrieval time is not trade time.
 if(freshPositiveCap(alternative,now)&&(!freshPositiveCap(primary,now)||alternative.fetchedAt>=primary.fetchedAt))return {...alternative,source:'GeckoTerminal'};
 return {...primary,source:'DEX Screener'};
}

