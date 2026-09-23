import {randomUUID} from 'node:crypto';
const FLOW_ERRORS=[
 'Execução mudou. Atualize antes de repetir o comando.',
 'Aguarde o envio em andamento antes de pular ou reiniciar.',
 'Confira e cancele o envio incerto antes de reiniciar.',
 'Outro fluxo ocupa esta conversa.', 'Já existe outro fluxo nesta conversa.',
 'O fluxo não está pausado.', 'Não é possível pausar este estado.', 'Não é possível pular este estado.',
 'Fluxo não encontrado ou desativado.', 'Execução não encontrada.', 'Comando já utilizado.'
];
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
export function requireUUID(value) {if(!uuid(value))throw new Error('Identificador inválido.');return value;}
export function validateFlow(input, library) {
 if(!input || typeof input.name!=='string' || !input.name.trim() || input.name.trim().length>80)throw new Error('Informe um nome de até 80 caracteres.');
 if(typeof input.active!=='boolean')throw new Error('Status do fluxo inválido.');
 if(!Array.isArray(input.steps)||input.steps.length<1||input.steps.length>30)throw new Error('Use entre 1 e 30 etapas.');
 const steps=input.steps.map(step=>{
  if(step?.type==='text' && typeof step.text==='string' && step.text.trim() && step.text.length<=4096)return {type:'text',text:step.text};
  if(step?.type==='wait' && Number.isInteger(step.seconds) && step.seconds>=1 && step.seconds<=86400)return {type:'wait',seconds:step.seconds};
  if(step?.type==='reply'){
   const timeoutSeconds=step.timeoutSeconds??0,timeoutAction=step.timeoutAction??'end';
   if(!Number.isInteger(timeoutSeconds)||timeoutSeconds<0||timeoutSeconds>2592000||!['end','next','followup'].includes(timeoutAction))throw new Error('Prazo de resposta inválido (0 = sem limite; máximo 30 dias).');
   const result={type:'reply',timeoutSeconds,timeoutAction};
   if(timeoutSeconds>0&&timeoutAction==='followup'){
    if(typeof step.followupText!=='string'||!step.followupText.trim()||step.followupText.length>4096)throw new Error('Preencha o texto do follow-up (até 4096 caracteres).');
    result.followupText=step.followupText;
   }
   return result;
  }
  if(step?.type==='audio'){
   const item=library.find(item=>item.id===step.audioId && (item.kind||'voice')==='voice' && item.active!==false && item.storedName);
   if(!item)throw new Error('Selecione um áudio ativo e disponível na biblioteca.');
   return {type:'audio',audioId:item.id};
  }
  throw new Error('Etapa inválida: use texto, áudio, espera por tempo ou espera por resposta.');
 });
 return {name:input.name.trim(),active:input.active,steps};
}
export class FlowStore {
 constructor(store){this.store=store;this.version=1;}
 async init(){await this.list();const capability=await this.rpc('capabilities');if(capability.version!==2)throw new Error('Aplique FLUXOS-PARTE-2.sql antes de iniciar o worker.');this.version=2;}
 requireV2(){if(this.version<2)throw new Error('Aplique FLUXOS-PARTE-2.sql e reinicie o backend para usar respostas e controles.');}
 dispatch(run){return this.rpc('dispatch',{p_id:run.id,p_token:run.claim_token});}
 arm(run,baseline,error=null){return this.rpc('arm',{p_id:run.id,p_token:run.claim_token,p_cursor:baseline?.cursor??0,p_account:baseline?.accountId??null,p_error:error});}
 watch(){return this.rpc('watch');}
 reply(run,page,error=null){return this.rpc('reply',{p_id:run.id,p_wait:run.wait_token,p_poll:run.poll_token,p_step:run.current_step,p_account:page?.accountId??run.reply_account_id,p_dialog:run.dialog_id,p_messages:page?.messages??[],p_cursor:page?.cursor??run.reply_cursor,p_complete:page?.complete??false,p_checked_at:run.reply_checked_at,p_error:error});}
 control(id,{requestId,action,version}){
  this.requireV2();requireUUID(id);requireUUID(requestId);
  if(!['pause','resume','cancel','restart','skip','human'].includes(action)||!Number.isSafeInteger(version)||version<0)throw new Error('Comando inválido. Atualize a execução.');
  return this.rpc('control',{p_id:id,p_request:requestId,p_action:action,p_version:version});
 }
 async request(route,method='GET',body){return this.store.request('/rest/v1/'+route,{method,safeErrors:FLOW_ERRORS,headers:{'Content-Type':'application/json',Prefer:'return=representation'},...(body===undefined?{}:{body:JSON.stringify(body)})});}
 async rpc(name,body={}){
  const result=await this.request('rpc/ta_flow_'+name,'POST',body);
  // PostgREST can encode a composite return as a one-row array. Queue RPCs remain arrays.
  return ['start','finish','cancel','arm','reply','control'].includes(name)&&Array.isArray(result)?result[0]??null:result;
 }
 list(){return this.request('ta_flows?deleted_at=is.null&order=created_at.desc');}
 async save(input,library,id=null){
  const payload=validateFlow(input,await library.list());
  if(payload.steps.some(step=>step.type==='reply'))this.requireV2();
  if(!id)return (await this.request('ta_flows','POST',{...payload,id:randomUUID()}))[0];
  requireUUID(id);
  if(!Number.isInteger(input.revision)||input.revision<1)throw new Error('Atualize o fluxo antes de salvar.');
  const rows=await this.request(`ta_flows?id=eq.${id}&revision=eq.${input.revision}&deleted_at=is.null`,'PATCH',{...payload,revision:input.revision+1,updated_at:new Date().toISOString()});
  if(!rows.length)throw new Error('O fluxo foi alterado em outra janela. Atualize a lista e tente novamente.');
  return rows[0];
 }
 async remove(id){requireUUID(id);await this.request(`ta_flows?id=eq.${id}`,'PATCH',{active:false,deleted_at:new Date().toISOString()});return true;}
 runs(dialogId){if(dialogId!==undefined&&!/^[1-9]\d{0,19}$/.test(dialogId))throw new Error('Conversa inválida.');return this.request('ta_flow_runs?order=started_at.desc&limit=100'+(dialogId?'&dialog_id=eq.'+dialogId:''));}
 logs(id){return this.request('ta_flow_logs?run_id=eq.'+requireUUID(id)+'&order=id.asc');}
 start({requestId,flowId},target){return this.rpc('start',{p_id:requireUUID(requestId),p_flow:requireUUID(flowId),p_dialog:target.id,p_name:target.name});}
 claim(){return this.rpc('claim');}
 finish(run,status,message=null,error=null){return this.rpc('finish',{p_id:run.id,p_token:run.claim_token,p_status:status,p_message:message,p_error:error});}
 cancel(id){return this.rpc('cancel',{p_id:requireUUID(id)});}
}
export class FlowWorker {
 constructor({flows,telegram,library,logger=console}){Object.assign(this,{flows,telegram,library,logger});this.busy=false;this.timer=null;this.pending=new Set();this.replyPending=new Set();this.replyBusy=false;}
 start(){if(this.timer)return;this.timer=setInterval(()=>{void this.tick();void this.pollReplies();},1000);this.timer.unref?.();void this.tick();}
 stop(){clearInterval(this.timer);this.timer=null;}
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
 async execute(run){
  if(run.status==='arming_reply'){
   try{await this.flows.arm(run,await this.telegram.flowReplyBaseline(run.dialog_id));}
   catch(error){try{await this.flows.arm(run,null,this.telegram.friendlyError(error));}catch{this.logger.error('Fluxos: preparação da espera será recuperada.');}}
   return;
  }
  let sending=false;
  try{
   const step=run.snapshot.steps[run.current_step];let item;
   if(run.dispatch_kind==='followup')item={kind:'text',text:step.followupText};
   else if(step.type==='text')item={kind:'text',text:step.text};
   else if(step.type==='audio'){
    item=await this.library.get(step.audioId);
    if(!item || (item.kind||'voice')!=='voice' || item.active===false || !item.path)throw new Error('Áudio excluído, desativado ou indisponível.');
   }else throw new Error('Tipo de etapa não suportado.');
   await this.telegram.requireAuthorized();
   // Resolve before marking the external send boundary; never use the browser's current conversation.
   await this.telegram.resolveTarget({dialogId:run.dialog_id});
   if(this.flows.version>=2&&!await this.flows.dispatch(run))return;
   sending=true;
   const result=await this.telegram.sendItem(item,{dialogId:run.dialog_id});
   // A database failure here must NEVER call sendItem a second time.
   await this.flows.finish(run,'completed',result.messageId);
  }catch(error){
   const status=sending?'uncertain':'error';
   try{await this.flows.finish(run,status,null,this.telegram.friendlyError(error));}
   catch{this.logger.error(`Fluxos: execução ${run.id} sem confirmação persistida; não será reenviada.`);}
  }
 }
}
