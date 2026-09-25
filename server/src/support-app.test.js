import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {JSDOM} from 'jsdom';

test('full dashboard boots into the queue and routes to replies and the existing library',async()=>{
 const dom=new JSDOM(await fs.readFile(new URL('../../dashboard/index.html',import.meta.url),'utf8'),{url:'https://dashboard.example'});
 const keys=['document','window','Option','localStorage','setInterval','fetch'];const old=Object.fromEntries(keys.map(key=>[key,globalThis[key]]));
 Object.assign(globalThis,{document:dom.window.document,window:dom.window,Option:dom.window.Option,localStorage:dom.window.localStorage,setInterval:()=>0});
 localStorage.setItem('telegram-atendimento-4-dashboard-connection',JSON.stringify({url:'https://api.example',token:'x'.repeat(32)}));
 globalThis.fetch=async url=>{
  const path=new URL(url).pathname;let data={};
  if(path==='/support/queue')data={items:[],total:0,stats:{reply:12,due:3,waiting:10,done:7},health:{}};
  if(path==='/library')data={items:[{id:'voice',name:'Boas-vindas',category:'Geral',storedName:'file.ogg',active:true}]};
  if(path==='/categories')data={categories:[{id:'general',name:'Geral'}]};
  if(path==='/auth/status')data={authorized:true,me:{name:'Conta de teste'}};
  if(path==='/support/replies')data={items:[{id:'reply',title:'Saudação',category:'Geral',body:'Olá {nome}',version:1}]};
  return new Response(JSON.stringify(data),{status:200});
 };
 try{
  await import('../../dashboard/app.js');await new Promise(resolve=>setImmediate(resolve));
  const $=id=>document.getElementById(id);
  assert.equal($('appShell').hidden,false);assert.equal($('supportView').hidden,false);assert.equal($('libraryView').hidden,true);assert.equal($('deskReply').textContent,'12');
  document.querySelector('[data-view="replies"]').click();await new Promise(resolve=>setImmediate(resolve));assert.equal($('repliesView').hidden,false);assert.match($('replyList').textContent,/Saudação/);
  document.querySelector('[data-view="library"]').click();assert.equal($('supportView').hidden,true);assert.match($('audioList').textContent,/Boas-vindas/);
  $('sortFilter').value='name';$('sortFilter').dispatchEvent(new dom.window.Event('change'));assert.equal($('audioList').firstElementChild.draggable,false);
 }finally{for(const key of keys)globalThis[key]=old[key];dom.window.close();}
});
