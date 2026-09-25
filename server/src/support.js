import {randomUUID} from 'node:crypto';
import {NewMessage} from 'teleproto/events/index.js';

export const LEAD_STATUSES = ['open','waiting','snoozed','done'];
const filters = [...LEAD_STATUSES,'focus','reply','due','priority','all'];
const dialog = value => {if(!/^[1-9]\d{0,19}$/.test(String(value)))throw new Error('Conversa inválida.');return String(value);};
const uuid = value => {if(!/^[a-f\d-]{36}$/i.test(String(value)))throw new Error('Resposta inválida.');return value;};
const text = (value,max,label) => {if(typeof value!=='string'||value.length>max)throw new Error(`${label}: use até ${max} caracteres.`);return value.trim();};
export function validateLeadPatch(input={}) {
  if(!Number.isSafeInteger(input.version)||input.version<1)throw new Error('Atualize a conversa antes de salvar.');
  const patch={};
  if(input.status!==undefined){if(!LEAD_STATUSES.includes(input.status))throw new Error('Status inválido.');patch.status=input.status;patch.status_changed_at=new Date().toISOString();}
  if(input.priority!==undefined){if(!Number.isInteger(input.priority)||input.priority<0||input.priority>2)throw new Error('Prioridade inválida.');patch.priority=input.priority;}
  for(const [key,max,label] of [['notes',8000,'Notas'],['owner',80,'Responsável']])if(input[key]!==undefined)patch[key]=text(input[key],max,label);
  if(input.tags!==undefined){if(!Array.isArray(input.tags)||input.tags.length>12)throw new Error('Use até 12 etiquetas.');patch.tags=[...new Set(input.tags.map(tag=>text(tag,32,'Etiqueta')).filter(Boolean))];}
  if(input.due_at!==undefined){if(input.due_at!==null&&(typeof input.due_at!=='string'||!Number.isFinite(Date.parse(input.due_at))))throw new Error('Data de retorno inválida.');patch.due_at=input.due_at===null?null:new Date(input.due_at).toISOString();}
  if(patch.status==='snoozed'&&(!patch.due_at||Date.parse(patch.due_at)<=Date.now()))throw new Error('Escolha uma data futura para adiar.');
  if(['done','waiting'].includes(patch.status)){patch.needs_reply=false;patch.waiting_since=null;}
  if(patch.status==='done')patch.due_at=null;
  if(!Object.keys(patch).length)throw new Error('Nenhuma alteração informada.');
  return {...patch,version:input.version+1,updated_at:new Date().toISOString()};
}

export class SupportStore {
  constructor(store){this.store=store;}
  request(route,method='GET',body){return this.store.request('/rest/v1/'+route,{method,headers:{'Content-Type':'application/json',Prefer:'return=representation'},...(body===undefined?{}:{body:JSON.stringify(body)})});}
  async init(){await this.request('ta_leads?select=dialog_id&limit=0');await this.request('ta_quick_replies?select=id&limit=0');}
  queue(account,query={}){
    const filter=query.filter||'focus',offset=Number(query.offset||0),limit=Number(query.limit||50),search=String(query.search||'').trim();
    if(!filters.includes(filter)||!Number.isInteger(offset)||offset<0||offset>1000000||!Number.isInteger(limit)||limit<1||limit>100||search.length>120)throw new Error('Filtro da fila inválido.');
    return this.request('rpc/ta_support_queue','POST',{p_account:dialog(account),p_filter:filter,p_search:search,p_offset:offset,p_limit:limit});
  }
  async get(account,id){return (await this.request(`ta_leads?account_id=eq.${dialog(account)}&dialog_id=eq.${dialog(id)}`))[0]||null;}
  async ingest(account,target,event={}) {
    if(event.id!==undefined&&(!Number.isSafeInteger(event.id)||event.id<0))throw new Error('Mensagem inválida.');
    const result=await this.request('rpc/ta_support_ingest','POST',{p_account:dialog(account),p_dialog:dialog(target.id),p_name:String(target.name||'').slice(0,120),p_username:target.username||null,p_message:event.id||0,p_date:event.date||null,p_incoming:!!event.incoming,p_preview:String(event.preview||'').slice(0,160)});
    return Array.isArray(result)?result[0]:result;
  }
  async patch(account,id,input){
    const patch=validateLeadPatch(input);
    const rows=await this.request(`ta_leads?account_id=eq.${dialog(account)}&dialog_id=eq.${dialog(id)}&version=eq.${input.version}`,'PATCH',patch);
    if(!rows.length){const error=new Error('Esta conversa mudou em outra janela ou recebeu mensagem. Atualize antes de salvar; suas notas continuam no editor.');error.status=409;throw error;}
    return rows[0];
  }
  async bulk(account,input){
    if(!Array.isArray(input.items)||!input.items.length||input.items.length>50)throw new Error('Selecione de 1 a 50 conversas.');
    if(!input.patch||Object.keys(input.patch).some(key=>!['status','priority','owner','due_at'].includes(key)))throw new Error('Ação em lote inválida.');
    const results=[];
    for(const item of input.items){try{await this.patch(account,item.id,{...input.patch,version:item.version});results.push({id:item.id,ok:true});}catch(error){results.push({id:item.id,ok:false,error:error.message});}}
    return results;
  }
  replies(){return this.request('ta_quick_replies?order=category.asc,title.asc&limit=500');}
  async saveReply(input,id=null){
    const title=text(input.title,80,'Nome'),body=text(input.body,4096,'Resposta'),category=text(input.category||'Geral',40,'Categoria');
    if(!title||!body)throw new Error('Preencha o nome e a resposta.');
    if(!id)return (await this.request('ta_quick_replies','POST',{id:randomUUID(),title,body,category}))[0];
    if(!Number.isInteger(input.version)||input.version<1)throw new Error('Atualize a resposta antes de salvar.');
    const rows=await this.request(`ta_quick_replies?id=eq.${uuid(id)}&version=eq.${input.version}`,'PATCH',{title,body,category,version:input.version+1,updated_at:new Date().toISOString()});
    if(!rows.length)throw new Error('Esta resposta mudou em outra janela. Atualize antes de salvar.');return rows[0];
  }
  async removeReply(id,version){if(!Number.isInteger(version)||version<1)throw new Error('Atualize a resposta.');const rows=await this.request(`ta_quick_replies?id=eq.${uuid(id)}&version=eq.${version}`,'DELETE');if(!rows.length)throw new Error('Esta resposta mudou. Atualize a lista.');return true;}
}

// Event-driven intake: no per-lead polling and no outbound messages. DB idempotency
// absorbs retries. The bounded queue retains failed events with a visible health flag.
export class SupportInbox {
  constructor({support,telegram,logger=console}){Object.assign(this,{support,telegram,logger});this.pending=new Map();this.busy=false;this.importing=false;this.lastError='';this.lastSync=null;this.dropped=0;this.account=null;this.accountAt=0;}
  async accountId(){
    if(this.account&&Date.now()-this.accountAt<15000)return this.account;
    if(!this.accountPromise)this.accountPromise=(async()=>{await this.telegram.requireAuthorized();this.account=dialog((await this.telegram.client.getMe()).id);this.accountAt=Date.now();return this.account;})().finally(()=>{this.accountPromise=null;});
    return this.accountPromise;
  }
  start(){
    this.builder=new NewMessage({});this.handler=event=>this.capture(event).catch(()=>{this.lastError='Não foi possível capturar uma conversa. Importe as recentes para atualizar.';});
    this.telegram.client.addEventHandler(this.handler,this.builder);
    this.timer=setInterval(()=>void this.flush(),3000);this.timer.unref?.();
  }
  stop(){clearInterval(this.timer);this.telegram.client.removeEventHandler(this.handler,this.builder);}
  async capture(event){
    const msg=event.message,id=msg?.peerId?.userId?.toString();
    if(!id||msg.className!=='Message'||!Number.isSafeInteger(msg.id))return;
    const account=await this.accountId();if(id===account)return;
    const key=account+':'+id;
    if(this.pending.size>=2000&&!this.pending.has(key)){this.dropped++;this.lastError='Fila de sincronização cheia. Importe as recentes para recuperar.';return;}
    // Coalesce by conversation without regressing the latest Telegram message.
    if((this.pending.get(key)?.event.id||0)>=msg.id)return;
    const sender=msg.out?null:msg._sender; if(sender?.bot)return;
    const name=[sender?.firstName,sender?.lastName].filter(Boolean).join(' ')||'';
    this.pending.set(key,{account,target:{id,name,username:sender?.username||null},event:{id:msg.id,date:new Date(msg.date*1000).toISOString(),incoming:!msg.out,preview:msg.message||'Mídia'}});
    void this.flush();
  }
  async flush(){
    if(this.busy)return;this.busy=true;
    try{let count=0;for(const [key,item] of this.pending){
      if(++count>50)break;
      // User names are already cached in the Telegram session in the usual case.
      const entity=this.telegram.dialogMap.get(item.target.id);
      if(entity){item.target.name=[entity.firstName,entity.lastName].filter(Boolean).join(' ')||entity.username||'';item.target.username=entity.username||null;}
      await this.support.ingest(item.account,item.target,item.event);
      if(this.pending.get(key)===item)this.pending.delete(key);this.lastSync=new Date().toISOString();
    }if(!this.pending.size&&!this.dropped)this.lastError='';}
    catch{this.lastError='Sincronização pendente. As mensagens serão tentadas novamente.';}
    finally{this.busy=false;}
  }
  health(){return {pending:this.pending.size,lastSync:this.lastSync,error:this.lastError,importing:this.importing};}
  async importRecent(){
    if(this.importing)throw new Error('Uma importação já está em andamento.');this.importing=true;
    try{
      const account=await this.accountId(),dialogs=await this.telegram.client.getDialogs({limit:100});let imported=0;
      for(const row of dialogs){const entity=row.entity;if(entity?.className!=='User'||entity.bot||entity.isSelf||String(entity.id)===account)continue;
        const id=String(entity.id),msg=row.message;this.telegram.dialogMap.set(id,entity);
        await this.support.ingest(account,{id,name:row.name||entity.firstName||entity.username||'Conversa',username:entity.username},msg?.id?{id:msg.id,date:new Date(msg.date*1000).toISOString(),incoming:!msg.out,preview:msg.message||'Mídia'}:{});imported++;
      }
      this.lastSync=new Date().toISOString();this.dropped=0;this.lastError='';return {imported,scanned:dialogs.length};
    }finally{this.importing=false;}
  }
}
