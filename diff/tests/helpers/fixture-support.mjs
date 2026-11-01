import {pathToFileURL} from 'node:url';
export async function offlineFetch(){throw new Error('SYNTHETIC QA forbids external provider requests')}
export function seedOnce(store,name,seed){
 store.db.exec('CREATE TABLE IF NOT EXISTS qa_fixture_seed(name TEXT PRIMARY KEY)');
 if(store.db.prepare('SELECT name FROM qa_fixture_seed WHERE name=?').get(name))return;
 seed();store.db.prepare('INSERT INTO qa_fixture_seed VALUES(?)').run(name);
}
export function syntheticTech({observed=true}={}){
 const checkedAt=Date.now();
 const observations=[['100000000','12000000'],['200000000','24000000']].map(([inputAmount,outputAmount])=>({source:'https://example.invalid/synthetic-quote?amount='+inputAmount,inputAmount,outputAmount,unit:'SYNTHETIC raw token units',pools:['synthetic-pool']}));
 return {enqueue(){},get(){return {candidate:true,claims:['SYNTHETIC QA claim only'],status:'unverified',color:'gray',checkedAt,observation:null,limitations:'SYNTHETIC QA ONLY. No website or quote service was contacted.',functional:{status:observed?'observed':'unsupported',color:observed?'green':'gray',label:'SYNTHETIC QA ONLY',checkedAt,expiresAt:checkedAt+600000,capability:'SYNTHETIC QA ONLY / simulated quote computation; no provider was contacted',affiliation:'unverified',observations:observed?observations:[]}}}};
}
// Importing factories has no listening/process side effects. Direct execution is loopback only.
export function launchFixture(moduleUrl,create){
 if(!process.argv[1]||moduleUrl!==pathToFileURL(process.argv[1]).href)return;
 const port=Number(process.env.PORT||4318);
 if(!Number.isInteger(port)||port<0||port>65535)throw new Error('PORT must be an integer from 0 to 65535');
 const fixture=create();
 fixture.app.listen(port,'127.0.0.1',()=>console.log('SYNTHETIC QA ONLY http://127.0.0.1:'+fixture.app.address().port));
 for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>fixture.app.close(()=>{fixture.store.close();process.exit(0)}));
}
