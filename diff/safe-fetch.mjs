import https from 'node:https';
import {resolve4} from 'node:dns/promises';
import {isIP} from 'node:net';

export function safeUrl(value) {
 if(typeof value!=='string'||value.length>2048)throw new Error('Invalid metadata URL');
 let input=value.trim();
 if(input.startsWith('ipfs://'))input='https://ipfs.io/ipfs/'+input.slice(7).replace(/^ipfs\//,'');
 const u=new URL(input);u.hostname=u.hostname.replace(/\.+$/,'');
 if(u.protocol!=='https:'||u.username||u.password||(u.port&&u.port!=='443')||isIP(u.hostname)||u.hostname.includes(':')||!u.hostname.includes('.')||/(^|\.)(localhost|local|internal|home|lan|test|invalid)$/.test(u.hostname))throw new Error('Only public HTTPS hosts are allowed');
 u.hash='';return u;
}
export function isPublicIPv4(ip) {
 if(isIP(ip)!==4)return false;const [a,b,c]=ip.split('.').map(Number);
 return !(a===0||a===10||a===127||a>=224||(a===100&&b>=64&&b<=127)||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&(b===168||b===0||b===88&&c===99))||(a===198&&(b===18||b===19||b===51&&c===100))||(a===203&&b===0&&c===113));
}
const limits={json:128*1024,market:1024*1024,image:2*1024*1024,html:128*1024};
function checkDimensions(b,type){
 let w=0,h=0;
 if(type==='image/png'&&b.length>=24){w=b.readUInt32BE(16);h=b.readUInt32BE(20)}
 if(type==='image/gif'&&b.length>=10){w=b.readUInt16LE(6);h=b.readUInt16LE(8)}
 if(type==='image/webp'&&b.length>=30){const chunk=b.toString('ascii',12,16);if(chunk==='VP8X'){w=1+b.readUIntLE(24,3);h=1+b.readUIntLE(27,3)}else if(chunk==='VP8L'&&b[20]===47){w=1+((b[21]|b[22]<<8)&16383);h=1+((b[22]>>6)|(b[23]<<2)|((b[24]&15)<<10))}else if(chunk==='VP8 '&&b.toString('hex',23,26)==='9d012a'){w=b.readUInt16LE(26)&16383;h=b.readUInt16LE(28)&16383}}
 if(type==='image/jpeg'){let p=2;while(p+8<b.length){if(b[p++]!==255)break;while(b[p]===255)p++;const marker=b[p++];if(marker===217||marker===218)break;const length=b.readUInt16BE(p);if(length<2||p+length>b.length)break;if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)){h=b.readUInt16BE(p+3);w=b.readUInt16BE(p+5);break}p+=length}}
 if(!w||!h||w>8192||h>8192||w*h>16000000)throw new Error('Unsupported or excessive image dimensions');
}
export function validateBody(body,contentType,kind) {
 if(body.length>limits[kind])throw new Error('Response exceeds size limit');
 const type=(contentType||'').split(';')[0].trim().toLowerCase();
 if(kind==='html'){
  if(!['text/html','application/xhtml+xml'].includes(type))throw new Error('Unsupported website content type');
 }else if(kind==='json'||kind==='market'){
  if(!['application/json','text/json','text/plain','application/octet-stream'].includes(type))throw new Error('Unsupported metadata content type');
  const value=JSON.parse(body.toString('utf8'));if(kind==='market'?!Array.isArray(value):!value||typeof value!=='object'||Array.isArray(value))throw new Error('Metadata must be an object');
 }else{
  const signature=body.subarray(0,12);let actual=null;
  if(signature.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')))actual='image/png';
  else if(signature[0]===255&&signature[1]===216&&signature[2]===255)actual='image/jpeg';
  else if(['GIF87a','GIF89a'].includes(signature.subarray(0,6).toString()))actual='image/gif';
  else if(signature.subarray(0,4).toString()==='RIFF'&&signature.subarray(8,12).toString()==='WEBP')actual='image/webp';
  if(!actual||![actual,'application/octet-stream'].includes(type))throw new Error('Unsupported or invalid raster image');
  checkDimensions(body,actual);
  return {body,type:actual};
 }
 return {body,type};
}
async function boundedResolve(host,resolve,timeoutMs) {
 let timer;try{return await Promise.race([resolve(host),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('DNS lookup timed out')),timeoutMs)})])}finally{clearTimeout(timer)}
}
function requestBytes(url,address,kind,{request=https.request,timeoutMs=10000}={}) {
 return new Promise((resolve,reject)=>{
  const req=request(url,{method:'GET',agent:false,headers:{Accept:kind==='html'?'text/html':(kind==='json'||kind==='market')?'application/json, text/plain':'image/png,image/jpeg,image/webp,image/gif','Accept-Encoding':'identity','User-Agent':'DIFF-local/1.1'},lookup:(host,options,callback)=>callback(null,options?.all?[{address,family:4}]:address,4)},res=>{
   const status=res.statusCode;
   if([301,302,303,307,308].includes(status)){res.destroy();resolve({redirect:res.headers.location});return}
   if(status!==200){res.destroy();const error=new Error(`Source HTTP ${status}`);error.status=status;error.retryAfter=res.headers['retry-after'];error.host=url.hostname;reject(error);return}
   if(res.headers['content-encoding']&&res.headers['content-encoding']!=='identity'){res.destroy();reject(new Error('Compressed responses are not supported'));return}
   if(Number(res.headers['content-length'])>limits[kind]){res.destroy();reject(new Error('Response exceeds size limit'));return}
   let size=0;const chunks=[];
   res.on('data',chunk=>{size+=chunk.length;if(size>limits[kind]){req.destroy(new Error('Response exceeds size limit'));return}chunks.push(chunk)});
   res.on('error',reject);res.on('aborted',()=>reject(new Error('Response interrupted')));
   res.on('end',()=>{try{resolve(validateBody(Buffer.concat(chunks),res.headers['content-type'],kind))}catch(e){reject(e)}});
  });
  const timer=setTimeout(()=>req.destroy(new Error('Request timed out')),timeoutMs);
  req.on('error',reject);req.on('close',()=>clearTimeout(timer));req.end();
 });
}
export async function fetchRemote(value,kind,{resolve=resolve4,request=https.request,reserve=()=>{},timeoutMs=10000,maxRedirects=3}={}) {
 let url=safeUrl(value);
 for(let hop=0;hop<=maxRedirects;hop++){
  try {
  if(/(^|\.)(github\.com|githubusercontent\.com|github\.io|githubassets\.com)$/.test(url.hostname))throw new Error('GitHub access disabled for this app');
  reserve(url.href);const addresses=await boundedResolve(url.hostname,resolve,timeoutMs);
  if(!addresses.length||addresses.some(ip=>!isPublicIPv4(ip)))throw new Error('Host resolves to a private or non-public address');
  const result=await requestBytes(url,addresses[0],kind,{request,timeoutMs});
  if(!result.redirect)return {...result,url:url.href};
  if(hop===maxRedirects)throw new Error('Too many redirects');
  url=safeUrl(new URL(result.redirect,url).href);
  }catch(error){error.host ||= url.hostname;throw error}
 }
}
