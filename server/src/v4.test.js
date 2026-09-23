import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {VoiceLibrary} from './library.js';
import {CategoryStore} from './categories.js';
import {Sequences} from './sequences.js';
import {createApp} from './app.js';

test('4.0 library fields, ordering and category lifecycle persist', async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'telegram-atendimento-v4-'));
  try{
    const library=new VoiceLibrary(dir);await library.init();
    const first=await library.add(null,{kind:'text',name:'Primeiro',category:'Boas-vindas',text:'Olá'});
    const second=await library.add(null,{kind:'text',name:'Segundo',active:false,text:'Até logo'});
    assert.equal(first.active,true);assert.equal(first.favorite,false);assert.equal(first.sortOrder,0);
    await library.update(first.id,{favorite:true,active:false});
    assert.equal((await library.get(first.id)).favorite,true);assert.equal((await library.get(first.id)).active,false);
    await library.reorder([second.id,first.id]);assert.deepEqual((await library.list()).map(item=>item.id),[second.id,first.id]);

    const categories=new CategoryStore(dir,null,library);await categories.init();
    const created=await categories.add({name:'Leads quentes'});await library.update(first.id,{category:created.name});
    await categories.rename(created.id,{name:'Prioridade'});
    assert.equal((await library.get(first.id)).category,'Prioridade');
    await categories.remove(created.id);assert.equal((await library.get(first.id)).category,'Geral');
    await assert.rejects(categories.remove((await categories.list()).find(item=>item.name==='Geral').id),/não pode/);
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('4.0 dashboard endpoints filter active items and accept configured origins', async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'telegram-atendimento-api-v4-')),token='t'.repeat(40);
  try{
    const library=new VoiceLibrary(dir);await library.init();
    await library.add(null,{kind:'text',name:'Ativo',active:true,text:'Mensagem ativa'});
    await library.add(null,{kind:'text',name:'Pausado',active:false,text:'Mensagem pausada'});
    const categories=new CategoryStore(dir,null,library);await categories.init();
    const sequences=new Sequences(dir);await sequences.init();
    const telegram={friendlyError:error=>error.message,currentTarget:async()=>({id:'11',name:'Teste'}),status:async()=>({authorized:false})};
    const app=createApp({telegram,library,sequences,categories,token,dashboardOrigins:['https://dashboard.example']});
    const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
    try{
      const base=`http://127.0.0.1:${server.address().port}`,headers={Authorization:`Bearer ${token}`,Origin:'https://dashboard.example'};
      const active=await fetch(base+'/library?active=true',{headers});assert.equal(active.status,200);assert.deepEqual((await active.json()).items.map(item=>item.name),['Ativo']);
      const categoriesResponse=await fetch(base+'/categories',{headers});assert.equal(categoriesResponse.status,200);assert.ok((await categoriesResponse.json()).categories.some(item=>item.name==='Geral'));
      const blocked=await fetch(base+'/library',{headers:{Authorization:`Bearer ${token}`,Origin:'https://other.example'}});assert.equal(blocked.status,403);
    }finally{await new Promise(resolve=>server.close(resolve));}
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('4.0 replaces a voice file without losing its metadata', {skip:!process.env.FFMPEG_PATH}, async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'telegram-atendimento-replace-v4-'));
  try{
    const firstPath=path.join(dir,'first.wav'),secondPath=path.join(dir,'second.wav');
    assert.equal(spawnSync(process.env.FFMPEG_PATH,['-f','lavfi','-i','sine=frequency=440:duration=1',firstPath]).status,0);
    assert.equal(spawnSync(process.env.FFMPEG_PATH,['-f','lavfi','-i','sine=frequency=880:duration=2',secondPath]).status,0);
    const library=new VoiceLibrary(dir);await library.init();
    const item=await library.add({path:firstPath,originalname:'first.wav'},{kind:'voice',name:'Alô'});
    const replaced=await library.replaceFile(item.id,{path:secondPath,originalname:'second.wav'});
    assert.equal(replaced.name,'Alô');assert.notEqual(replaced.storedName,item.storedName);assert.ok(replaced.duration>=2);assert.equal((await library.list())[0].id,item.id);assert.equal((await fs.readFile(path.join(dir,'library',item.storedName)).catch(()=>null)),null);
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('6.0 library stores and replaces private document content',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'telegram-atendimento-file-v6-'));
 try{
  const first=path.join(dir,'catalogo.pdf'),second=path.join(dir,'catalogo-novo.pdf');await fs.writeFile(first,'%PDF-1.4 primeiro');await fs.writeFile(second,'%PDF-1.4 segundo');
  const library=new VoiceLibrary(dir);await library.init();const item=await library.add({path:first,originalname:'Catálogo.pdf'},{kind:'file',name:'Catálogo',category:'Vendas'});
  assert.equal(item.kind,'file');assert.equal(item.originalName,'Catálogo.pdf');assert.match(item.storedName,/\.pdf$/);assert.equal((await fs.readFile((await library.get(item.id)).path,'utf8')),'%PDF-1.4 primeiro');
  const replaced=await library.replaceFile(item.id,{path:second,originalname:'Catálogo 2026.pdf'});assert.equal(replaced.originalName,'Catálogo 2026.pdf');assert.equal(replaced.name,'Catálogo');assert.equal((await fs.readFile((await library.get(item.id)).path,'utf8')),'%PDF-1.4 segundo');
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
