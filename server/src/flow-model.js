import {randomUUID} from 'node:crypto';

export const FLOW_STEP_TYPES=new Set(['text','audio','content','wait','reply','condition','handoff','end']);
const clean=(value,max=200)=>String(value??'').trim().replace(/\s+/g,' ').slice(0,max);
const integer=(value,{fallback=0,min=0,max=Number.MAX_SAFE_INTEGER}={})=>{
 const number=Number(value);
 return Number.isInteger(number)&&number>=min&&number<=max?number:fallback;
};

function activity(input,fallbackType){
 const source=input&&typeof input==='object'?input:{};
 const allowed=new Set(['auto','typing','record-audio','upload-audio','photo','video','document']);
 return {
  enabled:source.enabled!==false,
  type:allowed.has(source.type)?source.type:fallbackType,
  durationSeconds:integer(source.durationSeconds,{fallback:3,min:0,max:15})
 };
}

function stepId(value){
 return /^[A-Za-z0-9_-]{6,80}$/.test(String(value||''))?String(value):randomUUID();
}

function normalizeStep(input,index,library){
 const source=input&&typeof input==='object'?input:{};
 const aliases={send_item:'content',delay:'wait',wait_reply:'reply',image:'content',video:'content',file:'content'};
 const type=aliases[source.type]||source.type;
 if(!FLOW_STEP_TYPES.has(type))throw new Error(`A etapa ${index+1} possui um tipo inválido.`);
 const step={id:stepId(source.id),type};
 if(type==='text'){
  step.text=String(source.text??'').trim();
  if(!step.text||step.text.length>4096)throw new Error(`O texto da etapa ${index+1} precisa ter entre 1 e 4096 caracteres.`);
  step.activity=activity(source.activity,'typing');
 }
 if(type==='audio'){
  const audioId=clean(source.audioId||source.itemId,80);
  const item=library.find(candidate=>candidate.id===audioId&&(candidate.kind||'voice')==='voice'&&candidate.active!==false&&candidate.storedName);
  if(!item)throw new Error(`Selecione um áudio ativo e disponível na etapa ${index+1}.`);
  step.audioId=item.id;
  step.activity=activity(source.activity,'record-audio');
 }
 if(type==='content'){
  const itemId=clean(source.itemId||source.audioId,80);
  const item=library.find(candidate=>candidate.id===itemId&&candidate.active!==false&&((candidate.kind==='text'&&candidate.text)||candidate.storedName));
  if(!item)throw new Error(`Selecione um conteúdo ativo e disponível na etapa ${index+1}.`);
  step.itemId=item.id;
  step.activity=activity(source.activity,'auto');
 }
 if(type==='wait'){
  step.seconds=integer(source.seconds,{fallback:-1,min:1,max:86400});
  if(step.seconds<1)throw new Error(`A espera da etapa ${index+1} deve ter entre 1 segundo e 24 horas.`);
 }
 if(type==='reply'){
  step.timeoutSeconds=integer(source.timeoutSeconds??0,{fallback:-1,min:0,max:2592000});
  const timeoutAction=source.timeoutAction??'end';
  if(!['end','next','followup','goto'].includes(timeoutAction))throw new Error(`A ação de prazo da etapa ${index+1} é inválida.`);
  step.timeoutAction=timeoutAction;
  if(step.timeoutSeconds<0)throw new Error(`O prazo da etapa ${index+1} deve ser inteiro e ter no máximo 30 dias.`);
  if(step.timeoutAction==='followup'){
   step.followupText=String(source.followupText??'').trim();
   if(!step.followupText||step.followupText.length>4096)throw new Error(`Preencha o follow-up da etapa ${index+1} (até 4096 caracteres).`);
   step.followupActivity=activity(source.followupActivity,'typing');
  }
  if(step.timeoutAction==='goto'){
   step.timeoutStepId=clean(source.timeoutStepId,80)||null;
   if(!step.timeoutStepId)throw new Error(`Escolha o destino do prazo na etapa ${index+1}.`);
  }
 }
 if(type==='condition'){
  step.operator=['contains','equals','starts_with'].includes(source.operator)?source.operator:'contains';
  step.value=clean(source.value,300);
  if(!step.value)throw new Error(`Informe o texto da condição na etapa ${index+1}.`);
  step.thenStepId=clean(source.thenStepId,80)||null;
  step.elseStepId=clean(source.elseStepId,80)||null;
 }
 return step;
}

export function validateFlow(input,library=[]){
 const source=input&&typeof input==='object'?input:{};
 const name=clean(source.name,80);
 if(!name)throw new Error('Informe um nome de até 80 caracteres.');
 if(typeof source.active!=='boolean')throw new Error('Status do fluxo inválido.');
 if(!Array.isArray(source.steps)||source.steps.length<1||source.steps.length>100)throw new Error('Use entre 1 e 100 etapas.');
 const steps=source.steps.map((step,index)=>normalizeStep(step,index,library));
 const ids=new Set();
 for(const step of steps){if(ids.has(step.id))throw new Error('Cada etapa precisa ter um identificador único.');ids.add(step.id);}
 for(const [index,step] of steps.entries())for(const target of [step.thenStepId,step.elseStepId,step.timeoutStepId].filter(Boolean))if(!ids.has(target))throw new Error(`A etapa ${index+1} aponta para um destino inexistente.`);
 const rawTrigger=source.trigger&&typeof source.trigger==='object'?source.trigger:{};
 const triggerType=['manual','first_message','new_conversation','keyword'].includes(rawTrigger.type)?rawTrigger.type:'manual';
 const trigger={type:triggerType};
 if(triggerType==='keyword'){
  trigger.operator=['contains','equals','starts_with'].includes(rawTrigger.operator)?rawTrigger.operator:'contains';
  trigger.keywords=[...new Set((Array.isArray(rawTrigger.keywords)?rawTrigger.keywords:String(rawTrigger.keywords||'').split(','))
   .map(value=>clean(value,120)).filter(Boolean))].slice(0,30);
  if(!trigger.keywords.length)throw new Error('Adicione ao menos uma palavra-chave ao gatilho.');
 }
 const rawSettings=source.settings&&typeof source.settings==='object'?source.settings:{};
 return {
  name,
  description:String(source.description??'').trim().slice(0,500),
  active:source.active,
  trigger,
  settings:{
   pauseOnHuman:rawSettings.pauseOnHuman!==false,
   maxTransitions:Math.max(20,Math.min(1000,Number.isFinite(Number(rawSettings.maxTransitions))?Math.round(Number(rawSettings.maxTransitions)):200))
  },
  steps
 };
}

export function renderTemplate(text,target={},lastReply={}){
 const name=clean(target.name||[target.firstName,target.lastName].filter(Boolean).join(' '),200);
 const firstName=clean(target.firstName||name.split(/\s+/)[0],100);
 const username=clean(target.username,100).replace(/^@/,'');
 const values={
  nome:name,primeiro_nome:firstName,username,usuario:username?`@${username}`:'',
  telefone:clean(target.phone,80),id_conversa:clean(target.id||target.dialogId,80),
  resposta:String(lastReply?.text??'').slice(0,4096),name,first_name:firstName,
  phone:clean(target.phone,80),conversation_id:clean(target.id||target.dialogId,80),reply:String(lastReply?.text??'').slice(0,4096)
 };
 return String(text??'').replace(/\{([A-Za-z0-9_]+)\}/g,(match,key)=>Object.hasOwn(values,key)?values[key]:match);
}

export function activityForItem(item,configured='auto'){
 if(configured&&configured!=='auto')return configured;
 return ({text:'typing',voice:'record-audio',image:'photo',video:'video',file:'document'})[item?.kind||'voice']||'document';
}

export function describeStep(step,item=null){
 if(!step)return 'Fluxo concluído';
 if(step.type==='text')return 'Enviar mensagem de texto';
 if(step.type==='audio')return `Enviar ${item?.name||'áudio'}`;
 if(step.type==='content')return `Enviar ${item?.name||'conteúdo'}`;
 if(step.type==='wait')return `Aguardar ${step.seconds}s`;
 if(step.type==='reply')return 'Aguardar resposta do lead';
 if(step.type==='condition')return 'Avaliar condição da resposta';
 if(step.type==='handoff')return 'Transferir para atendimento humano';
 return 'Encerrar fluxo';
}
