(() => {
  const STATUS={open:'Em atendimento',waiting:'Aguardando lead',snoozed:'Agendado',done:'Concluído'};
  const node=(tag,text,cls)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(cls)el.className=cls;return el;};
  const button=(text,fn,cls='secondary')=>{const el=node('button',text,cls);el.type='button';el.onclick=fn;return el;};
  globalThis.TelevoiceSupport=({api,getActiveFlow=()=>null,takeOver=async()=>{}})=>{
    const host=node('div');host.id='televoice-support-panel';host.style.cssText='position:fixed;right:18px;top:76px;bottom:22px;width:370px;max-width:calc(100vw - 24px);z-index:2147483647;display:none;';
    const root=host.attachShadow({mode:'open'});
    root.innerHTML=`<style>
      :host{all:initial;font:13px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#e8f0f2;color-scheme:dark}*{box-sizing:border-box}button,input,select,textarea{font:inherit}button{cursor:pointer;border:0}button:disabled{opacity:.5;cursor:wait}.panel{height:100%;display:flex;flex-direction:column;background:#18282f;border:1px solid #3d555e;box-shadow:0 18px 65px #0007;border-radius:16px;overflow:hidden}.heading{display:flex;align-items:center;justify-content:space-between;padding:17px 18px;border-bottom:1px solid #334b55}.heading small{display:block;font-size:10px;color:#97b6bd;margin-top:4px}.heading strong{font-size:16px}.close{background:transparent;color:#b7cbd0;font-size:24px}.tabs{display:flex;padding:11px 12px;gap:5px}.tabs button{flex:1;padding:9px 8px;border-radius:7px;background:transparent;color:#a3bdc5;font-size:12px}.tabs button[aria-selected=true]{background:#2a4a50;color:#acf0dc}.content{overflow-y:auto;padding:4px 16px 20px;flex:1;overscroll-behavior:contain}.secondary,.primary{padding:9px 11px;border-radius:7px;background:#2c454f;color:#d6e7eb;font-size:12px}.primary{background:#319d8a;color:white}.actions{display:flex;gap:7px;flex-wrap:wrap;margin:12px 0}.muted{font-size:11px;color:#92aeb8;line-height:1.6}.message{font-size:12px;padding:10px 16px;color:#c9e8df;background:#223f43;margin:0;overflow-wrap:anywhere}.message.error{color:#ffd4c7;background:#533d36}input,textarea,select{width:100%;padding:10px;border:1px solid #415b65;border-radius:7px;background:#20353e;color:#edf6f7;margin-top:6px}input:focus,textarea:focus,select:focus{outline:2px solid #54b5a2;outline-offset:1px}textarea{resize:vertical;min-height:120px;line-height:1.5}label{display:block;margin:12px 0;color:#b4cad1;font-size:11px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}.title{font-size:17px;overflow-wrap:anywhere;margin:12px 0 5px}.identity{margin:0;color:#89a9b4;font-size:11px}.card{display:block;padding:13px 0;border-bottom:1px solid #304650}.card strong{font-size:13px;display:block;color:#e3eef0}.card p{font-size:11px;line-height:1.6;color:#a9bec7;white-space:pre-wrap;overflow-wrap:anywhere}.card .meta{display:block;font-size:10px;color:#b6ccaa;margin:5px 0}.queue-header{display:flex;justify-content:space-between;align-items:center;gap:8px}.queue-header span{font-size:11px;color:#aac3cc}.empty{text-align:center;color:#9fb8c2;padding:30px 8px;font-size:12px;line-height:1.7}.hint{border-left:2px solid #56b49e;padding-left:10px}.card-actions{display:flex;gap:6px}.copy-preview{white-space:pre-wrap;max-height:190px;overflow:auto}.footer{padding:10px 16px;border-top:1px solid #304650;color:#90acb5;font-size:10px}[hidden]{display:none!important}button:focus-visible{outline:2px solid #82dcc8;outline-offset:2px}
    </style><section class="panel" aria-label="Central de atendimento Televoice"><header class="heading"><div><strong>Televoice</strong><small>Seu atendimento, em ordem</small></div><button class="close" aria-label="Fechar central" type="button">×</button></header><div class="tabs" role="tablist"><button type="button" data-tab="lead" role="tab" aria-selected="true">Ficha do lead</button><button type="button" data-tab="queue" role="tab" aria-selected="false">Fila</button><button type="button" data-tab="replies" role="tab" aria-selected="false">Respostas</button></div><p class="message" role="status" hidden></p><div class="content"></div><footer class="footer">Alt+A abre a central · Alterações salvas no servidor</footer></section>`;
    document.documentElement.append(host);
    const content=root.querySelector('.content'),message=root.querySelector('.message');
    const state={target:null,key:null,lead:null,tab:'lead',generation:0,busy:false,queue:[],queueFilter:'focus',replySearch:'',replies:[],drafts:new Map(),loaded:false};
    const notify=(text,error=false)=>{message.textContent=text;message.hidden=!text;message.className='message'+(error?' error':'');};
    const open=()=>host.style.display!=='none';
    function preserveDraft(){if(state.busy)return;const form=content.querySelector('form');if(form?.dataset.lead&&form.dataset.dirty==='true')state.drafts.set(form.dataset.lead,Object.fromEntries(new FormData(form)));}
    function navigate(id){preserveDraft();location.hash=String(id);}
    function toggle(){if(open()){preserveDraft();host.style.display='none';}else{host.style.display='block';void loadTab();}}
    root.querySelector('.close').onclick=toggle;
    root.querySelectorAll('[data-tab]').forEach(el=>el.onclick=()=>{preserveDraft();state.tab=el.dataset.tab;root.querySelectorAll('[data-tab]').forEach(tab=>tab.setAttribute('aria-selected',String(tab===el)));void loadTab();});
    document.addEventListener('keydown',event=>{if(event.altKey&&!event.ctrlKey&&event.key.toLowerCase()==='a'){event.preventDefault();toggle();}if(event.key==='Escape'&&root.activeElement){toggle();}});
    function label(text,input){const el=node('label',text);el.append(input);return el;}
    function input(name,value,type='text'){const el=node('input');el.name=name;el.type=type;el.value=value||'';return el;}
    function select(name,options,value){const el=node('select');el.name=name;for(const [key,text]of Object.entries(options))el.add(new Option(text,key));el.value=String(value);return el;}
    const localDate=iso=>{if(!iso)return '';const d=new Date(iso);return new Date(d-d.getTimezoneOffset()*60000).toISOString().slice(0,16);};
    async function loadTab(){
      const generation=++state.generation;notify('');content.replaceChildren(node('p','Carregando…','muted'));
      try{
        if(state.tab==='lead'){
          if(!state.target){content.replaceChildren(node('p','Abra uma conversa privada para ver a ficha do lead.','empty'));return;}
          const target={...state.target},key=state.key;
          const data=await api('/support/lead',{method:'POST',body:{dialogId:target.id,peerKey:key}});
          if(generation!==state.generation||state.target?.id!==target.id)return;
          state.lead=data.lead;renderLead();
        }else if(state.tab==='queue'){
          const data=await api('/support/queue?filter='+state.queueFilter+'&limit=50');if(generation!==state.generation)return;
          state.queue=data.items||[];renderQueue(data);if(data.health?.error)notify(data.health.error,true);
        }else{
          const data=await api('/support/replies');if(generation!==state.generation)return;state.replies=data.items||[];renderReplies();
        }
      }catch(error){if(generation===state.generation){content.replaceChildren(button('Tentar novamente',()=>void loadTab()));notify(error.message,true);}}
    }
    function renderLead(){
      const lead=state.lead;if(!lead)return;content.replaceChildren();
      const draftKey=(lead.account_id||'')+':'+lead.dialog_id;
      const draft=state.drafts.get(draftKey),values=draft||lead;
      content.append(node('h2',lead.name,'title'),node('p',lead.username?'@'+lead.username:'Conversa '+lead.dialog_id,'identity'));
      if(draft)content.append(node('p','Rascunho recuperado desta conversa. Confira antes de salvar.','muted hint'));
      const active=getActiveFlow();if(active){const notice=node('div',undefined,'hint');notice.append(node('p','Há um fluxo ativo nesta conversa. Concluir a ficha não interrompe as mensagens do fluxo.','muted'),button('Assumir atendimento',async()=>{if(state.target?.id!==lead.dialog_id)return;await takeOver(active);notify('Confira o status do fluxo na barra abaixo da conversa.');}));content.append(notice);}
      const form=node('form');form.dataset.lead=draftKey;form.dataset.dirty=draft?'true':'false';form.oninput=()=>{form.dataset.dirty='true';};
      const version=input('version',String(draft?.version||lead.version),'hidden');form.append(version);
      const grid=node('div',undefined,'grid');grid.append(label('Status',select('status',STATUS,values.status)),label('Prioridade',select('priority',{0:'Normal',1:'Alta',2:'Urgente'},values.priority)));form.append(grid);
      const due=input('due_at',draft?draft.due_at:localDate(lead.due_at),'datetime-local');
      form.append(label('Retorno (horário local)',due));
      const quick=node('div',undefined,'actions');for(const [title,ms]of [['+1 hora',3600000],['Amanhã',86400000]])quick.append(button(title,()=>{due.value=localDate(Date.now()+ms);form.elements.status.value='snoozed';form.dataset.dirty='true';}));
      quick.append(button('Limpar retorno',()=>{due.value='';if(form.elements.status.value==='snoozed')form.elements.status.value='open';form.dataset.dirty='true';}));form.append(quick);
      const owner=input('owner',values.owner);owner.maxLength=80;const tags=input('tags',draft?draft.tags:lead.tags.join(', '));tags.maxLength=395;
      const notes=node('textarea');notes.name='notes';notes.maxLength=8000;notes.value=values.notes||'';notes.placeholder='Contexto, dúvidas, próximo passo…';
      form.append(label('Responsável',owner),label('Etiquetas (separadas por vírgula)',tags),label('Notas internas',notes));
      const save=button('Salvar ficha',()=>{},'primary');save.type='submit';
      const actions=node('div',undefined,'actions');actions.append(save,button('Concluir e próximo',()=>saveLead(true)),button('Recarregar ficha',()=>{if(confirm('Substituir o rascunho pelos dados salvos?')){state.drafts.delete(draftKey);void loadTab();}}));form.append(actions);
      form.onsubmit=event=>{event.preventDefault();void saveLead(false);};content.append(form);
      async function saveLead(next){
        if(state.busy)return;const captured={...lead},generation=state.generation;preserveDraft();state.busy=true;form.querySelectorAll('input,select,textarea').forEach(el=>el.disabled=true);actions.querySelectorAll('button').forEach(b=>b.disabled=true);notify('Salvando…');
        try{
          const data=await api('/support/leads/'+captured.dialog_id,{method:'PATCH',body:{version:Number(form.elements.version.value),status:next?'done':form.elements.status.value,priority:Number(form.elements.priority.value),owner:owner.value,tags:tags.value.split(',').map(t=>t.trim()).filter(Boolean),notes:notes.value,due_at:due.value?new Date(due.value).toISOString():null}});
          state.drafts.delete(draftKey);form.dataset.dirty='false';
          if(generation!==state.generation)return;
          state.lead=data.lead;notify('Ficha salva.');
          if(next){const result=await api('/support/queue?filter=focus&limit=50');if(generation!==state.generation)return;const nextLead=(result.items||[]).find(r=>r.dialog_id!==captured.dialog_id);if(nextLead)navigate(nextLead.dialog_id);else{renderLead();notify('Atendimento concluído. Sua fila está em dia.');}}
          else renderLead();
        }catch(error){if(generation===state.generation)notify(error.message,true);}
        finally{state.busy=false;form.querySelectorAll('input,select,textarea').forEach(el=>el.disabled=false);actions.querySelectorAll('button').forEach(b=>b.disabled=false);}
      }
    }
    function renderQueue(data){
      content.replaceChildren();const heading=node('div',undefined,'queue-header');heading.append(node('span',`${data.total} leads · até 50 nesta lista`),button('Atualizar',()=>void loadTab()));content.append(heading);
      const filter=select('filter',{focus:'Minha fila',reply:'Precisa de resposta',due:'Retorno vencido',priority:'Urgente',waiting:'Aguardando',snoozed:'Agendado'},state.queueFilter);filter.setAttribute('aria-label','Filtrar fila');filter.onchange=()=>{state.queueFilter=filter.value;void loadTab();};content.append(filter);
      if(!state.queue.length)content.append(node('p','Nenhuma pendência nesta fila. Importe conversas recentes na dashboard para começar.','empty'));
      for(const lead of state.queue){const card=node('article',undefined,'card');card.append(node('strong',lead.name),node('span',`${lead.priority===2?'Urgente · ':''}${STATUS[lead.status]}${lead.needs_reply?' · Precisa de resposta':''}`,'meta'),node('p',lead.last_preview));card.append(button(lead.dialog_id===state.target?.id?'Conversa atual':'Abrir conversa',()=>navigate(lead.dialog_id)));content.append(card);}
    }
    function renderReplies(){
      const stamp=location.href,generation=state.generation;
      content.replaceChildren();const search=input('search',state.replySearch,'search');search.placeholder='Buscar resposta ou categoria';search.setAttribute('aria-label','Buscar resposta pronta');content.append(search);
      const list=node('div');content.append(list);const render=()=>{
        list.replaceChildren();const q=search.value.toLocaleLowerCase('pt-BR');
        for(const reply of state.replies.filter(r=>`${r.title} ${r.category} ${r.body}`.toLocaleLowerCase('pt-BR').includes(q))){
          const body=reply.body.replace(/\{(nome|primeiro_nome|usuario)\}/g,(_,key)=>({nome:state.target?.name||'',primeiro_nome:(state.target?.name||'').split(' ')[0],usuario:state.target?.username?'@'+state.target.username:''})[key]);
          const card=node('article',undefined,'card');card.append(node('span',reply.category,'meta'),node('strong',reply.title),node('p',body,'copy-preview'));
          const copy=button('Copiar resposta',async()=>{if(stamp!==location.href||generation!==state.generation){notify('A conversa mudou. Abra as respostas novamente.',true);return;}try{await navigator.clipboard.writeText(body);notify('Resposta copiada. Cole na conversa e revise antes de enviar.');}catch{notify('O navegador bloqueou a cópia. Selecione o texto acima e copie.',true);}},'primary');copy.disabled=!state.target;card.append(copy);list.append(card);
        }if(!list.children.length)list.append(node('p','Nenhuma resposta encontrada. Crie suas respostas prontas na dashboard.','empty'));
      };search.oninput=()=>{state.replySearch=search.value;render();};render();
    }
    return {toggle,setTarget(target,key){preserveDraft();state.target=target?{...target}:null;state.key=key;state.lead=null;state.generation++;if(open())void loadTab();}};
  };
})();
