import {spawn} from 'node:child_process';
import {isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
const sidecar=fileURLToPath(new URL('./scripts/website-parser.py',import.meta.url));
const selectors={title:'title::text',description:'meta[name="description"]::attr(content)'};
const clean=(value,max)=>value.replace(/<[^>]*>/g,' ').replace(/[<>\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g,' ').replace(/\s+/g,' ').trim().slice(0,max)||null;
function validated(value,source){
 if(!value||typeof value!=='object'||Object.keys(value).sort().join(',')!=='description,selectors,source,title'||value.source!==source||typeof value.title!=='string'||typeof value.description!=='string'||value.title.length>2000||value.description.length>4000)return null;
 if(!value.selectors||Object.keys(value.selectors).sort().join(',')!=='description,title'||Object.entries(selectors).some(([k,v])=>value.selectors[k]!==v))return null;
 return {parser:'Scrapling 0.5',source,status:'unverified',title:clean(value.title,200),description:clean(value.description,500),selectors:{...selectors},statement:'Website-supplied metadata only; no product, affiliation or safety verification.'};
}
export async function parseWebsite(html,source,{executable=process.env.DIFF_SCRAPLING_PYTHON||'',spawnProcess=spawn,timeoutMs=2000}={}){
 if(!executable||!isAbsolute(executable)||typeof html!=='string'||Buffer.byteLength(html)>131072||typeof source!=='string'||source.length>2048)return null;
 let url;try{url=new URL(source)}catch{return null}if(url.protocol!=='https:'||url.username||url.password)return null;
 const header=Buffer.from(JSON.stringify({source})+'\n');if(header.length>4096)return null;
 return new Promise(resolve=>{
  let child,timer,done=false,size=0;const chunks=[];
  const finish=value=>{if(done)return;done=true;clearTimeout(timer);resolve(value)};
  const abort=()=>{if(done)return;child?.kill();finish(null)};
  try{
   child=spawnProcess(executable,['-I',sidecar],{shell:false,windowsHide:true,stdio:['pipe','pipe','ignore']});
   timer=setTimeout(abort,Math.min(2000,Math.max(10,timeoutMs)));
   child.on('error',()=>finish(null));child.stdin.on('error',abort);child.stdout.on('error',abort);
   child.stdout.on('data',chunk=>{size+=chunk.length;if(size>8192){abort();return}chunks.push(chunk)});
   child.on('close',code=>{if(done)return;try{finish(code===0?validated(JSON.parse(Buffer.concat(chunks).toString('utf8')),source):null)}catch{finish(null)}});
   child.stdin.end(Buffer.concat([header,Buffer.from(html)]));
  }catch{abort()}
 });
}
