import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {setupFlows} from '../../dashboard/flows.js';

test('dashboard creates, reorders, edits, disables and deletes flows with existing audio',async()=>{
 const dom=new JSDOM(await fs.readFile(new URL('../../dashboard/index.html',import.meta.url),'utf8'));
 const old={document:globalThis.document,Option:globalThis.Option,confirm:globalThis.confirm,setInterval:globalThis.setInterval};
 Object.assign(globalThis,{document:dom.window.document,Option:dom.window.Option,confirm:()=>true,setInterval:()=>0});
 const $=id=>document.getElementById(id),flows=[],calls=[];
 dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;};
 const element=(tag,text,className)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(className)el.className=className;return el;};
 const button=(text,action)=>{const el=element('button',text);el.type='button';el.onclick=action;return el;};
 const api=async(path,options={})=>{
  calls.push([path,options]);
  if(path==='/flow-runs')return {runs:[]};
  if(options.method==='POST'){flows.push({...structuredClone(options.body),id:'id',revision:1});return {};}
  if(options.method==='PATCH'){Object.assign(flows[0],structuredClone(options.body));return {};}
  if(options.method==='DELETE'){flows.length=0;return {};}
  return {flows:structuredClone(flows)};
 };
 const settle=()=>new Promise(resolve=>setImmediate(resolve));
 try{
  const ui=setupFlows({api,element,button,showToast:()=>{},getItems:()=>[{id:'audio',name:'Existente',storedName:'audio.ogg',active:true}]});await ui.refresh();
  $('newFlow').click();$('flowName').value='Atendimento';
  $('addFlowtext').click();let input=$('flowSteps').querySelector('textarea');input.value='Olá';input.dispatchEvent(new dom.window.Event('input'));
  $('addFlowwait').click();$('addFlowaudio').click();input=$('flowSteps').lastElementChild.querySelector('select');input.value='audio';input.dispatchEvent(new dom.window.Event('change'));
  assert.equal($('flowSteps').children.length,3);
  const last=$('flowSteps').lastElementChild;[...last.querySelectorAll('button')].find(b=>b.textContent.includes('Subir')).click();
  await $('flowForm').onsubmit({preventDefault(){}});
  assert.deepEqual(flows[0].steps.map(s=>s.type),['text','content','wait']);assert.equal(flows[0].steps[1].itemId,'audio');assert.ok(flows[0].steps.every(step=>step.id));assert.equal($('flowDialog').open,false);
  [...$('flowList').querySelectorAll('button')].find(b=>b.textContent==='Editar').click();$('flowName').value='Editado';await $('flowForm').onsubmit({preventDefault(){}});assert.equal(flows[0].name,'Editado');
  [...$('flowList').querySelectorAll('button')].find(b=>b.textContent==='Desativar').click();await settle();assert.equal(flows[0].active,false);
  [...$('flowList').querySelectorAll('button')].find(b=>b.textContent==='Excluir').click();await settle();assert.equal(flows.length,0);
  assert.ok(calls.some(([path,options])=>path==='/flows/id'&&options.method==='PATCH'&&options.body.revision===1));
 }finally{Object.assign(globalThis,old);dom.window.close();}
});
