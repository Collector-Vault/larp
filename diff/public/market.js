const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function compactUsd(x){if(typeof x!=='number'||!Number.isFinite(x)||x<0)return 'Unavailable';return new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',notation:x>=999.95?'compact':'standard',minimumFractionDigits:0,maximumFractionDigits:x>=999.95?1:2}).format(x)}
export function sourceEvidence(raw){const {marketCapSol,...rest}=raw||{};return rest}
const stamp=t=>t?new Date(t).toISOString().replace('T',' ').slice(0,19)+' UTC':'Not checked';
export function rememberMarket(old,next){for(const e of next){const before=old.find(p=>p.mint===e.mint)?.market;const after=e.market;e.marketChanged=!!(before?.data&&after?.data&&!after.stale&&before.source===after.source&&before.data.pairAddress===after.data.pairAddress&&before.data.marketCapUsd!==after.data.marketCapUsd);}}
export function marketHtml(e,detail=false){
 const m=e.market||{status:'pending'},d=m.data,stale=m.stale||(Number.isFinite(m.fetchedAt)&&Date.now()-m.fetchedAt>90000);
 const a=e.marketComparison?.primary,b=e.marketComparison?.alternative;const disagreement=hasLiveCap({market:a})&&hasLiveCap({market:b})&&Math.abs(a.data.marketCapUsd-b.data.marketCapUsd)/Math.max(a.data.marketCapUsd,b.data.marketCapUsd)>0.1;
 const missing=d?.marketCapUsd==null?'Market cap not reported':'';
 return `${detail?'<h3 class="market-heading">Market snapshot</h3>':''}<span class="market-box ${e.marketChanged?'market-changed':''}"><span class="market-values"><span>Market cap / USD<strong>${compactUsd(d?.marketCapUsd)}</strong></span></span><small>${stale?'STALE cached values / ':''}${esc(m.status)} / ${esc(m.source||"DEX Screener")} / fetched ${stamp(m.fetchedAt)}</small>${disagreement?'<small class="market-error">Providers disagree on market cap. Inspect both source values; accuracy is unresolved.</small>':''}${missing?`<small class="market-missing">${missing}${!d?' / New launches may not be indexed.':''}</small>`:''}${m.error?`<small class="market-error">${esc(m.error)}</small>`:''}${detail?`${comparisonHtml(e)}<details class="market-provenance"><summary>Market source &amp; refresh details</summary><span class="market-note">DEX Screener targets 5s for visible coins (up to 30 coins per batch, shared 12 requests/minute); background candidates wait at least 30s. GeckoTerminal comparison batches every 60s (up to 5). Selected, visible/saved and rotating candidates receive bounded slots. Individual coins may wait several batches. Fresh eligibility expires after 90s. Most recently fetched eligible provider quote is shown; retrieval time is not trade time. Source may lag. New bonding-curve coins may be unindexed.</span>${d?`<span class="market-note">FDV (separate estimate): ${compactUsd(d.fdvUsd)}<br><a href="${esc(d.sourceUrl||m.sourceUrl||"")}" target="_blank" rel="noopener noreferrer">Pool source / ${esc(d.dexId)}</a><br>Pool: ${esc(d.pairAddress)}</span>`:''}<span class="market-note">Last attempt ${stamp(m.checkedAt)}. Missing market cap is never replaced with FDV.</span></details>`:''}</span>`;
}

export function sortEvents(events,order='newest') {
 const newest=(a,b)=>b.receivedAt-a.receivedAt||b.id-a.id;
 const now=Date.now();
 const value=e=>hasLiveCap(e,now)?e.market.data.marketCapUsd:-Infinity;
 return [...events].sort(order==='oldest'?(a,b)=>-newest(a,b):order==='cap'?(a,b)=>(value(b)-value(a)||newest(a,b)):newest);
}

export function hasLiveCap(e,now=Date.now()){const m=e?.market,n=m?.data?.marketCapUsd;return m?.status==='available'&&!m.stale&&typeof n==='number'&&Number.isFinite(n)&&n>0&&Number.isFinite(m.fetchedAt)&&m.fetchedAt<=now&&now-m.fetchedAt<=90000}

export function comparisonHtml(e){const c=e.marketComparison;if(!c)return '';return '<div class="market-comparison"><strong>Independent source comparison</strong>'+[['DEX Screener',c.primary],['GeckoTerminal',c.alternative]].map(([name,m])=>'<p class="meta">'+name+': cap '+compactUsd(m?.data?.marketCapUsd)+' / '+esc(m?.status||'pending')+((m?.stale||(Number.isFinite(m?.fetchedAt)&&Date.now()-m.fetchedAt>90000))?' / stale':'')+' / fetched '+stamp(m?.fetchedAt)+(m?.error?' / '+esc(m.error):'')+'</p>').join('')+'<p class="notice">Sources may disagree on supply, pool coverage and timing. GeckoTerminal may cache responses for 60s; fetched is retrieval time, not last trade time. GeckoTerminal may withhold unverified market caps. No FDV substitution; no claim that either source is inherently more accurate.</p></div>'}

