import {setupFlows} from './flows.js';
const $ = id => document.getElementById(id);
const connectionStorageKey = 'telegram-atendimento-4-dashboard-connection';
const state = {connection:null,items:[],categories:[],view:'library',favoriteOnly:false,editingAudio:null,editingCategory:null,localPreviewUrl:null,previewUrl:null,toastTimer:null,loading:false,telegramAuthBusy:false,telegramStatusBusy:false,telegramPoll:null};
const kindMeta={
  voice:{label:'Áudio',icon:'♫',accept:'audio/*,.mp4,.opus,.webm',hint:'MP3, M4A, WAV, AAC, OGG, OPUS, MP4 ou WEBM · até 50 MB'},
  text:{label:'Texto',icon:'T',accept:'',hint:'Até 4096 caracteres'},
  image:{label:'Imagem',icon:'▧',accept:'image/jpeg,image/png,.jpg,.jpeg,.png',hint:'JPG ou PNG · até 50 MB'},
  video:{label:'Vídeo',icon:'▷',accept:'video/mp4,.mp4',hint:'MP4 · até 50 MB'},
  file:{label:'Arquivo',icon:'▱',accept:'.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv,.zip',hint:'PDF, Word, Excel, TXT, CSV ou ZIP · até 50 MB'}
};

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function button(text, onClick, className = 'secondary-button') {
  const node = element('button', text, className);node.type='button';node.addEventListener('click',onClick);return node;
}

function showToast(text, type = '') {
  const toast=$('toast');toast.textContent=text;toast.className=`toast show ${type}`.trim();clearTimeout(state.toastTimer);state.toastTimer=setTimeout(()=>toast.className='toast',4500);
}

function showConnectionGate(error = '') {
  $('appShell').hidden=true;$('connectionGate').hidden=false;
  $('connectionUrl').value=state.connection?.url || $('connectionUrl').value || '';
  $('connectionToken').value=state.connection?.token || $('connectionToken').value || '';
  $('connectionError').textContent=error;
}

function showApp() {
  $('connectionGate').hidden=true;$('appShell').hidden=false;
  $('connectedUrl').textContent=state.connection?.url || '—';
}

function normalizeUrl(value) {
  const url=new URL(value.trim());
  if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.pathname!=='/')throw new Error('Use um endereço HTTPS sem caminho, por exemplo https://telegram-atendimento.onrender.com');
  return url.origin;
}

async function requestWithConnection(connection,path,options={}) {
  const headers={Authorization:`Bearer ${connection.token}`};
  let body=options.body;
  if(body!==undefined && !(body instanceof FormData)){headers['Content-Type']='application/json';body=JSON.stringify(body);}
  let response;
  try{response=await fetch(new URL(path,connection.url),{method:options.method||'GET',headers,body,signal:AbortSignal.timeout(options.timeout||30000)});}catch{throw new Error('A API não respondeu. Confira o Render e a internet.');}
  if(options.blob){if(!response.ok){const data=await response.json().catch(()=>({}));throw new Error(data.error||`Erro ${response.status}`);}return response.blob();}
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(data.error||`Erro ${response.status}`);
  return data;
}

async function api(path, options={}) {
  if(!state.connection)throw new Error('Conecte o dashboard à API do Render.');
  return requestWithConnection(state.connection,path,options);
}

async function loadData() {
  if(!state.connection||state.loading)return;
  state.loading=true;
  try{
    const [libraryData,categoryData]=await Promise.all([api('/library'),api('/categories')]);
    state.items=libraryData.items||[];
    state.categories=(categoryData.categories||[]).filter(item=>item?.id&&item?.name);
    if(!state.categories.some(item=>item.name==='Geral'))state.categories.unshift({id:'',name:'Geral'});
    render();
  }finally{state.loading=false;}
}

function formatDuration(value) {
  const total=Math.max(0,Math.round(Number(value)||0));
  const minutes=Math.floor(total/60),seconds=String(total%60).padStart(2,'0');
  return `${minutes}:${seconds}`;
}

function categoryName(item) {return item.category || 'Geral';}

function filteredItems() {
  const query=$('search').value.trim().toLocaleLowerCase('pt-BR'),category=$('categoryFilter').value,status=$('statusFilter').value,kind=$('kindFilter').value;
  return state.items.filter(item=>
    (!query||String(item.name||'').toLocaleLowerCase('pt-BR').includes(query))&&
    (!kind||(item.kind||'voice')===kind)&&
    (!category||categoryName(item)===category)&&
    (!status||(status==='active'?item.active!==false:item.active===false))&&
    (!state.favoriteOnly||item.favorite===true)
  );
}

function renderStats() {
  $('totalCount').textContent=state.items.length;
  $('activeCount').textContent=state.items.filter(item=>item.active!==false).length;
  $('favoriteCount').textContent=state.items.filter(item=>item.favorite===true).length;
  $('categoryCount').textContent=state.categories.length;
  $('navAudioCount').textContent=state.items.length;
}

function renderCategoryOptions() {
  const filterValue=$('categoryFilter').value, audioValue=$('audioCategory').value;
  $('categoryFilter').replaceChildren(new Option('Todas as categorias',''));
  $('audioCategory').replaceChildren();
  for(const category of state.categories){
    $('categoryFilter').add(new Option(category.name,category.name));
    $('audioCategory').add(new Option(category.name,category.name));
  }
  $('categoryFilter').value=state.categories.some(item=>item.name===filterValue)?filterValue:'';
  $('audioCategory').value=state.categories.some(item=>item.name===audioValue)?audioValue:'Geral';
}

function render() {
  renderStats();renderCategoryOptions();renderAudioList();renderCategories();
  $('favoriteFilter').classList.toggle('active',state.favoriteOnly);
  const hasFilter=$('search').value||$('kindFilter').value||$('categoryFilter').value||$('statusFilter').value||state.favoriteOnly;
  $('clearFilters').hidden=!hasFilter;
}

function renderTelegramStatus(status, error = '') {
  const dot=$('telegramStatusDot'),title=$('telegramStatusText'),account=$('telegramAccountText'),connect=$('connectTelegram');
  if(status?.authorized){
    dot.className='telegram-dot online';title.textContent='Telegram conectado';account.textContent=`${status.me?.name || 'Conta Telegram'}${status.me?.username?' · @'+status.me.username:''}`;connect.textContent='Ver conta';return;
  }
  if(status?.state==='starting'||status?.state==='need_code'||status?.state==='need_password'){
    dot.className='telegram-dot loading';title.textContent='Conectando Telegram…';account.textContent=status.state==='need_code'?'Aguardando código':status.state==='need_password'?'Aguardando senha 2FA':'Processando login';connect.textContent='Continuar login';return;
  }
  dot.className=`telegram-dot ${error||status?.lastError?'error':''}`.trim();title.textContent='Telegram não conectado';account.textContent=error||status?.lastError||'Conecte a conta para enviar vozes';connect.textContent='Conectar conta';
}

function setTelegramSteps(status) {
  const stateName=status?.state||'idle',authorized=!!status?.authorized;
  $('telegramPhoneStep').hidden=authorized||!['idle','error'].includes(stateName);
  $('telegramCodeStep').hidden=authorized||stateName!=='need_code';
  $('telegramPasswordStep').hidden=authorized||stateName!=='need_password';
  if(authorized) $('telegramDialogMessage').textContent=`Conectado como ${status.me?.name || 'Conta Telegram'}.`;
  else if(status?.lastError) $('telegramDialogMessage').textContent=status.lastError;
  else if(stateName==='need_code') $('telegramDialogMessage').textContent='Digite o código que o Telegram enviou para sua conta.';
  else if(stateName==='need_password') $('telegramDialogMessage').textContent='Digite a senha de verificação em duas etapas.';
  else if(stateName==='starting') $('telegramDialogMessage').textContent='Iniciando a conexão… aguarde.';
  else $('telegramDialogMessage').textContent='Use a mesma conta que será atendida pela extensão.';
}

async function loadTelegramStatus(showError = false) {
  if(state.telegramStatusBusy)return null;
  state.telegramStatusBusy=true;
  try{const status=await api('/auth/status');renderTelegramStatus(status);setTelegramSteps(status);return status;}
  catch(error){renderTelegramStatus(null,error.message);if(showError)$('telegramError').textContent=error.message;return null;}
  finally{state.telegramStatusBusy=false;}
}

async function telegramAction(path, body, buttonId) {
  if(state.telegramAuthBusy)return;state.telegramAuthBusy=true;const action=$(buttonId);action.disabled=true;$('telegramError').textContent='';
  try{await api(path,{method:'POST',body});await loadTelegramStatus(true);}
  catch(error){$('telegramError').textContent=error.message;}
  finally{state.telegramAuthBusy=false;action.disabled=false;}
}

function openTelegramDialog() {
  $('telegramError').textContent='';$('telegramDialog').showModal();void loadTelegramStatus(true);clearInterval(state.telegramPoll);state.telegramPoll=setInterval(()=>{if($('telegramDialog').open&&!state.telegramAuthBusy)void loadTelegramStatus(true);},1500);
}

function renderAudioList() {
  const list=$('audioList');list.replaceChildren();
  const items=filteredItems();
  $('itemsCount').textContent=`${items.length} ${items.length===1?'conteúdo':'conteúdos'}`;
  const canReorder=!$('search').value&&!$('kindFilter').value&&!$('categoryFilter').value&&!$('statusFilter').value&&!state.favoriteOnly;
  $('listDescription').textContent=canReorder?'Arraste para reorganizar a biblioteca. Áudios ativos aparecem na extensão.':'Limpe os filtros para reorganizar a biblioteca.';
  if(!items.length){
    const empty=element('div',undefined,'empty-state');empty.append(element('strong',state.items.length?'Nenhum conteúdo encontrado':'Sua biblioteca está vazia'),element('p',state.items.length?'Tente ajustar os filtros.':'Adicione seu primeiro conteúdo para começar.'),button('+ Novo conteúdo',()=>openAudioDialog(),'primary'));list.append(empty);return;
  }
  for(const item of items){
    const row=element('article',undefined,'audio-row'+(item.active===false?' inactive':''));row.dataset.id=item.id;row.draggable=canReorder;
    const drag=element('span','⠿','drag-handle');drag.title=canReorder?'Arraste para reordenar':'Limpe os filtros para reordenar';
    const metaKind=kindMeta[item.kind||'voice']||kindMeta.file;
    const play=button(metaKind.icon,()=>openPreview(item),'play-button');play.title=`Ver prévia de ${item.name}`;play.setAttribute('aria-label',`Ver prévia de ${item.name}`);
    const info=element('div',undefined,'audio-info');info.append(element('strong',item.name,'audio-name'));
    const meta=element('div',undefined,'audio-meta');meta.append(element('span',metaKind.label,'category-pill'),element('span',categoryName(item),'category-pill'),element('span',item.active===false?'Desativado':'Ativo','status-pill '+(item.active===false?'inactive':'active')));info.append(meta);
    const duration=element('span',item.duration?formatDuration(item.duration):metaKind.label,'row-duration');duration.title=item.duration?'Duração':'Tipo';
    const favorite=button(item.favorite?'★':'☆',()=>toggleItem(item,'favorite',!item.favorite),'row-favorite '+(item.favorite?'active':''));favorite.title=item.favorite?'Remover dos favoritos':'Marcar como favorito';favorite.setAttribute('aria-label',favorite.title);
    const activeLabel=element('label',undefined,'switch');const activeInput=document.createElement('input');activeInput.type='checkbox';activeInput.checked=item.active!==false;activeInput.setAttribute('aria-label',`${item.active===false?'Ativar':'Desativar'} ${item.name}`);activeInput.addEventListener('change',()=>toggleItem(item,'active',activeInput.checked));const track=element('span',undefined,'switch-track');activeLabel.append(activeInput,track);
    const menu=element('details','', 'row-menu');const summary=element('summary','⋯','menu-button');summary.setAttribute('aria-label',`Ações para ${item.name}`);const actions=element('div',undefined,'row-actions');
    actions.append(button('Editar',()=>{menu.open=false;openAudioDialog(item)}));if((item.kind||'voice')!=='text')actions.append(button('Substituir arquivo',()=>{menu.open=false;openAudioDialog(item,true)}));actions.append(button('Excluir',()=>{menu.open=false;deleteAudio(item)},'danger'));menu.append(summary,actions);
    row.append(drag,play,info,duration,favorite,activeLabel,menu);
    row.addEventListener('dragstart',event=>{if(!canReorder){event.preventDefault();return;}row.classList.add('dragging');event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/plain',item.id);});
    row.addEventListener('dragend',()=>row.classList.remove('dragging'));
    row.addEventListener('dragover',event=>{if(canReorder)event.preventDefault();});
    row.addEventListener('drop',event=>{event.preventDefault();if(canReorder)reorderAudio(event.dataTransfer.getData('text/plain'),item.id);});
    list.append(row);
  }
}

function renderCategories() {
  const list=$('categoryList');list.replaceChildren();
  for(const category of state.categories){
    const count=state.items.filter(item=>categoryName(item)===category.name).length,row=element('div',undefined,'category-row');
    row.append(element('span','▤','category-symbol'));
    const main=element('div',undefined,'category-main');main.append(element('strong',category.name),element('span',`${count} ${count===1?'conteúdo':'conteúdos'}`));row.append(main);
    const actions=element('div',undefined,'category-actions');const rename=button('Renomear',()=>openCategoryDialog(category));const remove=button('Excluir',()=>deleteCategory(category),'danger');if(category.name==='Geral'){rename.disabled=true;remove.disabled=true;}actions.append(rename,remove);row.append(actions);list.append(row);
  }
  if(!state.categories.length)list.append(element('div','Nenhuma categoria criada.','empty-state'));
}

async function toggleItem(item,field,value) {
  try{await api(`/library/${encodeURIComponent(item.id)}`,{method:'PATCH',body:{[field]:value}});await loadData();showToast(field==='active'?(value?'Conteúdo ativado.':'Conteúdo desativado.'):'Favorito atualizado.');}
  catch(error){showToast(error.message,'error');render();}
}

async function reorderAudio(fromId,toId) {
  if(!fromId||fromId===toId)return;
  const from=state.items.findIndex(item=>item.id===fromId),to=state.items.findIndex(item=>item.id===toId);if(from<0||to<0)return;
  const [moved]=state.items.splice(from,1);state.items.splice(to,0,moved);renderAudioList();
  try{await api('/library/reorder',{method:'PATCH',body:{ids:state.items.map(item=>item.id)}});showToast('Ordem dos conteúdos atualizada.');}
  catch(error){showToast(error.message,'error');await loadData();}
}

async function deleteAudio(item) {
  if(!confirm(`Excluir “${item.name}”? Essa ação remove o arquivo do Storage.`))return;
  try{await api(`/library/${encodeURIComponent(item.id)}`,{method:'DELETE'});await loadData();showToast('Conteúdo excluído.');}
  catch(error){showToast(error.message,'error');}
}

function clearLocalPreview() {
  if(state.localPreviewUrl)URL.revokeObjectURL(state.localPreviewUrl);state.localPreviewUrl=null;$('localAudio').removeAttribute('src');$('localAudio').load();$('localDuration').textContent='';$('localPreview').hidden=true;
}

function updateContentKind() {
  const kind=$('audioKind').value,meta=kindMeta[kind]||kindMeta.voice,isText=kind==='text';
  $('audioTextField').hidden=!isText;$('audioFileField').hidden=isText;$('audioFile').accept=meta.accept;$('audioFileTypes').textContent=meta.hint;
  $('audioFileHint').textContent=kind==='voice'?'O servidor converterá o áudio para mensagem de voz OGG/Opus.':kind==='video'?'O servidor otimizará o vídeo para MP4.':'O arquivo será armazenado de forma privada no servidor.';
  $('audioFile').required=!state.editingAudio&&!isText;$('audioText').required=isText;
}

function openAudioDialog(item=null,replace=false) {
  state.editingAudio=item||null;clearLocalPreview();$('audioDialogTitle').textContent=item?'Editar conteúdo':'Novo conteúdo';$('audioName').value=item?.name||'';$('audioKind').value=item?.kind||'voice';$('audioKind').disabled=!!item;$('audioText').value=item?.text||'';$('audioCategory').value=item?categoryName(item):'Geral';$('audioActive').value=item?.active===false?'false':'true';$('audioFile').value='';$('audioError').textContent='';updateContentKind();$('audioDialog').showModal();if(replace)$('audioFile').focus();
}

async function saveAudio(event) {
  event.preventDefault();const save=$('saveAudio');save.disabled=true;$('audioError').textContent='';
  const file=$('audioFile').files[0],name=$('audioName').value.trim(),category=$('audioCategory').value||'Geral',active=$('audioActive').value==='true',kind=$('audioKind').value,text=$('audioText').value.trim();
  try{
    if(!name)throw new Error('Informe um nome para o conteúdo.');
    if(file&&file.size>50*1024*1024)throw new Error('O arquivo excede 50 MB.');
    if(kind==='text'&&!text)throw new Error('Digite a mensagem de texto.');
    if(!state.editingAudio&&kind!=='text'&&!file)throw new Error('Selecione um arquivo.');
    if(state.editingAudio){
      await api(`/library/${encodeURIComponent(state.editingAudio.id)}`,{method:'PATCH',body:{name,category,active,...(kind==='text'?{text}:{})}});
      if(file){const form=new FormData();form.append('file',file);await api(`/library/${encodeURIComponent(state.editingAudio.id)}/file`,{method:'POST',body:form,timeout:300000});}
    }else{
      const form=new FormData();form.append('name',name);form.append('category',category);form.append('kind',kind);form.append('active',String(active));if(kind==='text')form.append('text',text);else form.append('file',file);await api('/library',{method:'POST',body:form,timeout:300000});
    }
    $('audioDialog').close();await loadData();showToast(state.editingAudio?'Conteúdo atualizado.':'Conteúdo adicionado à biblioteca.');
  }catch(error){$('audioError').textContent=error.message;}
  finally{save.disabled=false;}
}

async function openPreview(item) {
  if(state.previewUrl)URL.revokeObjectURL(state.previewUrl);state.previewUrl=null;$('previewTitle').textContent=item.name;$('previewContent').replaceChildren(element('span',undefined,'loader'));$('previewDialog').showModal();
  if(item.kind==='text'){$('previewContent').replaceChildren(element('p',item.text||'','text-preview'));return;}
  try{const blob=await api(`/library/${encodeURIComponent(item.id)}/preview`,{blob:true,timeout:120000});if(!$('previewDialog').open)return;state.previewUrl=URL.createObjectURL(blob);let preview;if((item.kind||'voice')==='voice'){preview=document.createElement('audio');preview.controls=true;}else if(item.kind==='image'){preview=document.createElement('img');preview.alt=item.name;}else if(item.kind==='video'){preview=document.createElement('video');preview.controls=true;}else{preview=document.createElement('a');preview.textContent=`Abrir ${item.originalName||item.name}`;preview.download=item.originalName||item.name;}preview.src=state.previewUrl;if(preview.tagName==='A')preview.href=state.previewUrl;$('previewContent').replaceChildren(preview);}
  catch(error){$('previewContent').replaceChildren(element('p',error.message,'form-error'));}
}

function closePreview() {if(state.previewUrl)URL.revokeObjectURL(state.previewUrl);state.previewUrl=null;$('previewContent').replaceChildren();}

function openCategoryDialog(category=null) {state.editingCategory=category||null;$('categoryDialogTitle').textContent=category?'Renomear categoria':'Nova categoria';$('categoryName').value=category?.name||'';$('categoryError').textContent='';$('categoryDialog').showModal();}

async function saveCategory(event) {
  event.preventDefault();const name=$('categoryName').value.trim();$('categoryError').textContent='';
  try{if(!name)throw new Error('Informe um nome.');if(state.editingCategory)await api(`/categories/${encodeURIComponent(state.editingCategory.id)}`,{method:'PATCH',body:{name}});else await api('/categories',{method:'POST',body:{name}});$('categoryDialog').close();await loadData();showToast(state.editingCategory?'Categoria renomeada.':'Categoria criada.');}
  catch(error){$('categoryError').textContent=error.message;}
}

async function deleteCategory(category) {
  if(category.name==='Geral')return;
  if(!confirm(`Excluir a categoria “${category.name}”? Os conteúdos serão movidos para Geral.`))return;
  try{await api(`/categories/${encodeURIComponent(category.id)}`,{method:'DELETE'});await loadData();showToast('Categoria excluída; os conteúdos foram movidos para Geral.');}
  catch(error){showToast(error.message,'error');}
}

function setView(view) {
  $('flowsView').hidden=view!=='flows';if(view==='flows')void flowUI.refresh();
  state.view=view;$('libraryView').hidden=view!=='library';$('categoriesView').hidden=view!=='categories';$('pageTitle').textContent=view==='library'?'Organize seu atendimento':view==='flows'?'Fluxos de mensagens':'Categorias da biblioteca';
  document.querySelectorAll('.nav-item').forEach(item=>item.classList.toggle('active',item.dataset.view===view));$('sidebar').classList.remove('open');
}

async function connect(event) {
  event.preventDefault();const submit=event.currentTarget.querySelector('button[type="submit"]');submit.disabled=true;$('connectionError').textContent='';
  try{const url=normalizeUrl($('connectionUrl').value),token=$('connectionToken').value.trim();if(token.length<32)throw new Error('Confira a chave de acesso completa.');const connection={url,token};const health=await requestWithConnection(connection,'/health',{timeout:120000});if(!health.ok)throw new Error('A API não confirmou a conexão.');state.connection=connection;localStorage.setItem(connectionStorageKey,JSON.stringify(connection));showApp();await loadData();await loadTelegramStatus();showToast('Dashboard conectado.');}
  catch(error){$('connectionError').textContent=error.message;showConnectionGate(error.message);}
  finally{submit.disabled=false;}
}

async function start() {
  try{state.connection=JSON.parse(localStorage.getItem(connectionStorageKey)||'null');}catch{state.connection=null;}
  if(!state.connection){showConnectionGate();return;}
  $('connectionUrl').value=state.connection.url||'';$('connectionToken').value=state.connection.token||'';showApp();
  try{await loadData();await loadTelegramStatus();}catch(error){showConnectionGate(error.message);}
}

const flowUI=setupFlows({api,element,button,showToast,getItems:()=>state.items});

$('connectionForm').addEventListener('submit',connect);
$('audioForm').addEventListener('submit',saveAudio);
$('categoryForm').addEventListener('submit',saveCategory);
$('newAudio').addEventListener('click',()=>openAudioDialog());$('cancelAudio').addEventListener('click',()=>$('audioDialog').close());$('closeAudio').addEventListener('click',()=>$('audioDialog').close());$('audioDialog').addEventListener('close',clearLocalPreview);
$('closePreview').addEventListener('click',()=>$('previewDialog').close());$('previewDialog').addEventListener('close',closePreview);
$('newCategory').addEventListener('click',()=>openCategoryDialog());$('cancelCategory').addEventListener('click',()=>$('categoryDialog').close());$('closeCategory').addEventListener('click',()=>$('categoryDialog').close());
$('connectTelegram').addEventListener('click',openTelegramDialog);$('startTelegramLogin').addEventListener('click',()=>telegramAction('/auth/start',{phone:$('telegramPhone').value},'startTelegramLogin'));$('submitTelegramCode').addEventListener('click',()=>telegramAction('/auth/code',{code:$('telegramCode').value},'submitTelegramCode'));$('submitTelegramPassword').addEventListener('click',()=>telegramAction('/auth/password',{password:$('telegramPassword').value},'submitTelegramPassword'));$('cancelTelegram').addEventListener('click',()=>$('telegramDialog').close());$('closeTelegram').addEventListener('click',()=>$('telegramDialog').close());$('telegramForm').addEventListener('submit',event=>event.preventDefault());$('telegramDialog').addEventListener('close',()=>{clearInterval(state.telegramPoll);state.telegramPoll=null;});
$('audioKind').addEventListener('change',()=>{clearLocalPreview();$('audioFile').value='';updateContentKind();});
$('audioFile').addEventListener('change',()=>{const file=$('audioFile').files[0];clearLocalPreview();$('audioError').textContent='';if(!file)return;if(file.size>50*1024*1024){$('audioError').textContent='O arquivo excede 50 MB.';return;}if($('audioKind').value!=='voice')return;state.localPreviewUrl=URL.createObjectURL(file);$('localAudio').src=state.localPreviewUrl;$('localAudio').onloadedmetadata=()=>{$('localDuration').textContent=formatDuration($('localAudio').duration);};$('localPreview').hidden=false;});
$('search').addEventListener('input',renderAudioList);$('kindFilter').addEventListener('change',renderAudioList);$('categoryFilter').addEventListener('change',renderAudioList);$('statusFilter').addEventListener('change',renderAudioList);$('favoriteFilter').addEventListener('click',()=>{state.favoriteOnly=!state.favoriteOnly;render();});$('clearFilters').addEventListener('click',()=>{$('search').value='';$('kindFilter').value='';$('categoryFilter').value='';$('statusFilter').value='';state.favoriteOnly=false;render();});
$('refresh').addEventListener('click',async()=>{try{await loadData();showToast('Biblioteca atualizada.');}catch(error){showToast(error.message,'error');}});
$('disconnect').addEventListener('click',()=>{localStorage.removeItem(connectionStorageKey);state.connection=null;showConnectionGate();});
$('openSidebar').addEventListener('click',()=>$('sidebar').classList.add('open'));$('closeSidebar').addEventListener('click',()=>$('sidebar').classList.remove('open'));
document.querySelectorAll('.nav-item').forEach(item=>item.addEventListener('click',()=>setView(item.dataset.view)));
setInterval(()=>{if(!$('appShell').hidden&&!state.loading)loadData().catch(()=>{});},30000);
start();
