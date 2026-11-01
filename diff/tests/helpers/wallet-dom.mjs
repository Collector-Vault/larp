// Minimal DOM boundary for the real wallets module. No browser or network needed.
const decode=s=>s.replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
class Element {
 constructor(document,attributes={}){this.document=document;this.attributes=attributes;this.dataset={};for(const [k,v] of Object.entries(attributes))if(k.startsWith('data-'))this.dataset[k.slice(5)]=v;this.value=attributes.value||'';this.children=[];this.textContent='';}
 set innerHTML(html){this.html=html;this.children=[];const stack=[this];for(const token of html.matchAll(/<\/?[a-z][^>]*>/gi)){if(token[0].startsWith('</')){if(stack.length>1){const child=stack.pop();child.html=html.slice(child.contentStart,token.index)}continue}const tag=token[0].match(/^<([a-z0-9-]+)/i)[1];const attributes={};for(const a of token[0].matchAll(/([a-z][a-z0-9-]*)="([^"]*)"/gi))attributes[a[1]]=decode(a[2]);const child=new Element(this.document,attributes);child.contentStart=token.index+token[0].length;child.parent=stack.at(-1);child.parent.children.push(child);if(!['input','br','img','hr','meta','link'].includes(tag))stack.push(child);}}
 get innerHTML(){return this.html||''}
 querySelectorAll(selector){const matches=e=>selector.startsWith('#')?e.attributes.id===selector.slice(1):selector==='[data-wallet]'?'wallet' in e.dataset:e.dataset.wallet===selector.match(/^\[data-wallet="([^"]+)"\]$/)?.[1];const found=[];const visit=e=>{for(const child of e.children){if(matches(child))found.push(child);visit(child)}};visit(this);return found;}
 querySelector(selector){return this.querySelectorAll(selector)[0]||null}
 contains(element){return element===this||this.children.some(child=>child.contains(element))}
 focus(){this.document.activeElement=this}
}
export function walletDocument(){const document={activeElement:null};const root=new Element(document);root.innerHTML='<section id="wallet-panel"></section><button id="outside"></button>';document.querySelector=selector=>root.querySelector(selector);return document;}
