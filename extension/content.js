(() => {
  const HOST_ID = 'telegram-atendimento-5-audio-bar';
  const LEGACY_HOST_ID = 'telegram-atendimento-4-audio-bar';
  const legacyHost = document.getElementById(LEGACY_HOST_ID);
  if (legacyHost) {
    legacyHost.remove();
    // 4.0 reserved space through an inline expression. Remove only that
    // exact shape when the extension is updated without reloading Telegram.
    document.querySelectorAll('.chat').forEach(chat => {
      const value = chat.style.getPropertyValue('--chat-padding-bottom').trim();
      if (/^calc\(var\(--chat-input-height\) \+ var\(--page-chats-padding\) \+ var\(--chat-input-height-surplus\) \+ \d+(?:\.\d+)?px\)$/.test(value)) {
        chat.style.removeProperty('--chat-padding-bottom');
      }
    });
  }
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
  host.dataset.version = '5.0.0';
  host.style.cssText = 'position:relative;display:none;width:100%;flex:0 0 auto;z-index:2147483646;pointer-events:auto;box-sizing:border-box;padding:0 0 4px;';
  const root = host.attachShadow({mode:'open'});
  root.innerHTML = `<style>
    :host{all:initial;color-scheme:dark;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    *{box-sizing:border-box}
    button{font:600 11px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;border:0;cursor:pointer;white-space:nowrap}
    .bar{display:flex;align-items:center;gap:7px;min-height:52px;width:100%;max-width:var(--chat-input-max-width,720px);margin:5px auto 0;padding:7px 9px;border:1px solid #30363c;border-radius:11px;background:#202428;box-shadow:0 7px 22px rgba(0,0,0,.34);color:#f2f5f7;overflow:hidden}
    .dashboard{display:inline-flex;align-items:center;justify-content:center;gap:5px;height:38px;padding:0 10px;border-radius:9px;flex:0 0 auto;color:#fff;background:#30363b;box-shadow:inset 0 0 0 1px rgba(255,255,255,.06)}
    .dashboard:hover{background:#3b444b}.dashboard:active{transform:scale(.97)}.dashboard:disabled{opacity:.58;cursor:wait}
    .dashboard svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
    .scroll-control{display:grid;place-items:center;width:34px;height:38px;padding:0;border-radius:9px;flex:0 0 auto;color:#fff;background:linear-gradient(145deg,#7357ff 8%,#1689ed 88%);box-shadow:0 5px 13px rgba(31,105,226,.28)}
    .scroll-control:hover{filter:brightness(1.12)}.scroll-control:active{transform:scale(.96)}.scroll-control:disabled{opacity:.32;cursor:default;filter:none}
    .scroll-control svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:2.3;stroke-linecap:round;stroke-linejoin:round}
    .items{display:flex;align-items:center;gap:7px;min-width:0;flex:1;overflow-x:auto;scroll-behavior:smooth;scrollbar-width:thin;scrollbar-color:#615be1 transparent;padding:1px 0 5px;user-select:none;touch-action:pan-y;cursor:grab}
    .items.dragging{scroll-behavior:auto;cursor:grabbing}
    .items::-webkit-scrollbar{height:4px}.items::-webkit-scrollbar-track{background:transparent}.items::-webkit-scrollbar-thumb{background:#615be1;border-radius:4px}
    .audio{display:inline-flex;align-items:center;gap:7px;flex:0 0 auto;width:max-content;max-width:none;height:38px;padding:0 13px;border-radius:8px;background:#075c7c;color:#23c9ff;box-shadow:inset 0 0 0 1px rgba(39,199,255,.08);transition:background .15s,transform .12s,color .15s;overflow:visible}
    .audio:hover{background:#087399;color:#6edcff}.audio:active{transform:scale(.98)}.audio:disabled{opacity:.58;cursor:wait}
    .audio-icon{display:grid;place-items:center;flex:0 0 auto}.audio-icon svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
    .audio-label{display:block;overflow:visible;text-overflow:clip;max-width:none;white-space:nowrap}
    .message{max-width:160px;font-size:10px;color:#9da7ae;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:0 4px}
    .message.error{color:#ff858f}.message.success{color:#66d7a5}.setup{height:36px;color:#4bcfff;background:#30363b;border-radius:8px;padding:0 12px}
    [hidden]{display:none!important}
    @media (max-width:700px){.message{display:none}.scroll-control{width:31px}.dashboard{padding:0 9px}.dashboard-label{display:none}}
  </style>
  <div class="bar" role="region" aria-label="Áudios de atendimento">
    <button class="dashboard" type="button" title="Abrir dashboard" aria-label="Abrir dashboard"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/></svg><span class="dashboard-label">Dashboard</span></button>
    <button class="scroll-control previous" type="button" title="Áudios anteriores" aria-label="Mostrar áudios anteriores" hidden><svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg></button>
    <div class="items"></div>
    <button class="scroll-control next" type="button" title="Próximos áudios" aria-label="Mostrar próximos áudios" hidden><svg viewBox="0 0 24 24"><path d="m9 18 6-6-6-6"/></svg></button>
    <span class="message" aria-live="polite"></span>
  </div>`;

  document.documentElement.append(host);

  const bar = root.querySelector('.bar');
  const dashboardButton = root.querySelector('.dashboard');
  const itemsElement = root.querySelector('.items');
  const messageElement = root.querySelector('.message');
  const previousButton = root.querySelector('.previous');
  const nextButton = root.querySelector('.next');
  const state = {key:null,target:null,stamp:'',generation:0,configured:false,items:[],loading:false,error:''};
  const inFlight = new Map();
  const feedback = new Map();
  let scheduledPosition = false;
  let libraryBusy = false;
  let jobsBusy = false;
  let configurationBusy = false;
  let reservedChat = null;
  let reservedDockPadding = null;
  let previousChatPadding = '';
  let previousChatPaddingPriority = '';
  let baseChatPadding = '';
  let appliedChatPadding = '';
  let usingChatPaddingFallback = false;
  let reservationObserver = null;
  let reservationApplying = false;

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

  function clearChatReserve() {
    reservationObserver?.disconnect();
    reservationObserver = null;
    reservedDockPadding?.remove();
    if (usingChatPaddingFallback && reservedChat?.isConnected) {
      if (previousChatPadding) reservedChat.style.setProperty('--chat-padding-bottom', previousChatPadding, previousChatPaddingPriority);
      else reservedChat.style.removeProperty('--chat-padding-bottom');
    }
    reservedChat = null;
    reservedDockPadding = null;
    previousChatPadding = '';
    previousChatPaddingPriority = '';
    baseChatPadding = '';
    appliedChatPadding = '';
    usingChatPaddingFallback = false;
  }

  function messageScroller(chat) {
    const preferred = chat.querySelector('.bubbles-scrollable');
    if (preferred) return preferred;
    return [...chat.querySelectorAll('.scrollable, .bubbles')]
      .find(element => element.scrollHeight > element.clientHeight || /auto|scroll/i.test(getComputedStyle(element).overflowY)) || null;
  }

  function preserveScrollAfterReserve(scroller, wasNearBottom) {
    if (!scroller || !wasNearBottom) return;
    requestAnimationFrame(() => {
      if (!scroller.isConnected) return;
      const maxScrollTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
      if (scroller.scrollTop < maxScrollTop - 2) scroller.scrollTop = maxScrollTop;
    });
  }

  function reserveMessageSpace(telegramInput) {
    const chat = telegramInput.closest('.chat');
    if (!chat) {clearChatReserve();return;}
    if (reservedChat !== chat) {
      clearChatReserve();
      reservedChat = chat;
      previousChatPadding = chat.style.getPropertyValue('--chat-padding-bottom');
      previousChatPaddingPriority = chat.style.getPropertyPriority('--chat-padding-bottom');
      baseChatPadding = previousChatPadding.trim() || getComputedStyle(chat).getPropertyValue('--chat-padding-bottom').trim() || '0px';
    }
    const scroller = messageScroller(chat);
    const nearBottom = scroller ? scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 180 : false;
    const dockHeight = Math.max(48, Math.ceil(host.getBoundingClientRect().height || 61));
    const bottomPadding = chat.querySelector('.bubbles-padding-bottom');

    if (scroller && usingChatPaddingFallback) {
      reservationApplying = true;
      if (previousChatPadding) chat.style.setProperty('--chat-padding-bottom', previousChatPadding, previousChatPaddingPriority);
      else chat.style.removeProperty('--chat-padding-bottom');
      reservationApplying = false;
      appliedChatPadding = '';
      usingChatPaddingFallback = false;
    }

    if (scroller) {
      let dockChanged = false;
      const spacerParent = bottomPadding?.parentElement || scroller;
      const spacerNeedsRebuild = !reservedDockPadding?.isConnected ||
        reservedDockPadding.parentElement !== spacerParent ||
        (!!bottomPadding && reservedDockPadding.previousElementSibling !== bottomPadding);
      if (spacerNeedsRebuild) {
        reservedDockPadding?.remove();
        reservedDockPadding = document.createElement('div');
        reservedDockPadding.className = 'telegram-atendimento-5-bottom-reserve';
        reservedDockPadding.setAttribute('aria-hidden', 'true');
        reservedDockPadding.style.cssText = 'width:100%;height:0;flex:0 0 auto;pointer-events:none;';
        if (bottomPadding?.parentElement === spacerParent) bottomPadding.after(reservedDockPadding);
        else spacerParent.append(reservedDockPadding);
        dockChanged = true;
      }
      const targetHeightText = `${dockHeight}px`;
      if (reservedDockPadding.style.height !== targetHeightText) {
        reservedDockPadding.style.height = targetHeightText;
        dockChanged = true;
      }
      preserveScrollAfterReserve(scroller, nearBottom && dockChanged);
    } else {
      reservedDockPadding?.remove();
      reservedDockPadding = null;
      // Fallback for older Telegram Web layouts without a scrollable message container.
      const padding = `calc(${baseChatPadding} + ${dockHeight}px)`;
      usingChatPaddingFallback = true;
      if (appliedChatPadding !== padding || chat.style.getPropertyValue('--chat-padding-bottom') !== padding) {
        reservationApplying = true;
        chat.style.setProperty('--chat-padding-bottom', padding);
        reservationApplying = false;
        appliedChatPadding = padding;
      }
      preserveScrollAfterReserve(scroller, nearBottom);
    }

    if (!reservationObserver) {
      reservationObserver = new MutationObserver(() => {
        if (!reservationApplying) schedulePosition();
      });
      reservationObserver.observe(chat, {attributes:true, attributeFilter:['style','class']});
    }
  }

  function updateScroller() {
    const overflow = itemsElement.scrollWidth - itemsElement.clientWidth > 3;
    previousButton.hidden = !overflow;
    nextButton.hidden = !overflow;
    if (!overflow) return;
    const max = Math.max(0, itemsElement.scrollWidth - itemsElement.clientWidth);
    previousButton.disabled = itemsElement.scrollLeft <= 2;
    nextButton.disabled = itemsElement.scrollLeft >= max - 2;
  }

  function positionBar() {
    scheduledPosition = false;
    if (host.style.display === 'none') return;
    const composer = findComposer();
    if (!composer || !state.key) {host.style.display = 'none';clearChatReserve();return;}
    const telegramInput = composer.closest('.chat-input');
    if (telegramInput) {
      if (host.parentElement !== telegramInput) telegramInput.append(host);
      host.style.position = 'relative';
      host.style.left = 'auto';
      host.style.top = 'auto';
      host.style.width = '100%';
      reserveMessageSpace(telegramInput);
      return;
    }
    clearChatReserve();
    const rect = composer.getBoundingClientRect();
    const maxRight = window.innerWidth - 8;
    const availableWidth = Math.max(210, maxRight - rect.left);
    const width = Math.max(210, Math.min(rect.width, availableWidth));
    const left = Math.max(8, Math.min(rect.left, maxRight - width));
    const barHeight = bar.getBoundingClientRect().height || 52;
    const top = Math.max(6, rect.top - barHeight - 5);
    host.style.position = 'fixed';
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
    const previousScroll = itemsElement.scrollLeft;
    itemsElement.replaceChildren();
    if (!state.key || !findComposer()) {host.style.display = 'none';clearChatReserve();return;}
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
        const icon=document.createElement('span');icon.className='audio-icon';icon.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="3" width="8" height="13" rx="4"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6"/></svg>';const label=document.createElement('span');label.className='audio-label';label.textContent=item.name;button.append(icon,label);button.onclick=()=>sendItem(item);itemsElement.append(button);
      }
    }
    requestAnimationFrame(()=>{itemsElement.scrollLeft=previousScroll;updateScroller();});
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

  dashboardButton.onclick=async()=>{
    dashboardButton.disabled=true;
    try {
      const result=await chrome.runtime.sendMessage({type:'open-dashboard'});
      if (!result?.ok) setMessage(result?.error || 'Não foi possível abrir o dashboard.','error');
    } catch (error) {setMessage(error.message || 'Não foi possível abrir o dashboard.','error');}
    finally {dashboardButton.disabled=false;}
  };
  previousButton.onclick=()=>itemsElement.scrollBy({left:-Math.max(180,itemsElement.clientWidth*.72),behavior:'smooth'});
  nextButton.onclick=()=>itemsElement.scrollBy({left:Math.max(180,itemsElement.clientWidth*.72),behavior:'smooth'});
  itemsElement.addEventListener('scroll',updateScroller,{passive:true});
  itemsElement.addEventListener('wheel',event=>{
    if(Math.abs(event.deltaY)<=Math.abs(event.deltaX))return;
    event.preventDefault();itemsElement.scrollLeft+=event.deltaY;
  },{passive:false});
  const dragState={pointerId:null,startX:0,startScroll:0,moved:false,suppressClick:false};
  itemsElement.addEventListener('pointerdown',event=>{
    if (event.pointerType==='mouse'&&event.button!==0) return;
    if (itemsElement.scrollWidth-itemsElement.clientWidth<=3) return;
    dragState.pointerId=event.pointerId;dragState.startX=event.clientX;dragState.startScroll=itemsElement.scrollLeft;dragState.moved=false;
    itemsElement.classList.add('dragging');
    try {itemsElement.setPointerCapture(event.pointerId);} catch {}
  });
  itemsElement.addEventListener('pointermove',event=>{
    if (dragState.pointerId!==event.pointerId) return;
    const distance=event.clientX-dragState.startX;
    if (Math.abs(distance)>5) dragState.moved=true;
    if (!dragState.moved) return;
    event.preventDefault();itemsElement.scrollLeft=dragState.startScroll-distance;
  },{passive:false});
  const finishDrag=event=>{
    if (dragState.pointerId!==event.pointerId) return;
    const moved=dragState.moved;
    try {if (itemsElement.hasPointerCapture(event.pointerId)) itemsElement.releasePointerCapture(event.pointerId);} catch {}
    dragState.pointerId=null;dragState.moved=false;itemsElement.classList.remove('dragging');
    if (moved) {
      dragState.suppressClick=true;
      setTimeout(()=>{dragState.suppressClick=false;},0);
    }
  };
  itemsElement.addEventListener('pointerup',finishDrag);
  itemsElement.addEventListener('pointercancel',finishDrag);
  itemsElement.addEventListener('click',event=>{
    if (!dragState.suppressClick) return;
    event.preventDefault();event.stopPropagation();dragState.suppressClick=false;
  },true);
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
