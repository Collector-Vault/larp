import {test} from 'node:test';
import assert from 'node:assert/strict';
import {avatarHtml,projectHtml,techHtml,techBadge} from '../public/project.js';
import {readFileSync} from 'node:fs';
test('artwork uses same-origin cache and lazy loading with escaped alt text',()=>{
 const html=avatarHtml({mint:'A'.repeat(32),name:'<img onerror=x>',project:{imageAvailable:true,imageFetchedAt:100}});
 assert.match(html,/src="\/api\/image\?/);assert.match(html,/loading="lazy"/);assert.match(html,/&lt;img/);assert.ok(!html.includes('<img onerror'));
});
test('tech colors have text meanings and readable contrast, not color-only verdicts',()=>{
 const html=techHtml({project:{tech:{candidate:true,status:'green',color:'green'}}});assert.match(html,/Unverified/);assert.match(html,/No automatic fraud verdict is issued/);assert.match(techBadge({project:{tech:{candidate:true,color:'green'}}}),/tech-unknown/);
 const css=readFileSync(new URL('../public/style.css',import.meta.url),'utf8');
 const lum=hex=>{const rgb=hex.match(/../g).map(v=>parseInt(v,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722};
 for(const cls of ['good','bad']){const match=css.match(new RegExp('\\.tech-'+cls+'\\{color:#([0-9a-f]{6});background:#([0-9a-f]{6})'));assert.ok(match);assert.ok((lum(match[1])+.05)/(lum(match[2])+.05)>=4.5)}
});
test('missing artwork keeps fallback and narrative never invents content',()=>{
 assert.ok(!avatarHtml({symbol:'ABC',project:{imageAvailable:false}}).includes('<img'));
 const html=projectHtml({project:{status:'unavailable'}});assert.match(html,/Description unavailable/);assert.match(html,/Project-provided/);
});
test('published narrative is escaped and explicitly attributed',()=>{
 const html=projectHtml({project:{status:'ready',summary:'<script>alert(1)</script>',description:'<b>Long description</b>',fetchedAt:1000,source:'https://example.com/a',links:[]}});
 assert.ok(!html.includes('<script>'));assert.match(html,/&lt;script&gt;/);assert.match(html,/unverified/i);assert.match(html,/1970-01-01/);assert.match(html,/Published metadata/);
});
test('pending and source cooldown UI does not claim an unfetched description was absent',()=>{const queued=projectHtml({project:{status:'deferred',source:'https://example.com/m',prioritized:true}});assert.match(queued,/queue full/);assert.match(queued,/priority/);assert.doesNotMatch(queued,/source supplied no usable narrative/);const blocked=projectHtml({project:{status:'retry',source:'https://ipfs.io/ipfs/test',sourceHost:'ipfs.io',cooldownUntil:Date.now()+60000,retryAt:Date.now()+60000}});assert.match(blocked,/ipfs.io is rate-limited until/);assert.match(blocked,/cannot bypass/)});
