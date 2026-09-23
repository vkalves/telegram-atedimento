import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {FlowWorker,validateFlow} from './flows.js';
import {activityForItem,renderTemplate} from './flow-model.js';

const voice={id:'voice-1',kind:'voice',name:'Boas-vindas',active:true,storedName:'voice.ogg'};
const image={id:'image-1',kind:'image',name:'Catálogo',active:true,storedName:'image.png'};

test('Parte 3: modelo aceita mídia, variáveis, indicadores, condições, gatilhos e destinos válidos',()=>{
 const flow=validateFlow({
  name:' Primeiro atendimento ',description:'Recepção',active:true,
  trigger:{type:'keyword',operator:'contains',keywords:['Oi',' oi ','preço']},settings:{pauseOnHuman:true,maxTransitions:5000},
  steps:[
   {id:'message_1',type:'text',text:'Olá, {primeiro_nome}! Resposta: {resposta}',activity:{enabled:true,type:'typing',durationSeconds:2}},
   {id:'reply_01',type:'reply',timeoutSeconds:7200,timeoutAction:'goto',timeoutStepId:'finish_1'},
   {id:'check_01',type:'condition',operator:'contains',value:'sim',thenStepId:'media_01',elseStepId:'finish_1'},
   {id:'media_01',type:'content',itemId:image.id,activity:{enabled:true,type:'auto',durationSeconds:3}},
   {id:'finish_1',type:'end'}
  ]
 },[voice,image]);
 assert.equal(flow.name,'Primeiro atendimento');assert.deepEqual(flow.trigger.keywords,['Oi','oi','preço']);assert.equal(flow.settings.maxTransitions,1000);
 assert.equal(renderTemplate(flow.steps[0].text,{name:'Ana Maria',firstName:'Ana',id:'77'},{text:'Sim'}),'Olá, Ana! Resposta: Sim');
 assert.equal(activityForItem(image),'photo');assert.equal(activityForItem(voice),'record-audio');
 assert.throws(()=>validateFlow({...flow,steps:[{id:'reply_01',type:'reply',timeoutSeconds:10,timeoutAction:'goto',timeoutStepId:'missing'}]},[image]),/destino inexistente/);
});

test('worker mostra atividade nativa antes do limite irreversível e personaliza uma única mensagem',async()=>{
 let clock=0;const events=[],sent=[],activities=[];
 const run={id:randomUUID(),dialog_id:'123',target_name:'Ana Maria',target:{id:'123',name:'Ana Maria',firstName:'Ana',username:'ana'},claim_token:randomUUID(),current_step:0,status:'sending',snapshot:{steps:[{id:'message_1',type:'text',text:'Oi, {primeiro_nome}. @{username}',activity:{enabled:true,type:'typing',durationSeconds:3}}]}};
 const worker=new FlowWorker({
  flows:{version:3,activity:async(_run,event,detail)=>events.push([event,detail]),dispatch:async()=>{events.push(['dispatch']);return true;},finish:async(_run,status,message)=>events.push([status,message])},
  telegram:{requireAuthorized:async()=>{},resolveTarget:async()=>{},sendActivity:async(_target,action)=>activities.push(action),cancelActivity:async()=>{},sendItem:async item=>{sent.push(item);return {messageId:'501'};},friendlyError:error=>error.message},
  library:{},now:()=>clock,sleep:async milliseconds=>{clock+=milliseconds;}
 });
 await worker.execute(run);
 assert.deepEqual(activities,['typing']);assert.equal(sent[0].text,'Oi, Ana. @ana');
 assert.deepEqual(events.map(event=>event[0]),['activity_started','dispatch','completed']);
});

test('Parte 3 SQL executa conversa ramificada, gatilhos, deduplicação e pausa humana sem cruzar leads',async()=>{
 const db=new PGlite();
 const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
 try{
  await db.exec('create role anon;create role authenticated;create role service_role;');
  for(const file of ['FLUXOS-PARTE-1.sql','FLUXOS-PARTE-2.sql','FLUXOS-PARTE-3.sql','FLUXOS-PARTE-3.sql'])await db.exec(await fs.readFile(new URL('../../supabase/'+file,import.meta.url),'utf8'));
  assert.equal((await q('select ta_flow_capabilities() as value'))[0].value.version,3);
  const steps=[
   {id:'message_1',type:'text',text:'Oi, {primeiro_nome}',activity:{enabled:false,type:'typing',durationSeconds:0}},
   {id:'reply_01',type:'reply',timeoutSeconds:0,timeoutAction:'end'},
   {id:'check_01',type:'condition',operator:'contains',value:'sim',thenStepId:'media_01',elseStepId:'finish_no'},
   {id:'media_01',type:'content',itemId:'image-1',activity:{enabled:false,type:'auto',durationSeconds:0}},
   {id:'finish_1',type:'end'},
   {id:'finish_no',type:'end'}
  ];
  const [flow]=await q("insert into ta_flows(name,description,trigger,settings,steps) values($1,$2,$3,$4,$5) returning *",['Recepção','Teste',JSON.stringify({type:'manual'}),JSON.stringify({pauseOnHuman:true,maxTransitions:200}),JSON.stringify(steps)]);
  const runId=randomUUID();
  let [run]=await q('select * from ta_flow_start_v3($1,$2,$3,$4,$5,$6)',[runId,flow.id,'123','Ana Maria',JSON.stringify({id:'123',name:'Ana Maria',firstName:'Ana',username:'ana'}),'manual']);
  assert.equal(run.target.firstName,'Ana');assert.equal(run.snapshot.description,'Teste');
  [run]=await q('select * from ta_flow_claim()');assert.equal(run.current_step,0);
  assert.equal((await q('select ta_flow_dispatch($1,$2) as ok',[run.id,run.claim_token]))[0].ok,true);
  [run]=await q('select * from ta_flow_finish($1,$2,$3,$4,$5)',[run.id,run.claim_token,'completed','101',null]);assert.equal(run.current_step,1);
  [run]=await q('select * from ta_flow_claim()');assert.equal(run.status,'arming_reply');
  [run]=await q('select * from ta_flow_arm($1,$2,$3,$4)',[run.id,run.claim_token,999,'account-A']);assert.equal(run.reply_cursor,101,'usa o ID enviado para não perder resposta rápida');
  [run]=await q('select * from ta_flow_watch()');
  const reply={id:102,date:Math.floor(Date.now()/1000),dialogId:'123',senderId:'123',text:'Sim, quero',type:'text'};
  [run]=await q('select * from ta_flow_reply($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',[run.id,run.wait_token,run.poll_token,run.current_step,'account-A','123',JSON.stringify([reply]),102,true,new Date().toISOString(),null]);
  assert.equal(run.current_step,2);assert.equal(run.last_reply.text,'Sim, quero');
  assert.equal((await q('select * from ta_flow_claim()')).length,0,'condição é transição interna');
  [run]=await q('select * from ta_flow_claim()');assert.equal(run.current_step,3,'ramo sim aponta para a mídia');
  assert.equal((await q("select count(*)::int as count from ta_flow_logs where run_id=$1 and event='condition_evaluated'",[runId]))[0].count,1);

  // Dois leads acionam o mesmo gatilho, mas cada execução e resposta permanecem isoladas.
  const [triggerFlow]=await q('insert into ta_flows(name,trigger,settings,steps) values($1,$2,$3,$4) returning *',['Palavra-chave',JSON.stringify({type:'keyword',operator:'contains',keywords:['preço']}),JSON.stringify({pauseOnHuman:true,maxTransitions:200}),JSON.stringify([{id:'trigger_msg',type:'text',text:'Olá',activity:{enabled:false,type:'typing',durationSeconds:0}}])]);
  const incoming=async(dialog,message,text)=>(await q('select * from ta_flow_incoming($1,$2,$3,$4,$5,$6,$7)',['account-A',dialog,message,new Date().toISOString(),text,'text',JSON.stringify({id:dialog,name:'Lead '+dialog,firstName:'Lead'})]))[0];
  const a=await incoming('200',10,'Qual é o preço?'),again=await incoming('200',10,'Qual é o preço?'),b=await incoming('300',20,'preço');
  assert.equal(a.id,again.id);assert.notEqual(a.id,b.id);assert.equal(a.flow_id,triggerFlow.id);assert.equal(b.flow_id,triggerFlow.id);
  assert.equal((await q('select count(*)::int as count from ta_flow_runs where flow_id=$1',[triggerFlow.id]))[0].count,2);

  const [firstFlow]=await q('insert into ta_flows(name,trigger,steps) values($1,$2,$3) returning *',['Primeira mensagem',JSON.stringify({type:'first_message'}),JSON.stringify([{id:'first_end',type:'end'}])]);
  const [newFlow]=await q('insert into ta_flows(name,trigger,steps) values($1,$2,$3) returning *',['Nova conversa',JSON.stringify({type:'new_conversation'}),JSON.stringify([{id:'new_end_1',type:'end'}])]);
  let first=await incoming('400',30,'Bom dia');assert.equal(first.flow_id,firstFlow.id);await q('select * from ta_flow_claim()');
  await q("update ta_flow_leads set last_seen_at=now()-interval '25 hours' where dialog_id='400'");
  const reopened=await incoming('400',31,'Voltei');assert.equal(reopened.flow_id,newFlow.id);

  // O update do próprio envio não pausa; uma mensagem manual concorrente pausa somente a conversa correta.
  const [manualFlow]=await q('insert into ta_flows(name,settings,steps) values($1,$2,$3) returning *',['Pausa humana',JSON.stringify({pauseOnHuman:true,maxTransitions:200}),JSON.stringify([
   {id:'manual_1',type:'text',text:'Um',activity:{enabled:false,type:'typing',durationSeconds:0}},
   {id:'manual_2',type:'text',text:'Dois',activity:{enabled:false,type:'typing',durationSeconds:0}}
  ])]);
  [run]=await q('select * from ta_flow_start_v3($1,$2,$3,$4,$5,$6)',[randomUUID(),manualFlow.id,'888','Lead 888',JSON.stringify({id:'888',name:'Lead 888'}),'manual']);
  [run]=(await q('select * from ta_flow_claim()')).filter(candidate=>candidate.id===run.id);await q('select ta_flow_dispatch($1,$2)',[run.id,run.claim_token]);
  await q('select * from ta_flow_outgoing($1,$2,$3)',['888',501,new Date().toISOString()]);
  [run]=await q('select * from ta_flow_finish($1,$2,$3,$4,$5)',[run.id,run.claim_token,'completed','501',null]);assert.equal(run.status,'running');
  [run]=(await q('select * from ta_flow_claim()')).filter(candidate=>candidate.id===run.id);await q('select ta_flow_dispatch($1,$2)',[run.id,run.claim_token]);
  await q('select * from ta_flow_outgoing($1,$2,$3)',['888',777,new Date().toISOString()]);
  [run]=await q('select * from ta_flow_finish($1,$2,$3,$4,$5)',[run.id,run.claim_token,'completed','502',null]);assert.equal(run.status,'paused');assert.equal(run.human_takeover,true);
  assert.notEqual((await q("select status from ta_flow_runs where id=$1",[b.id]))[0].status,'paused');

  // Reserva abandonada antes do dispatch é recuperável; depois do dispatch fica incerta e não reenvia.
  const [recoveryFlow]=await q('insert into ta_flows(name,steps) values($1,$2) returning *',['Recuperação',JSON.stringify([{id:'recover_1',type:'text',text:'Teste',activity:{enabled:false,type:'typing',durationSeconds:0}}])]);
  let [recovery]=await q('select * from ta_flow_start_v3($1,$2,$3,$4,$5,$6)',[randomUUID(),recoveryFlow.id,'999','Lead 999',JSON.stringify({id:'999',name:'Lead 999'}),'manual']);
  [recovery]=(await q('select * from ta_flow_claim()')).filter(candidate=>candidate.id===recovery.id);const oldToken=recovery.claim_token;
  await q("update ta_flow_runs set updated_at=now()-interval '3 minutes' where id=$1",[recovery.id]);
  [recovery]=(await q('select * from ta_flow_claim()')).filter(candidate=>candidate.id===recovery.id);assert.notEqual(recovery.claim_token,oldToken);
  await q('select ta_flow_dispatch($1,$2)',[recovery.id,recovery.claim_token]);await q("update ta_flow_runs set updated_at=now()-interval '11 minutes' where id=$1",[recovery.id]);await q('select * from ta_flow_claim()');
  assert.equal((await q('select status from ta_flow_runs where id=$1',[recovery.id]))[0].status,'uncertain');

  const [loopFlow]=await q('insert into ta_flows(name,settings,steps) values($1,$2,$3) returning *',['Loop protegido',JSON.stringify({pauseOnHuman:true,maxTransitions:20}),JSON.stringify([{id:'loop_001',type:'condition',operator:'equals',value:'nunca',thenStepId:'loop_001',elseStepId:'loop_001'}])]);
  const [loopRun]=await q('select * from ta_flow_start_v3($1,$2,$3,$4,$5,$6)',[randomUUID(),loopFlow.id,'1000','Lead 1000',JSON.stringify({id:'1000',name:'Lead 1000'}),'manual']);
  for(let index=0;index<22;index++)await q('select * from ta_flow_claim()');
  assert.equal((await q('select status from ta_flow_runs where id=$1',[loopRun.id]))[0].status,'error');
  assert.equal((await q("select count(*)::int as count from ta_flow_logs where run_id=$1 and event='loop_guard'",[loopRun.id]))[0].count,1);

  const [handoffFlow]=await q('insert into ta_flows(name,steps) values($1,$2) returning *',['Transferência',JSON.stringify([{id:'handoff_1',type:'handoff'},{id:'after_handoff',type:'end'}])]);
  let [handoffRun]=await q('select * from ta_flow_start_v3($1,$2,$3,$4,$5,$6)',[randomUUID(),handoffFlow.id,'1001','Lead 1001',JSON.stringify({id:'1001',name:'Lead 1001'}),'manual']);
  await q('select * from ta_flow_claim()');[handoffRun]=await q('select * from ta_flow_runs where id=$1',[handoffRun.id]);
  assert.equal(handoffRun.status,'paused');assert.equal(handoffRun.current_step,1,'a transferência é concluída antes de pausar');
  [handoffRun]=await q('select * from ta_flow_control($1,$2,$3,$4)',[handoffRun.id,randomUUID(),'resume',handoffRun.control_version]);
  await q('select * from ta_flow_claim()');assert.equal((await q('select status from ta_flow_runs where id=$1',[handoffRun.id]))[0].status,'done','continuar não repete a transferência');

  await db.exec('set role anon');await assert.rejects(q('select * from ta_flow_updates'),/permission denied/);await assert.rejects(q("select * from ta_flow_incoming('a','1',1,now(),'x','text','{}')"),/permission denied/);await db.exec('reset role');
 }finally{await db.close();}
});
