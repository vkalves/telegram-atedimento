import {randomUUID} from 'node:crypto';
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
export function requireUUID(value) {if(!uuid(value))throw new Error('Identificador inválido.');return value;}
export function validateFlow(input, library) {
 if(!input || typeof input.name!=='string' || !input.name.trim() || input.name.trim().length>80)throw new Error('Informe um nome de até 80 caracteres.');
 if(typeof input.active!=='boolean')throw new Error('Status do fluxo inválido.');
 if(!Array.isArray(input.steps)||input.steps.length<1||input.steps.length>30)throw new Error('Use entre 1 e 30 etapas.');
 const steps=input.steps.map(step=>{
  if(step?.type==='text' && typeof step.text==='string' && step.text.trim() && step.text.length<=4096)return {type:'text',text:step.text};
  if(step?.type==='wait' && Number.isInteger(step.seconds) && step.seconds>=1 && step.seconds<=86400)return {type:'wait',seconds:step.seconds};
  if(step?.type==='audio'){
   const item=library.find(item=>item.id===step.audioId && (item.kind||'voice')==='voice' && item.active!==false && item.storedName);
   if(!item)throw new Error('Selecione um áudio ativo e disponível na biblioteca.');
   return {type:'audio',audioId:item.id};
  }
  throw new Error('Etapa inválida: use texto, áudio ou espera de 1 a 86400 segundos.');
 });
 return {name:input.name.trim(),active:input.active,steps};
}
export class FlowStore {
 constructor(store){this.store=store;}
 async request(route,method='GET',body){return this.store.request('/rest/v1/'+route,{method,headers:{'Content-Type':'application/json',Prefer:'return=representation'},...(body===undefined?{}:{body:JSON.stringify(body)})});}
 rpc(name,body={}){return this.request('rpc/ta_flow_'+name,'POST',body);}
 list(){return this.request('ta_flows?deleted_at=is.null&order=created_at.desc');}
 async save(input,library,id=null){
  const payload=validateFlow(input,await library.list());
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
 constructor({flows,telegram,library,logger=console}){Object.assign(this,{flows,telegram,library,logger});this.busy=false;this.timer=null;this.pending=new Set();}
 start(){if(this.timer)return;this.timer=setInterval(()=>void this.tick(),1000);this.timer.unref?.();void this.tick();}
 stop(){clearInterval(this.timer);this.timer=null;}
 async tick(){
  if(this.busy||this.pending.size>=20)return;this.busy=true;
  try{const runs=await this.flows.claim();for(const run of runs){const task=this.execute(run);this.pending.add(task);void task.finally(()=>this.pending.delete(task));}}
  catch(error){this.logger.error('Fluxos: não foi possível consultar/persistir a fila.',error.message);}
  finally{this.busy=false;}
 }
 async execute(run){
  let sending=false;
  try{
   const step=run.snapshot.steps[run.current_step];let item;
   if(step.type==='text')item={kind:'text',text:step.text};
   else if(step.type==='audio'){
    item=await this.library.get(step.audioId);
    if(!item || (item.kind||'voice')!=='voice' || item.active===false || !item.path)throw new Error('Áudio excluído, desativado ou indisponível.');
   }else throw new Error('Tipo de etapa não suportado.');
   await this.telegram.requireAuthorized();
   // Resolve before marking the external send boundary; never use the browser's current conversation.
   await this.telegram.resolveTarget({dialogId:run.dialog_id});
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
