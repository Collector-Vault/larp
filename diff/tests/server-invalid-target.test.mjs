import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';

test('malformed request target returns 400 and the server survives the next request',()=>{
 const code=`import {Store} from './store.mjs';import {createApp} from './server.mjs';import http from 'node:http';
 const s=new Store(':memory:');const app=createApp(s,{status:{state:'offline'}});
 await new Promise(r=>app.listen(0,'127.0.0.1',r));
 const request=path=>new Promise((resolve,reject)=>{http.get({hostname:'127.0.0.1',port:app.address().port,path},res=>{res.resume();res.on('end',()=>resolve(res.statusCode))}).on('error',reject)});
 const invalid=await request('http://[');const valid=await request('/api/status');console.log(JSON.stringify({invalid,valid}));
 await new Promise(r=>app.close(r));s.close();`;
 const result=spawnSync(process.execPath,['--input-type=module','-e',code],{cwd:new URL('../',import.meta.url),encoding:'utf8',timeout:10000});
 assert.equal(result.status,0,'server must survive malformed URL: '+result.stderr);
 assert.deepEqual(JSON.parse(result.stdout.trim()),{invalid:400,valid:200});
});
