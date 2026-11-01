import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../store.mjs';
import {createApp} from '../server.mjs';
import http from 'node:http';
import {Metadata} from '../metadata.mjs';
test('serves status and real stored events and persists watch changes',async()=>{
 const store=new Store(':memory:');const mint='A'.repeat(32);store.ingest({mint,txType:'create',name:'<script>unsafe</script>'});
 const app=createApp(store,{status:{state:'offline'}});await new Promise(r=>app.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${app.address().port}`;
 try {
 assert.equal((await fetch(base+'/api/events').then(r=>r.json())).events.length,1);
 assert.equal((await fetch(base+'/api/status').then(r=>r.json())).feed.state,'offline');
 assert.equal((await fetch(base+'/api/watch',{method:'POST',headers:{'Content-Type':'application/json',Origin:base},body:JSON.stringify({mint,enabled:true})})).status,200);
 assert.equal(store.list({watch:true}).length,1);
 assert.equal((await fetch(base+'/api/watch',{method:'POST',headers:{Origin:'https://evil.example'},body:'{}'})).status,403);
 assert.equal((await fetch(base+'/api/watch',{method:'POST',body:'{bad'})).status,400);
 assert.equal((await fetch(base+'/missing')).status,404);
 assert.equal(await new Promise((resolve,reject)=>{http.get(base+'/',{headers:{Host:'evil.example'}},r=>{r.resume();resolve(r.statusCode)}).on('error',reject)}),403);
 assert.match(await fetch(base+'/').then(r=>r.text()),/DIFF/);
 }finally{await new Promise(r=>app.close(r));store.close()}
});
test('image route only serves cached bytes and project API exposes unavailable state',async()=>{
 const store=new Store(':memory:');const mint='A'.repeat(32);store.ingest({mint,txType:'create'});const metadata=new Metadata(store);metadata.enqueue(mint);const app=createApp(store,{status:{state:'stopped'}},metadata);await new Promise(r=>app.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${app.address().port}`;
 try{assert.equal((await fetch(base+'/api/project?mint='+mint).then(r=>r.json())).status,'unavailable');assert.equal((await fetch(base+'/api/image?mint='+mint+'&url=http://127.0.0.1')).status,404);assert.equal((await fetch(base+'/api/events').then(r=>r.json())).events[0].project.imageAvailable,false)}finally{await new Promise(r=>app.close(r));store.close()}
});
