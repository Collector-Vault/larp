// Only a trusted provider adapter may supply this normalized metric. None is enabled.
export function passesFees(f,now=Date.now()){
 return !!(f?.verified===true&&f.metric==='cumulative-token-trading-fees'&&f.unit==='SOL'&&f.complete===true&&typeof f.source==='string'&&f.source.startsWith('https://')&&Number.isFinite(f.checkedAt)&&f.checkedAt<=now&&now-f.checkedAt<=90000&&Number.isFinite(f.value)&&f.value>=0.1);
}
export function feeCounts(events){return {total:events.length,passed:events.filter(e=>passesFees(e.fees)).length,unknown:events.filter(e=>!e.fees||e.fees.status==='unavailable').length}}
