export function setupFlows({api,element,button,showToast,getItems}) {
 const $=id=>document.getElementById(id);
 let flows=[],editing=null,steps=[],loading=false;
 const labels={running:'Em execução',waiting:'Aguardando tempo',sending:'Enviando',done:'Concluído',error:'Erro',uncertain:'Conferir envio',cancelled:'Cancelado',arming_reply:'Preparando espera',awaiting_reply:'Aguardando resposta',paused:'Pausado'};
 const stepNames={text:'Mensagem de texto',audio:'Conteúdo da biblioteca',content:'Conteúdo da biblioteca',wait:'Esperar',reply:'Esperar resposta do lead',condition:'Condição pela resposta',handoff:'Transferir para humano',end:'Encerrar fluxo'};
 const commandRequests=new Map(),commandBusy=new Set();
 const guarded=fn=>async()=>{try{await fn();}catch(error){showToast(error.message,'error');}};
 const makeId=()=>crypto.randomUUID();
 const field=(title,input,className='')=>{const label=element('label',title,className);label.append(input);return label;};
 const select=(options,value)=>{const input=element('select');for(const [key,title] of options)input.add(new Option(title,key));input.value=value;return input;};
 const input=(type,value,min,max)=>{const node=element('input');node.type=type;node.value=value;if(min!==undefined)node.min=min;if(max!==undefined)node.max=max;return node;};

 async function refresh(){
  if(loading)return;loading=true;
  try{
   const data=await api('/flows');flows=data.flows||[];$('flowList').replaceChildren();
   if(!flows.length)$('flowList').append(element('p','Nenhum fluxo criado. Monte a primeira conversa automatizada.','muted'));
   for(const flow of flows){
    const row=element('article',undefined,'flow-row'),info=element('div');
    const trigger=flow.trigger?.type==='keyword'?`Palavra-chave: ${(flow.trigger.keywords||[]).join(', ')}`:({first_message:'Primeira mensagem',new_conversation:'Nova conversa após 24h',manual:'Manual'})[flow.trigger?.type||'manual'];
    info.append(element('strong',flow.name),element('p',`${flow.steps.length} etapas · ${flow.active?'Ativo':'Desativado'} · ${trigger}`,'muted'));
    row.append(info,button('Editar',()=>open(flow)),button('Duplicar',guarded(async()=>{await api(`/flows/${flow.id}/duplicate`,{method:'POST'});await refresh();showToast('Cópia criada desativada.');})),button(flow.active?'Desativar':'Ativar',guarded(async()=>{await api('/flows/'+flow.id,{method:'PATCH',body:{...flow,active:!flow.active}});await refresh();})),button('Excluir',guarded(async()=>{if(!confirm(`Excluir “${flow.name}”? Execuções iniciadas serão preservadas.`))return;await api('/flows/'+flow.id,{method:'DELETE'});await refresh();})));
    $('flowList').append(row);
   }
   await refreshRuns();$('flowError').textContent='';
  }catch(error){$('flowError').textContent=error.message;}
  finally{loading=false;}
 }

 async function refreshRuns(){
  const {runs=[]}=await api('/flow-runs');$('flowRuns').replaceChildren();
  if(!runs.length)$('flowRuns').append(element('p','Inicie manualmente pela extensão ou configure um gatilho no fluxo.','muted'));
  for(const run of runs){
   const row=element('article',undefined,'flow-row'),info=element('div');
   const total=run.snapshot?.steps?.length||0,current=Math.min(run.current_step+1,total);
   info.append(element('strong',`${run.target_name} · ${run.snapshot.name}`),element('p',`${labels[run.status]||run.status} · ${current}/${total} etapas`,'muted'));
   if(run.current_step_label)info.append(element('p',`Etapa atual: ${run.current_step_label}`,'muted'));
   if(run.next_step_label)info.append(element('p',`Próxima etapa: ${run.next_step_label}`,'muted'));
   info.append(element('small',`Início: ${new Date(run.started_at).toLocaleString('pt-BR')}${run.completed_at?' · Fim: '+new Date(run.completed_at).toLocaleString('pt-BR'):''}`));
   if(run.error)info.append(element('p',run.error,'form-error'));
   if(run.cancel_requested&&run.status==='sending')info.append(element('p','Cancelamento solicitado; aguardando envio em andamento.','muted'));
   if(run.pause_requested)info.append(element('p','Pausa solicitada; aguardando envio em andamento.','muted'));
   if(run.human_takeover)info.append(element('p','Atendimento humano assumido.','muted'));
   if(run.status==='awaiting_reply'&&run.reply_deadline)info.append(element('p','Prazo: '+new Date(run.reply_deadline).toLocaleString('pt-BR'),'muted'));
row.append(info,button('Ver histórico',guarded(async()=>{const {logs}=await api(`/flow-runs/${run.id}/logs`);const executedEvents=new Set(['completed','condition_evaluated','ended','human_handoff','followup_sent','skip']),executed=new Set(logs.filter(log=>executedEvents.has(log.event)).map(log=>log.step)),failed=new Set(logs.filter(log=>['error','uncertain','loop_guard'].includes(log.event)).map(log=>log.step));const stepLines=(run.snapshot.steps||[]).map((step,index)=>`${executed.has(index)?'✓':failed.has(index)?'×':index===run.current_step&&!['done','cancelled','error'].includes(run.status)?'→':'○'} ${index+1}. ${stepNames[step.type]||step.type}`);$('flowLogContent').textContent=[`Fluxo: ${run.snapshot.name}`,`Lead: ${run.target_name} · conversa ${run.dialog_id}`,`Status: ${labels[run.status]||run.status}`,`Início: ${new Date(run.started_at).toLocaleString('pt-BR')}${run.completed_at?' · Fim: '+new Date(run.completed_at).toLocaleString('pt-BR'):''}`,'','ETAPAS','------',...stepLines,'','EVENTOS','-------',...logs.map(log=>formatFlowLog(log,run))].join('\n');$('flowLogDialog').showModal();})));
   const active=['running','waiting','sending','uncertain','arming_reply','awaiting_reply','paused'].includes(run.status),actions=[];
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
  const questions={restart:'Reiniciar do começo? Mensagens já enviadas poderão ser enviadas novamente.',skip:'Pular somente a etapa atual?',cancel:run.status==='uncertain'?'Confira o envio incerto no Telegram antes de cancelar. Cancelar?':'Cancelar esta execução? Um envio em andamento poderá terminar.'};
  if(questions[action]&&!confirm(questions[action]))return;
  const key=run.id+':'+action;if(!commandRequests.has(key))commandRequests.set(key,crypto.randomUUID());commandBusy.add(run.id);
  try{await api(`/flow-runs/${run.id}/control`,{method:'POST',body:{action,version:run.control_version,requestId:commandRequests.get(key)}});commandRequests.delete(key);await refreshRuns();}
  finally{commandBusy.delete(run.id);void refreshRuns().catch(()=>{});}
 }

 function normalizeStep(step){
  const copy=structuredClone(step);copy.id=/^[A-Za-z0-9_-]{6,80}$/.test(copy.id||'')?copy.id:makeId();
  if(copy.type==='audio'){copy.type='content';copy.itemId=copy.audioId;delete copy.audioId;}
  if(copy.type==='text'||copy.type==='content')copy.activity={enabled:copy.activity?.enabled!==false,type:copy.activity?.type||(copy.type==='text'?'typing':'auto'),durationSeconds:copy.activity?.durationSeconds??3};
  return copy;
 }

 function open(flow=null){
  editing=flow;steps=(flow?.steps||[]).map(normalizeStep);$('flowName').value=flow?.name||'';$('flowDescription').value=flow?.description||'';$('flowActive').checked=flow?.active!==false;$('flowPauseOnHuman').checked=flow?.settings?.pauseOnHuman!==false;$('flowTrigger').value=flow?.trigger?.type||'manual';$('flowKeywords').value=(flow?.trigger?.keywords||[]).join(', ');toggleKeywords();$('flowSaveError').textContent='';renderSteps();$('flowDialog').showModal();
 }

 function toggleKeywords(){$('flowKeywordsField').hidden=$('flowTrigger').value!=='keyword';}

 function activityFields(step,fallback,property='activity'){
  if(!step[property])step[property]={enabled:true,type:fallback,durationSeconds:3};
  const config=step[property];
  const wrap=element('div',undefined,'flow-activity');
  const enabled=input('checkbox');enabled.checked=config.enabled!==false;enabled.onchange=()=>config.enabled=enabled.checked;
  const enabledLabel=element('label',undefined,'flow-check');enabledLabel.append(enabled,document.createTextNode('Indicador nativo'));
  const kind=select([['auto','Automático pelo conteúdo'],['typing','Digitando'],['record-audio','Gravando áudio'],['upload-audio','Enviando áudio'],['photo','Enviando foto'],['video','Enviando vídeo'],['document','Enviando arquivo']],config.type||fallback);kind.onchange=()=>config.type=kind.value;
  const seconds=input('number',config.durationSeconds??3,0,15);seconds.oninput=()=>config.durationSeconds=Number(seconds.value);
  wrap.append(enabledLabel,field('Indicador',kind),field('Duração (s)',seconds));return wrap;
 }

 function targetOptions(selected,allowNext=true){
  const options=allowNext?[["","Próxima etapa"]]:[["","Selecione uma etapa"]];
  steps.forEach((candidate,index)=>options.push([candidate.id,`${index+1}. ${stepNames[candidate.type]||candidate.type}`]));
  return select(options,selected||'');
 }

 function renderSteps(){
  $('flowSteps').replaceChildren();
  steps.forEach((step,index)=>{
   const row=element('section',undefined,'flow-step');row.draggable=true;row.dataset.stepId=step.id;
   const head=element('div',undefined,'flow-step-head'),handle=element('span','⠿','flow-step-handle');
   head.append(handle,element('strong',`${index+1}. ${stepNames[step.type]||step.type}`));
   const up=button('↑ Subir',()=>move(index,index-1));up.disabled=index===0;const down=button('↓ Descer',()=>move(index,index+1));down.disabled=index===steps.length-1;head.append(up,down,button('Remover',()=>{steps.splice(index,1);renderSteps();}));row.append(head);
   if(step.type==='text'){
    const value=element('textarea');value.maxLength=4096;value.rows=3;value.value=step.text||'';value.placeholder='Ex.: Oi, {primeiro_nome}! Tudo bem?';value.oninput=()=>step.text=value.value;row.append(field('Mensagem',value),activityFields(step,'typing'));
   } else if(step.type==='content'){
    const choice=element('select');choice.add(new Option('Selecione um conteúdo',''));const items=getItems().filter(item=>item.active!==false&&((item.kind==='text'&&item.text)||item.storedName));for(const item of items)choice.add(new Option(`${item.name} · ${{voice:'áudio',text:'texto',image:'imagem',video:'vídeo',file:'arquivo'}[item.kind||'voice']||'conteúdo'}`,item.id));if(step.itemId&&!items.some(item=>item.id===step.itemId))choice.add(new Option('Conteúdo indisponível — selecione outro',step.itemId));choice.value=step.itemId||'';choice.onchange=()=>step.itemId=choice.value;row.append(field('Conteúdo da biblioteca',choice),activityFields(step,'auto'));
   } else if(step.type==='wait'){
    const grid=element('div',undefined,'flow-step-grid'),amount=input('number',step.seconds||3,1,86400),unit=select([['seconds','Segundos'],['minutes','Minutos']],step.displayUnit||'seconds');
    const sync=()=>{const raw=Math.max(1,Number(amount.value)||1);step.displayUnit=unit.value;step.seconds=Math.min(86400,Math.round(raw*(unit.value==='minutes'?60:1)));};amount.oninput=sync;unit.onchange=sync;grid.append(field('Tempo',amount),field('Unidade',unit));row.append(grid);
   } else if(step.type==='reply'){
    const grid=element('div',undefined,'flow-step-grid'),storedTimeout=Number(step.timeoutSeconds)||0;
    const preferredUnit=step.timeoutDisplayUnit||(storedTimeout>0&&storedTimeout%3600===0?'hours':storedTimeout>0&&storedTimeout%60===0?'minutes':'seconds'),factors={seconds:1,minutes:60,hours:3600};
    step.timeoutDisplayUnit=preferredUnit;const limit=input('number',storedTimeout/factors[preferredUnit],0,2592000),timeoutUnit=select([['seconds','Segundos'],['minutes','Minutos'],['hours','Horas']],preferredUnit);
    const syncTimeout=()=>{step.timeoutDisplayUnit=timeoutUnit.value;limit.max=String(2592000/factors[timeoutUnit.value]);step.timeoutSeconds=Math.min(2592000,Math.round(Math.max(0,Number(limit.value)||0)*factors[timeoutUnit.value]));};limit.oninput=syncTimeout;timeoutUnit.onchange=syncTimeout;syncTimeout();
    const action=select([['end','Encerrar fluxo'],['next','Continuar'],['followup','Enviar follow-up e continuar'],['goto','Ir para outra etapa']],step.timeoutAction||'end');
    const follow=element('textarea');follow.rows=3;follow.maxLength=4096;follow.value=step.followupText||'';follow.oninput=()=>step.followupText=follow.value;
    const followLabel=field('Texto do follow-up',follow,'full'),followActivity=activityFields(step,'typing','followupActivity'),destination=targetOptions(step.timeoutStepId,false),destinationLabel=field('Destino do prazo',destination,'full');followActivity.classList.add('full');destination.onchange=()=>step.timeoutStepId=destination.value;
    const update=()=>{step.timeoutAction=action.value;followLabel.hidden=action.value!=='followup';followActivity.hidden=action.value!=='followup';destinationLabel.hidden=action.value!=='goto';};action.onchange=update;update();
    grid.append(field('Tempo máximo (0 = sem limite)',limit),field('Unidade',timeoutUnit),field('Se não responder',action),followLabel,followActivity,destinationLabel);row.append(grid);
   } else if(step.type==='condition'){
    const grid=element('div',undefined,'flow-step-grid'),operator=select([['contains','Contém'],['equals','É igual a'],['starts_with','Começa com']],step.operator||'contains'),value=input('text',step.value||''),yes=targetOptions(step.thenStepId),no=targetOptions(step.elseStepId);value.maxLength=300;
    operator.onchange=()=>step.operator=operator.value;value.oninput=()=>step.value=value.value;yes.onchange=()=>step.thenStepId=yes.value||null;no.onchange=()=>step.elseStepId=no.value||null;
    grid.append(field('Comparação',operator),field('Valor esperado',value),field('Se atender',yes),field('Se não atender',no));row.append(grid,element('p','A condição usa a última resposta recebida do lead.','flow-branch-note'));
   } else if(step.type==='handoff')row.append(element('p','A automação será pausada e a conversa ficará marcada como atendimento humano.','flow-branch-note'));
   else row.append(element('p','A execução será concluída imediatamente nesta etapa.','flow-branch-note'));
   row.addEventListener('dragstart',event=>{row.classList.add('dragging');event.dataTransfer?.setData('text/plain',step.id);});row.addEventListener('dragend',()=>row.classList.remove('dragging'));row.addEventListener('dragover',event=>event.preventDefault());row.addEventListener('drop',event=>{event.preventDefault();const from=steps.findIndex(candidate=>candidate.id===event.dataTransfer?.getData('text/plain'));if(from>=0)move(from,index);});
   $('flowSteps').append(row);
  });
 }

 function move(from,to){if(to<0||to>=steps.length||from===to)return;const [moved]=steps.splice(from,1);steps.splice(to,0,moved);renderSteps();}
 function add(type){
  if(steps.length>=100){$('flowSaveError').textContent='Limite de 100 etapas.';return;}
  const base={id:makeId(),type};
  if(type==='text')Object.assign(base,{text:'',activity:{enabled:true,type:'typing',durationSeconds:3}});
  if(type==='content')Object.assign(base,{itemId:'',activity:{enabled:true,type:'auto',durationSeconds:3}});
  if(type==='wait')base.seconds=3;
  if(type==='reply')Object.assign(base,{timeoutSeconds:0,timeoutAction:'end'});
  if(type==='condition')Object.assign(base,{operator:'contains',value:'',thenStepId:null,elseStepId:null});
  steps.push(base);renderSteps();
 }
 $('addFlowtext').onclick=()=>add('text');$('addFlowaudio').onclick=()=>add('content');$('addFlowwait').onclick=()=>add('wait');$('addFlowreply').onclick=()=>add('reply');$('addFlowcondition').onclick=()=>add('condition');$('addFlowhandoff').onclick=()=>add('handoff');$('addFlowend').onclick=()=>add('end');
 $('flowTrigger').onchange=toggleKeywords;$('newFlow').onclick=()=>open();$('closeFlow').onclick=()=>$('flowDialog').close();$('closeFlowLogs').onclick=()=>$('flowLogDialog').close();$('refreshFlows').onclick=refresh;
 $('flowForm').onsubmit=async event=>{
  event.preventDefault();$('saveFlow').disabled=true;$('flowSaveError').textContent='';
  try{
   const trigger={type:$('flowTrigger').value};if(trigger.type==='keyword'){trigger.operator='contains';trigger.keywords=$('flowKeywords').value.split(',').map(value=>value.trim()).filter(Boolean);}
   const payload={name:$('flowName').value,description:$('flowDescription').value,active:$('flowActive').checked,trigger,settings:{pauseOnHuman:$('flowPauseOnHuman').checked,maxTransitions:200},steps:steps.map(step=>{const copy=structuredClone(step);delete copy.displayUnit;delete copy.timeoutDisplayUnit;return copy;}),revision:editing?.revision};
   await api('/flows'+(editing?'/'+editing.id:''),{method:editing?'PATCH':'POST',body:payload});$('flowDialog').close();await refresh();showToast('Fluxo salvo.');
  }catch(error){$('flowSaveError').textContent=error.message;}
  finally{$('saveFlow').disabled=false;}
 };
 setInterval(()=>{if(!$('flowsView').hidden&&!$('appShell').hidden)void refreshRuns().catch(error=>$('flowError').textContent=error.message);},5000);
 return {refresh};
}

export function formatFlowLog(log,run){
 const step=run.snapshot.steps[log.step];
 const events={activity_started:'Indicador nativo iniciado',activity_failed:'Indicador nativo indisponível; envio preservado',reply_error:'Erro ao consultar respostas; nova tentativa pendente',paused:'Fluxo pausado',cancelled:'Fluxo cancelado',started:'Fluxo iniciado',trigger_matched:'Gatilho acionado',waiting:'Aguardando tempo',awaiting_reply:'Aguardando resposta',reply_received:'Resposta do lead detectada',resumed:'Fluxo retomado',reply_timeout:'Tempo máximo de resposta atingido',followup_sent:'Follow-up executado',condition_evaluated:'Condição avaliada',human_handoff:'Transferido para atendimento humano',human_message_detected:'Mensagem manual detectada; automação pausada',human_message_pending:'Mensagem manual detectada durante envio',loop_guard:'Proteção contra loop acionada',ended:'Fluxo encerrado',pause:'Pausa solicitada',human:'Atendimento humano assumido',resume:'Fluxo retomado manualmente',cancel:'Cancelamento solicitado',skip:'Etapa pulada',restarted:'Fluxo reiniciado',finished:'Fluxo concluído',claimed:'Preparando envio',claim_recovered:'Etapa recuperada após reinício',uncertain:'Envio sem confirmação',error:'Erro'};
 const completed={text:'Mensagem enviada',audio:'Áudio enviado',content:'Conteúdo enviado',wait:'Espera concluída',reply:'Espera por resposta concluída'};
 return `${new Date(log.created_at).toLocaleString('pt-BR')} — ${log.event==='completed'?(completed[step?.type]||'Etapa concluída'):(events[log.event]||log.event)} · etapa ${log.step+1}${log.message_id?' · Telegram #'+log.message_id:''}${log.detail?' · '+log.detail:''}`;
}
