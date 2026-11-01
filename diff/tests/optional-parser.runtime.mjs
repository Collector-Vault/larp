import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {isAbsolute} from 'node:path';
import {parseWebsite} from '../optional-parser.mjs';
import {TechChecks} from '../tech.mjs';
import {Store} from '../store.mjs';
import {Metadata} from '../metadata.mjs';

const executable=process.env.DIFF_SCRAPLING_PYTHON;
assert.ok(executable&&isAbsolute(executable),'Set DIFF_SCRAPLING_PYTHON to the installed trusted Python executable before running this opt-in suite');
const source='https://example.com/synthetic-parser-fixture';
const parse=html=>parseWebsite(html,source,{executable});

test('installed real runtime reports its Python and parser dependency versions',()=>{
 const result=spawnSync(executable,['-I','-c','import sys,json; from importlib.metadata import version; print(json.dumps({"python":sys.version.split()[0],**{name:version(name) for name in ["scrapling","lxml","cssselect","orjson","tld","w3lib","typing_extensions"]}}))'],{encoding:'utf8',timeout:5000,windowsHide:true,shell:false});
 assert.equal(result.status,0,result.stderr);const versions=JSON.parse(result.stdout);assert.equal(versions.scrapling,'0.5');console.log('Runtime versions:',JSON.stringify(versions));
});
test('real parser extracts Unicode entities and exact attributed selectors',async()=>{
 const result=await parse('<html><head><title>Café &amp; API</title><meta name="description" content="Public &quot;API&quot; claim"></head></html>');
 assert.ok(result,'real parser must return metadata rather than fallback');assert.equal(result.title,'Café & API');assert.equal(result.description,'Public "API" claim');assert.equal(result.source,source);assert.equal(result.status,'unverified');assert.deepEqual(result.selectors,{title:'title::text',description:'meta[name="description"]::attr(content)'});
});
test('real parser handles missing and malformed metadata without executing scripts or fetching URLs',async()=>{
 const html='<html><head><title>Incomplete &amp; title</title><meta name="description" content="Plain description"><script>throw new Error("EXECUTED");fetch("https://synthetic.example.invalid/never")</script><img src="https://synthetic.example.invalid/never"><body><div';
 const result=await parse(html);assert.ok(result);assert.equal(result.title,'Incomplete & title');assert.equal(result.description,'Plain description');assert.doesNotMatch(JSON.stringify(result),/EXECUTED|\/never/);
 const empty=await parse('<html><body>No metadata</body></html>');assert.ok(empty);assert.equal(empty.title,null);assert.equal(empty.description,null);
});
test('real parser keeps hostile markup and verdict language as plain unverified text',async()=>{
 const result=await parse('<title>&lt;img src=x onerror=bad&gt; Trusted\u202e</title><meta name="description" content="verified green safe investment">');assert.ok(result);assert.doesNotMatch(result.title,/[<>\u202e]/);assert.equal(result.description,'verified green safe investment');assert.equal(result.status,'unverified');assert.equal(result.verified,undefined);
});
test('HTML byte limits and disabled configuration prevent child execution',async()=>{
 for(const html of ['x'.repeat(131073),'é'.repeat(65537)])assert.equal(await parseWebsite(html,source,{executable,spawnProcess:()=>assert.fail('oversized HTML spawned')}),null);
 assert.equal(await parseWebsite('<title>Disabled</title>',source,{executable:'',spawnProcess:()=>assert.fail('disabled parser spawned')}),null);
 const result=await parse('<title>Bounded</title>'+' '.repeat(131072-22));assert.ok(result);assert.equal(result.title,'Bounded');
});
test('real parser retains libxml depth protection for excessively nested HTML',async()=>{
 const result=await parse('<div>'.repeat(1000)+'<title>Beyond protected depth</title>'+'</div>'.repeat(1000));
 assert.ok(result);assert.equal(result.title,null,'huge_tree=False must not expose a title beyond the protected parser depth');
});
test('real adapter enriches evidence without changing verdict and missing runtime preserves fallback',async t=>{
 const store=new Store(':memory:');t.after(()=>store.close());const metadata=new Metadata(store);const mint='R'.repeat(32);const project={description:'Our software API.',links:[{label:'Website',url:source}]};const parserOptions={executable};
 const tech=new TechChecks(metadata,{parserOptions,fetcher:async()=>({url:source,body:Buffer.from('<title>Built-in fallback</title><meta name="description" content="Website claim">')})});tech.enqueue(mint,project);await tech.tick();let result=tech.get(mint,project);assert.equal(result.observation.parserEvidence.description,'Website claim');assert.equal(result.status,'unverified');assert.equal(result.color,'gray');assert.equal(result.functional.status,'unsupported');
 parserOptions.executable=executable+'.missing';store.db.prepare('UPDATE tech_checks SET next_try=1').run();await tech.tick();result=tech.get(mint,project);assert.equal(result.observation.title,'Built-in fallback');assert.equal(result.observation.parserEvidence,undefined);assert.equal(result.status,'unverified');
});
