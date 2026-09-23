import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {JSDOM} from 'jsdom';

test('actual extension starts one flow bound to the captured conversation and retains audio controls',async()=>{
 const dom=new JSDOM('<html><body><div class="chat"><div class="chat-input"><textarea aria-label="Mensagem"></textarea></div></div></body></html>',{url:'https://web.telegram.org/k/#123',runScripts:'outside-only',pretendToBeVisual:true});
 const w=dom.window,calls=[];w.confirm=()=>true;w.setInterval=()=>0;w.requestAnimationFrame=()=>0;
 w.Element.prototype.getBoundingClientRect=()=>({width:600,height:50,bottom:700,top:650,left:0,right:600});
 w.chrome={runtime:{sendMessage:async message=>{
  calls.push(message);
  if(message.type==='connection-status')return {configured:true};
  if(message.path==='/context')return {ok:true,data:{target:{id:'123',name:'Lead A'}}};
  if(message.path?.startsWith('/library'))return {ok:true,data:{items:[{id:'audio',kind:'voice',storedName:'audio.ogg',name:'Áudio existente'}]}};
  if(message.path==='/flows')return {ok:true,data:{flows:[{id:'flow',name:'Boas-vindas',active:true}]}};
  if(message.path?.startsWith('/flow-runs?'))return {ok:true,data:{runs:[]}};
  if(message.path==='/flow-runs')return {ok:true,data:{run:{id:'run',dialog_id:'123',status:'running',current_step:0,snapshot:{steps:[{type:'text',text:'Olá'}]}}}};
  return {ok:true,data:{jobs:[]}};
 }}};
 try{
  w.eval(await fs.readFile(new URL('../../extension/content.js',import.meta.url),'utf8'));
  await new Promise(resolve=>setImmediate(resolve));
  const root=w.document.getElementById('telegram-atendimento-5-audio-bar').shadowRoot;
  assert.ok([...root.querySelectorAll('button')].some(b=>b.textContent==='Áudio existente'));
  let select=root.querySelector('select');assert.ok(select);select.value='flow';select.dispatchEvent(new w.Event('change'));
  const start=[...root.querySelectorAll('button')].find(b=>b.textContent==='Iniciar fluxo');assert.equal(start.disabled,false);start.click();start.click();
  await new Promise(resolve=>setImmediate(resolve));
  const posts=calls.filter(c=>c.path==='/flow-runs'&&c.method==='POST');assert.equal(posts.length,1);assert.equal(posts[0].body.dialogId,'123');assert.equal(posts[0].body.peerKey,'123');assert.ok(posts[0].body.requestId);
 }finally{dom.window.close();}
});
