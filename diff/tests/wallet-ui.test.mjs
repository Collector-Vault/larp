import test from 'node:test';
import assert from 'node:assert/strict';
import {walletDocument} from './helpers/wallet-dom.mjs';
let instance=0;
async function setup(t){
 const original={document:globalThis.document,fetch:globalThis.fetch};
 const document=walletDocument();globalThis.document=document;
 const wallets=[{address:'1'.repeat(32),labels:['Synthetic first'],status:'not connected',activity:[]},{address:'1'.repeat(31)+'2',labels:['Synthetic second'],status:'not connected',activity:[]}];
 let failSave=false;
 globalThis.fetch=async(url,options)=>{
  assert.equal(url,'/api/wallets');
  if(options){const data=JSON.parse(options.body);if(data.action==='edit'){if(failSave)return {ok:false,json:async()=>({error:'Synthetic save failure'})};wallets.find(w=>w.address===data.address).labels=[data.label];}else if(data.action==='check')wallets.find(w=>w.address===data.address).status='queued';else throw new Error('Unexpected synthetic action');return {ok:true,json:async()=>({ok:true})};}
  return {ok:true,json:async()=>({wallets:structuredClone(wallets),report:null,rpc:null})};
 };
 t.after(()=>{globalThis.document=original.document;globalThis.fetch=original.fetch});
 const ui=await import('../public/wallets.js?wallet-test='+instance++);
 await ui.refreshWallets();
 const get=selector=>document.querySelector(selector),select=index=>get('#wallet-list').querySelectorAll('[data-wallet]')[index].onclick();
 select(0);
 const edit=value=>{const input=get('#wallet-label');input.value=value;input.focus();input.oninput?.()};
 return {...ui,get,edit,select,document,wallets,failSave:()=>{failSave=true}};
}
test('wallet label draft survives blur and repeated polling while activity updates',async t=>{
 const h=await setup(t);h.edit('Unsaved <label>');h.get('#outside').focus();h.wallets[0].status='queued';
 await h.refreshWallets();await h.refreshWallets();
 assert.equal(h.get('#wallet-label').value,'Unsaved <label>');
 assert.match(h.get('#wallet-activity').innerHTML,/queued/);
 assert.deepEqual(h.wallets[0].labels,['Synthetic first']);
});
test('activity check forced refresh preserves the unsaved label',async t=>{
 const h=await setup(t);h.edit('Draft during lookup');await h.get('#wallet-check').onclick();
 assert.equal(h.get('#wallet-label').value,'Draft during lookup');
 assert.match(h.get('#wallet-activity').innerHTML,/queued/);
});
test('empty draft survives polling and can be saved',async t=>{
 const h=await setup(t);h.edit('');h.get('#outside').focus();await h.refreshWallets();
 assert.equal(h.get('#wallet-label').value,'');await h.get('#wallet-save').onclick();
 assert.deepEqual(h.wallets[0].labels,['']);assert.equal(h.get('#wallet-message').textContent,'Label saved');
});
test('failed label save preserves draft for retry',async t=>{
 const h=await setup(t);h.edit('Retry me');h.failSave();await h.get('#wallet-save').onclick();h.get('#outside').focus();await h.refreshWallets();
 assert.equal(h.get('#wallet-label').value,'Retry me');assert.equal(h.get('#wallet-message').textContent,'Synthetic save failure');
});
test('cancel explicitly discards draft and restores latest saved label',async t=>{
 const h=await setup(t);h.edit('Discard me');h.get('#outside').focus();await h.refreshWallets();
 assert.ok(h.get('#wallet-cancel'),'Cancel edit button is available');h.get('#wallet-cancel').onclick();
 assert.equal(h.get('#wallet-label').value,'Synthetic first');await h.refreshWallets();assert.equal(h.get('#wallet-label').value,'Synthetic first');
});
test('changing wallet discards old draft without leaking into next wallet',async t=>{
 const h=await setup(t);h.edit('First draft');h.select(1);assert.equal(h.get('#wallet-label').value,'Synthetic second');
 h.select(0);assert.equal(h.get('#wallet-label').value,'Synthetic first');
});
test('successful save clears draft so subsequent server labels can refresh',async t=>{
 const h=await setup(t);h.edit('Saved');await h.get('#wallet-save').onclick();assert.deepEqual(h.wallets[0].labels,['Saved']);
 h.wallets[0].labels=['Updated elsewhere'];h.get('#outside').focus();await h.refreshWallets();assert.equal(h.get('#wallet-label').value,'Updated elsewhere');
});
