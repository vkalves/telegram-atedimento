import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {setupSupport,personalizeReply} from '../../dashboard/support.js';
const lead={dialog_id:'123',name:'Ana Silva',username:'ana_silva',status:'open',priority:0,tags:['novo'],owner:'',notes:'Contexto',version:1,needs_reply:true,waiting_since:new Date().toISOString(),last_preview:'Olá'};
const settle=()=>new Promise(r=>setImmediate(r));
test('dashboard edits a lead, exposes conflicts without losing notes and personalizes replies',async()=>{
 const dom=new JSDOM('<section id="supportView"></section><section id="repliesView"></section>');
 const old={document:globalThis.document,Option:globalThis.Option,setInterval:globalThis.setInterval};Object.assign(globalThis,{document:dom.window.document,Option:dom.window.Option,setInterval:()=>0});
 dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;};
 const el=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};const btn=(text,fn,cls)=>{const e=el('button',text,cls);e.type='button';e.onclick=fn;return e;};
 let fail=false;const writes=[];
 try{
  const ui=setupSupport({element:el,button:btn,showToast:()=>{},api:async(path,options={})=>{if(options.method==='PATCH'){writes.push(options.body);if(fail)throw Error('Conflito: atualize');return {lead};}return {items:[lead],total:1,stats:{reply:1},health:{}};}});
  ui.activate('support');await settle();document.querySelector('.desk-name').click();document.getElementById('leadNotes').value='Atualizado';fail=true;
  await document.getElementById('leadForm').onsubmit({preventDefault(){}});assert.equal(document.getElementById('leadNotes').value,'Atualizado');assert.match(document.getElementById('leadError').textContent,/Conflito/);assert.equal(document.getElementById('leadDialog').open,true);
  fail=false;await document.getElementById('leadForm').onsubmit({preventDefault(){}});assert.equal(writes[1].notes,'Atualizado');assert.equal(document.getElementById('leadDialog').open,false);
  assert.equal(personalizeReply('Olá {primeiro_nome}, {usuario}!',lead),'Olá Ana, @ana_silva!');
 }finally{Object.assign(globalThis,old);dom.window.close();}
});

test('Telegram panel ignores stale lead reads and restores a draft to its own conversation',async()=>{
 const dom=new JSDOM('<html><body></body></html>',{url:'https://web.telegram.org/k/#123',runScripts:'outside-only'});const w=dom.window;w.confirm=()=>true;
 let resolveA,delay=true;const calls=[];
 try{
  w.eval(await fs.readFile(new URL('../../extension/support.js',import.meta.url),'utf8'));
  const ui=w.TelevoiceSupport({api:async(path,options={})=>{calls.push([path,options]);if(path==='/support/lead'){if(options.body.dialogId==='123'&&delay)return new Promise(r=>resolveA=r);return {lead:{...lead,dialog_id:options.body.dialogId,name:options.body.dialogId==='123'?'Ana':'Beatriz'}};}return {items:[]};}});
  ui.setTarget({id:'123',name:'Ana'},'123');ui.toggle();ui.setTarget({id:'456',name:'Beatriz'},'456');await settle();resolveA({lead});await settle();
  const root=w.document.getElementById('televoice-support-panel').shadowRoot;assert.equal(root.querySelector('.title').textContent,'Beatriz');
  const notes=root.querySelector('textarea');notes.value='Nota de Beatriz';notes.dispatchEvent(new w.Event('input',{bubbles:true}));delay=false;
  ui.setTarget({id:'123',name:'Ana'},'123');await settle();assert.equal(root.querySelector('textarea').value,'Contexto');
  ui.setTarget({id:'456',name:'Beatriz'},'456');await settle();assert.equal(root.querySelector('textarea').value,'Nota de Beatriz');assert.equal(calls.filter(([path])=>path==='/jobs').length,0);
 }finally{dom.window.close();}
});
