(() => {
  const HOST_ID = 'telegram-atendimento-5-audio-bar';
  const VERSION = '6.1.0';
  const CONTEXT_RETRY_DELAYS = [1200, 3000, 7000];
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
  const existingHost = document.getElementById(HOST_ID);
  if (existingHost?.dataset.version === VERSION) return;
  existingHost?.remove();
  document.querySelectorAll('.telegram-atendimento-5-bottom-reserve').forEach(element => element.remove());

  function peerFromURL(href) {
    try {
      const url = new URL(href);
      if (url.origin !== 'https://web.telegram.org' || !/^\/(?:a|k)\/?$/.test(url.pathname)) return null;
      const raw = url.hash.slice(1).trim();
      if (!raw) return null;
      const hash = decodeURIComponent(raw).trim();
      const nested = hash.match(/^\/?im\?(?:p|peer|id)=([^&]+)$/i);
      const candidate = String(nested ? nested[1] : hash).trim();
      if (/^[1-9]\d{0,19}$/.test(candidate)) return candidate;
      if (!/^@?[A-Za-z][A-Za-z0-9_]{4,31}$/.test(candidate)) return null;
      return candidate.startsWith('@') ? candidate : `@${candidate}`;
    } catch { return null; }
  }

  const host = document.createElement('div');
  host.id = HOST_ID;
  host.dataset.version = VERSION;
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
    .quick-search{width:125px;min-width:75px;height:36px;padding:0 9px;border:1px solid #46515b;border-radius:8px;background:#171d22;color:#fff;outline:none;font:12px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}.quick-search:focus{border-color:#44a9ec;box-shadow:0 0 0 2px #3390ec33}.quick-search::placeholder{color:#a0adb7}.quick-count{font-size:10px;color:#aebbc4;white-space:nowrap}.audio.favorite{box-shadow:inset 0 0 0 1px #e5b04b}.audio:focus-visible,.dashboard:focus-visible{outline:2px solid #79caff;outline-offset:2px}
    .items{display:flex;align-items:center;gap:7px;min-width:0;flex:1;overflow-x:auto;scroll-behavior:smooth;scrollbar-width:thin;scrollbar-color:#615be1 transparent;padding:1px 0 5px;user-select:none;touch-action:pan-y;cursor:grab}
    .items.dragging{scroll-behavior:auto;cursor:grabbing}
    .items::-webkit-scrollbar{height:4px}.items::-webkit-scrollbar-track{background:transparent}.items::-webkit-scrollbar-thumb{background:#615be1;border-radius:4px}
    .audio{display:inline-flex;align-items:center;gap:7px;flex:0 0 auto;width:max-content;max-width:none;height:38px;padding:0 13px;border-radius:8px;background:#075c7c;color:#23c9ff;box-shadow:inset 0 0 0 1px rgba(39,199,255,.08);transition:background .15s,transform .12s,color .15s;overflow:visible}
    .audio:hover{background:#087399;color:#6edcff}.audio:active{transform:scale(.98)}.audio:disabled{opacity:.58;cursor:wait}.audio.unavailable{background:#3a4146;color:#aab3b8;cursor:not-allowed}
    .audio-icon{display:grid;place-items:center;flex:0 0 auto}.audio-icon svg{width:15px;height:15px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
    .audio-label{display:block;overflow:visible;text-overflow:clip;max-width:none;white-space:nowrap}
    .message{max-width:160px;font-size:10px;color:#9da7ae;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:0 4px}
    .message.error{color:#ff858f}.message.success{color:#66d7a5}.setup{height:36px;color:#4bcfff;background:#30363b;border-radius:8px;padding:0 12px}
    [hidden]{display:none!important}
    @media (max-width:700px){.message{display:none}.scroll-control{width:31px}.dashboard{padding:0 9px}.dashboard-label{display:none}}
  </style>
  <div class="bar" role="region" aria-label="Áudios de atendimento">
    <button class="dashboard" type="button" title="Abrir dashboard" aria-label="Abrir dashboard"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/></svg><span class="dashboard-label">Dashboard</span></button>
    <input class="quick-search" type="search" placeholder="Buscar áudio…" aria-label="Buscar áudio" title="Ctrl+K para buscar áudio"><span class="quick-count" aria-live="polite"></span>
    <button class="scroll-control previous" type="button" title="Áudios anteriores" aria-label="Mostrar áudios anteriores" hidden><svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg></button>
    <div class="items"></div>
    <button class="scroll-control next" type="button" title="Próximos áudios" aria-label="Mostrar próximos áudios" hidden><svg viewBox="0 0 24 24"><path d="m9 18 6-6-6-6"/></svg></button>
    <span class="message" aria-live="polite"></span>
  </div>`;

  document.documentElement.append(host);

  const bar = root.querySelector('.bar');
  const dashboardButton = root.querySelector('.dashboard');
  const itemsElement = root.querySelector('.items');
  const quickSearch = root.querySelector('.quick-search');
  const quickCount = root.querySelector('.quick-count');
  let searchQuery = '';
  quickSearch.addEventListener('input', () => {searchQuery=quickSearch.value.trim().toLocaleLowerCase('pt-BR');render();});
  document.addEventListener('keydown', event => {if ((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='k'&&host.style.display!=='none') {event.preventDefault();quickSearch.focus();quickSearch.select();}if(event.key==='Escape'&&root.activeElement===quickSearch){quickSearch.value='';searchQuery='';quickSearch.blur();render();}});
  const messageElement = root.querySelector('.message');
  const previousButton = root.querySelector('.previous');
  const nextButton = root.querySelector('.next');
  const state = {key:null,target:null,stamp:'',generation:0,configured:false,items:[],loading:false,contextLoading:false,error:''};
  const inFlight = new Map();
  let availableFlows=[],flowRuns=[],flowSelected='',flowBusy=false,flowLoading=false,flowError='';
  const flowRequests=new Map();
  const activeFlow=()=>flowRuns.find(run=>run.dialog_id===String(state.target?.id)&&['running','waiting','sending','uncertain','arming_reply','awaiting_reply','paused'].includes(run.status));
  async function loadFlows(){
    if(!state.configured||flowLoading)return;flowLoading=true;
    const targetId=state.target?.id;
    try{
      const data=await api('/flows');availableFlows=(data.flows||[]).filter(flow=>flow.active);
      const result=targetId?await api('/flow-runs?dialogId='+encodeURIComponent(targetId)):{runs:[]};
      if(state.target?.id===targetId)flowRuns=result.runs||[];
      flowError='';
    }catch(error){flowError=error.message;availableFlows=[];}
    finally{flowLoading=false;render();}
  }
  function renderFlows(){
    if(!state.configured||!state.target)return;
    const run=activeFlow();
    const select=document.createElement('select');select.setAttribute('aria-label','Selecionar fluxo');select.style.cssText='flex:0 0 auto;max-width:170px;background:#30363c;color:white;border-radius:7px;padding:8px';
    select.add(new Option('Selecionar fluxo',''));for(const flow of availableFlows)select.add(new Option(flow.name,flow.id));
    select.value=flowSelected;select.disabled=!!run||flowBusy;select.onchange=()=>{flowSelected=select.value;select.blur();render();};
    const start=document.createElement('button');start.type='button';start.className='audio';start.textContent=run?'Fluxo em andamento':'Iniciar fluxo';start.disabled=flowBusy||!!run||!flowSelected||!availableFlows.some(f=>f.id===flowSelected);start.title=flowError||'Executar na conversa atual';start.onclick=startFlow;
    itemsElement.prepend(select,start);
    if(flowError){const note=document.createElement('span');note.textContent='Fluxos indisponíveis';note.title=flowError;itemsElement.append(note);}
    const shown=run||flowRuns.find(item=>item.dialog_id===String(state.target.id));
    if(shown){
      const labels={running:'executando',waiting:'aguardando tempo',sending:'enviando',arming_reply:'preparando espera',awaiting_reply:'aguardando resposta',paused:'pausado',done:'concluído',cancelled:'cancelado',error:'erro',uncertain:'conferir envio'};
      const status=document.createElement('span');status.style.cssText='white-space:nowrap;flex:0 0 auto;font-size:11px';
      status.textContent=`Fluxo ${run?'ativo':'recente'}: ${shown.snapshot.name} · Status: ${labels[shown.status]||shown.status} · Etapa atual: ${Math.min(shown.current_step+1,shown.snapshot.steps.length)} de ${shown.snapshot.steps.length}${shown.current_step_label?' ('+shown.current_step_label+')':''}${shown.next_step_label?' · Próxima: '+shown.next_step_label:''}${shown.pause_requested?' · Pausa pendente':''}${shown.human_takeover?' · Atendimento humano':''}`;
      status.title=shown.error||status.textContent;itemsElement.append(status);
      const actions=[];
      if(run&&run.status!=='uncertain')actions.push(run.status==='paused'?['resume','Continuar fluxo']:['pause','Pausar fluxo'],['human','Assumir atendimento']);
      if(run)actions.push(['cancel','Cancelar fluxo']);
      if(run&&!['sending','uncertain'].includes(run.status))actions.push(['skip','Pular etapa']);
      if(!['sending','uncertain'].includes(shown.status))actions.push(['restart','Reiniciar fluxo']);
      for(const [action,label] of actions){const control=document.createElement('button');control.type='button';control.className='audio';control.textContent=label;control.disabled=flowBusy;control.onclick=()=>controlFlow(shown,action);itemsElement.append(control);}
    }
  }
  const flowCommands=new Map();
  async function controlFlow(run,action){
    if(flowBusy)return;
    const questions={restart:'Reiniciar do começo? Mensagens já enviadas poderão ser enviadas novamente.',skip:'Pular a etapa atual desta execução?',cancel:run.status==='uncertain'?'Confira o envio incerto antes de cancelar. Cancelar?':'Cancelar esta execução? Um envio em andamento poderá terminar.'};
    if(questions[action]&&!confirm(questions[action]))return;
    const key=run.id+':'+action;if(!flowCommands.has(key))flowCommands.set(key,crypto.randomUUID());
    flowBusy=true;render();
    try{await api('/flow-runs/'+run.id+'/control',{method:'POST',body:{action,version:run.control_version,requestId:flowCommands.get(key)}});flowCommands.delete(key);await loadFlows();}
    catch(error){feedback.set(run.dialog_id,{text:error.message,type:'error',expiresAt:Date.now()+10000});}
    finally{flowBusy=false;render();}
  }
  async function startFlow(){
    if(flowBusy||!state.target||!flowSelected||activeFlow())return;
    const target={...state.target},key=state.key,selected=flowSelected,stamp=location.href;
    if(!confirm(`Iniciar o fluxo “${availableFlows.find(f=>f.id===selected)?.name||''}” para ${target.name}?`))return;
    if(stamp!==location.href||key!==peerFromURL(location.href))return;
    const requestKey=target.id+':'+selected;
    // A timeout retry reuses the request ID and returns the existing execution.
    if(!flowRequests.has(requestKey))flowRequests.set(requestKey,crypto.randomUUID());
    flowBusy=true;render();
    try{
      const {run}=await api('/flow-runs',{method:'POST',body:{requestId:flowRequests.get(requestKey),flowId:selected,dialogId:String(target.id),peerKey:key}});
      if(state.target?.id===target.id){flowRuns=[run,...flowRuns.filter(r=>r.id!==run.id)];flowSelected='';}
      flowRequests.delete(requestKey);
    }catch(error){feedback.set(target.id,{text:error.message,type:'error',expiresAt:Date.now()+10000});}
    finally{flowBusy=false;render();void loadFlows();}
  }
  setInterval(()=>void loadFlows(),5000);

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
  let contextRetryTimer = null;
  let contextAttempt = 0;

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
      }
      const targetHeightText = `${dockHeight}px`;
      if (reservedDockPadding.style.height !== targetHeightText) {
        reservedDockPadding.style.height = targetHeightText;
      }
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

  function clearContextRetry() {
    if (contextRetryTimer !== null) {
      clearTimeout(contextRetryTimer);
      contextRetryTimer = null;
    }
  }

  function scheduleContextRetry(generation, delay) {
    clearContextRetry();
    contextRetryTimer = setTimeout(() => {
      contextRetryTimer = null;
      if (generation === state.generation) void syncContext(true);
    }, delay);
  }

  function isPermanentContextError(error) {
    const message = String(error?.message || error || '').toLowerCase();
    return /senha incorreta|origem não autorizada|conecte sua conta|abra uma conversa privada|atende conversas privadas|endereço da instalação inválido/.test(message);
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
    if(root.activeElement?.tagName==='SELECT' && state.stamp===location.href)return;
    const previousScroll = itemsElement.scrollLeft;
    itemsElement.replaceChildren();
    if (!state.key || !findComposer()) {host.style.display = 'none';clearChatReserve();return;}
    host.style.display = 'block';
    const busy = state.target && inFlight.has(state.target.id);
    const note = currentFeedback();
    if (note) setMessage(note.text, note.type);
    else if (!state.configured) setMessage('Configure a extensão em Opções');
    else if (state.loading) setMessage('Carregando…');
    else if (state.contextLoading) setMessage('Identificando…');
    else if (state.error) setMessage(state.error, 'error');
    else if (!state.target) setMessage('Abra uma conversa privada');
    else if (busy) setMessage('Enviando…', 'success');
    else if (!state.items.length) setMessage('Nenhum áudio ativo');
    else setMessage('');

    if (!state.configured) {
      const setup = document.createElement('button');setup.type='button';setup.className='setup';setup.textContent='Abrir Opções';setup.onclick=()=>chrome.runtime.sendMessage({type:'open-options'}).catch(()=>{});itemsElement.append(setup);
    } else if (state.error) {
      const retry = document.createElement('button');retry.type='button';retry.className='setup';retry.textContent='Tentar novamente';retry.onclick=()=>{clearContextRetry();contextAttempt=0;state.error='';syncContext(true);};itemsElement.append(retry);
    } else {
      const matching = state.items.filter(item => !searchQuery || [item.name,item.category].some(value => String(value||'').toLocaleLowerCase('pt-BR').includes(searchQuery)));
      quickCount.textContent=searchQuery ? `${matching.length}/${state.items.length}` : String(state.items.length);
      if(searchQuery && !matching.length){const empty=document.createElement('span');empty.className='message';empty.textContent='Nenhum áudio encontrado';itemsElement.append(empty);}
      for (const item of [...matching].sort((a,b)=>Number(!!b.favorite)-Number(!!a.favorite))) {
        const sendable = Boolean(item.storedName);
        const button = document.createElement('button');button.type='button';button.className=`audio${sendable?'':' unavailable'}${item.favorite?' favorite':''}`;button.title=sendable?`Enviar ${item.name}`:`${item.name}: arquivo não disponível`;button.setAttribute('aria-label',sendable?`Enviar ${item.name}`:`${item.name}: arquivo não disponível`);button.disabled=!state.target||!!busy||!sendable;
        const icon=document.createElement('span');icon.className='audio-icon';icon.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="3" width="8" height="13" rx="4"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6"/></svg>';const label=document.createElement('span');label.className='audio-label';label.textContent=item.name;button.append(icon,label);button.onclick=()=>sendItem(item);itemsElement.append(button);
      }
    }
    renderFlows();
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
      // Keep active voice records visible even when an old/partial record is
      // missing its file marker. Hiding them as "Nenhum áudio ativo" made
      // the extension disagree with the dashboard and concealed the repair
      // needed for that specific item. The render step disables only the
      // unusable record, so a missing file can never be sent accidentally.
      state.items=(data.items || []).filter(item => (item.kind || 'voice') === 'voice' && item.active !== false);
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
    if (!item.storedName) {
      feedback.set(String(state.target.id),{text:'Este áudio está sem arquivo no servidor.',type:'error',expiresAt:Date.now()+8000});
      render();
      return;
    }
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
    const sameStamp = stamp === state.stamp;
    clearContextRetry();
    if (!sameStamp) contextAttempt=0;
    state.stamp=stamp;state.key=key;state.target=null;state.error='';state.contextLoading=!!key && state.configured;state.generation++;
    const generation=state.generation;render();
    if (!key || !state.configured) {state.contextLoading=false;render();return;}
    try {
      const data=await api('/context',{method:'POST',body:{peerKey:key}});
      if (generation !== state.generation) return;
      if (!data?.target || data.target.id === undefined || data.target.id === null) throw new Error('Não consegui identificar a conversa atual.');
      state.target={...data.target,id:String(data.target.id)};void loadFlows();state.error='';state.contextLoading=false;contextAttempt=0;render();await refreshRunningJob();
    } catch (error) {
      if (generation !== state.generation) return;
      if (isPermanentContextError(error)) {
        state.contextLoading=false;state.error=error.message || 'Não foi possível identificar a conversa atual.';render();return;
      }
      if (contextAttempt < CONTEXT_RETRY_DELAYS.length) {
        const delay=CONTEXT_RETRY_DELAYS[contextAttempt++];
        state.contextLoading=true;state.error='';render();scheduleContextRetry(generation,delay);
      } else {
        state.contextLoading=false;state.error=error.message || 'Não consegui identificar a conversa atual.';render();
      }
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
  const dragState={pointerId:null,startX:0,startScroll:0,moved:false,captured:false,suppressClick:false};
  itemsElement.addEventListener('pointerdown',event=>{
    if(event.target.closest('select'))return;
    if (event.pointerType==='mouse'&&event.button!==0) return;
    if (itemsElement.scrollWidth-itemsElement.clientWidth<=3) return;
    dragState.pointerId=event.pointerId;dragState.startX=event.clientX;dragState.startScroll=itemsElement.scrollLeft;dragState.moved=false;dragState.captured=false;
  });
  itemsElement.addEventListener('pointermove',event=>{
    if (dragState.pointerId!==event.pointerId) return;
    const distance=event.clientX-dragState.startX;
    if (Math.abs(distance)>5) dragState.moved=true;
    if (!dragState.moved) return;
    if (!dragState.captured) {
      dragState.captured=true;
      itemsElement.classList.add('dragging');
      try {itemsElement.setPointerCapture(event.pointerId);} catch {}
    }
    event.preventDefault();itemsElement.scrollLeft=dragState.startScroll-distance;
  },{passive:false});
  const finishDrag=event=>{
    if (dragState.pointerId!==event.pointerId) return;
    const moved=dragState.moved;
    try {if (dragState.captured && itemsElement.hasPointerCapture(event.pointerId)) itemsElement.releasePointerCapture(event.pointerId);} catch {}
    dragState.pointerId=null;dragState.moved=false;dragState.captured=false;itemsElement.classList.remove('dragging');
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
      if(!!result?.configured!==state.configured){state.configured=!!result?.configured;state.error='';contextAttempt=0;clearContextRetry();render();if(state.configured)await loadLibrary(true);await syncContext(true);}
    }catch{}finally{configurationBusy=false;}
  },10000);
  void boot();
})();
