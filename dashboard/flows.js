// Independent view: no changes to the library/editor data model.
export function setupFlows({api,element,button,showToast,getItems}) {
 const $=id=>document.getElementById(id);
 const typingField=(step,key)=>{
  const label=element('label','Digitando… (segundos, vazio = automático)');
  const field=element('input');
  field.type='number';field.min=1;field.max=20;field.placeholder='automático';field.setAttribute('aria-label','Tempo de digitando em segundos');
  if(Number.isInteger(step[key])&&step[key]>0)field.value=step[key];
  field.oninput=()=>{const value=Number(field.value);if(Number.isInteger(value)&&value>=1&&value<=20)step[key]=value;else delete step[key];};
  label.append(field);return label;
 };
 let flows=[],editing=null,steps=[],loading=false;
 const labels={running:'Em execução',waiting:'Aguardando',sending:'Enviando',done:'Concluído',error:'Erro',uncertain:'Conferir envio',cancelled:'Cancelado',arming_reply:'Preparando espera',awaiting_reply:'Aguardando resposta',paused:'Pausado'};
 const commandRequests=new Map(),commandBusy=new Set();
 const guarded=fn=>async()=>{try{await fn();}catch(error){showToast(error.message,'error');}};
 async function refresh(){
  if(loading)return;loading=true;
  try{
   const data=await api('/flows');flows=data.flows;
   $('flowList').replaceChildren();
   if(!flows.length)$('flowList').append(element('p','Nenhum fluxo criado. Comece com texto, áudio ou espera.','muted'));
   for(const flow of flows){
    const row=element('article',undefined,'flow-row'),info=element('div');
    info.append(element('strong',flow.name),element('p',`${flow.steps.length} etapas · ${flow.active?'Ativo':'Desativado'}`,'muted'));
    row.append(info,button('Editar',()=>open(flow)),button(flow.active?'Desativar':'Ativar',guarded(async()=>{await api('/flows/'+flow.id,{method:'PATCH',body:{...flow,active:!flow.active}});await refresh();})),button('Excluir',guarded(async()=>{if(!confirm(`Excluir “${flow.name}”? Execuções já iniciadas serão preservadas.`))return;await api('/flows/'+flow.id,{method:'DELETE'});await refresh();})));
    $('flowList').append(row);
   }
   await refreshRuns();$('flowError').textContent='';
  }catch(error){$('flowError').textContent=error.message;}
  finally{loading=false;}
 }
 async function refreshRuns(){
  const {runs}=await api('/flow-runs');$('flowRuns').replaceChildren();
  if(!runs.length)$('flowRuns').append(element('p','Inicie um fluxo pela barra da extensão em uma conversa privada.','muted'));
  for(const run of runs){
   const row=element('article',undefined,'flow-row'),info=element('div');
   info.append(element('strong',`${run.target_name} · ${run.snapshot.name}`),element('p',`${labels[run.status]||run.status} · ${Math.min(run.current_step+1,run.snapshot.steps.length)}/${run.snapshot.steps.length} etapas`,'muted'),element('small',`Início: ${new Date(run.started_at).toLocaleString('pt-BR')}${run.completed_at?' · Fim: '+new Date(run.completed_at).toLocaleString('pt-BR'):''}`));
   if(run.error)info.append(element('p',run.error,'form-error'));
   if(run.cancel_requested&&run.status==='sending')info.append(element('p','Cancelamento solicitado; aguardando envio em andamento.','muted'));
   if(run.pause_requested)info.append(element('p','Pausa solicitada; aguardando envio em andamento.','muted'));
   if(run.human_takeover)info.append(element('p','Atendimento humano assumido.','muted'));
   if(run.status==='awaiting_reply'&&run.reply_deadline)info.append(element('p','Prazo: '+new Date(run.reply_deadline).toLocaleString('pt-BR'),'muted'));
   row.append(info,button('Ver logs',guarded(async()=>{const {logs}=await api(`/flow-runs/${run.id}/logs`);$('flowLogContent').textContent=logs.map(log=>formatFlowLog(log,run)).join('\n');$('flowLogDialog').showModal();})));
   const active=['running','waiting','sending','uncertain','arming_reply','awaiting_reply','paused'].includes(run.status);
   const actions=[];
   if(active&&run.status!=='uncertain')actions.push(run.status==='paused'?['resume','Continuar']:['pause','Pausar'],['human','Assumir atendimento']);
   if(active)actions.push(['cancel','Cancelar']);
   if(active&&!['sending','uncertain'].includes(run.status))actions.push(['skip','Pular etapa']);
   if(!['sending','uncertain'].includes(run.status))actions.push(['restart','Reiniciar']);
   for(const [action,label] of actions){const control=button(label,guarded(()=>command(run,action)));control.disabled=commandBusy.has(run.id);row.append(control);}
   $('flowRuns').append(row);
  }
 }
 async function command(run,action){
  if(commandBusy.has(run.id))return;
  const questions={restart:'Reiniciar do começo? Mensagens já enviadas poderão ser enviadas novamente.',skip:'Pular somente a etapa atual desta execução?',cancel:run.status==='uncertain'?'Confira o envio incerto no Telegram antes de cancelar. Cancelar?':'Cancelar esta execução? Um envio em andamento poderá terminar.'};
  if(questions[action]&&!confirm(questions[action]))return;
  const key=run.id+':'+action;if(!commandRequests.has(key))commandRequests.set(key,crypto.randomUUID());
  commandBusy.add(run.id);
  try{await api(`/flow-runs/${run.id}/control`,{method:'POST',body:{action,version:run.control_version,requestId:commandRequests.get(key)}});commandRequests.delete(key);await refreshRuns();}
  finally{commandBusy.delete(run.id);void refreshRuns().catch(()=>{});}
 }
 function open(flow=null){editing=flow;steps=structuredClone(flow?.steps||[]);$('flowName').value=flow?.name||'';$('flowActive').checked=flow?.active!==false;if($('flowDoneFolder'))$('flowDoneFolder').value=flow?.doneFolder||flow?.steps?.[0]?.doneFolder||'';$('flowSaveError').textContent='';renderSteps();$('flowDialog').showModal();}
 function renderSteps(){
  $('flowSteps').replaceChildren();
  steps.forEach((step,index)=>{
   const row=element('section',undefined,'flow-step');row.append(element('strong',`${index+1}. ${ {text:'Mensagem de texto',audio:'Áudio da biblioteca',wait:'Esperar',reply:'Esperar resposta do lead'}[step.type]}`));
   let input;
   if(step.type==='text'){input=element('textarea');input.maxLength=4096;input.rows=3;input.value=step.text;input.placeholder='Digite a mensagem';input.oninput=()=>step.text=input.value;}
   else if(step.type==='wait'){input=element('input');input.type='number';input.min=1;input.max=86400;input.value=step.seconds;input.oninput=()=>step.seconds=Number(input.value);}
   else if(step.type==='reply'){
    const options=element('div',undefined,'flow-reply-options');
    const limitLabel=element('label','Tempo máximo em segundos (0 = sem limite)');
    input=element('input');input.type='number';input.min=0;input.max=2592000;input.value=step.timeoutSeconds??0;input.oninput=()=>step.timeoutSeconds=Number(input.value);limitLabel.append(input);
    const actionLabel=element('label','Se não houver resposta');const action=element('select');
    for(const [value,title] of [['end','Encerrar fluxo'],['next','Continuar para a próxima etapa'],['followup','Enviar um follow-up e continuar']])action.add(new Option(title,value));
    action.value=step.timeoutAction||'end';actionLabel.append(action);
    const followLabel=element('label','Texto do follow-up');const follow=element('textarea');follow.rows=3;follow.maxLength=4096;follow.value=step.followupText||'';follow.oninput=()=>step.followupText=follow.value;followLabel.append(follow);followLabel.hidden=action.value!=='followup';
    const followTyping=typingField(step,'followupTypingSeconds');followTyping.hidden=action.value!=='followup';
    action.onchange=()=>{step.timeoutAction=action.value;followLabel.hidden=action.value!=='followup';followTyping.hidden=action.value!=='followup';};
    options.append(limitLabel,element('small','Exemplo: 7200 segundos = 2 horas. O follow-up é enviado uma única vez.'),actionLabel,followLabel,followTyping);row.append(options);
   }
   else{input=element('select');input.add(new Option('Selecione um áudio',''));const items=getItems().filter(item=>item.active!==false&&item.storedName);for(const item of items)input.add(new Option(item.name,item.id));if(step.audioId&&!items.some(i=>i.id===step.audioId))input.add(new Option('Áudio indisponível — selecione outro',step.audioId));input.value=step.audioId;input.onchange=()=>step.audioId=input.value;}
   input.required=true;input.setAttribute('aria-label',step.type==='reply'?'Prazo da resposta em segundos':step.type==='wait'?'Tempo em segundos':step.type==='audio'?'Áudio':'Mensagem');if(step.type!=='reply')row.append(input);if(step.type==='text')row.append(typingField(step,'typingSeconds'));
   const actions=element('div',undefined,'flow-actions');
   const up=button('↑ Subir',()=>{[steps[index-1],steps[index]]=[steps[index],steps[index-1]];renderSteps();});up.disabled=index===0;
   const down=button('↓ Descer',()=>{[steps[index+1],steps[index]]=[steps[index],steps[index+1]];renderSteps();});down.disabled=index===steps.length-1;
   actions.append(up,down,button('Remover',()=>{steps.splice(index,1);renderSteps();}));row.append(actions);$('flowSteps').append(row);
  });
 }
 for(const type of ['text','audio','wait','reply'])$('addFlow'+type).onclick=()=>{if(steps.length>=30){$('flowSaveError').textContent='Limite de 30 etapas.';return;}steps.push(type==='text'?{type,text:''}:type==='audio'?{type,audioId:''}:type==='reply'?{type,timeoutSeconds:0,timeoutAction:'end'}:{type,seconds:3});renderSteps();};
 $('newFlow').onclick=()=>open();$('closeFlow').onclick=()=>$('flowDialog').close();$('closeFlowLogs').onclick=()=>$('flowLogDialog').close();$('refreshFlows').onclick=refresh;
 $('flowForm').onsubmit=async event=>{
  event.preventDefault();$('saveFlow').disabled=true;$('flowSaveError').textContent='';
  try{await api('/flows'+(editing?'/'+editing.id:''),{method:editing?'PATCH':'POST',body:{name:$('flowName').value,active:$('flowActive').checked,doneFolder:$('flowDoneFolder')?.value||'',steps,revision:editing?.revision}});$('flowDialog').close();await refresh();showToast('Fluxo salvo.');}
  catch(error){$('flowSaveError').textContent=error.message;}
  finally{$('saveFlow').disabled=false;}
 };
 setInterval(()=>{if(!$('flowsView').hidden&&!$('appShell').hidden)void refreshRuns().catch(error=>$('flowError').textContent=error.message);},5000);
 return {refresh};
}

export function formatFlowLog(log,run){
 const step=run.snapshot.steps[log.step];
 const events={reply_error:'Erro ao consultar respostas; nova tentativa pendente',paused:'Fluxo pausado',cancelled:'Fluxo cancelado',started:'Fluxo iniciado',waiting:'Aguardando tempo',awaiting_reply:'Aguardando resposta',reply_received:'Resposta do lead detectada',resumed:'Fluxo retomado',reply_timeout:'Tempo máximo de resposta atingido',followup_sent:'Follow-up executado',pause:'Pausa solicitada',human:'Atendimento humano assumido',resume:'Fluxo retomado manualmente',cancel:'Cancelamento solicitado',skip:'Etapa pulada',restarted:'Fluxo reiniciado',finished:'Fluxo concluído',claimed:'Preparando envio',uncertain:'Envio sem confirmação',error:'Erro'};
 const completed={text:'Mensagem enviada',audio:'Áudio enviado',wait:'Espera concluída',reply:'Espera por resposta concluída'};
 return `${new Date(log.created_at).toLocaleString('pt-BR')} — ${log.event==='completed'?(completed[step?.type]||'Etapa concluída'):(events[log.event]||log.event)} · etapa ${log.step+1}${log.message_id?' · Telegram #'+log.message_id:''}${log.detail?' · '+log.detail:''}`;
}
