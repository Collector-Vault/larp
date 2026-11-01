import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../store.mjs';
import {Metadata} from '../metadata.mjs';
import {TechChecks} from '../tech.mjs';
import {techHtml,projectHtml} from '../public/project.js';
const mint='C'.repeat(32),sol='So11111111111111111111111111111111111111112',usdc='EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const generic={description:'Our protocol provides infrastructure.',links:[{label:'Website',url:'https://raydium.io/'}]};
const venue={...generic,description:'Our protocol provides swap quotes.'};
function setup(t){const s=new Store(':memory:');t.after(()=>s.close());const tech=new TechChecks(new Metadata(s),{fetcher:async(url,kind)=>kind==='html'?{url,body:Buffer.from('<title>Published site</title>')}:{url,body:Buffer.from(JSON.stringify({success:true,data:{swapType:'BaseIn',inputMint:sol,outputMint:usdc,inputAmount:new URL(url).searchParams.get('amount'),outputAmount:String(Number(new URL(url).searchParams.get('amount'))/10),routePlan:[{poolId:'A'.repeat(32),inputMint:sol,outputMint:usdc}]}}))}});return {s,tech}}

test('website-only target reports one applicable supporting check',async t=>{
 const {tech}=setup(t);tech.enqueue(mint,generic);await tech.tick();const result=tech.get(mint,generic);
 assert.equal(result.supportingCheck,'website');assert.match(techHtml({project:{tech:result}}),/Coverage: 1 \/ 1 supporting check current/);assert.equal(result.status,'unverified');
});
test('fixed venue quotes do not promise a website check or replace historical page evidence',async t=>{
 const {tech}=setup(t);tech.enqueue(mint,generic);await tech.tick();const previous=tech.get(mint,generic).lastSuccess;
 tech.enqueue(mint,venue);await tech.tick();const result=tech.get(mint,venue),html=techHtml({project:{tech:result}});
 assert.equal(result.lastSuccess.observation.kind,'website_response');assert.equal(result.lastSuccess.checkedAt,previous.checkedAt);
 assert.equal(result.supportingCheck,'venue');assert.match(html,/Coverage: 1 \/ 1 supporting check current/);assert.match(html,/Website availability \/ not scheduled/);
 assert.equal(result.status,'unverified');assert.equal(result.functional.affiliation,'unverified');assert.equal(result.functional.observations[0].inputMint,sol);assert.equal(result.functional.observations[0].outputMint,usdc);assert.match(html,/Product behavior not tested/);
});
test('missing and expired supporting evidence does not claim two scheduled checks',async t=>{
 const {s,tech}=setup(t);const missing=tech.get(mint,{description:'A meme.',links:[]});assert.equal(missing.supportingCheck,null);assert.match(techHtml({project:{tech:missing}}),/Coverage: 0 \/ 0/);
 tech.enqueue(mint,venue);await tech.tick();s.db.prepare('UPDATE tech_functional_cache SET checked=?').run(Date.now()-600001);assert.match(techHtml({project:{tech:tech.get(mint,venue)}}),/Coverage: 0 \/ 1/);
});
test('JSON retry is identified as metadata while cached narrative artwork and fetch times survive',()=>{
 const project={status:'retry',phase:'json',error:'offline',retryAt:300000,summary:'Cached description',description:'Cached description',fetchedAt:1000,imageAvailable:true,imageFetchedAt:2000};
 const html=projectHtml({project});assert.match(html,/Metadata refresh pending: offline/);assert.match(html,/Cached description/);assert.match(html,/Fetched: 1970-01-01 00:00:01 UTC/);assert.match(html,/Artwork cached 1970-01-01 00:00:02 UTC/);assert.doesNotMatch(html,/Artwork refresh pending/);
});
test('retry without cached artwork names the failed stage',()=>{
 const base={status:'retry',error:'offline',retryAt:300000,summary:'Cached description',description:'Cached description',fetchedAt:1000,imageAvailable:false};
 const json=projectHtml({project:{...base,phase:'json'}});assert.match(json,/Metadata refresh pending/);assert.doesNotMatch(json,/Artwork unavailable[^<]*retry scheduled/);
 const image=projectHtml({project:{...base,phase:'image'}});assert.match(image,/Artwork refresh pending/);assert.match(image,/Artwork unavailable[^<]*retry scheduled/);
});

test('venue request URL and timestamp are not presented as a website inspection',async t=>{
 const {tech}=setup(t);tech.enqueue(mint,venue);await tech.tick();const html=techHtml({project:{tech:tech.get(mint,venue)}}),website=html.slice(html.indexOf('<div class="tech-observation">'));
 assert.doesNotMatch(website,/transaction-v1\.raydium\.io/);assert.match(website,/Checked: Unavailable/);
});
