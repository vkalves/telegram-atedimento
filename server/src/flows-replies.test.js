import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {FlowWorker,validateFlow} from './flows.js';

const reply={type:'reply',timeoutSeconds:0,timeoutAction:'end'},text={type:'text',text:'Depois'};
test('Parte 2: banco persistente e isolamento de respostas e comandos',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'flow-replies-'));let db=new PGlite(dir);
 const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
 const rpc=async(name,args,params)=>q(`select * from ta_flow_${name}(${params.map((_,i)=>'$'+(i+1)).join(',')})`,params);
 const row=async id=>(await q('select * from ta_flow_runs where id=$1',[id]))[0];
 const start=async(dialog,steps=[reply,text])=>{
  const [f]=await q('insert into ta_flows(name,steps) values($1,$2) returning *',['Teste',JSON.stringify(steps)]);
  return (await q('select * from ta_flow_start($1,$2,$3,$4)',[randomUUID(),f.id,dialog,'Lead '+dialog]))[0];
 };
 const claim=()=>q('select * from ta_flow_claim()');
 const arm=async(r,cursor=100)=>(await q('select * from ta_flow_arm($1,$2,$3,$4)',[r.id,r.claim_token,cursor,'account']))[0];
 const armAll=async()=>{const rows=await claim();for(const r of rows)if(r.status==='arming_reply')await arm(r);return rows;};
 const watch=()=>q('select * from ta_flow_watch()');
 const message=(r,id=101,date=Math.floor(Date.now()/1000))=>({id,date,senderId:r.dialog_id,dialogId:r.dialog_id});
 const receive=async(r,messages,options={})=>(await q('select * from ta_flow_reply($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',[
  r.id,r.wait_token,r.poll_token,r.current_step,options.account??'account',options.dialog??r.dialog_id,JSON.stringify(messages),options.cursor??Math.max(r.reply_cursor,...messages.map(m=>m.id)),options.complete??true,options.checkedAt??new Date().toISOString(),options.error??null
 ]))[0];
 const control=async(r,action,id=randomUUID())=>(await q('select * from ta_flow_control($1,$2,$3,$4)',[r.id,id,action,r.control_version]))[0];
 const dispatch=async r=>(await q('select ta_flow_dispatch($1,$2) as ok',[r.id,r.claim_token]))[0].ok;
 const finish=async(r,status='completed')=>(await q('select * from ta_flow_finish($1,$2,$3,$4)',[r.id,r.claim_token,status,'777']))[0];
 const reset=()=>db.exec('truncate ta_flows cascade');
 try{
  await db.exec('create role anon;create role authenticated;create role service_role;');
  for(const file of ['FLUXOS-PARTE-1.sql','FLUXOS-PARTE-2.sql','FLUXOS-PARTE-2.sql'])await db.exec(await fs.readFile(new URL('../../supabase/'+file,import.meta.url),'utf8'));
  await t.test('cada lead avança exclusivamente com sua própria resposta',async()=>{
   await reset();const a=await start('123'),b=await start('456');await armAll();const watches=await watch(),wa=watches.find(r=>r.id===a.id),wb=watches.find(r=>r.id===b.id);
   await receive(wa,[message(wb)]);assert.equal((await row(a.id)).status,'awaiting_reply');assert.equal((await row(b.id)).status,'awaiting_reply');
   // Wrong-account and wrong-dialog RPC calls cannot mutate the row.
   await assert.rejects(receive(wb,[message(wb)],{account:'other'}),/outra conta/);
   await assert.rejects(receive(wb,[message(wb)],{dialog:'999'}),/outra conta/);
   const resumed=await receive(wb,[message(wb)]);assert.equal(resumed.current_step,1);assert.equal(resumed.status,'running');assert.equal((await row(a.id)).current_step,0);
  });
  await t.test('mensagens antigas, repetidas e rajadas não liberam uma segunda espera',async()=>{
   await reset();const a=await start('123',[reply,reply,text]);await armAll();let [w]=await watch();
   await receive(w,[message(w,99),message(w,101,Math.floor(Date.now()/1000)-60)]);
   assert.equal((await row(a.id)).current_step,0);
   await q("update ta_flow_runs set reply_checked_at=null where id=$1",[a.id]);[w]=await watch();
   const batch=[message(w,102),message(w,103),message(w,104)];await receive(w,batch);await receive(w,batch);
   assert.equal((await row(a.id)).current_step,1);assert.equal((await q('select * from ta_flow_inbound')).length,1);
   const [next]=await claim();await arm(next,104);let [w2]=await watch();await receive(w2,batch);
   assert.equal((await row(a.id)).current_step,1);await receive(w,batch);assert.equal((await row(a.id)).current_step,1);
   await q('update ta_flow_runs set reply_checked_at=null where id=$1',[a.id]);[w2]=await watch();await receive(w2,[message(w2,105)]);assert.equal((await row(a.id)).current_step,2);
  });
  await t.test('pausa e atendimento humano invalidam consultas em trânsito; retomar exige nova resposta',async()=>{
   await reset();const a=await start('123'),b=await start('456');await armAll();const watches=await watch();const wa=watches.find(r=>r.id===a.id),wb=watches.find(r=>r.id===b.id);
   const paused=await control(await row(a.id),'human');assert.equal(paused.status,'paused');assert.equal(paused.human_takeover,true);
   await receive(wa,[message(wa)]);assert.equal((await row(a.id)).status,'paused');await receive(wb,[message(wb)]);assert.equal((await row(b.id)).status,'running');
   await control(paused,'resume');const armed=(await claim()).find(r=>r.id===a.id);await arm(armed,110);let [w]=await watch();await receive(w,[message(w,109)]);assert.equal((await row(a.id)).status,'awaiting_reply');
   await q('update ta_flow_runs set reply_checked_at=null where id=$1',[a.id]);[w]=await watch();await receive(w,[message(w,111)]);assert.equal((await row(a.id)).status,'running');
  });
  await t.test('cancelamento e reinício não aceitam callbacks da execução anterior',async()=>{
   await reset();const a=await start('123');await armAll();const [w]=await watch();let cancelled=await control(await row(a.id),'cancel');await receive(w,[message(w)]);assert.equal((await row(a.id)).status,'cancelled');
   const command=randomUUID(),restarted=await control(cancelled,'restart',command);const repeated=await control(cancelled,'restart',command);assert.equal(repeated.id,restarted.id);
   await receive(w,[message(w)]);assert.equal((await row(restarted.id)).current_step,0);assert.equal((await row(a.id)).status,'cancelled');
   await armAll();const blocked=(await q('select * from ta_flow_start($1,$2,$3,$4)',[randomUUID(),a.flow_id,'123','A']))[0];assert.equal(blocked.id,restarted.id);
  });
  await t.test('pular é idempotente e comandos com versão antiga são recusados',async()=>{
   await reset();let a=await start('123',[reply,reply,text]);const command=randomUUID();const skipped=await control(a,'skip',command);await control(a,'skip',command);assert.equal((await row(a.id)).current_step,1);
   await assert.rejects(control(a,'skip'),/Execução mudou/);const paused=await control(skipped,'pause');const p=await control(paused,'skip');assert.equal(p.status,'paused');assert.equal(p.current_step,2);
   assert.equal((await claim()).length,0);
  });
  await t.test('pausa antes do envio bloqueia dispatch; após envio impede a próxima etapa',async()=>{
   await reset();const a=await start('123',[text,text]);let [r]=await claim();await control(await row(a.id),'human');assert.equal(await dispatch(r),false);
   await control(await row(a.id),'resume');[r]=await claim();assert.equal(await dispatch(r),true);assert.equal(await dispatch(r),false);
   const pending=await control(await row(a.id),'pause');assert.equal(pending.pause_requested,true);await assert.rejects(control(pending,'skip'),/envio em andamento/);
   const paused=await finish(r);assert.equal(paused.status,'paused');assert.equal(paused.current_step,1);assert.equal((await claim()).length,0);
  });
  await t.test('sem prazo, o relógio não libera a espera',async()=>{
   await reset();const a=await start('123');await armAll();await q("update ta_flow_runs set wait_started_at=now()-interval '10 days' where id=$1",[a.id]);const [w]=await watch();await receive(w,[]);assert.equal((await row(a.id)).status,'awaiting_reply');assert.equal((await claim()).length,0);
  });
  await t.test('timeout encerra ou avança apenas a execução configurada',async()=>{
   await reset();const a=await start('123',[{...reply,timeoutSeconds:5,timeoutAction:'end'},text]),b=await start('456',[{...reply,timeoutSeconds:5,timeoutAction:'next'},text]);await armAll();
   await q("update ta_flow_runs set reply_deadline=now()-interval '2 seconds'");for(const w of await watch())await receive(w,[]);
   assert.equal((await row(a.id)).status,'done');assert.ok((await row(a.id)).completed_at);assert.equal((await row(b.id)).status,'running');assert.equal((await row(b.id)).current_step,1);
  });
  await t.test('resposta antes do prazo vence timeout mesmo consultada após reinício',async()=>{
   await reset();const a=await start('123',[{...reply,timeoutSeconds:10},text]);await armAll();await q("update ta_flow_runs set wait_started_at=now()-interval '30 seconds',reply_deadline=now()-interval '5 seconds' where id=$1",[a.id]);
   const [w]=await watch();await receive(w,[message(w,101,Math.floor(Date.now()/1000)-10)]);assert.equal((await row(a.id)).status,'running');assert.equal((await q("select * from ta_flow_logs where event='reply_timeout'")).length,0);
  });
  await t.test('follow-up é enviado uma vez e não é repetido se faltar confirmação',async()=>{
   await reset();const a=await start('123',[{...reply,timeoutSeconds:5,timeoutAction:'followup',followupText:'Ainda está aí?'},text]);await armAll();await q("update ta_flow_runs set reply_deadline=now()-interval '2 seconds'");const [w]=await watch();await receive(w,[]);await receive(w,[]);
   const [send]=await claim();assert.equal(send.dispatch_kind,'followup');assert.equal((await claim()).length,0);
   const attempts=[];const worker=new FlowWorker({flows:{version:2,dispatch,finish:async(r,status)=>finish(r,status)},telegram:{requireAuthorized:async()=>{},resolveTarget:async()=>{},friendlyError:e=>e.message,sendItem:async item=>{attempts.push(item);return {messageId:'777'};}},library:{}});
   await worker.execute(send);await worker.execute(send);assert.equal(attempts.length,1);assert.equal(attempts[0].text,'Ainda está aí?');assert.equal((await row(a.id)).current_step,1);
   assert.equal((await q("select * from ta_flow_logs where event='followup_sent'")).length,1);
   await reset();const uncertain=await start('123',[{...reply,timeoutSeconds:5,timeoutAction:'followup',followupText:'Uma vez'},text]);await armAll();await q("update ta_flow_runs set reply_deadline=now()-interval '2 seconds'");const [pending]=await watch();await receive(pending,[]);const [job]=await claim();
   let failures=0;worker.telegram.sendItem=async()=>{failures++;throw Error('Timeout após envio');};await worker.execute(job);await worker.execute(job);assert.equal(failures,1);assert.equal((await row(uncertain.id)).status,'uncertain');assert.equal((await claim()).length,0);

  });
  await t.test('erros de consulta e páginas incompletas nunca disparam timeout',async()=>{
   await reset();const a=await start('123',[{...reply,timeoutSeconds:5},text]);await armAll();await q("update ta_flow_runs set reply_deadline=now()-interval '2 seconds'");let [w]=await watch();await receive(w,[],{error:'Telegram indisponível'});assert.equal((await row(a.id)).status,'awaiting_reply');
   await q('update ta_flow_runs set poll_until=null,reply_checked_at=null');[w]=await watch();await receive(w,[],{complete:false,cursor:200});assert.equal((await row(a.id)).status,'awaiting_reply');
  });
  await t.test('pausa congela prazo de resposta e espera por tempo',async()=>{
   await reset();const a=await start('123',[{...reply,timeoutSeconds:7200},text]);await armAll();const paused=await control(await row(a.id),'pause');assert.ok(paused.remaining_seconds>7190);
   await control(paused,'resume');await arm((await claim())[0],500);assert.ok(new Date((await row(a.id)).reply_deadline)-Date.now()>7190000);
   await control(await row(a.id),'cancel');const b=await start('456',[{type:'wait',seconds:20},reply]);await claim();let p=await control(await row(b.id),'pause');assert.ok(p.remaining_seconds>19);await control(p,'resume');
   await q("update ta_flow_runs set due_at=now()-interval '1 second' where id=$1",[b.id]);await arm((await claim())[0]);assert.equal((await row(b.id)).reply_deadline,null);
  });
  await t.test('fluxo completo texto-áudio-resposta-texto-resposta-áudio avança em ritmos diferentes',async()=>{
   await reset();const steps=[text,{type:'audio',audioId:'existing'},reply,text,reply,{type:'audio',audioId:'existing'}];
   const a=await start('123',steps),b=await start('456',steps),sent=[],ids=new Map([['123',500],['456',500]]);
   const worker=new FlowWorker({flows:{version:2,claim,dispatch,arm:async(r,baseline)=>arm(r,baseline.cursor),finish:async(r,status)=>finish(r,status)},library:{get:async id=>({kind:'voice',id,path:'/existing.ogg',active:true})},telegram:{requireAuthorized:async()=>{},resolveTarget:async()=>{},friendlyError:e=>e.message,flowReplyBaseline:async id=>({cursor:ids.get(id)}),sendItem:async(item,target)=>{ids.set(target.dialogId,ids.get(target.dialogId)+1);sent.push([target.dialogId,item.kind]);return {messageId:String(ids.get(target.dialogId))};}}});
   const pump=async()=>{for(let i=0;i<5;i++){await worker.tick();await Promise.all(worker.pending);}};
   const respond=async id=>{await q('update ta_flow_runs set reply_checked_at=null where id=$1',[id]);const w=(await watch()).find(r=>r.id===id);ids.set(w.dialog_id,ids.get(w.dialog_id)+1);await receive(w,[message(w,ids.get(w.dialog_id))]);await pump();};
   await pump();assert.equal((await row(a.id)).current_step,2);assert.equal((await row(b.id)).current_step,2);
   await respond(a.id);assert.equal((await row(a.id)).current_step,4);assert.equal((await row(b.id)).current_step,2);
   await respond(a.id);assert.equal((await row(a.id)).status,'done');assert.equal((await row(b.id)).status,'awaiting_reply');
   // Simulate recovery of the other watch reservation after its polling lease.
   await q('update ta_flow_runs set poll_until=null where id=$1',[b.id]);await respond(b.id);await respond(b.id);assert.equal((await row(b.id)).status,'done');
   assert.deepEqual(sent.filter(x=>x[0]==='123').map(x=>x[1]),['text','voice','text','voice']);assert.deepEqual(sent.filter(x=>x[0]==='456').map(x=>x[1]),['text','voice','text','voice']);
  });
  await t.test('tabelas e RPCs de resposta não são acessíveis pelo navegador',async()=>{
   await db.exec('set role anon');await assert.rejects(q('select * from ta_flow_inbound'),/permission denied/);await assert.rejects(q('select * from ta_flow_watch()'),/permission denied/);await db.exec('reset role');
  });
  await t.test('espera persiste após fechar e reabrir o banco e outro worker a retoma',async()=>{
   await reset();const a=await start('123');await armAll();await db.close();db=new PGlite(dir);assert.equal((await row(a.id)).status,'awaiting_reply');
   const worker=new FlowWorker({flows:{version:2,watch,reply:async(r,page,error)=>receive(r,page?.messages??[],{error})},telegram:{flowReplyPage:async r=>({messages:[message(r)]}),friendlyError:e=>e.message},library:{},logger:console});
   await worker.pollReplies();await Promise.all(worker.replyPending);assert.equal((await row(a.id)).status,'running');assert.equal((await row(a.id)).current_step,1);
  });
 }finally{await db.close();await fs.rm(dir,{recursive:true,force:true});}
});

test('validação de espera e follow-up mantém compatibilidade com fluxos da Parte 2',()=>{
 const valid=validateFlow({name:'A',active:true,steps:[{...reply,timeoutSeconds:7200,timeoutAction:'followup',followupText:'Olá {nome}'}]},[]);assert.equal(valid.steps[0].followupText,'Olá {nome}');
 for(const step of [{...reply,timeoutSeconds:-1},{...reply,timeoutSeconds:1.5},{...reply,timeoutAction:'ai'},{...reply,timeoutSeconds:1,timeoutAction:'followup',followupText:''}])assert.throws(()=>validateFlow({name:'A',active:true,steps:[step]},[]));
});
