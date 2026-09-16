const $=id=>document.getElementById(id);
let connection=JSON.parse(localStorage.getItem('telegramDashboardConnection')||'{}');
let items=[],editing=null,onlyFavorites=false,previewUrl=null,busy=false;

function notify(message,type=''){
 const el=$('notice');el.textContent=message;el.className='notice '+type;el.hidden=!message;
}
function setConnected(connected){
 const badge=$('connectionBadge');badge.classList.toggle('offline',!connected);badge.innerHTML=`<i></i> ${connected?'Conectado':'Desconectado'}`;
 $('library').hidden=!connected;$('setupCard').hidden=connected;
}
async function request(path,{method='GET',body,blob=false,timeout=30000}={}){
 if(!connection.url||!connection.token)throw new Error('Configure a conexão do dashboard.');
 const headers={Authorization:'Bearer '+connection.token};
 if(body&&!(body instanceof FormData)){headers['Content-Type']='application/json';body=JSON.stringify(body);}
 let response;
 try{response=await fetch(connection.url+path,{method,headers,body,signal:AbortSignal.timeout(timeout)});}
 catch{throw new Error('O backend não respondeu. Confira o endereço, o Render e a autorização do dashboard.');}
 if(!response.ok){const data=await response.json().catch(()=>({}));throw new Error(data.error||`Erro ${response.status}`);}
 return blob?response.blob():response.json();
}
async function boot(){
 if(!connection.url||!connection.token){setConnected(false);return;}
 notify('Conectando ao servidor…','busy');
 try{await request('/health',{timeout:120000});await loadItems();setConnected(true);notify('Biblioteca atualizada.');}
 catch(error){setConnected(false);notify(error.message,'error');}
}
async function loadItems(){items=(await request('/library')).items.filter(item=>(item.kind||'voice')==='voice');render();}
function render(){
 const categories=[...new Set(items.map(item=>item.category||'Geral'))].sort((a,b)=>a.localeCompare(b,'pt-BR'));
 const current=$('category').value;$('category').replaceChildren(new Option('Todas as categorias',''));
 $('categories').replaceChildren();for(const category of categories){$('category').add(new Option(category,category));$('categories').append(new Option(category,category));}
 $('category').value=categories.includes(current)?current:'';
 $('totalCount').textContent=items.length;$('favoriteCount').textContent=items.filter(item=>item.favorite).length;$('categoryCount').textContent=categories.length;
 const query=$('search').value.trim().toLocaleLowerCase('pt-BR'),category=$('category').value;
 const filtered=items.filter(item=>(!query||`${item.name} ${item.category||''}`.toLocaleLowerCase('pt-BR').includes(query))&&(!category||(item.category||'Geral')===category)&&(!onlyFavorites||item.favorite)).sort((a,b)=>Number(!!b.favorite)-Number(!!a.favorite)||a.name.localeCompare(b.name,'pt-BR'));
 $('items').replaceChildren();
 if(!filtered.length){const empty=document.createElement('div');empty.className='empty';empty.innerHTML=`<strong>${items.length?'Nenhum áudio encontrado':'Sua biblioteca está vazia'}</strong><span>${items.length?'Altere os filtros para ver outros resultados.':'Clique em “Novo áudio” para adicionar o primeiro.'}</span>`;$('items').append(empty);return;}
 for(const item of filtered){
  const card=document.createElement('article');card.className='audio-card';
  const play=iconButton('▶','Ouvir '+item.name,()=>preview(item));play.className='play';
  const info=document.createElement('div');info.className='audio-info';const title=document.createElement('h3');title.textContent=(item.favorite?'★ ':'')+item.name;
  const meta=document.createElement('p');meta.textContent=`${item.category||'Geral'}${item.duration?' · '+formatDuration(item.duration):''}`;info.append(title,meta);
  const actions=document.createElement('div');actions.className='card-actions';actions.append(iconButton(item.favorite?'★':'☆',item.favorite?'Remover dos favoritos':'Adicionar aos favoritos',()=>favorite(item)),iconButton('✎','Editar '+item.name,()=>openItem(item)),iconButton('⌫','Excluir '+item.name,()=>removeItem(item),'danger'));
  card.append(play,info,actions);$('items').append(card);
 }
}
function iconButton(text,label,action,extra=''){const button=document.createElement('button');button.type='button';button.className='icon-button '+extra;button.textContent=text;button.title=label;button.setAttribute('aria-label',label);button.onclick=action;return button;}
function formatDuration(seconds){const value=Math.max(0,Number(seconds)||0),minutes=Math.floor(value/60),rest=Math.round(value%60);return minutes?`${minutes}:${String(rest).padStart(2,'0')}`:`${rest}s`;}
function openSettings(){$('apiUrl').value=connection.url||'';$('accessToken').value=connection.token||'';$('settingsError').textContent='';$('settingsDialog').showModal();}
function openItem(item=null){editing=item;$('itemTitle').textContent=item?'Editar áudio':'Novo áudio';$('itemName').value=item?.name||'';$('itemCategory').value=item?.category||'Geral';$('itemFile').value='';$('fileRow').hidden=!!item;$('selectedFile').hidden=true;$('itemError').textContent='';$('saveItem').textContent=item?'Salvar alterações':'Salvar áudio';$('itemDialog').showModal();}
async function favorite(item){try{await request('/library/'+item.id,{method:'PATCH',body:{favorite:!item.favorite}});await loadItems();notify(item.favorite?'Removido dos favoritos.':'Adicionado aos favoritos.');}catch(error){notify(error.message,'error');}}
async function removeItem(item){if(!confirm(`Excluir o áudio “${item.name}”? Esta ação não pode ser desfeita.`))return;try{await request('/library/'+item.id,{method:'DELETE'});await loadItems();notify('Áudio excluído.');}catch(error){notify(error.message,'error');}}
async function preview(item){$('previewTitle').textContent=item.name;$('previewBody').innerHTML='<p class="loading">Carregando áudio…</p>';$('previewDialog').showModal();try{const blob=await request('/library/'+item.id+'/preview',{blob:true});previewUrl=URL.createObjectURL(blob);const audio=document.createElement('audio');audio.controls=true;audio.autoplay=true;audio.src=previewUrl;$('previewBody').replaceChildren(audio);}catch(error){$('previewBody').textContent=error.message;}}
function closePreview(){$('previewBody').querySelector('audio')?.pause();$('previewDialog').close();if(previewUrl)URL.revokeObjectURL(previewUrl);previewUrl=null;}

$('settingsForm').onsubmit=async event=>{event.preventDefault();const submit=$('saveSettings');submit.disabled=true;$('settingsError').textContent='';try{const url=new URL($('apiUrl').value.trim()),token=$('accessToken').value.trim();if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||url.pathname!=='/')throw new Error('Use a URL HTTPS do Render sem caminho no final.');if(token.length<32)throw new Error('Confira o ACCESS_TOKEN completo.');connection={url:url.origin,token};localStorage.setItem('telegramDashboardConnection',JSON.stringify(connection));$('settingsDialog').close();await boot();}catch(error){$('settingsError').textContent=error.message;}finally{submit.disabled=false;}};
$('itemForm').onsubmit=async event=>{event.preventDefault();if(busy)return;busy=true;const submit=$('saveItem');submit.disabled=true;$('itemError').textContent='';try{const name=$('itemName').value.trim(),category=$('itemCategory').value.trim()||'Geral';if(editing)await request('/library/'+editing.id,{method:'PATCH',body:{name,category}});else{const file=$('itemFile').files[0];if(!file)throw new Error('Selecione um arquivo de áudio.');if(file.size>50*1024*1024)throw new Error('O arquivo excede 50 MB.');const form=new FormData();form.append('kind','voice');form.append('name',name);form.append('category',category);form.append('file',file);notify('Enviando e convertendo o áudio…','busy');await request('/library',{method:'POST',body:form,timeout:300000});}$('itemDialog').close();await loadItems();notify(editing?'Áudio atualizado.':'Áudio salvo e disponível na extensão.');}catch(error){$('itemError').textContent=error.message;notify(error.message,'error');}finally{busy=false;submit.disabled=false;}};
$('itemFile').onchange=()=>{const file=$('itemFile').files[0];$('selectedFile').hidden=!file;$('selectedFile').textContent=file?`${file.name} · ${(file.size/1024/1024).toFixed(1)} MB`:'';};
$('search').oninput=render;$('category').onchange=render;$('favorites').onclick=()=>{onlyFavorites=!onlyFavorites;$('favorites').classList.toggle('active',onlyFavorites);render();};
$('reload').onclick=async()=>{try{notify('Atualizando…','busy');await loadItems();notify('Biblioteca atualizada.');}catch(error){notify(error.message,'error');}};
$('newItem').onclick=()=>openItem();$('openSettings').onclick=openSettings;$('setupButton').onclick=openSettings;$('closeSettings').onclick=()=>$('settingsDialog').close();$('closeItem').onclick=()=>$('itemDialog').close();$('closePreview').onclick=closePreview;$('previewDialog').addEventListener('close',()=>{if(previewUrl){URL.revokeObjectURL(previewUrl);previewUrl=null;}});
await boot();
