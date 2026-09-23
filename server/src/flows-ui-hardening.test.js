import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {setupFlows} from '../../dashboard/flows.js';

test('visual builder preserves branch destinations, every advanced step and history evidence',async()=>{
 const dom=new JSDOM(await fs.readFile(new URL('../../dashboard/index.html',import.meta.url),'utf8'));
 const previous={document:globalThis.document,Option:globalThis.Option,confirm:globalThis.confirm,setInterval:globalThis.setInterval};
 Object.assign(globalThis,{document:dom.window.document,Option:dom.window.Option,confirm:()=>true,setInterval:()=>0});
 dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;};
 const $=id=>document.getElementById(id),calls=[],flows=[];
 const items=[{id:'voice-1',kind:'voice',name:'Áudio',active:true,storedName:'voice.ogg'},{id:'image-1',kind:'image',name:'Catálogo',active:true,storedName:'image.png'},{id:'file-1',kind:'file',name:'Proposta',active:true,storedName:'proposal.pdf'}];
 const element=(tag,text,className)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(className)node.className=className;return node;};
 const button=(text,action)=>{const node=element('button',text);node.type='button';node.onclick=action;return node;};
 let run=null;
 const api=async(path,options={})=>{
  calls.push([path,structuredClone(options)]);
  if(path==='/flows'&&options.method==='POST'){const flow={...structuredClone(options.body),id:'flow-1',revision:1};flows.push(flow);return {flow};}
  if(path==='/flows')return {flows:structuredClone(flows)};
  if(path==='/flow-runs')return {runs:run?[structuredClone(run)]:[]};
  if(path==='/flow-runs/run-1/logs')return {logs:[
   {id:1,step:0,event:'completed',message_id:'10',created_at:new Date().toISOString()},
   {id:2,step:1,event:'reply_received',message_id:'11',detail:'sim',created_at:new Date().toISOString()},
   {id:3,step:2,event:'condition_evaluated',detail:'{"matched":true,"nextStep":3}',created_at:new Date().toISOString()},
   {id:4,step:3,event:'completed',message_id:'12',created_at:new Date().toISOString()}
  ]};
  return {};
 };
 try{
  const ui=setupFlows({api,element,button,showToast:()=>{},getItems:()=>items});await ui.refresh();$('newFlow').click();$('flowName').value='Conversa completa';
  for(const type of ['text','reply','condition','audio','handoff','end'])$('addFlow'+type).click();
  const cards=[...$('flowSteps').children];
  const message=cards[0].querySelector('textarea');message.value='Olá, {primeiro_nome}!';message.dispatchEvent(new dom.window.Event('input'));
  const content=cards[3].querySelector('select');content.value='image-1';content.dispatchEvent(new dom.window.Event('change'));
  const conditionInputs=cards[2].querySelectorAll('input');conditionInputs[0].value='sim';conditionInputs[0].dispatchEvent(new dom.window.Event('input'));
  const conditionSelects=cards[2].querySelectorAll('select'),contentId=cards[3].dataset.stepId,handoffId=cards[4].dataset.stepId;
  conditionSelects[1].value=contentId;conditionSelects[1].dispatchEvent(new dom.window.Event('change'));
  conditionSelects[2].value=handoffId;conditionSelects[2].dispatchEvent(new dom.window.Event('change'));
  await $('flowForm').onsubmit({preventDefault(){}});
  assert.deepEqual(flows[0].steps.map(step=>step.type),['text','reply','condition','content','handoff','end']);
  assert.equal(flows[0].steps[2].thenStepId,contentId);assert.equal(flows[0].steps[2].elseStepId,handoffId);assert.equal(flows[0].steps[3].itemId,'image-1');
  run={id:'run-1',dialog_id:'123',target_name:'Lead',status:'done',current_step:6,started_at:new Date().toISOString(),completed_at:new Date().toISOString(),snapshot:structuredClone(flows[0])};
  await ui.refresh();[...$('flowRuns').querySelectorAll('button')].find(node=>node.textContent==='Ver histórico').click();await new Promise(resolve=>setImmediate(resolve));
  const history=$('flowLogContent').textContent;assert.match(history,/✓ 1\. Mensagem de texto/);assert.match(history,/✓ 3\. Condição pela resposta/);assert.match(history,/✓ 4\. Conteúdo da biblioteca/);assert.match(history,/Resposta do lead detectada/);assert.match(history,/Telegram #12/);
 }finally{Object.assign(globalThis,previous);dom.window.close();}
});
