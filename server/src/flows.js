import {randomUUID} from 'node:crypto';
import {activityForItem,describeStep,renderTemplate,validateFlow} from './flow-model.js';

export {validateFlow} from './flow-model.js';

const FLOW_ERRORS=[
 'Execução mudou. Atualize antes de repetir o comando.',
 'Aguarde o envio em andamento antes de pular ou reiniciar.',
 'Confira e cancele o envio incerto antes de reiniciar.',
 'Outro fluxo ocupa esta conversa.','Já existe outro fluxo nesta conversa.',
 'O fluxo não está pausado.','Não é possível pausar este estado.','Não é possível pular este estado.',
 'Fluxo não encontrado ou desativado.','Execução não encontrada.','Comando já utilizado.',
 'O fluxo excedeu o limite de transições e foi interrompido.'
];
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const activeStatuses=new Set(['running','waiting','sending','uncertain','arming_reply','awaiting_reply','paused']);
const wait=milliseconds=>new Promise(resolve=>setTimeout(resolve,milliseconds));

export function requireUUID(value){if(!uuid(value))throw new Error('Identificador inválido.');return value;}

export class FlowStore{
 constructor(store){this.store=store;this.version=1;}
 async init(){
  await this.list();
  const capability=await this.rpc('capabilities');
  if(!Number.isInteger(capability?.version)||capability.version<2)throw new Error('Aplique FLUXOS-PARTE-2.sql antes de iniciar o worker.');
  this.version=capability.version;this.capability=capability;
 }
 requireV2(){if(this.version<2)throw new Error('Aplique FLUXOS-PARTE-2.sql e reinicie o backend para usar respostas e controles.');}
 requireV3(){if(this.version<3)throw new Error('Aplique FLUXOS-PARTE-3.sql e reinicie o backend para usar o construtor completo.');}
 dispatch(run){return this.rpc('dispatch',{p_id:run.id,p_token:run.claim_token});}
 arm(run,baseline,error=null){return this.rpc('arm',{p_id:run.id,p_token:run.claim_token,p_cursor:baseline?.cursor??0,p_account:baseline?.accountId??null,p_error:error});}
 watch(){return this.rpc('watch');}
 reply(run,page,error=null){return this.rpc('reply',{p_id:run.id,p_wait:run.wait_token,p_poll:run.poll_token,p_step:run.current_step,p_account:page?.accountId??run.reply_account_id,p_dialog:run.dialog_id,p_messages:page?.messages??[],p_cursor:page?.cursor??run.reply_cursor,p_complete:page?.complete??false,p_checked_at:page?.checkedAt??run.reply_checked_at,p_error:error});}
 activity(run,event,detail=null){return this.version>=3?this.rpc('activity',{p_id:run.id,p_token:run.claim_token,p_event:event,p_detail:detail}):false;}
 incoming(message){
  if(this.version<3)return null;
  return this.rpc('incoming',{p_account:String(message.accountId||''),p_dialog:String(message.dialogId),p_message:Number(message.messageId),p_date:message.date,p_text:String(message.text||'').slice(0,4096),p_type:String(message.type||'message').slice(0,80),p_target:message.target||{}});
 }
 outgoing(message){
  if(this.version<3)return null;
  return this.rpc('outgoing',{p_dialog:String(message.dialogId),p_message:Number(message.messageId),p_date:message.date});
 }
 control(id,{requestId,action,version}){
  this.requireV2();requireUUID(id);requireUUID(requestId);
  if(!['pause','resume','cancel','restart','skip','human'].includes(action)||!Number.isSafeInteger(version)||version<0)throw new Error('Comando inválido. Atualize a execução.');
  return this.rpc('control',{p_id:id,p_request:requestId,p_action:action,p_version:version});
 }
 async request(route,method='GET',body){return this.store.request('/rest/v1/'+route,{method,safeErrors:FLOW_ERRORS,headers:{'Content-Type':'application/json',Prefer:'return=representation'},...(body===undefined?{}:{body:JSON.stringify(body)})});}
 async rpc(name,body={}){
  const result=await this.request('rpc/ta_flow_'+name,'POST',body);
  const single=['start','start_v3','finish','cancel','arm','reply','control','incoming','outgoing'];
  return single.includes(name)&&Array.isArray(result)?result[0]??null:result;
 }
 list(){return this.request('ta_flows?deleted_at=is.null&order=created_at.desc');}
 async save(input,library,id=null){
  const payload=validateFlow(input,await library.list());
  const advanced=payload.trigger.type!=='manual'||payload.description||payload.steps.some(step=>['content','condition','handoff','end'].includes(step.type)||step.activity?.enabled||step.timeoutAction==='goto');
  if(advanced)this.requireV3();
  if(payload.steps.some(step=>step.type==='reply'))this.requireV2();
  const stored=this.version>=3?payload:{name:payload.name,active:payload.active,steps:payload.steps.map(step=>{const copy={...step};delete copy.id;delete copy.activity;delete copy.followupActivity;return copy;})};
  if(!id)return (await this.request('ta_flows','POST',{...stored,id:randomUUID()}))[0];
  requireUUID(id);
  if(!Number.isInteger(input.revision)||input.revision<1)throw new Error('Atualize o fluxo antes de salvar.');
  const rows=await this.request(`ta_flows?id=eq.${id}&revision=eq.${input.revision}&deleted_at=is.null`,'PATCH',{...stored,revision:input.revision+1,updated_at:new Date().toISOString()});
  if(!rows.length)throw new Error('O fluxo foi alterado em outra janela. Atualize a lista e tente novamente.');
  return rows[0];
 }
 async duplicate(id,library){
  this.requireV3();requireUUID(id);
  const rows=await this.request(`ta_flows?id=eq.${id}&deleted_at=is.null&limit=1`);
  if(!rows.length)throw new Error('Fluxo não encontrado.');
  const source=rows[0];
  return this.save({...source,name:`${source.name} — cópia`.slice(0,80),active:false,revision:undefined},library);
 }
 async remove(id){requireUUID(id);await this.request(`ta_flows?id=eq.${id}`,'PATCH',{active:false,deleted_at:new Date().toISOString()});return true;}
 async usesLibraryItem(itemId){
  const references=steps=>Array.isArray(steps)&&steps.some(step=>(step.type==='audio'&&step.audioId===itemId)||(step.type==='content'&&step.itemId===itemId));
  if((await this.list()).some(flow=>references(flow.steps)))return true;
  const live=await this.request('ta_flow_runs?status=in.(running,waiting,sending,uncertain,arming_reply,awaiting_reply,paused)&select=snapshot');
  return live.some(run=>references(run.snapshot?.steps));
 }
 capabilities(){return {...(this.capability||{version:this.version}),platform:'Telegram MTProto',notes:['Os indicadores são nativos e temporários; o aplicativo do lead decide o texto exibido.'],documentation:['https://core.telegram.org/method/messages.setTyping','https://core.telegram.org/type/SendMessageAction']};}
 runs(dialogId){if(dialogId!==undefined&&!/^[1-9]\d{0,19}$/.test(dialogId))throw new Error('Conversa inválida.');return this.request('ta_flow_runs?order=started_at.desc&limit=100'+(dialogId?'&dialog_id=eq.'+dialogId:''));}
 logs(id){return this.request('ta_flow_logs?run_id=eq.'+requireUUID(id)+'&order=id.asc');}
 async describe(run,library,availableItems=null){
  const items=new Map((availableItems||await library.list()).map(item=>[item.id,item]));
  const steps=run.snapshot?.steps||[];
  const label=index=>{const step=steps[index];const id=step?.itemId||step?.audioId;return describeStep(step,items.get(id));};
  const waiting=run.status==='awaiting_reply'||(run.status==='paused'&&run.resume_status==='awaiting_reply');
  return {...run,current_step_label:waiting?'Aguardando resposta do lead':label(run.current_step),next_step_label:label(run.current_step+1)};
 }
 start({requestId,flowId},target){
  if(this.version>=3)return this.rpc('start_v3',{p_id:requireUUID(requestId),p_flow:requireUUID(flowId),p_dialog:target.id,p_name:target.name,p_target:{...target,id:String(target.id)},p_started_by:'manual'});
  return this.rpc('start',{p_id:requireUUID(requestId),p_flow:requireUUID(flowId),p_dialog:target.id,p_name:target.name});
 }
 claim(){return this.rpc('claim');}
 finish(run,status,message=null,error=null){return this.rpc('finish',{p_id:run.id,p_token:run.claim_token,p_status:status,p_message:message,p_error:error});}
 cancel(id){return this.rpc('cancel',{p_id:requireUUID(id)});}
}

export class FlowWorker{
 constructor({flows,telegram,library,logger=console,sleep=wait,now=()=>Date.now()}){
  Object.assign(this,{flows,telegram,library,logger,sleep,now});
  this.busy=false;this.timer=null;this.pending=new Set();this.replyPending=new Set();this.replyBusy=false;this.unsubscribe=null;
 }
 start(){
  if(this.timer)return;
  if(this.telegram.onMessage)this.unsubscribe=this.telegram.onMessage(message=>this.handleMessage(message));
  this.timer=setInterval(()=>{void this.tick();void this.pollReplies();},1000);this.timer.unref?.();void this.tick();
 }
 stop(){clearInterval(this.timer);this.timer=null;this.unsubscribe?.();this.unsubscribe=null;}
 async handleMessage(message){
  try{
   if(message.direction==='incoming')await this.flows.incoming(message);
   else if(message.direction==='outgoing')await this.flows.outgoing(message);
   void this.tick();
  }catch(error){this.logger.error(`Fluxos: atualização ${message.direction||'desconhecida'} não processada.`,error.message);}
 }
 async tick(){
  if(this.busy||this.pending.size>=20)return;this.busy=true;
  try{const runs=await this.flows.claim();for(const run of runs){const task=this.execute(run);this.pending.add(task);void task.finally(()=>this.pending.delete(task));}}
  catch(error){this.logger.error('Fluxos: não foi possível consultar/persistir a fila.',error.message);}
  finally{this.busy=false;}
 }
 async pollReplies(){
  if(this.flows.version<2||this.flows.version===undefined||this.replyBusy||this.replyPending.size>=20)return;
  this.replyBusy=true;
  try{const runs=await this.flows.watch();for(const run of runs){const task=(async()=>{
   try{const page=await this.telegram.flowReplyPage(run);await this.flows.reply(run,page);}
   catch(error){try{await this.flows.reply(run,null,this.telegram.friendlyError(error));}catch{this.logger.error('Fluxos: consulta de respostas indisponível; estado preservado.');}}
  })();this.replyPending.add(task);void task.finally(()=>this.replyPending.delete(task));}}catch(error){this.logger.error('Fluxos: fila de respostas indisponível.',error.message);}
  finally{this.replyBusy=false;}
 }
 async showActivity(run,item,configured){
  if(!configured?.enabled||!configured.durationSeconds||!this.telegram.sendActivity)return;
  const action=activityForItem(item,configured.type),duration=Math.min(15,Math.max(0,Number(configured.durationSeconds)||0));
  try{
   await this.flows.activity?.(run,'activity_started',JSON.stringify({action,durationSeconds:duration}));
   const deadline=this.now()+duration*1000;
   do{
    await this.telegram.sendActivity({dialogId:run.dialog_id},action);
    const remaining=deadline-this.now();if(remaining<=0)break;
    await this.sleep(Math.min(4000,remaining));
   }while(this.now()<deadline);
  }catch(error){
   const message=this.telegram.friendlyError?this.telegram.friendlyError(error):error.message;
   try{await this.flows.activity?.(run,'activity_failed',message);}catch{}
  }
 }
 async execute(run){
  if(run.status==='arming_reply'){
   try{await this.flows.arm(run,await this.telegram.flowReplyBaseline(run.dialog_id));}
   catch(error){try{await this.flows.arm(run,null,this.telegram.friendlyError(error));}catch{this.logger.error('Fluxos: preparação da espera será recuperada.');}}
   return;
  }
  let sending=false;
  try{
   const step=run.snapshot.steps[run.current_step];let item,configuredActivity;
   if(run.dispatch_kind==='followup'){
    item={kind:'text',text:renderTemplate(step.followupText,run.target||{id:run.dialog_id,name:run.target_name},run.last_reply)};
    configuredActivity=step.followupActivity;
   }else if(step.type==='text'){
    item={kind:'text',text:renderTemplate(step.text,run.target||{id:run.dialog_id,name:run.target_name},run.last_reply)};configuredActivity=step.activity;
   }else if(step.type==='audio'||step.type==='content'){
    item=await this.library.get(step.audioId||step.itemId);
    if(!item||item.active===false||(item.kind!=='text'&&!item.path))throw new Error('Conteúdo excluído, desativado ou indisponível.');
    if(step.type==='audio'&&(item.kind||'voice')!=='voice')throw new Error('O áudio desta etapa não está mais disponível.');
    if(item.kind==='text')item={...item,text:renderTemplate(item.text,run.target||{id:run.dialog_id,name:run.target_name},run.last_reply)};
    configuredActivity=step.activity;
   }else throw new Error('Tipo de etapa não suportado.');
   await this.telegram.requireAuthorized();
   await this.telegram.resolveTarget({dialogId:run.dialog_id});
   await this.showActivity(run,item,configuredActivity);
   if(this.flows.version>=2&&!await this.flows.dispatch(run)){
    if(this.telegram.cancelActivity)await this.telegram.cancelActivity({dialogId:run.dialog_id}).catch(()=>{});return;
   }
   sending=true;
   const result=await this.telegram.sendItem(item,{dialogId:run.dialog_id});
   await this.flows.finish(run,'completed',result.messageId);
  }catch(error){
   const status=sending?'uncertain':'error';
   try{await this.flows.finish(run,status,null,this.telegram.friendlyError(error));}
   catch{this.logger.error(`Fluxos: execução ${run.id} sem confirmação persistida; não será reenviada.`);}
  }finally{if(this.telegram.cancelActivity)await this.telegram.cancelActivity({dialogId:run.dialog_id}).catch(()=>{});}
 }
}

export {activeStatuses};
