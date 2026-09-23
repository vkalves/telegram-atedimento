import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {TelegramService} from './telegram.js';
import {Jobs} from './jobs.js';
import {VoiceLibrary} from './library.js';
import {createApp} from './app.js';
import {Sequences} from './sequences.js';
import {encodeSession,decodeSession} from './session-store.js';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
test('each asynchronous peer ID remains distinct and resolves to the right person',async()=>{
  const service=new TelegramService({apiId:1,apiHash:'test',dataDir:'/unused'});
  service.client={checkAuthorization:async()=>true,getDialogs:async()=>[{name:'A',entity:{id:11n,className:'User'}},{name:'B',entity:{id:22n,className:'User'}}],getPeerId:async e=>e.id.toString()};
  const rows=await service.getDialogs();assert.deepEqual(rows.map(x=>x.id),['11','22']);assert.equal((await service.resolveTarget({dialogId:'11'})).id,11n);assert.equal((await service.resolveTarget({dialogId:'22'})).id,22n);
});
test('voice includes duration and voice attribute; success requires a Telegram message ID',async()=>{
  const service=new TelegramService({apiId:1,apiHash:'test',dataDir:'/unused'});service.resolveTarget=async()=>({id:11n});let options;
  service.client={sendFile:async(_target,o)=>{options=o;return {id:99};}};
  assert.equal((await service.sendItem({path:'/x.ogg',duration:7.8,kind:'voice'},{dialogId:'11'})).messageId,'99');assert.equal(options.voiceNote,true);assert.equal(options.attributes[0].voice,true);assert.equal(options.attributes[0].duration,8);
  service.client.sendFile=async()=>undefined;await assert.rejects(service.sendItem({path:'/x.ogg'},{dialogId:'11'}),/não confirmou/);
});
test('voice can show Telegram recording status before it is sent',async()=>{
  const service=new TelegramService({apiId:1,apiHash:'test',dataDir:'/unused'});service.resolveTarget=async()=>({id:11n});const calls=[];
  service.client={invoke:async request=>calls.push(request),sendFile:async()=>{calls.push('sent');return{id:100};}};
  await service.sendItem({path:'/x.ogg',duration:2,kind:'voice'},{dialogId:'11'},{recordingDelay:.001});
  assert.equal(calls.length,2);assert.equal(calls[0].action.className,'SendMessageRecordAudioAction');assert.equal(calls[1],'sent');
});
test('flood waits stop the authentication retry loop and preserve the wait message',async()=>{
 const service=new TelegramService({apiId:1,apiHash:'test',dataDir:'/unused'});let attempts=0,shouldStop;
 service.client={checkAuthorization:async()=>false,start:async({onError})=>{attempts++;shouldStop=onError({errorMessage:'FLOOD_WAIT_42'});if(shouldStop)throw new Error('AUTH_USER_CANCEL');}};
 await service.startLogin('+5511999999999');await sleep(0);
 assert.equal(attempts,1);assert.equal(shouldStop,true);assert.equal(service.state,'error');assert.match(service.lastError,/42 segundos/);assert(service.authRetryAt>Date.now());
 await assert.rejects(service.startLogin('+5511999999999'),/FLOOD_WAIT_/);
});
test('terminal authentication errors stop retries while input errors remain retryable',async()=>{
 const service=new TelegramService({apiId:1,apiHash:'test',dataDir:'/unused'});
 assert.equal(service.authErrorShouldStop({errorMessage:'PHONE_NUMBER_INVALID'}),true);
 assert.equal(service.authErrorShouldStop({errorMessage:'PHONE_CODE_EXPIRED'}),true);
 assert.equal(service.authErrorShouldStop({errorMessage:'PHONE_CODE_INVALID'}),false);
 assert.equal(service.authErrorShouldStop({errorMessage:'PASSWORD_HASH_INVALID'}),false);
 let shouldStop;
 service.client={checkAuthorization:async()=>false,start:async({onError})=>{shouldStop=onError({errorMessage:'PHONE_NUMBER_INVALID'});if(shouldStop)throw new Error('AUTH_USER_CANCEL');}};
 await service.startLogin('+5511999999999');await sleep(0);
 assert.equal(shouldStop,true);assert.equal(service.state,'error');assert.match(service.lastError,/número.*inválido/i);
});
test('duplicate clicks, per-recipient isolation, cancellation and failures',async()=>{
  const sent=[],tg={requireAuthorized:async()=>{},friendlyError:e=>e.message,sendItem:async(item,target)=>{sent.push([item.id,target.dialogId]);return{messageId:String(sent.length)};}},lib={get:async id=>({id})},jobs=new Jobs(tg,lib);
  const input={requestId:'request-0001',dialogId:'11',steps:[{id:'a',delay:0},{id:'b',delay:1}]};
  jobs.create(input);jobs.create(input);await sleep(20);assert.equal(sent.length,1);assert.throws(()=>jobs.create({...input,requestId:'request-0002'}),/Já existe/);
  jobs.cancel(input.requestId);await sleep(20);assert.equal(jobs.get(input.requestId).state,'cancelled');assert.equal(sent.length,1);
  jobs.create({...input,requestId:'request-0003',dialogId:'22',steps:[{id:'c',delay:0}]});await sleep(20);assert.deepEqual(sent[1],['c','22']);
  tg.sendItem=async()=>{throw new Error('FLOOD_WAIT_12');};jobs.create({...input,requestId:'request-0004'});await sleep(20);assert.equal(jobs.get('request-0004').state,'error');assert.equal(jobs.get('request-0004').sent,0);
});
test('library serializes concurrent writes and persists edits',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'voice-test-'));try{const lib=new VoiceLibrary(dir);await lib.init();const [a,b]=await Promise.all([lib.add(null,{kind:'text',text:'A',name:'Primeira'}),lib.add(null,{kind:'text',text:'B'})]);assert.equal((await lib.list()).length,2);await lib.update(a.id,{category:'Boas-vindas',text:'Olá'});assert.equal((await lib.get(a.id)).text,'Olá');await lib.remove(b.id);assert.equal((await lib.list()).length,1);}finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('real FFmpeg conversion creates mono Ogg Opus', {skip:!process.env.FFMPEG_PATH},async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'voice-audio-test-'));try{const input=path.join(dir,'sample.wav');assert.equal(spawnSync(process.env.FFMPEG_PATH,['-f','lavfi','-i','sine=frequency=440:duration=1.5',input]).status,0);const lib=new VoiceLibrary(dir);await lib.init();const item=await lib.add({path:input,originalname:'sample.wav'},{kind:'voice'});assert.equal(item.duration,2);const file=(await lib.get(item.id)).path;const out=JSON.parse(spawnSync('ffprobe',['-v','quiet','-show_streams','-of','json',file],{encoding:'utf8'}).stdout);assert.equal(out.streams[0].codec_name,'opus');assert.equal(out.streams[0].channels,1);}finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('MP4 conversion carries real dimensions for Telegram video', {skip:!process.env.FFMPEG_PATH},async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'voice-video-test-'));try{const input=path.join(dir,'sample.mp4');assert.equal(spawnSync(process.env.FFMPEG_PATH,['-f','lavfi','-i','color=c=blue:s=320x240:d=1','-c:v','mpeg4',input]).status,0);const lib=new VoiceLibrary(dir);await lib.init();const item=await lib.add({path:input,originalname:'sample.mp4'},{kind:'video'});assert.equal(item.width,320);assert.equal(item.height,240);const probe=JSON.parse(spawnSync('ffprobe',['-v','quiet','-show_streams','-of','json',(await lib.get(item.id)).path],{encoding:'utf8'}).stdout);assert.equal(probe.streams[0].codec_name,'h264');}finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('session encryption round-trip, random nonce, tampering and wrong key',()=>{
 const key='ab'.repeat(32),encoded=encodeSession('TEST_SESSION_NOT_REAL',key);
 assert.equal(decodeSession(encoded,key),'TEST_SESSION_NOT_REAL');
 assert(!encoded.includes('TEST_SESSION_NOT_REAL'));assert.notEqual(encoded,encodeSession('TEST_SESSION_NOT_REAL',key));
 assert.throws(()=>decodeSession(encoded,'cd'.repeat(32)));
 const altered=JSON.parse(encoded);altered.tag=Buffer.alloc(16).toString('base64');assert.throws(()=>decodeSession(JSON.stringify(altered),key));
});
test('cloud sequence persistence and favorites',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'voice-cloud-seq-'));try{
  const lib=new VoiceLibrary(dir);await lib.init();const item=await lib.add(null,{kind:'text',name:'Olá',text:'Bem-vindo'});await lib.update(item.id,{favorite:true});assert.equal((await lib.get(item.id)).favorite,true);
  const seq=new Sequences(dir);await seq.init();const saved=await seq.save({name:'Recepção',steps:[{id:item.id,delay:0}]});
  const reloaded=new Sequences(dir);assert.equal((await reloaded.list())[0].id,saved.id);
  await assert.rejects(seq.save({name:'Inválida',steps:[{id:item.id,delay:-1}]}));
  await seq.remove(saved.id);assert.equal((await seq.list()).length,0);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('online API requires bearer token, accepts the extension password only from extensions, denies foreign origins and binds exact current recipient',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'voice-cloud-api-')),token='f'.repeat(64),extensionPassword='senha-simples';
 const lib=new VoiceLibrary(dir);await lib.init();const seq=new Sequences(dir);await seq.init();
 const tg={friendlyError:e=>e.message,requireAuthorized:async()=>{},status:async()=>({authorized:true}),currentTarget:async peerKey=>{if(peerKey!=='11')throw new Error('Invalid peer');return {id:'11',name:'Teste'};},sendItem:async()=>({messageId:'99'})};
 const app=createApp({telegram:tg,library:lib,sequences:seq,token,extensionPassword});const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 try{
  const base=`http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(base+'/health')).status,200);
  assert.equal((await fetch(base+'/library')).status,401);
  assert.equal((await fetch(base+'/library',{headers:{Authorization:'Bearer wrong'}})).status,401);
  assert.equal((await fetch(base+'/library',{headers:{Authorization:'Bearer '+token,Origin:'https://telegram-atendimento-dashboard.onrender.com'}})).status,200);
  assert.equal((await fetch(base+'/library',{headers:{Authorization:'Bearer '+token,Origin:'https://example.com'}})).status,403);
  const passwordHeaders={Authorization:'Bearer '+extensionPassword,Origin:'chrome-extension://'+'a'.repeat(32)};
  assert.equal((await fetch(base+'/library',{headers:passwordHeaders})).status,200);
  assert.equal((await fetch(base+'/library',{headers:{Authorization:'Bearer '+extensionPassword}})).status,401);
  assert.equal((await fetch(base+'/library',{headers:{...passwordHeaders,Origin:'https://example.com'}})).status,403);
  const headers={Authorization:'Bearer '+token,'Content-Type':'application/json',Origin:'chrome-extension://'+'a'.repeat(32)};
  assert.equal((await fetch(base+'/library',{headers})).status,200);
  const text=(await (await fetch(base+'/library',{method:'POST',headers,body:JSON.stringify({kind:'text',text:'Demo',name:'Mensagem'})})).json()).item;
  assert(text.id);
  const seqRes=await fetch(base+'/sequences',{method:'POST',headers,body:JSON.stringify({name:'Primeira',steps:[{id:text.id,delay:0}]})});assert.equal(seqRes.status,200);
  const wrong=await fetch(base+'/jobs',{method:'POST',headers,body:JSON.stringify({requestId:'request-test-1',peerKey:'11',dialogId:'22',steps:[{id:text.id,delay:0}]})});assert.equal(wrong.status,400);assert.match((await wrong.json()).error,/conversa mudou/i);
  const right=await fetch(base+'/jobs',{method:'POST',headers,body:JSON.stringify({requestId:'request-test-2',peerKey:'11',dialogId:'11',steps:[{id:text.id,delay:0}]})});assert.equal(right.status,200);
  await sleep(30);const state=await (await fetch(base+'/jobs',{headers})).json();assert.equal(state.jobs[0].sent,1);assert.equal(state.jobs[0].targetName,'Teste');
 }finally{await new Promise(r=>server.close(r));await fs.rm(dir,{recursive:true,force:true});}
});
test('new private context is resolved and channel contexts are refused',async()=>{
 const service=new TelegramService({apiId:1,apiHash:'test',dataDir:'/unused'});service.client={checkAuthorization:async()=>true,getPeerId:async e=>e.id.toString()};
 service.resolveTarget=async()=>({id:77n,firstName:'Teste',className:'User'});
 assert.equal((await service.currentTarget('77')).id,'77');
 await assert.rejects(service.currentTarget('-10077'));await assert.rejects(service.currentTarget('77_9'));
 service.resolveTarget=async()=>({id:77n,className:'Channel'});await assert.rejects(service.currentTarget('77'),/privadas/);
});

test('username context resolves quickly and falls back to a matching dialog',async()=>{
 const service=new TelegramService({apiId:1,apiHash:'test',dataDir:'/unused'});let dialogCalls=0;
 service.client={
  checkAuthorization:async()=>true,
  getEntity:async()=>{throw new Error('username lookup failed');},
  getDialogs:async()=>{dialogCalls++;return [{name:'Viela 2K',entity:{id:88n,username:'viela2k',firstName:'Viela',lastName:'2K',className:'User'}}];},
  getPeerId:async entity=>entity.id.toString()
 };
 const target=await service.currentTarget('@Viela2K');
 assert.deepEqual(target,{id:'88',name:'Viela 2K',firstName:'Viela',lastName:'2K',username:'viela2k',phone:null});
 assert.equal(dialogCalls,1);
});

test('numeric context falls back to direct lookup when refreshing dialogs fails',async()=>{
 const service=new TelegramService({apiId:1,apiHash:'test',dataDir:'/unused'});
 service.client={
  checkAuthorization:async()=>true,
  getDialogs:async()=>{throw new Error('dialog refresh unavailable');},
  getEntity:async id=>({id,className:'User',firstName:'Ana'}),
  getPeerId:async entity=>entity.id.toString()
 };
 assert.deepEqual(await service.currentTarget('11'),{id:'11',name:'Ana',firstName:'Ana',lastName:null,username:null,phone:null});
});

test('Supabase-backed audio, favorites and sequences survive removal of all local data',async()=>{
 const state=new Map(),objects=new Map();let uploads=0,downloads=0;
 const store={getState:async id=>structuredClone(state.get(id)??null),setState:async(id,value)=>state.set(id,structuredClone(value)),upload:async(name,file)=>{uploads++;objects.set(name,await fs.readFile(file));},download:async(name,file)=>{downloads++;if(!objects.has(name))throw new Error('Missing remote object');await fs.writeFile(file,objects.get(name));},remove:async name=>objects.delete(name)};
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'voice-restore-'));
 try{
  const lib=new VoiceLibrary(dir,store);await lib.init();
  const input=path.join(dir,'photo.png');await fs.writeFile(input,Buffer.from('synthetic-image-test'));
  const item=await lib.add({path:input,originalname:'photo.png'},{kind:'image',name:'Foto teste'});await lib.update(item.id,{favorite:true});
  const seq=new Sequences(dir,store);await seq.init();await seq.save({name:'Recepção',steps:[{id:item.id,delay:0}]});
  const key='12'.repeat(32);await store.setState('telegram-session',encodeSession('FAKE_SESSION',key));
  await fs.rm(dir,{recursive:true,force:true});
  const restored=new VoiceLibrary(dir,store);await restored.init();const [first,second]=await Promise.all([restored.get(item.id),restored.get(item.id)]);
  assert.equal(first.id,second.id);assert.equal(first.favorite,true);assert.equal((await fs.readFile(first.path)).toString(),'synthetic-image-test');assert.equal(downloads,1);assert.equal(uploads,1);
  const restoredSeq=new Sequences(dir,store);await restoredSeq.init();assert.equal((await restoredSeq.list())[0].steps[0].id,item.id);
  assert.equal(decodeSession(await store.getState('telegram-session'),key),'FAKE_SESSION');
  await restored.remove(item.id);assert.equal(objects.size,0);assert.deepEqual(await restored.list(),[]);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('failed cloud reads and uploads do not reset existing metadata or publish missing files',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'voice-cloud-fail-'));let writes=0;
 const store={getState:async()=>{throw new Error('cloud unavailable');},setState:async()=>writes++,upload:async()=>{throw new Error('upload failed');}};
 try{
  const lib=new VoiceLibrary(dir,store);await assert.rejects(lib.init(),/cloud unavailable/);assert.equal(writes,0);
  store.getState=async()=>[];await lib.init();const input=path.join(dir,'photo.png');await fs.writeFile(input,'test');
  await assert.rejects(lib.add({path:input,originalname:'photo.png'},{kind:'image'}),/upload failed/);assert.equal(writes,0);assert.deepEqual(await lib.list(),[]);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
