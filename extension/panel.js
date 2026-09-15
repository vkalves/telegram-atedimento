import {peerFromURL,TargetTracker} from './target.js';
const $=id=>document.getElementById(id);
let items=[],sequences=[],jobs=[],account=null,windowId,editingItem=null,editingSequence=null,previewUrl=null,authBusy=false,pollBusy=false,loading=false,ready=false,sending=false,onlyFavorites=false;
const tracker=new TargetTracker();let contextStamp='',resolving=null;
const kindLabel={voice:'Áudio',text:'Texto',image:'Imagem',video:'Vídeo'};
let connection=(await chrome.storage.local.get('connection')).connection||{};
await chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'}).catch(()=>{});
windowId=(await chrome.windows.getCurrent()).id;
$('kindFilter').value='voice';
function notify(text,type=''){const el=$('notice');el.textContent=text;el.className='notice '+type;}
function node(tag,text,cls){const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(cls)el.className=cls;return el;}
function button(text,fn,cls='secondary'){const el=node('button',text,cls);el.type='button';el.onclick=fn;return el;}
async function request(path,{body,method='GET',blob=false,...options}={}){
 if(!connection.url||!connection.token)throw new Error('Configure a conexão com sua instalação online.');
 const headers={Authorization:'Bearer '+connection.token};
 if(body&&!(body instanceof FormData)){headers['Content-Type']='application/json';body=JSON.stringify(body);}
 let response;try{response=await fetch(connection.url+path,{...options,method,body,headers,signal:AbortSignal.timeout(path==='/health'?120000:method==='POST'&&path==='/library'?300000:30000)});}catch{throw new Error('A conexão não respondeu. Confira a internet e a instalação online. Se clicou em enviar, veja a conversa e a aba Envios antes de repetir.');}
 if(!response.ok){const data=await response.json().catch(()=>({}));throw new Error(data.error||`Erro ${response.status}`);}
 return blob?response.blob():response.json();
}
function destination(){return tracker.target;}
function enableSends(){document.querySelectorAll('.send').forEach(b=>b.disabled=!tracker.target||!ready||sending);}
function showDestination(message){
 const d=tracker.target;$('destination').textContent=d?d.name:'Abra uma conversa';
 $('targetHint').textContent=message||(d?`${d.username?'@'+d.username+' · ':''}Conversa atual identificada · ID ${d.id}`:'Escolha uma conversa privada no Telegram.');enableSends();
}
async function browserContext(){const data=await chrome.runtime.sendMessage({type:'context',windowId});return {key:peerFromURL(data?.href||''),stamp:`${data?.tabId||''}|${data?.href||''}`};}
async function context(force=false){
 const current=await browserContext();
 if(current.stamp===contextStamp&&!force){if(resolving)await resolving;return;}
 contextStamp=current.stamp;const generation=tracker.change(current.key);resolving=null;
 showDestination(current.key?'Identificando a conversa…':'Abra uma conversa privada no Telegram Web K ou A.');
 if(!current.key)return;
 const pending=request('/context',{method:'POST',body:{peerKey:current.key}}).then(({target})=>{if(tracker.accept(generation,target))showDestination();}).catch(e=>{if(generation===tracker.generation)showDestination(e.message);}).finally(()=>{if(generation===tracker.generation)resolving=null;});
 resolving=pending;await pending;
}
async function loadItems(){items=(await request('/library')).items;renderCategories();renderItems();renderSequences();}
async function loadSequences(){sequences=(await request('/sequences')).sequences;renderSequences();}
function renderCategories(){const prev=$('category').value,categories=[...new Set(items.map(x=>x.category||'Geral'))].sort();$('category').replaceChildren(new Option('Todas as categorias',''));$('categories').replaceChildren();for(const c of categories){$('category').add(new Option(c,c));$('categories').append(new Option(c,c));}$('category').value=categories.includes(prev)?prev:'';}
function renderItems(){
 $('items').replaceChildren();const q=$('search').value.toLowerCase(),category=$('category').value,kind=$('kindFilter').value;
 const filtered=items.filter(x=>(!q||`${x.name} ${x.text||''}`.toLowerCase().includes(q))&&(!category||(x.category||'Geral')===category)&&(!kind||(kind==='media'?['image','video'].includes(x.kind):(x.kind||'voice')===kind))&&(!onlyFavorites||x.favorite)).sort((a,b)=>Number(!!b.favorite)-Number(!!a.favorite));
 if(!filtered.length){const e=node('div',undefined,'empty');e.append(node('b',items.length?'Nenhuma resposta neste filtro':'Seus áudios, a um clique'),node('span',items.length?'Ajuste a busca ou a categoria.':'Clique em + Nova para salvar sua primeira resposta.'));$('items').append(e);}
 for(const item of filtered){
  const card=node('article',undefined,'card audio-row');
  const play=button(item.kind==='text'?'T':item.kind==='image'?'▧':'▶',()=>preview(item),'preview-button');play.title=item.kind==='voice'||!item.kind?'Ouvir áudio':'Ver resposta';play.setAttribute('aria-label',`${play.title}: ${item.name}`);
  const info=node('div',undefined,'row-info'),title=node('h3',(item.favorite?'★ ':'')+item.name);title.title=item.name;
  const meta=node('div',undefined,'meta');meta.append(node('span',`${item.duration?item.duration+'s · ':''}${item.category||'Geral'}`));info.append(title,meta);
  if(item.kind==='text')info.append(node('p',item.text.slice(0,80)));
  const send=button('➤',()=>sendSteps([{id:item.id,delay:0}],item.name),'send');send.title='Enviar na conversa atual';send.setAttribute('aria-label',`Enviar ${item.name} na conversa atual`);
  const menu=node('details',undefined,'more'),summary=node('summary','⋮');summary.setAttribute('aria-label','Opções de '+item.name);const options=node('div');
  options.append(button(item.favorite?'Remover favorito':'☆ Favoritar',async()=>{try{await request('/library/'+item.id,{method:'PATCH',body:{favorite:!item.favorite}});await loadItems();}catch(e){notify(e.message,'error');}}),button('Editar',()=>{menu.open=false;openItem(item);}),button('Excluir',()=>removeItem(item),'danger'));
  menu.append(summary,options);card.append(play,info,send,menu);$('items').append(card);
 }
 enableSends();
}
function openItem(item=null){editingItem=item;$('itemTitle').textContent=item?'Editar resposta':'Nova resposta';$('itemName').value=item?.name||'';$('itemCategory').value=item?.category||'Geral';$('itemKind').value=item?.kind||'voice';$('itemKind').disabled=!!item;$('itemText').value=item?.text||'';$('itemFile').value='';$('itemError').textContent='';setItemKind();$('itemDialog').showModal();}
function setItemKind(){const kind=$('itemKind').value;$('textRow').hidden=kind!=='text';$('fileRow').hidden=kind==='text'||!!editingItem;$('itemFile').accept=kind==='voice'?'audio/*,.mp4,.opus':kind==='image'?'.jpg,.jpeg,.png':'.mp4';}
$('itemForm').onsubmit=async e=>{e.preventDefault();$('saveItem').disabled=true;$('itemError').textContent='';try{
  const input={name:$('itemName').value,category:$('itemCategory').value,kind:$('itemKind').value,text:$('itemText').value};
  if(editingItem)await request('/library/'+editingItem.id,{method:'PATCH',body:input});
  else{const form=new FormData();for(const [key,value]of Object.entries(input))form.append(key,value);if(input.kind!=='text'){const file=$('itemFile').files[0];if(!file)throw new Error('Selecione o arquivo.');if(file.size>50*1024*1024)throw new Error('O arquivo excede 50 MB.');form.append('file',file);}notify(input.kind==='voice'?'Convertendo áudio…':'Salvando resposta…','busy');await request('/library',{method:'POST',body:form});}
  $('itemDialog').close();await loadItems();notify('Resposta salva. Já pode usar nos atendimentos.');
}catch(e){$('itemError').textContent=e.message;notify(e.message,'error');}finally{$('saveItem').disabled=false;}};
async function removeItem(item){if(!confirm(`Excluir “${item.name}”? Sequências que usam este item precisarão ser editadas.`))return;try{await request('/library/'+item.id,{method:'DELETE'});await loadItems();notify('Resposta excluída.');}catch(e){notify(e.message,'error');}}
async function preview(item){
  $('previewTitle').textContent=item.name;$('previewBody').replaceChildren(node('p','Carregando…'));$('previewDialog').showModal();
  try{if(item.kind==='text'){$('previewBody').replaceChildren(node('p',item.text));return;}
    const blob=await request('/library/'+item.id+'/preview',{blob:true});if(!$('previewDialog').open)return;
    previewUrl=URL.createObjectURL(blob);const el=node(item.kind==='image'?'img':item.kind==='video'?'video':'audio');el.src=previewUrl;
    if(item.kind!=='image'){el.controls=true;el.onended=()=>{};}else el.alt=item.name;
    $('previewBody').replaceChildren(el);
  }catch(e){$('previewBody').replaceChildren(node('p',e.message,'error'));}
}
$('previewDialog').addEventListener('close',()=>{$('previewBody').querySelectorAll('audio,video').forEach(e=>e.pause());$('previewBody').replaceChildren();if(previewUrl)URL.revokeObjectURL(previewUrl);previewUrl=null;});
function renderSequences(){
  $('sequences').replaceChildren();if(!sequences.length)$('sequences').append(node('div','Crie uma sequência com seus áudios, textos e mídias.','empty'));
  for(const seq of sequences){const card=node('article',undefined,'card');card.append(node('span',`${seq.steps.length} etapas`,'tag'),node('h3',seq.name));card.append(node('p',seq.steps.map((s,i)=>`${i+1}. ${items.find(x=>x.id===s.id)?.name||'Item excluído'}${s.delay?' · esperar '+s.delay+'s':''}`).join('\n')));
    const actions=node('div',undefined,'actions');actions.append(button('Editar',()=>openSequence(seq)),button('Excluir',async()=>{if(confirm(`Excluir a sequência “${seq.name}”?`)){try{await request('/sequences/'+seq.id,{method:'DELETE'});await loadSequences();}catch(e){notify(e.message,'error');}}},'danger'),button('Iniciar',()=>sendSteps(seq.steps,seq.name),'send'));card.append(actions);$('sequences').append(card);}
  enableSends();
}
function addStep(step={delay:0}){if($('steps').children.length>=30)return;const row=node('div',undefined,'step'),select=node('select');select.setAttribute('aria-label','Resposta desta etapa');for(const item of items)select.add(new Option(`${kindLabel[item.kind||'voice']} · ${item.name}`,item.id));if(step.id)select.value=step.id;const delay=node('input');delay.type='number';delay.min='0';delay.max='3600';delay.value=step.delay;delay.required=true;delay.setAttribute('aria-label','Espera antes da etapa, em segundos');const line=node('div',undefined,'split');line.append(node('small','Esperar (s)'),delay,button('↑',()=>{if(row.previousElementSibling)row.before(row.previousElementSibling);}),button('↓',()=>{if(row.nextElementSibling)row.after(row.nextElementSibling);}),button('×',()=>row.remove(),'danger'));row.append(select,line);$('steps').append(row);}
function openSequence(seq=null){if(!items.length){notify('Salve pelo menos uma resposta antes de criar uma sequência.','error');return;}editingSequence=seq;$('sequenceName').value=seq?.name||'';$('sequenceError').textContent='';$('steps').replaceChildren();(seq?.steps||[{delay:0}]).forEach(addStep);$('sequenceDialog').showModal();}
$('sequenceForm').onsubmit=async e=>{e.preventDefault();const steps=[...$('steps').children].map(r=>({id:r.querySelector('select').value,delay:Number(r.querySelector('input').value)}));if(!steps.length||steps.some(s=>!s.id||!Number.isFinite(s.delay)||s.delay<0||s.delay>3600)){$('sequenceError').textContent='Preencha todas as etapas e use esperas de 0 a 3600 segundos.';return;}const seq={id:editingSequence?.id||crypto.randomUUID(),name:$('sequenceName').value.trim(),steps};if(!seq.name)return;try{await request('/sequences',{method:'POST',body:seq});await loadSequences();$('sequenceDialog').close();notify('Sequência salva online.');}catch(e){$('sequenceError').textContent=e.message;}};
async function sendSteps(steps,label){
 if(sending)return;sending=true;enableSends();
 try{
  await context();const target=destination(),key=tracker.key,stamp=contextStamp;
  if(!target)throw new Error('Aguarde a identificação da conversa aberta.');
  if(!account)throw new Error('Conecte sua conta primeiro.');
  if(steps.length>1&&!confirm(`Iniciar “${label}” (${steps.length} etapas) para ${target.name}?\nRemetente: ${account.name}.\nA sequência continuará para essa pessoa se você trocar de conversa.`))return;
  const current=await browserContext();if(current.stamp!==stamp||current.key!==key){await context();throw new Error('A conversa mudou. Confira o destinatário e clique novamente.');}
  const {job}=await request('/jobs',{method:'POST',body:{requestId:crypto.randomUUID(),dialogId:target.id,peerKey:key,steps,label}});
  jobStates.set(job.id,'running');notify(`Enviando para ${target.name}…`,'busy');await loadJobs();
 }catch(e){notify(e.message,'error');}finally{sending=false;enableSends();}
}
let jobStates=new Map(),lastJobsPoll=0;
async function loadJobs(){const data=await request('/jobs');jobs=data.jobs;$('jobs').replaceChildren();if(!jobs.length)$('jobs').append(node('div','Os envios desta sessão aparecerão aqui.','empty'));
  for(const job of [...jobs].reverse()){
    const old=jobStates.get(job.id);jobStates.set(job.id,job.state);
    const target=job.targetName||job.dialogId;
    if(old==='running'&&job.state!=='running')notify(job.state==='done'?`Enviado para ${target}: ${job.sent}/${job.total}.`:job.state==='error'?`Falha no envio para ${target}: ${job.error}`:`Sequência interrompida: ${job.sent}/${job.total} enviados.`,job.state==='error'?'error':'');
    const card=node('article',undefined,'card');card.append(node('span',job.phase,'tag'),node('h3',target),node('p',`${job.label||'Envio'} · ${job.sent}/${job.total} confirmados`));if(job.error)card.append(node('p',job.error,'error'));
    if(job.messageIds.length)card.append(node('small','Mensagens: '+job.messageIds.join(', ')));
    if(job.state==='running')card.append(button('Parar sequência',async()=>{try{await request('/jobs/'+job.id+'/cancel',{method:'POST'});await loadJobs();}catch(e){notify(e.message,'error');}},'danger'));
    $('jobs').append(card);
  }
}
async function authStatus(){
  const status=await request('/auth/status');account=status.authorized?status.me:null;
  $('offline').hidden=true;$('auth').hidden=!!account;$('main').hidden=!account;
  if(account){$('account').textContent=`${account.name}${account.username?' · @'+account.username:''} · ${account.id}`;return true;}
  const state=status.state||'idle';$('phoneRow').hidden=!['idle','error'].includes(state);$('codeRow').hidden=state!=='need_code';$('passwordRow').hidden=state!=='need_password';
  $('authMessage').textContent=status.lastError||(state==='starting'?'Conectando… Aguarde.':state==='need_code'?'Digite o código recebido no seu Telegram.':state==='need_password'?'Digite sua senha de verificação em duas etapas.':'Use a mesma conta aberta no Telegram Web.');return false;
}
async function boot(){if(loading)return;loading=true;ready=false;tracker.change(null);showDestination();if(!connection.url){$('offline').hidden=false;$('main').hidden=true;$('auth').hidden=true;notify('Conecte sua instalação online para começar.');loading=false;return;}try{notify('Conectando… Após inatividade, a hospedagem gratuita pode levar cerca de um minuto para iniciar.','busy');const h=await request('/health');if(h.version!=='3.0.1')throw new Error('O endereço informado não está rodando a versão 3.0. Confira a publicação.');if(await authStatus()){await Promise.all([loadItems(),loadSequences(),loadJobs()]);ready=true;await context(true);notify('Pronto para atender. Abra uma conversa e envie.');}else notify('Conecte sua conta para começar.');}catch(e){$('offline').hidden=false;$('main').hidden=true;$('auth').hidden=true;notify(e.message,'error');}finally{loading=false;}}
async function authAction(path,body){if(authBusy)return;authBusy=true;try{await request(path,{method:'POST',body});$('code').value='';$('password').value='';await authStatus();}catch(e){notify(e.message,'error');}finally{authBusy=false;}}
$('login').onclick=()=>authAction('/auth/start',{phone:$('phone').value});$('confirmCode').onclick=()=>authAction('/auth/code',{code:$('code').value});$('confirmPassword').onclick=()=>authAction('/auth/password',{password:$('password').value});
function openSettings(){ $('apiUrl').value=connection.url||'';$('accessToken').value=connection.token||'';$('settingsError').textContent='';$('settingsDialog').showModal(); }
$('settings').onclick=openSettings;$('setup').onclick=openSettings;$('closeSettings').onclick=()=>$('settingsDialog').close();
$('settingsForm').onsubmit=async e=>{
 e.preventDefault();const submit=$('saveSettings');submit.disabled=true;
 try{
  const url=new URL($('apiUrl').value.trim()),token=$('accessToken').value.trim();
  if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.pathname!=='/')throw new Error('Use um endereço HTTPS sem caminho, por exemplo https://atendimento.seudominio.com');
  if(token.length<32)throw new Error('Confira a chave de acesso completa.');
  const granted=await chrome.permissions.request({origins:[url.origin+'/*']});if(!granted)throw new Error('Autorize o acesso a esse endereço para conectar.');
  connection={url:url.origin,token};await chrome.storage.local.set({connection});$('settingsDialog').close();await boot();
 }catch(e){$('settingsError').textContent=e.message;}finally{submit.disabled=false;}
};
$('favorites').onclick=()=>{onlyFavorites=!onlyFavorites;$('favorites').classList.toggle('active',onlyFavorites);renderItems();};
for(const b of document.querySelectorAll('[data-kind]'))b.onclick=()=>{$('kindFilter').value=b.dataset.kind;document.querySelectorAll('[data-kind]').forEach(x=>x.classList.toggle('active',x===b));renderItems();};
for(const id of ['search','category','kindFilter'])$(id).addEventListener(id==='search'?'input':'change',renderItems);
$('newItem').onclick=()=>openItem();$('itemKind').onchange=setItemKind;$('closeItem').onclick=()=>$('itemDialog').close();$('newSequence').onclick=()=>openSequence();$('addStep').onclick=()=>addStep();$('closeSequence').onclick=()=>$('sequenceDialog').close();$('closePreview').onclick=()=>$('previewDialog').close();$('reload').onclick=boot;$('retry').onclick=boot;
for(const b of document.querySelectorAll('nav button'))b.onclick=()=>{for(const tab of ['library','sequences','history'])$(tab+'Tab').hidden=b.dataset.tab!==tab;document.querySelectorAll('nav button').forEach(x=>x.classList.toggle('selected',x===b));};
setInterval(async()=>{if(pollBusy||loading)return;pollBusy=true;try{if(ready){await context();if(Date.now()-lastJobsPoll>3000){lastJobsPoll=Date.now();await loadJobs();}}else if(!$('auth').hidden&&!authBusy){if(await authStatus())await boot();}}catch(e){notify(e.message,'error');}finally{pollBusy=false;}},800);
await boot();
