const STATUS={open:'Em atendimento',waiting:'Aguardando lead',snoozed:'Retorno agendado',done:'Concluído'};
const PRIORITY=['Normal','Alta','Urgente'];
const FILTERS=[['focus','Minha fila'],['reply','Precisa de resposta'],['due','Retornos vencidos'],['priority','Urgentes'],['waiting','Aguardando'],['snoozed','Agendados'],['done','Concluídos'],['all','Todos']];
export function personalizeReply(body,lead){return body.replace(/\{(nome|primeiro_nome|usuario)\}/g,(_,key)=>({nome:lead?.name||'',primeiro_nome:(lead?.name||'').split(' ')[0],usuario:lead?.username?'@'+lead.username:''})[key]);}
export function setupSupport({api,element,button,showToast}){
  const $=id=>document.getElementById(id);
  const state={view:'support',filter:'focus',search:'',offset:0,items:[],total:0,selected:new Map(),lead:null,replies:[],editing:null,loading:false,busy:false,generation:0,active:false};
  $('supportView').innerHTML=`
    <section class="desk-hero"><div><p class="eyebrow">CENTRAL DE ATENDIMENTO</p><h2>Uma conversa de cada vez.<br>Todos os leads sob controle.</h2><p>Priorize as respostas, retome no horário certo e continue de onde parou.</p></div><div class="desk-hero-actions"><button id="deskNext" class="primary" type="button">Abrir próximo lead ↗</button><button id="deskImport" class="secondary-button" type="button">Importar 100 conversas recentes</button></div></section>
    <p id="deskError" class="desk-error" role="alert" hidden></p>
    <section class="desk-metrics" aria-label="Resumo do atendimento">
      <button type="button" data-filter="reply"><span>Precisam de resposta</span><strong id="deskReply">—</strong><small>Mensagens recebidas</small></button>
      <button type="button" data-filter="due"><span>Retornos vencidos</span><strong id="deskDue">—</strong><small>Retome agora</small></button>
      <button type="button" data-filter="waiting"><span>Aguardando o lead</span><strong id="deskWaiting">—</strong><small>Última mensagem enviada</small></button>
      <button type="button" data-filter="done"><span>Concluídos</span><strong id="deskDone">—</strong><small>Atendimentos organizados</small></button>
    </section>
    <section class="content-card desk-workspace"><div class="desk-heading"><div><h2>Sua fila de atendimento</h2><p id="deskHealth" class="muted" role="status">Carregando a central…</p></div><button id="deskRefresh" class="secondary-button" type="button">↻ Atualizar</button></div>
    <div id="deskFilters" class="desk-tabs" aria-label="Filtrar fila"></div>
    <div class="desk-tools"><label class="search-field"><span>⌕</span><input id="deskSearch" type="search" placeholder="Nome, @usuário, etiqueta ou responsável" aria-label="Buscar lead"></label><span class="muted">Urgência → retorno → tempo de espera</span></div>
    <div class="desk-list-head"><label><input id="deskSelectAll" type="checkbox"> Selecionar página</label><span id="deskCount"></span></div>
    <div id="deskList" class="desk-list" aria-busy="false"></div>
    <div id="deskBulk" class="desk-bulk" hidden><strong id="deskSelected"></strong><select id="deskBulkAction" aria-label="Ação para os selecionados"><option value="priority">Marcar urgente</option><option value="waiting">Aguardar lead</option><option value="snoozed">Retomar em 1 hora</option><option value="done">Concluir atendimento</option></select><button id="deskApplyBulk" class="primary" type="button">Aplicar</button><button id="deskClearSelection" class="text-button" type="button">Limpar</button></div>
    <div class="desk-pagination"><button id="deskPrev" class="secondary-button" type="button">← Anterior</button><span id="deskPage"></span><button id="deskMore" class="secondary-button" type="button">Próxima →</button></div></section>`;
  $('repliesView').innerHTML=`<section class="content-card"><div class="section-heading"><div><p class="eyebrow">MENOS DIGITAÇÃO</p><h2>Respostas prontas</h2><p class="muted">Crie textos reutilizáveis. No Telegram, copie a resposta já com o nome do lead.</p></div><button id="newReply" class="primary" type="button">+ Nova resposta</button></div><label class="search-field reply-search"><span>⌕</span><input id="replySearch" type="search" placeholder="Buscar resposta ou categoria" aria-label="Buscar resposta"></label><p id="replyError" class="form-error" role="alert"></p><div id="replyList" class="reply-grid"></div></section>`;
  const dialogs=element('div');dialogs.innerHTML=`
    <dialog id="leadDialog" class="modal lead-dialog"><form id="leadForm"><div class="modal-heading"><div><p class="eyebrow">FICHA DO LEAD</p><h2 id="leadTitle"></h2><p id="leadIdentity" class="muted"></p></div><button id="leadClose" class="icon-button" type="button" aria-label="Fechar ficha">×</button></div><div class="lead-shortcuts"><a id="leadTelegram" class="primary" target="_blank" rel="noopener">Abrir conversa ↗</a><button id="leadHour" class="secondary-button" type="button">Retomar em 1h</button><button id="leadTomorrow" class="secondary-button" type="button">Amanhã</button></div><div class="form-grid"><label>Status<select id="leadStatus"></select></label><label>Prioridade<select id="leadPriority"></select></label><label>Responsável<input id="leadOwner" maxlength="80" placeholder="Nome de quem atende"></label><label>Retorno (seu horário local)<input id="leadDue" type="datetime-local"></label><label class="full">Etiquetas, separadas por vírgula<input id="leadTags" maxlength="395" placeholder="novo, interessado, pós-venda"></label><label class="full">Notas internas<textarea id="leadNotes" maxlength="8000" rows="6" placeholder="O que precisa saber antes de continuar esta conversa?"></textarea></label></div><p id="leadError" class="form-error" role="alert"></p><div class="modal-actions"><button id="leadReload" class="secondary-button" type="button">Recarregar ficha</button><button id="leadSave" class="primary" type="submit">Salvar ficha</button></div></form></dialog>
    <dialog id="replyDialog" class="modal"><form id="replyForm"><div class="modal-heading"><h2 id="replyTitle">Nova resposta</h2><button id="replyClose" class="icon-button" type="button" aria-label="Fechar">×</button></div><label>Nome<input id="replyName" maxlength="80" required placeholder="Boas-vindas"></label><label>Categoria<input id="replyCategory" maxlength="40" required value="Geral"></label><label>Texto<textarea id="replyBody" maxlength="4096" rows="7" required placeholder="Olá, {primeiro_nome}! Como posso ajudar?"></textarea></label><p class="muted">Variáveis: {nome}, {primeiro_nome} e {usuario}. O texto será copiado para você revisar e enviar.</p><p id="replySaveError" class="form-error" role="alert"></p><div class="modal-actions"><button id="replySave" class="primary" type="submit">Salvar resposta</button></div></form></dialog>`;
  document.body.append(dialogs);
  for(const [value,label]of Object.entries(STATUS))$('leadStatus').add(new Option(label,value));
  PRIORITY.forEach((label,i)=>$('leadPriority').add(new Option(label,String(i))));
  const error=message=>{$('deskError').textContent=message;$('deskError').hidden=!message;};
  const url=lead=>'https://web.telegram.org/k/#'+encodeURIComponent(lead.dialog_id);
  function elapsed(value){const minutes=Math.max(0,Math.floor((Date.now()-Date.parse(value))/60000));return minutes<60?`${minutes} min`:minutes<1440?`${Math.floor(minutes/60)}h ${minutes%60}min`:`${Math.floor(minutes/1440)}d`;}
  function goFilter(filter){state.filter=filter;state.offset=0;state.selected.clear();void refresh();}
  function renderFilters(){
    $('deskFilters').replaceChildren(...FILTERS.map(([key,label])=>{const b=button(label,()=>goFilter(key),'desk-tab');b.setAttribute('aria-pressed',String(state.filter===key));return b;}));
  }
  function selection(){
    $('deskBulk').hidden=!state.selected.size;$('deskSelected').textContent=`${state.selected.size} selecionados`;
    $('deskSelectAll').checked=state.items.length>0&&state.items.every(row=>state.selected.has(row.dialog_id));
    $('deskSelectAll').indeterminate=state.items.some(row=>state.selected.has(row.dialog_id))&&!$('deskSelectAll').checked;
  }
  function renderQueue(){
    renderFilters();const list=$('deskList');list.replaceChildren();
    $('deskCount').textContent=`${state.total} conversas`;$('deskPage').textContent=state.total?`${state.offset+1}–${Math.min(state.offset+50,state.total)} de ${state.total}`:'0 conversas';
    $('deskPrev').disabled=state.offset===0;$('deskMore').disabled=state.offset+50>=state.total;$('deskNext').disabled=!state.items.length;
    if(!state.items.length){const empty=element('div',undefined,'desk-empty');empty.append(element('span','✓','desk-empty-icon'),element('h3',state.search?'Nenhuma conversa encontrada':'Tudo em dia nesta fila'),element('p',state.search?'Tente outro nome, etiqueta ou responsável.':'Importe as conversas recentes ou abra a ficha de um lead no Telegram. Novas mensagens entram automaticamente com o servidor conectado.'));list.append(empty);}
    for(const lead of state.items){
      const row=element('article',undefined,'desk-row'+(lead.priority===2?' urgent':''));
      const check=element('input');check.type='checkbox';check.checked=state.selected.has(lead.dialog_id);check.setAttribute('aria-label','Selecionar '+lead.name);check.onchange=()=>{if(check.checked)state.selected.set(lead.dialog_id,lead.version);else state.selected.delete(lead.dialog_id);selection();};
      const avatar=element('span',(lead.name||'?').slice(0,2).toUpperCase(),'desk-avatar');
      const info=element('div',undefined,'desk-person');const name=button(lead.name,()=>openLead(lead),'desk-name');info.append(name,element('p',lead.last_preview||lead.username&&'@'+lead.username||'Sem mensagem recente','desk-preview'));
      const tags=element('div',undefined,'desk-tags');for(const tag of lead.tags.slice(0,3))tags.append(element('span',tag,'desk-tag'));if(lead.owner)tags.append(element('span','↳ '+lead.owner,'desk-owner'));info.append(tags);
      const status=element('div',undefined,'desk-row-status');status.append(element('span',STATUS[lead.status],'desk-status '+lead.status));if(lead.priority)status.append(element('small',PRIORITY[lead.priority],'priority-'+lead.priority));
      const timing=element('div',undefined,'desk-timing');if(lead.needs_reply&&lead.waiting_since)timing.append(element('strong',elapsed(lead.waiting_since)+' sem resposta'));if(lead.due_at){const due=Date.parse(lead.due_at)<Date.now();timing.append(element('small',(due?'Vencido · ':'Retorno · ')+new Date(lead.due_at).toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}),due?'overdue':''));}
      const actions=element('div',undefined,'desk-row-actions');const link=element('a','Conversar ↗','secondary-button');link.href=url(lead);link.target='_blank';link.rel='noopener';actions.append(link,button('Ficha',()=>openLead(lead),'text-button'));row.append(check,avatar,info,status,timing,actions);list.append(row);
    }selection();
  }
  async function refresh(){
    const generation=++state.generation;state.loading=true;$('deskList').setAttribute('aria-busy','true');$('deskRefresh').disabled=true;error('');
    try{
      const query=new URLSearchParams({filter:state.filter,search:state.search,offset:String(state.offset),limit:'50'});
      const data=await api('/support/queue?'+query);if(generation!==state.generation)return;
      state.items=data.items||[];state.total=data.total||0;
      if(state.offset>=state.total&&state.offset>0){state.offset=Math.max(0,Math.floor(Math.max(0,state.total-1)/50)*50);return void refresh();}
      for(const [id,key]of [['deskReply','reply'],['deskDue','due'],['deskWaiting','waiting'],['deskDone','done']])$(id).textContent=data.stats?.[key]??0;
      $('deskHealth').textContent=data.health?.error||`Atualizado às ${new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})} · ${data.health?.pending||0} sincronizações pendentes`;
      if(data.health?.error)error(data.health.error);renderQueue();
    }catch(e){if(generation===state.generation){error(e.message);$('deskHealth').textContent='Não foi possível atualizar a fila.';}}
    finally{if(generation===state.generation){state.loading=false;$('deskList').setAttribute('aria-busy','false');$('deskRefresh').disabled=false;}}
  }
  function localDate(iso){if(!iso)return '';const date=new Date(iso);return new Date(date-date.getTimezoneOffset()*60000).toISOString().slice(0,16);}
  function openLead(lead){
    state.lead=lead;$('leadTitle').textContent=lead.name;$('leadIdentity').textContent=lead.username?'@'+lead.username:lead.dialog_id;
    $('leadTelegram').href=url(lead);$('leadStatus').value=lead.status;$('leadPriority').value=String(lead.priority);$('leadOwner').value=lead.owner;$('leadDue').value=localDate(lead.due_at);$('leadTags').value=lead.tags.join(', ');$('leadNotes').value=lead.notes;$('leadError').textContent='';if(!$('leadDialog').open)$('leadDialog').showModal();
  }
  $('leadForm').onsubmit=async event=>{
    event.preventDefault();if(state.busy)return;state.busy=true;$('leadSave').disabled=true;$('leadReload').disabled=true;$('leadForm').querySelectorAll('input,select,textarea').forEach(el=>el.disabled=true);$('leadError').textContent='';
    try{await api('/support/leads/'+state.lead.dialog_id,{method:'PATCH',body:{version:state.lead.version,status:$('leadStatus').value,priority:Number($('leadPriority').value),owner:$('leadOwner').value,tags:$('leadTags').value.split(',').map(x=>x.trim()).filter(Boolean),notes:$('leadNotes').value,due_at:$('leadDue').value?new Date($('leadDue').value).toISOString():null}});$('leadDialog').close();showToast('Ficha salva.');await refresh();}catch(e){$('leadError').textContent=e.message;}finally{state.busy=false;$('leadSave').disabled=false;$('leadReload').disabled=false;$('leadForm').querySelectorAll('input,select,textarea').forEach(el=>el.disabled=false);}
  };
  $('leadReload').onclick=async()=>{
    if(!confirm('Recarregar a ficha e substituir o que está no editor pelos dados salvos?'))return;
    try{const data=await api('/support/lead',{method:'POST',body:{peerKey:state.lead.dialog_id,dialogId:state.lead.dialog_id}});openLead(data.lead);}catch(e){$('leadError').textContent=e.message;}
  };
  $('leadClose').onclick=()=>$('leadDialog').close();
  for(const [id,ms]of [['leadHour',3600000],['leadTomorrow',86400000]])$(id).onclick=()=>{$('leadStatus').value='snoozed';$('leadDue').value=localDate(Date.now()+ms);};
  $('deskApplyBulk').onclick=async()=>{
    if(state.busy||!state.selected.size)return;
    const action=$('deskBulkAction').value;
    if(action==='done'&&!confirm(`Concluir ${state.selected.size} atendimentos selecionados?`))return;
    state.busy=true;$('deskApplyBulk').disabled=true;const snapshot=[...state.selected].map(([id,version])=>({id,version}));
    try{const patch=action==='priority'?{priority:2}:action==='snoozed'?{status:'snoozed',due_at:new Date(Date.now()+3600000).toISOString()}:{status:action};
      const {results}=await api('/support/bulk',{method:'POST',body:{items:snapshot,patch},timeout:120000});
      const failed=results.filter(r=>!r.ok);for(const r of results)if(r.ok)state.selected.delete(r.id);
      await refresh();if(failed.length)error(`${results.length-failed.length} atualizados; ${failed.length} não alterados. ${failed[0].error} Limpe a seleção e confira as fichas antes de repetir.`);else showToast(`${results.length} atendimentos atualizados.`);
    }catch(e){error(e.message);}finally{state.busy=false;$('deskApplyBulk').disabled=false;}
  };
  $('deskSelectAll').onchange=()=>{state.selected.clear();if($('deskSelectAll').checked)state.items.forEach(row=>state.selected.set(row.dialog_id,row.version));renderQueue();};
  $('deskClearSelection').onclick=()=>{state.selected.clear();renderQueue();};
  $('deskImport').onclick=async()=>{if(state.busy)return;state.busy=true;$('deskImport').disabled=true;$('deskImport').textContent='Importando…';error('');try{const data=await api('/support/import',{method:'POST',timeout:300000});showToast(`${data.imported} conversas privadas atualizadas, entre as ${data.scanned} mais recentes.`);await refresh();}catch(e){error(e.message);}finally{state.busy=false;$('deskImport').disabled=false;$('deskImport').textContent='Importar 100 conversas recentes';}};
  $('deskNext').onclick=()=>{if(state.items[0])window.open(url(state.items[0]),'_blank','noopener');};
  $('deskRefresh').onclick=()=>void refresh();$('deskPrev').onclick=()=>{state.offset=Math.max(0,state.offset-50);state.selected.clear();void refresh();};$('deskMore').onclick=()=>{state.offset+=50;state.selected.clear();void refresh();};
  let searchTimer; $('deskSearch').oninput=()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>{state.search=$('deskSearch').value.trim();state.offset=0;state.selected.clear();void refresh();},250);};
  document.querySelectorAll('.desk-metrics [data-filter]').forEach(b=>b.onclick=()=>goFilter(b.dataset.filter));
  function renderReplies(){
    const query=$('replySearch').value.toLocaleLowerCase('pt-BR');const list=$('replyList');list.replaceChildren();
    for(const reply of state.replies.filter(r=>`${r.title} ${r.body} ${r.category}`.toLocaleLowerCase('pt-BR').includes(query))){
      const card=element('article',undefined,'reply-card');card.append(element('span',reply.category,'desk-tag'),element('h3',reply.title),element('p',reply.body));
      const actions=element('div',undefined,'flow-actions');actions.append(button('Editar',()=>editReply(reply)),button('Excluir',async()=>{if(!confirm(`Excluir a resposta “${reply.title}”?`))return;try{await api('/support/replies/'+reply.id,{method:'DELETE',body:{version:reply.version}});await loadReplies();}catch(e){$('replyError').textContent=e.message;}}));card.append(actions);list.append(card);
    }
    if(!list.children.length)list.append(element('div',state.replies.length?'Nenhuma resposta encontrada.':'Crie respostas para boas-vindas, dúvidas frequentes e retornos. Elas aparecerão no painel do Telegram.','desk-empty'));
  }
  async function loadReplies(){try{$('replyError').textContent='';state.replies=(await api('/support/replies')).items||[];renderReplies();}catch(e){$('replyError').textContent=e.message;}}
  function editReply(reply=null){state.editing=reply;$('replyTitle').textContent=reply?'Editar resposta':'Nova resposta';$('replyName').value=reply?.title||'';$('replyCategory').value=reply?.category||'Geral';$('replyBody').value=reply?.body||'';$('replySaveError').textContent='';$('replyDialog').showModal();}
  $('newReply').onclick=()=>editReply();$('replyClose').onclick=()=>$('replyDialog').close();$('replySearch').oninput=renderReplies;
  $('replyForm').onsubmit=async event=>{event.preventDefault();if($('replySave').disabled)return;$('replySave').disabled=true;$('replySaveError').textContent='';try{await api('/support/replies'+(state.editing?'/'+state.editing.id:''),{method:state.editing?'PATCH':'POST',body:{title:$('replyName').value,category:$('replyCategory').value,body:$('replyBody').value,version:state.editing?.version}});$('replyDialog').close();await loadReplies();showToast('Resposta salva.');}catch(e){$('replySaveError').textContent=e.message;}finally{$('replySave').disabled=false;}};
  setInterval(()=>{if(state.active&&state.view==='support'&&document.visibilityState==='visible'&&!state.loading&&!state.busy&&!$('leadDialog').open&&!document.activeElement?.closest('.desk-row'))void refresh();},15000);
  return {activate(view){state.active=['support','replies'].includes(view);state.view=view;if(view==='support')void refresh();if(view==='replies')void loadReplies();},disconnect(){state.active=false;state.generation++;state.selected.clear();state.items=[];state.lead=null;state.replies=[];$('leadDialog').close();$('replyDialog').close();}};
}
