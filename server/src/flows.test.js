import test from 'node:test';
import assert from 'node:assert/strict';
import {FlowWorker,FlowStore,validateFlow} from './flows.js';
import {createApp} from './app.js';
const voice={id:'audio-1',kind:'voice',active:true,storedName:'audio.ogg',path:'/existing/audio.ogg'};
const run={id:'run',claim_token:'token',dialog_id:'123',current_step:0,snapshot:{steps:[{type:'audio',audioId:voice.id}]}};
function fixture(){const sent=[],results=[];return {sent,results,flows:{finish:async(...args)=>results.push(args)},library:{get:async()=>voice},telegram:{requireAuthorized:async()=>{},resolveTarget:async()=>{},sendItem:async(...args)=>{sent.push(args);return {messageId:'42'};},friendlyError:e=>e.message},logger:{error:()=>{}}};}
test('validates three supported types and rejects missing/inactive audio, variables stay literal',()=>{
 const input={name:'Teste',active:true,steps:[{type:'text',text:'Olá {nome}'},{type:'wait',seconds:3},{type:'audio',audioId:voice.id}]};
 assert.deepEqual(validateFlow(input,[voice]),input);
 for(const step of [{type:'typing'},{type:'wait',seconds:-1},{type:'wait',seconds:1.1},{type:'text',text:''},{type:'audio',audioId:'missing'}])assert.throws(()=>validateFlow({...input,steps:[step]},[voice]));
 assert.throws(()=>validateFlow(input,[{...voice,active:false}]));
});
test('worker reuses existing voice library and sender without recording indicators',async()=>{
 const f=fixture();await new FlowWorker(f).execute(run);
 assert.deepEqual(f.sent,[[voice,{dialogId:'123'}]]);assert.equal(f.results[0][1],'completed');assert.equal(f.results[0][2],'42');
});
test('missing audio fails before sending; external failures are uncertain and never retried',async()=>{
 const f=fixture();f.library.get=async()=>null;await new FlowWorker(f).execute(run);assert.equal(f.sent.length,0);assert.equal(f.results[0][1],'error');
 f.results.length=0;f.library.get=async()=>voice;f.telegram.sendItem=async()=>{f.sent.push('attempt');throw Error('timeout');};await new FlowWorker(f).execute(run);assert.equal(f.sent.length,1);assert.equal(f.results[0][1],'uncertain');
});
test('DB failure after Telegram success never repeats the send',async()=>{
 const f=fixture();let attempts=0;f.flows.finish=async()=>{attempts++;throw Error('DB down');};await new FlowWorker(f).execute(run);assert.equal(f.sent.length,1);assert.equal(attempts,2);
});
test('a slow recipient does not block the next worker poll or another recipient',async()=>{
 const f=fixture();let unblock;const blocked=new Promise(resolve=>unblock=resolve);let calls=0;
 f.flows.claim=async()=>++calls===1?[run]:calls===2?[{...run,id:'second',dialog_id:'456'}]:[];
 f.telegram.sendItem=async(item,target)=>{f.sent.push(target.dialogId);if(target.dialogId==='123')await blocked;return {messageId:'1'};};
 const worker=new FlowWorker(f);await worker.tick();await worker.tick();await new Promise(r=>setImmediate(r));assert.deepEqual(f.sent,['123','456']);assert.equal(f.results[0][0].dialog_id,'456');unblock();await Promise.all(worker.pending);
});
test('flow API requires authentication, binds recipient and persists start arguments',async()=>{
 let starts=0;const token='a'.repeat(32),telegram={currentTarget:async()=>({id:'123',name:'A'}),friendlyError:e=>e.message};
 const app=createApp({telegram,library:{uploadDir:'/tmp'},sequences:{},token,flows:{start:async(body,target)=>{starts++;return {id:body.requestId,dialog_id:target.id};},list:async()=>[]}});
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));const base=`http://127.0.0.1:${server.address().port}`;
 try{
  assert.equal((await fetch(base+'/flows')).status,401);
  const post=body=>fetch(base+'/flow-runs',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(body)});
  assert.equal((await post({dialogId:'999',peerKey:'123'})).status,400);assert.equal(starts,0);
  assert.equal((await post({dialogId:'123',peerKey:'123',requestId:'id'})).status,200);assert.equal(starts,1);
 }finally{await new Promise(resolve=>server.close(resolve));}
});
test('flow REST adapter sends only server-authenticated calls and guards update revisions',async()=>{
 const calls=[];const flows=new FlowStore({request:async(...args)=>{calls.push(args);return [];}});
 await assert.rejects(flows.save({name:'A',active:true,steps:[{type:'wait',seconds:1}],revision:2},{list:async()=>[]},'8cf3106d-655b-4b14-91fb-83d389a15902'),/outra janela/);
 assert.match(calls[0][0],/revision=eq.2/);
 assert.throws(()=>flows.runs('1&select=*'),/inválida/);
});
