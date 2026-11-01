import {test} from 'node:test';
import assert from 'node:assert/strict';
import {TechChecks} from '../tech.mjs';
import {Store} from '../store.mjs';
import {Metadata} from '../metadata.mjs';
const mint='C'.repeat(32),sol='So11111111111111111111111111111111111111112',usdc='EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const project={description:'Our Raydium protocol provides swap quotes.',links:[{label:'Website',url:'https://raydium.io/'}]};
function setup(t,fetcher){const s=new Store(':memory:');t.after(()=>s.close());const m=new Metadata(s);const tech=new TechChecks(m,{fetcher});return {s,m,tech}}
function response(url){const amount=new URL(url).searchParams.get('amount');return {url,body:Buffer.from(JSON.stringify({success:true,data:{swapType:'BaseIn',inputMint:sol,outputMint:usdc,inputAmount:amount,outputAmount:String(Number(amount)/10),routePlan:[{poolId:'A'.repeat(32),inputMint:sol,outputMint:usdc}]}}))}}
test('two fixed read-only quotes demonstrate only linked service capability with expiry',async t=>{
 const seen=[];const {s,tech}=setup(t,async(u,k,o)=>{o.reserve(u);seen.push(u);return response(u)});tech.enqueue(mint,project);await tech.tick();
 const result=tech.get(mint,project);assert.equal(result.functional?.status,'observed');assert.equal(result.functional.color,'green');assert.equal(result.color,'gray');assert.equal(result.status,'unverified');assert.equal(result.functional.affiliation,'unverified');assert.equal(result.functional.observations.length,2);assert.ok(result.functional.expiresAt>Date.now());assert.ok(seen.every(u=>u.startsWith('https://transaction-v1.raydium.io/compute/swap-base-in?')));
 s.db.prepare('UPDATE tech_functional_cache SET checked=?').run(Date.now()-600001);assert.equal(tech.get(mint,project).functional.color,'gray');assert.equal(tech.get(mint,project).functional.status,'expired');
});
test('arbitrary or spoofed website, static page and injected verdict cannot produce functional green',async t=>{
 const {tech}=setup(t,async u=>({url:u,body:Buffer.from('<title>Working swaps</title>')}));
 for(const website of ['https://raydium.io.evil.example','https://evil.example/?url=https://raydium.io','http://raydium.io','https://127.0.0.1']){const p={...project,links:[{label:'Website',url:website}],functional:{status:'observed'}};tech.enqueue(mint,p);await tech.tick();assert.notEqual(tech.get(mint,p).functional?.color,'green')}
 tech.enqueue(mint,project);await tech.tick();assert.equal(tech.get(mint,project).functional.color,'gray');
});
test('mismatched quote is inconclusive not fraud and fresh outage withdraws green',async t=>{
 let fail=false;const {s,tech}=setup(t,async(u,k,o)=>{o.reserve(u);if(fail)throw new Error('Source HTTP 503');return response(u)});tech.enqueue(mint,project);await tech.tick();fail=true;s.db.prepare('UPDATE tech_checks SET next_try=0').run();s.db.prepare('UPDATE tech_functional_cache SET next_try=0').run();await tech.tick();assert.equal(tech.get(mint,project).functional.color,'gray');assert.equal(tech.get(mint,project).functional.status,'unavailable');
 const bad=setup(t,async(u,k,o)=>{o.reserve(u);const r=response(u),v=JSON.parse(r.body);v.data.inputMint=usdc;r.body=Buffer.from(JSON.stringify(v));return r});bad.tech.enqueue(mint,project);await bad.tech.tick();assert.equal(bad.tech.get(mint,project).functional.color,'gray');assert.notEqual(bad.tech.get(mint,project).functional.color,'red');
});
test('shared service cache avoids token-amplified probes and local quota wait preserves evidence',async t=>{
 let calls=0;const {s,m,tech}=setup(t,async(u,k,o)=>{o.reserve(u);calls++;return response(u)});tech.enqueue(mint,project);await tech.tick();tech.enqueue('D'.repeat(32),project);await tech.tick();assert.equal(calls,2);assert.equal(tech.get('D'.repeat(32),project).functional.status,'observed');
 s.db.prepare('UPDATE tech_checks SET next_try=0').run();s.db.prepare('UPDATE tech_functional_cache SET next_try=0').run();for(let i=0;i<9;i++)m.reserve();await tech.tick();assert.equal(calls,2);assert.equal(tech.get(mint,project).functional.status,'observed');
 const changed={...project,description:'A cat meme. No utility.'};tech.enqueue(mint,changed);assert.notEqual(tech.get(mint,changed).functional?.status,'observed');
});
test('static output, discontinuous route, redirects and future observations remain neutral',async t=>{
 for(const mode of ['static','route','redirect']){
  const {tech}=setup(t,async(u,k,o)=>{o.reserve(u);assert.equal(o.maxRedirects,0);const r=response(u),v=JSON.parse(r.body);if(mode==='static')v.data.outputAmount='123';if(mode==='route')v.data.routePlan[0].inputMint=usdc;if(mode==='redirect')r.url='https://evil.example/';r.body=Buffer.from(JSON.stringify(v));return r});tech.enqueue(mint,project);await tech.tick();assert.equal(tech.get(mint,project).functional.color,'gray');
 }
 const {s,m,tech}=setup(t,async(u,k,o)=>{o.reserve(u);return response(u)});tech.enqueue(mint,project);await tech.tick();
 const restored=new TechChecks(m,{fetcher:()=>{throw new Error('No refetch needed')}});assert.equal(restored.get(mint,project).functional.status,'observed');
 s.db.prepare('UPDATE tech_functional_cache SET checked=?').run(Date.now()+60000);assert.equal(restored.get(mint,project).functional.color,'gray');
});
test('upstream rate limit withdraws observation, preserves history and prevents immediate retry',async t=>{
 let fail=false,calls=0;const {s,tech}=setup(t,async(u,k,o)=>{o.reserve(u);calls++;if(fail)throw Object.assign(new Error('Source HTTP 429'),{status:429,retryAt:Date.now()+3600000});return response(u)});tech.enqueue(mint,project);await tech.tick();fail=true;s.db.prepare('UPDATE tech_checks SET next_try=0').run();s.db.prepare('UPDATE tech_functional_cache SET next_try=0').run();await tech.tick();const f=tech.get(mint,project).functional;assert.equal(f.color,'gray');assert.equal(f.previousObservation.observations.length,2);await tech.tick();assert.equal(calls,3);
});
test('same website adapter changes schedule a fresh check in both directions',async t=>{
 const {s,tech}=setup(t,async(u,k,o)=>{o.reserve(u);return k==='html'?{url:u,body:Buffer.from('<title>Protocol</title>')}:response(u)});
 const generic={...project,description:'Our protocol provides infrastructure.'};tech.enqueue(mint,generic);await tech.tick();assert.ok(s.db.prepare('SELECT next_try FROM tech_checks').get().next_try>Date.now()+3600000);
 tech.enqueue(mint,project);await tech.tick();assert.equal(tech.get(mint,project).functional.status,'observed');
 tech.enqueue(mint,generic);await tech.tick();assert.equal(tech.get(mint,generic).functional.status,'unsupported');assert.equal(tech.get(mint,generic).observation.kind,'website_response');
});
test('403 source denial persists at least an hour of host cooldown',async t=>{
 const {s,m,tech}=setup(t,async(u,k,o)=>{o.reserve(u);throw Object.assign(new Error('Source HTTP 403'),{status:403})});const before=Date.now();tech.enqueue(mint,project);await tech.tick();assert.ok(tech.get(mint,project).functional.nextCheckAt>=before+3600000);assert.ok(m.requestWait('https://transaction-v1.raydium.io/compute/swap-base-in')>=before+3600000);assert.equal(tech.get(mint,project).functional.color,'gray');
});
