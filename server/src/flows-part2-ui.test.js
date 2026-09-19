import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {setupFlows,formatFlowLog} from '../../dashboard/flows.js';

test('editor salva espera de duas horas com follow-up e comandos apontam para a execução exata',async()=>{
 const dom=new JSDOM(await fs.readFile(new URL('../../dashboard/index.html',import.meta.url),'utf8'));
 const old={document:globalThis.document,Option:globalThis.Option,confirm:globalThis.confirm,setInterval:globalThis.setInterval};Object.assign(globalThis,{document:dom.window.document,Option:dom.window.Option,confirm:()=>true,setInterval:()=>0});
 const $=id=>document.getElementById(id),calls=[];
 const run={id:'run-A',dialog_id:'123',target_name:'Lead A',status:'awaiting_reply',control_version:7,current_step:0,started_at:new Date().toISOString(),snapshot:{name:'Primeiro Atendimento',steps:[{type:'reply'}]}};
 dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;};
 const element=(tag,text)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;return e;};
 const button=(label,action)=>{const e=element('button',label);e.type='button';e.onclick=action;return e;};
 const api=async(path,options={})=>{calls.push([path,options]);return path==='/flows'?{flows:[]}:path==='/flow-runs'?{runs:[run]}:{run};};
 try{
  const ui=setupFlows({api,element,button,showToast:()=>{},getItems:()=>[]});await ui.refresh();$('newFlow').click();$('flowName').value='Respostas';$('addFlowreply').click();
  const input=$('flowSteps').querySelector('input');input.value='7200';input.dispatchEvent(new dom.window.Event('input'));
  const select=$('flowSteps').querySelector('select');select.value='followup';select.dispatchEvent(new dom.window.Event('change'));
  const text=$('flowSteps').querySelector('textarea');text.value='Posso ajudar?';text.dispatchEvent(new dom.window.Event('input'));
  await $('flowForm').onsubmit({preventDefault(){}});
  const save=calls.find(([p,o])=>p==='/flows'&&o.method==='POST');assert.deepEqual(save[1].body.steps,[{type:'reply',timeoutSeconds:7200,timeoutAction:'followup',followupText:'Posso ajudar?'}]);
  assert.match($('flowRuns').textContent,/Aguardando resposta/);
  const take=[...$('flowRuns').querySelectorAll('button')].find(b=>b.textContent==='Assumir atendimento');take.click();take.click();await new Promise(r=>setImmediate(r));
  const commands=calls.filter(([p])=>p==='/flow-runs/run-A/control');assert.equal(commands.length,1);assert.equal(commands[0][1].body.action,'human');assert.equal(commands[0][1].body.version,7);assert.ok(commands[0][1].body.requestId);
  assert.match(formatFlowLog({event:'reply_received',step:0,created_at:run.started_at},run),/Resposta do lead detectada/);
  assert.match(formatFlowLog({event:'followup_sent',step:0,created_at:run.started_at},run),/Follow-up executado/);
 }finally{Object.assign(globalThis,old);dom.window.close();}
});

test('extensão mostra aguardando resposta e pausa somente a execução exibida',async()=>{
 const dom=new JSDOM('<html><body><div class="chat"><div class="chat-input"><textarea aria-label="Mensagem"></textarea></div></div></body></html>',{url:'https://web.telegram.org/k/#123',runScripts:'outside-only',pretendToBeVisual:true});
 const w=dom.window,calls=[];w.confirm=()=>true;w.setInterval=()=>0;w.requestAnimationFrame=()=>0;w.Element.prototype.getBoundingClientRect=()=>({width:600,height:50,bottom:700,top:650,left:0,right:600});
 const run={id:'run-A',dialog_id:'123',status:'awaiting_reply',control_version:9,current_step:2,snapshot:{name:'Primeiro Atendimento',steps:Array(6).fill({type:'text'})}};
 w.chrome={runtime:{sendMessage:async m=>{calls.push(m);if(m.type==='connection-status')return {configured:true};if(m.path==='/context')return {ok:true,data:{target:{id:'123',name:'Lead A'}}};if(m.path==='/flows')return {ok:true,data:{flows:[]}};if(m.path?.startsWith('/flow-runs?'))return {ok:true,data:{runs:[run]}};return {ok:true,data:{items:[],jobs:[],run}};}}};
 try{w.eval(await fs.readFile(new URL('../../extension/content.js',import.meta.url),'utf8'));await new Promise(r=>setImmediate(r));const root=w.document.getElementById('telegram-atendimento-5-audio-bar').shadowRoot;assert.match(root.textContent,/Fluxo ativo: Primeiro Atendimento · Status: aguardando resposta · Etapa atual: 3 de 6/);const pause=[...root.querySelectorAll('button')].find(b=>b.textContent==='Pausar fluxo');pause.click();pause.click();await new Promise(r=>setImmediate(r));const commands=calls.filter(c=>c.path==='/flow-runs/run-A/control');assert.equal(commands.length,1);assert.equal(commands[0].body.version,9);assert.equal(commands[0].body.action,'pause');}finally{dom.window.close();}
});
