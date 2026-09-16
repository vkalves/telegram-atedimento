(() => {
  const HOST_ID = 'telegram-atendimento-4-audio-bar';
  if (document.getElementById(HOST_ID)) return;

  function peerFromURL(href) {
    try {
      const url = new URL(href);
      if (url.origin !== 'https://web.telegram.org' || !/^\/(a|k)\/?$/.test(url.pathname)) return null;
      const hash = decodeURIComponent(url.hash.slice(1));
      return /^(?:[1-9]\d{0,19}|@[A-Za-z0-9_]{5,32})$/.test(hash) ? hash : null;
    } catch { return null; }
  }

  const host = document.createElement('div');
  host.id = HOST_ID;
  host.style.cssText = 'position:fixed;display:none;z-index:2147483646;pointer-events:auto;box-sizing:border-box;';
  const root = host.attachShadow({mode:'open'});
  root.innerHTML = `<style>
    :host{all:initial;color-scheme:light;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    *{box-sizing:border-box}
    .bar{display:flex;align-items:center;gap:7px;min-height:42px;width:100%;padding:5px 7px;border:1px solid #d9e1e8;border-radius:10px;background:rgba(255,255,255,.98);box-shadow:0 5px 18px rgba(26,44,61,.18);color:#263746;overflow:hidden}
    .title{display:flex;align-items:center;gap:5px;flex:0 0 auto;font-size:10px;font-weight:700;letter-spacing:.15px;color:#6c7d8c;white-space:nowrap}
    .dot{width:6px;height:6px;border-radius:50%;background:#36a8f4;box-shadow:0 0 0 3px rgba(54,168,244,.14)}
    .items{display:flex;align-items:center;gap:5px;min-width:0;flex:1;overflow-x:auto;scrollbar-width:none;padding:1px 0}
    .items::-webkit-scrollbar{display:none}
    button{font:600 11px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;border:0;cursor:pointer;white-space:nowrap}
    .audio{display:inline-flex;align-items:center;gap:5px;max-width:170px;min-height:29px;padding:0 10px;border-radius:15px;background:#edf6fe;color:#2787c8;overflow:hidden;text-overflow:ellipsis}
    .audio:hover{background:#dfeffc}.audio:active{transform:scale(.98)}.audio:disabled{opacity:.65;cursor:wait}
    .audio-label{overflow:hidden;text-overflow:ellipsis;max-width:130px}
    .utility{width:27px;height:27px;padding:0;border-radius:50%;background:transparent;color:#81909d;font-size:17px;flex:0 0 auto}
    .utility:hover{background:#eef3f7;color:#318ac7}
    .message{font-size:10px;color:#778692;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:0 3px}
    .message.error{color:#c54e56}.message.success{color:#249567}.setup{color:#2787c8;background:transparent;padding:5px 4px}
    @media (prefers-color-scheme:dark){
      .bar{border-color:#435363;background:rgba(36,49,61,.98);color:#e7eef4;box-shadow:0 5px 18px rgba(0,0,0,.35)}
      .title{color:#aab7c2}.audio{background:#263f52;color:#70c2fa}.audio:hover{background:#2e4d65}.utility{color:#9caeba}.utility:hover{background:#30404d;color:#70c2fa}.message{color:#aab7c2}.message.error{color:#ff8990}.message.success{color:#68d2a4}
    }
    :host([data-theme="dark"]){color-scheme:dark}
    :host([data-theme="light"]){color-scheme:light}
  </style><div class="bar" role="region" aria-label="Áudios de atendimento"><div class="title"><span class="dot"></span><span>Áudios</span></div><div class="items"></div><button class="utility refresh" type="button" title="Atualizar áudios" aria-label="Atualizar áudios">↻</button><span class="message" aria-live="polite"></span></div>`;

  document.documentElement.append(host);

  const bar = root.querySelector('.bar');
  const itemsElement = root.querySelector('.items');
  const messageElement = root.querySelector('.message');
  const refreshButton = root.querySelector('.refresh');
  const state = {key:null,target:null,stamp:'',generation:0,configured:false,items:[],loading:false,error:''};
  const inFlight = new Map();
  const feedback = new Map();
  let scheduledPosition = false;
  let libraryBusy = false;
  let jobsBusy = false;
  let configurationBusy = false;

  function isVisible(element) {
    const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
  }

  function findComposer() {
    const candidates = [...document.querySelectorAll('[contenteditable="true"],textarea')].filter(isVisible);
    let best = null, bestScore = -Infinity;
    for (const element of candidates) {
      const rect = element.getBoundingClientRect();
      if (rect.bottom < window.innerHeight * .35) continue;
      const context = [
        element.getAttribute('data-placeholder') || '',
        element.getAttribute('aria-label') || '',
        element.className || '',
        element.parentElement?.className || '',
        element.parentElement?.parentElement?.className || ''
      ].join(' ').toLowerCase();
      let score = rect.bottom > window.innerHeight * .7 ? 30 : 0;
      if (rect.width > 180) score += 10;
      if (/message|mensagem|escreva|write|compose|input-message/.test(context)) score += 100;
      if (/composer|footer|bottom|input-message/.test(context)) score += 40;
      if (element.tagName === 'TEXTAREA') score += 8;
      if (score > bestScore) {best = element;bestScore = score;}
    }
    return best;
  }

  function positionBar() {
    scheduledPosition = false;
    if (host.style.display === 'none') return;
    const composer = findComposer();
    if (!composer || !state.key) {host.style.display = 'none';return;}
    const rect = composer.getBoundingClientRect();
    const width = Math.max(210, Math.min(rect.width, window.innerWidth - 16));
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
    const barHeight = bar.getBoundingClientRect().height || 42;
    const top = Math.max(6, rect.top - barHeight - 5);
    host.style.left = `${left}px`;
    host.style.top = `${top}px`;
    host.style.width = `${width}px`;
  }

  function schedulePosition() {
    if (!scheduledPosition) {scheduledPosition = true;requestAnimationFrame(positionBar);}
  }

  function setMessage(text = '', type = '') {
    messageElement.textContent = text;
    messageElement.className = `message ${type}`.trim();
  }

  function currentFeedback() {
    const id = state.target?.id;
    const item = id ? feedback.get(id) : null;
    if (!item) return null;
    if (item.expiresAt && item.expiresAt < Date.now()) {feedback.delete(id);return null;}
    return item;
  }

  function render() {
    host.dataset.theme = document.documentElement.classList.contains('night') || document.documentElement.classList.contains('theme-dark') ? 'dark' : 'light';
    itemsElement.replaceChildren();
    if (!state.key || !findComposer()) {host.style.display = 'none';return;}
    host.style.display = 'block';
    const busy = state.target && inFlight.has(state.target.id);
    const note = currentFeedback();
    if (note) setMessage(note.text, note.type);
    else if (!state.configured) setMessage('Configure a extensão em Opções');
    else if (state.loading) setMessage('Carregando…');
    else if (state.error) setMessage(state.error, 'error');
    else if (!state.target) setMessage('Identificando…');
    else if (busy) setMessage('Enviando…', 'success');
    else if (!state.items.length) setMessage('Nenhum áudio ativo');
    else setMessage('');

    if (!state.configured) {
      const setup = document.createElement('button');setup.type='button';setup.className='setup';setup.textContent='Abrir Opções';setup.onclick=()=>chrome.runtime.sendMessage({type:'open-options'}).catch(()=>{});itemsElement.append(setup);
    } else if (state.error) {
      const retry = document.createElement('button');retry.type='button';retry.className='setup';retry.textContent='Tentar novamente';retry.onclick=()=>{state.error='';loadLibrary(true);syncContext(true);};itemsElement.append(retry);
    } else {
      for (const item of state.items) {
        const button = document.createElement('button');button.type='button';button.className='audio';button.title=`Enviar ${item.name}`;button.setAttribute('aria-label',`Enviar ${item.name}`);button.disabled=!state.target||!!busy;
        const icon=document.createElement('span');icon.textContent='▶';const label=document.createElement('span');label.className='audio-label';label.textContent=item.name;button.append(icon,label);button.onclick=()=>sendItem(item);itemsElement.append(button);
      }
    }
    refreshButton.disabled=state.loading||!state.configured;
    schedulePosition();
  }

  async function api(path, options = {}) {
    const response = await chrome.runtime.sendMessage({type:'api',path,method:options.method || 'GET',body:options.body});
    if (!response?.ok) throw new Error(response?.error || 'Não foi possível acessar a instalação.');
    return response.data;
  }

  async function loadLibrary(force = false) {
    if (libraryBusy || !state.configured) return;
    libraryBusy = true;
    if (force) state.loading = true;
    render();
    try {
      const data=await api('/library?kind=voice&active=true');
      state.items=(data.items || []).filter(item => (item.kind || 'voice') === 'voice' && item.active !== false && item.storedName);
      state.error='';
    } catch (error) {state.error=error.message;}
    finally {state.loading=false;libraryBusy=false;render();}
  }

  async function refreshRunningJob() {
    if (!state.target || !state.configured || inFlight.has(state.target.id)) return;
    try {
      const data=await api('/jobs');
      const job=(data.jobs || []).find(item=>item.dialogId===String(state.target.id)&&item.state==='running');
      if (job) inFlight.set(String(state.target.id),{jobId:job.id,label:job.label || 'Áudio',startedAt:Date.now()});
    } catch {}
    render();
  }

  async function reconcileJobs() {
    if (jobsBusy || !state.configured || !inFlight.size) return;
    jobsBusy=true;
    try {
      const data=await api('/jobs'), jobs=data.jobs || [];
      for (const [targetId, entry] of inFlight) {
        const job=jobs.find(item=>item.id===entry.jobId);
        if (job?.state === 'running') continue;
        if (!job) {
          if (Date.now()-entry.startedAt < 120000) continue;
          inFlight.delete(targetId);feedback.set(targetId,{text:'Não foi possível confirmar o envio.',type:'error',expiresAt:Date.now()+7000});continue;
        }
        inFlight.delete(targetId);
        feedback.set(targetId,job.state==='done'?{text:'Áudio enviado',type:'success',expiresAt:Date.now()+5000}:{text:job.error || 'Falha no envio',type:'error',expiresAt:Date.now()+8000});
      }
    } catch {}
    finally {jobsBusy=false;render();}
  }

  async function sendItem(item) {
    if (!state.target || inFlight.has(String(state.target.id))) return;
    const target=state.target,key=state.key,stamp=location.href;
    inFlight.set(String(target.id),{jobId:null,label:item.name,startedAt:Date.now()});render();
    try {
      const freshKey=peerFromURL(location.href);
      if (freshKey !== key || stamp !== location.href) throw new Error('A conversa mudou. Escolha o áudio novamente.');
      const data=await api('/jobs',{method:'POST',body:{requestId:crypto.randomUUID(),dialogId:String(target.id),peerKey:key,steps:[{id:item.id,delay:0}],label:item.name}});
      const job=data.job;
      if (!job?.id) throw new Error('O servidor não confirmou o envio.');
      inFlight.set(String(target.id),{jobId:job.id,label:item.name,startedAt:Date.now()});
      setMessage('Enviando…','success');
      void reconcileJobs();
    } catch (error) {
      inFlight.delete(String(target.id));feedback.set(String(target.id),{text:error.message,type:'error',expiresAt:Date.now()+8000});render();
    }
  }

  async function syncContext(force = false) {
    const stamp=location.href,key=peerFromURL(stamp);
    if (!force && stamp === state.stamp) return;
    state.stamp=stamp;state.key=key;state.target=null;state.error='';state.generation++;
    const generation=state.generation;render();
    if (!key || !state.configured) return;
    try {
      const data=await api('/context',{method:'POST',body:{peerKey:key}});
      if (generation !== state.generation) return;
      state.target=data.target;state.error='';render();await refreshRunningJob();
    } catch (error) {
      if (generation !== state.generation) return;
      state.error=error.message;render();
    }
  }

  async function boot() {
    const result=await chrome.runtime.sendMessage({type:'connection-status'}).catch(()=>({configured:false}));
    state.configured=!!result?.configured;
    render();
    if (state.configured) {await loadLibrary(true);await syncContext(true);}
    else await syncContext(true);
  }

  refreshButton.onclick=()=>loadLibrary(true);
  window.addEventListener('resize',schedulePosition,{passive:true});
  window.addEventListener('scroll',schedulePosition,{passive:true,capture:true});
  window.addEventListener('hashchange',()=>syncContext(true));
  window.addEventListener('popstate',()=>syncContext(true));
  const observer=new MutationObserver(()=>{schedulePosition();});
  observer.observe(document.body,{childList:true,subtree:true});
  setInterval(()=>syncContext(false),700);
  setInterval(()=>{if(document.visibilityState==='visible')loadLibrary(false);},30000);
  setInterval(()=>{if(document.visibilityState==='visible')reconcileJobs();},1500);
  setInterval(()=>{if(document.visibilityState==='visible')render();},2500);
  setInterval(async()=>{
    if(configurationBusy)return;configurationBusy=true;
    try{
      const result=await chrome.runtime.sendMessage({type:'connection-status'});
      if(!!result?.configured!==state.configured){state.configured=!!result?.configured;state.error='';render();if(state.configured){await loadLibrary(true);await syncContext(true);}}
    }catch{}finally{configurationBusy=false;}
  },10000);
  void boot();
})();
