import test from 'node:test';
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const run=promisify(execFile);
async function isolated(t,file,factory,checks){
 const directory=await mkdtemp(join(tmpdir(),'diff-synthetic-ui-'));
 t.after(()=>rm(directory,{recursive:true,force:true}));
 const url=new URL(file,import.meta.url).href;
 const script=`import assert from 'node:assert/strict';
 import {${factory}} from ${JSON.stringify(url)};
 const fixture=${factory}();
 await new Promise(resolve=>fixture.app.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+fixture.app.address().port;
 const json=path=>fetch(base+path).then(r=>{assert.equal(r.status,200);return r.json()});
 try{${checks}}finally{await new Promise(resolve=>fixture.app.close(resolve));fixture.store.close()}
 console.log('portable synthetic fixture passed');`;
 const result=await run(process.execPath,['--input-type=module','--eval',script],{cwd:directory,timeout:20000});
 assert.match(result.stdout,/portable synthetic fixture passed/);
}
test('functional QA starts from an empty working directory with clearly synthetic in-repo evidence',async t=>{
 await isolated(t,'./functional-ui-fixture.mjs','createFunctionalUiFixture',`
  const status=await json('/api/status');assert.match(status.feed.error,/SYNTHETIC/i);
  const {events}=await json('/api/events');assert.equal(events.length,1);
  assert.match(events[0].name,/SYNTHETIC/);assert.match(events[0].project.description,/synthetic/i);
  const functional=events[0].project.tech.functional;
  assert.equal(functional.status,'observed');assert.match(functional.capability,/SYNTHETIC/);
  assert.equal(functional.observations.length,2);assert.equal(functional.observations[1].inputAmount,'200000000');
  assert.equal(functional.observations[1].outputAmount,'24000000');
 `);
});
test('isolated UI fixture supplies fresh, expired and missing caps plus independent values and synthetic wallets',async t=>{
 await isolated(t,'./ui-fixtures.mjs','createUiFixture',`
  const status=await json('/api/status');assert.match(status.feed.error,/SYNTHETIC/i);
  const {events}=await json('/api/events');assert.equal(events.length,4);
  const fresh=events.find(e=>e.symbol==='QA1'),expired=events.find(e=>e.symbol==='QA2'),missing=events.find(e=>e.symbol==='QA4');
  assert.equal(fresh.marketComparison.primary.data.marketCapUsd,10000);
  assert.equal(fresh.marketComparison.alternative.data.marketCapUsd,12000);
  assert.equal(fresh.market.data.marketCapUsd,12000);
  assert.equal(expired.market.stale,false);assert.ok(Date.now()-expired.market.fetchedAt>90000);assert.equal(expired.market.data.marketCapUsd,250000);
  assert.equal(missing.market.data.marketCapUsd,null);assert.equal(missing.market.data.fdvUsd,999999);
  const wallets=await json('/api/wallets');assert.equal(wallets.wallets.length,2);
  assert.ok(wallets.wallets.every(w=>w.labels[0].includes('SYNTHETIC')));
  assert.equal(wallets.rpc.running,false);assert.match(wallets.rpc.source,/SYNTHETIC/);
  await fetch(base+'/api/wallets',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'check',address:wallets.wallets[0].address})});
  assert.equal((await json('/api/wallets')).wallets[0].activity.length,0);
 `);
});
test('explicit temporary fixture database preserves wallet edits, removals and watches across restart',async t=>{
 await isolated(t,'./ui-fixtures.mjs','createUiFixture',`
  const dbPath='synthetic-persistence.sqlite';
  let saved=createUiFixture({dbPath});
  const [first,second]=saved.wallets.list();
  saved.wallets.update(first.address,'Edited synthetic label');saved.wallets.remove(second.address);
  saved.store.setWatch('A'.repeat(32),true);saved.store.close();
  saved=createUiFixture({dbPath});
  try{
   assert.equal(saved.wallets.list().length,1);assert.deepEqual(saved.wallets.list()[0].labels,['Edited synthetic label']);
   assert.equal(saved.store.list({watch:true}).length,1);assert.equal(saved.store.list().length,4);
   assert.equal(saved.wallets.export()[0].name,'Edited synthetic label');
   const borrowed=createUiFixture({store:saved.store});assert.equal(borrowed.store,saved.store);
  }finally{saved.store.close()}
 `);
});
