import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {safeUrl,isPublicIPv4,fetchRemote,validateBody} from '../safe-fetch.mjs';
import {Metadata,normalizeMetadata} from '../metadata.mjs';
import {Store} from '../store.mjs';
import {EventEmitter} from 'node:events';
const mint='A'.repeat(32),uri='https://example.com/token.json';
const png=Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000b49444154789c636000020000050001a5f645400000000049454e44ae426082','hex');
test('URLs reject local networks, credentials, ports and executable protocols',()=>{
 for(const u of ['http://example.com','https://localhost/a','https://127.0.0.1','https://[::1]','https://2130706433','https://user:pass@example.com','https://example.com:444','file:///x','javascript:alert(1)','https://x.local'])assert.throws(()=>safeUrl(u));
 assert.equal(safeUrl('https://example.com/a#x').href,'https://example.com/a');
 assert.equal(safeUrl('ipfs://QmAbCd123/image.png').hostname,'ipfs.io');
});
test('IP classifier excludes private, reserved, multicast and mapped addresses',()=>{
 for(const ip of ['127.0.0.1','10.0.0.1','172.16.0.1','192.168.0.1','169.254.1.1','100.64.0.1','0.0.0.0','224.1.1.1','198.18.0.1','192.0.2.1','::ffff:127.0.0.1'])assert.equal(isPublicIPv4(ip),false,ip);
 assert.equal(isPublicIPv4('1.1.1.1'),true);
});
test('private DNS answer never reaches HTTP transport',async()=>{let called=false;await assert.rejects(fetchRemote(uri,'json',{resolve:async()=>['10.0.0.1'],request:()=>{called=true}}),/private|public/i);assert.equal(called,false)});
test('content validation rejects HTML, SVG and oversized responses',()=>{
 assert.throws(()=>validateBody(Buffer.from('<svg/>'),'image/svg+xml','image'));
 assert.throws(()=>validateBody(Buffer.from('<html/>'),'text/html','json'));
 assert.throws(()=>validateBody(Buffer.alloc(131073),'application/json','json'));
 assert.equal(validateBody(png,'image/png','image').type,'image/png');
});
test('oversized raster dimensions are rejected before browser decoding',()=>{const huge=Buffer.from(png);huge.writeUInt32BE(100000,16);assert.throws(()=>validateBody(huge,'image/png','image'),/dimensions/)});
test('launcher boilerplate does not become a made-up coin narrative',()=>{assert.equal(normalizeMetadata({description:'Launched on discord.gg/uxento'}).summary,null)});
test('normalizes real narrative as bounded plain text and drops unsafe links',()=>{
 const result=normalizeMetadata({description:'<script>alert(1)</script><b>A cat meme</b>\u0000 '+('long '.repeat(2000)),image:'javascript:bad',website:'http://127.0.0.1',twitter:'https://x.com/cat'});
 assert.ok(result.description.startsWith('A cat meme'));assert.ok(result.description.length<=4000);assert.ok(!result.description.includes('<'));assert.equal(result.image,null);assert.equal(result.links.length,1);assert.ok(result.summary.length<=281);
 assert.equal(normalizeMetadata({}).summary,null);
});
test('metadata and images cache persist; missing data stays unavailable',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'diff-metadata-'));let s;
 try {s=new Store(join(dir,'test.sqlite'));s.ingest({mint,txType:'create',uri});let calls=0;let m=new Metadata(s,{fetcher:async(u,kind)=>{calls++;return kind==='json'?{body:Buffer.from(JSON.stringify({description:'A community cat meme.',image:'https://example.com/cat.png'})),url:u,type:'application/json'}:{body:png,url:u,type:'image/png'}}});m.enqueue(mint);await m.tick();await m.tick();assert.equal(calls,2);assert.equal(m.get(mint).summary,'A community cat meme.');assert.equal(m.image(mint).body.length,png.length);s.close();s=new Store(join(dir,'test.sqlite'));m=new Metadata(s,{fetcher:async()=>{throw new Error('should be cached')}});m.enqueue(mint);await m.tick();assert.equal(m.get(mint).imageAvailable,true);assert.equal(m.get(mint).source,uri);
 }finally{s?.close();rmSync(dir,{recursive:true})}
});
test('failed metadata retries persist and do not spin; no URI is unavailable',async()=>{
 const s=new Store(':memory:');s.ingest({mint,txType:'create',uri});let calls=0;const m=new Metadata(s,{fetcher:async()=>{calls++;throw new Error('Network unavailable')}});m.enqueue(mint);await m.tick();await m.tick();assert.equal(calls,1);assert.equal(m.get(mint).status,'retry');assert.ok(m.get(mint).retryAt>Date.now());
 const b='B'.repeat(32);s.ingest({mint:b,txType:'create'});m.enqueue(b);assert.equal(m.get(b).status,'unavailable');s.close();
});
test('outbound quota is persisted across Metadata instances',()=>{
 const s=new Store(':memory:');const m=new Metadata(s);for(let i=0;i<12;i++)m.reserve();const n=new Metadata(s);assert.throws(()=>n.reserve(),/rate/i);s.close();
});
test('429 cools down every token on that host across worker restarts',async()=>{const s=new Store(':memory:');s.ingest({mint,txType:'create',uri});const m=new Metadata(s,{fetcher:async()=>{const e=new Error('Source HTTP 429');Object.assign(e,{status:429,retryAfter:'7200',host:'example.com'});throw e}});m.enqueue(mint);await m.tick();const next=new Metadata(s);assert.throws(()=>next.reserve('https://example.com/other'),/rate-limited/);assert.ok(next.db.prepare('SELECT retry_at FROM metadata_hosts').get().retry_at-Date.now()>7199000);s.close()});
function transport(responses,inspect=()=>{}){return(u,options,callback)=>{inspect(u,options);const req=new EventEmitter();req.destroy=e=>{if(e)req.emit('error',e);req.emit('close')};req.end=()=>queueMicrotask(()=>{const spec=responses.shift();if(!spec)return;const res=new EventEmitter();res.statusCode=spec.status||200;res.headers=spec.headers||{'content-type':'application/json'};res.destroy=()=>req.emit('close');callback(res);if(res.statusCode===200){for(const chunk of spec.chunks||[Buffer.from('{}')])res.emit('data',chunk);res.emit('end');req.emit('close')}});return req}}
test('redirect to private DNS is blocked before second request',async()=>{
 let requests=0;const request=transport([{status:302,headers:{location:'https://evil.example/secret'}}],()=>requests++);
 await assert.rejects(fetchRemote(uri,'json',{request,resolve:async host=>host==='evil.example'?['192.168.1.1']:['1.1.1.1']}),/private/);assert.equal(requests,1);
});
test('HTTPS request pins vetted DNS answer and redirect count is bounded',async()=>{
 let pinned;const request=transport([{chunks:[Buffer.from('{"description":"ok"}')]}],(u,o)=>o.lookup(u.hostname,{all:true},(e,addresses)=>pinned=addresses));
 assert.equal((await fetchRemote(uri,'json',{request,resolve:async()=>['1.1.1.1']})).type,'application/json');assert.deepEqual(pinned,[{address:'1.1.1.1',family:4}]);
 await assert.rejects(fetchRemote(uri,'json',{resolve:async()=>['1.1.1.1'],request:transport(Array.from({length:4},()=>({status:302,headers:{location:'/again'}})))}),/Too many redirects/);
});
test('stream byte cap and total request deadline abort transport',async()=>{
 await assert.rejects(fetchRemote(uri,'json',{resolve:async()=>['1.1.1.1'],request:transport([{chunks:[Buffer.alloc(100000),Buffer.alloc(100000)]}])}),/size/);
 await assert.rejects(fetchRemote(uri,'json',{timeoutMs:10,resolve:async()=>['1.1.1.1'],request:transport([])}),/timed out/);
});
test('GitHub restriction applies to direct metadata and redirected image requests',async()=>{let calls=0;await assert.rejects(fetchRemote('https://raw.githubusercontent.com/a/b/main/data.json','json',{resolve:async()=>['1.1.1.1'],request:()=>calls++}),/GitHub access disabled/);assert.equal(calls,0);await assert.rejects(fetchRemote(uri,'image',{resolve:async()=>['1.1.1.1'],request:transport([{status:302,headers:{location:'https://user.github.io/image.png'}}],()=>calls++)}),/GitHub access disabled/);assert.equal(calls,1)});
test('terminal DNS dot cannot bypass blocked host rules',async()=>{let calls=0;await assert.rejects(fetchRemote('https://github.com./data','json',{resolve:async()=>['1.1.1.1'],request:()=>calls++}),/GitHub access disabled/);assert.equal(calls,0);assert.throws(()=>safeUrl('https://server.local./file'))});
test('supported Pinata previews keep the published host and preserve other URLs',async()=>{const {artworkUrl}=await import('../metadata.mjs');const original='https://pump.mypinata.cloud/ipfs/bafyexample';const preview=new URL(artworkUrl(original));assert.equal(preview.hostname,'pump.mypinata.cloud');assert.equal(preview.searchParams.get('img-width'),'512');assert.equal(preview.searchParams.get('img-fit'),'scale-down');assert.equal(artworkUrl('https://example.com/image.png'),'https://example.com/image.png');assert.equal(artworkUrl(original+'?token=existing'),original+'?token=existing')});
