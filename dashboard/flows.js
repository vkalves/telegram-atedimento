// Independent view: no changes to the library/editor data model.
export function setupFlows({api,element,button,showToast,getItems}) {
 const $=id=>document.getElementById(id);
 let flows=[],editing=null,steps=[],loading=false;
 const labels={running:'Em execução',waiting:'Aguardando',sending:'Enviando',done:'Concluído',error:'Erro',uncertain:'Conferir envio',cancelled:'Interrompido'};
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
   if(run.cancel_requested&&run.status==='sending')info.append(element('p','Interrupção solicitada; aguardando envio em andamento.','muted'));
   row.append(info,button('Ver logs',guarded(async()=>{const {logs}=await api(`/flow-runs/${run.id}/logs`);$('flowLogContent').textContent=logs.map(log=>`${new Date(log.created_at).toLocaleString('pt-BR')} · Etapa ${log.step+1} · ${log.event}${log.message_id?' · Telegram #'+log.message_id:''}${log.detail?' · '+log.detail:''}`).join('\n');$('flowLogDialog').showModal();})));
   if(['running','waiting','sending','uncertain'].includes(run.status))row.append(button('Interromper',guarded(async()=>{if(!confirm(run.status==='uncertain'?'Confira primeiro a conversa: a última mensagem pode ter sido enviada. Encerrar esta execução sem reenviar?':'Interromper o fluxo? Um envio já em andamento poderá ser concluído.'))return;await api(`/flow-runs/${run.id}/cancel`,{method:'POST'});await refreshRuns();})));
   $('flowRuns').append(row);
  }
 }
 function open(flow=null){editing=flow;steps=structuredClone(flow?.steps||[]);$('flowName').value=flow?.name||'';$('flowActive').checked=flow?.active!==false;$('flowSaveError').textContent='';renderSteps();$('flowDialog').showModal();}
 function renderSteps(){
  $('flowSteps').replaceChildren();
  steps.forEach((step,index)=>{
   const row=element('section',undefined,'flow-step');row.append(element('strong',`${index+1}. ${ {text:'Mensagem de texto',audio:'Áudio da biblioteca',wait:'Esperar'}[step.type]}`));
   let input;
   if(step.type==='text'){input=element('textarea');input.maxLength=4096;input.rows=3;input.value=step.text;input.placeholder='Digite a mensagem';input.oninput=()=>step.text=input.value;}
   else if(step.type==='wait'){input=element('input');input.type='number';input.min=1;input.max=86400;input.value=step.seconds;input.oninput=()=>step.seconds=Number(input.value);}
   else{input=element('select');input.add(new Option('Selecione um áudio',''));const items=getItems().filter(item=>item.active!==false&&item.storedName);for(const item of items)input.add(new Option(item.name,item.id));if(step.audioId&&!items.some(i=>i.id===step.audioId))input.add(new Option('Áudio indisponível — selecione outro',step.audioId));input.value=step.audioId;input.onchange=()=>step.audioId=input.value;}
   input.required=true;input.setAttribute('aria-label',step.type==='wait'?'Tempo em segundos':step.type==='audio'?'Áudio':'Mensagem');row.append(input);
   const actions=element('div',undefined,'flow-actions');
   const up=button('↑ Subir',()=>{[steps[index-1],steps[index]]=[steps[index],steps[index-1]];renderSteps();});up.disabled=index===0;
   const down=button('↓ Descer',()=>{[steps[index+1],steps[index]]=[steps[index],steps[index+1]];renderSteps();});down.disabled=index===steps.length-1;
   actions.append(up,down,button('Remover',()=>{steps.splice(index,1);renderSteps();}));row.append(actions);$('flowSteps').append(row);
  });
 }
 for(const type of ['text','audio','wait'])$('addFlow'+type).onclick=()=>{if(steps.length>=30){$('flowSaveError').textContent='Limite de 30 etapas.';return;}steps.push(type==='text'?{type,text:''}:type==='audio'?{type,audioId:''}:{type,seconds:3});renderSteps();};
 $('newFlow').onclick=()=>open();$('closeFlow').onclick=()=>$('flowDialog').close();$('closeFlowLogs').onclick=()=>$('flowLogDialog').close();$('refreshFlows').onclick=refresh;
 $('flowForm').onsubmit=async event=>{
  event.preventDefault();$('saveFlow').disabled=true;$('flowSaveError').textContent='';
  try{await api('/flows'+(editing?'/'+editing.id:''),{method:editing?'PATCH':'POST',body:{name:$('flowName').value,active:$('flowActive').checked,steps,revision:editing?.revision}});$('flowDialog').close();await refresh();showToast('Fluxo salvo.');}
  catch(error){$('flowSaveError').textContent=error.message;}
  finally{$('saveFlow').disabled=false;}
 };
 setInterval(()=>{if(!$('flowsView').hidden&&!$('appShell').hidden)void refreshRuns().catch(error=>$('flowError').textContent=error.message);},5000);
 return {refresh};
}
