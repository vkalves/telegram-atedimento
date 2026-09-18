export class Jobs {
  constructor(telegram, library) {this.telegram=telegram;this.library=library;this.jobs=new Map();}
  get(id){const j=this.jobs.get(id);if(!j)return null;const {controller,...publicJob}=j;return publicJob;}
  create(input) {
    const {requestId,dialogId,steps}=input || {};
    if(!/^[a-zA-Z0-9-]{8,80}$/.test(requestId || ''))throw new Error('Identificador do envio inválido.');
    // Duplicate requests return the original result, including failures; never silently resend.
    if(this.jobs.has(requestId))return this.get(requestId);
    if(!/^-?\d+$/.test(String(dialogId || '')))throw new Error('Selecione uma conversa válida.');
    if(!Array.isArray(steps)||!steps.length||steps.length>30)throw new Error('Use entre 1 e 30 etapas.');
    for(const s of steps)if(typeof s.id!=='string'||!Number.isFinite(s.delay)||s.delay<0||s.delay>3600||(s.recordingDelay!==undefined&&(!Number.isFinite(s.recordingDelay)||s.recordingDelay<0||s.recordingDelay>15)))throw new Error('Etapa inválida.');
    if([...this.jobs.values()].some(j=>j.dialogId===String(dialogId)&&j.state==='running'))throw new Error('Já existe um envio nesta conversa. Aguarde ou pare a sequência.');
    for(const [id,j] of this.jobs)if(j.state!=='running'&&Date.now()-j.updatedAt>86400000)this.jobs.delete(id);
    const job={id:requestId,dialogId:String(dialogId),label:String(input.label||'Envio').slice(0,80),targetName:String(input.targetName||dialogId).slice(0,120),steps:structuredClone(steps),state:'running',sent:0,total:steps.length,messageIds:[],error:null,phase:'Preparando',updatedAt:Date.now(),controller:new AbortController()};
    this.jobs.set(job.id,job);void this.run(job);return this.get(job.id);
  }
  cancel(id){const j=this.jobs.get(id);if(j?.state==='running'){j.controller.abort();j.phase='Parando após o envio em andamento';}return this.get(id);}
  async run(job){
    try{
      await this.telegram.requireAuthorized();
      const items=[];
      for(const step of job.steps){const item=await this.library.get(step.id);if(!item)throw new Error('Um item foi excluído. Edite a sequência.');items.push(item);}
      for(let i=0;i<items.length;i++){
        if(job.controller.signal.aborted)break;
        if(job.steps[i].delay){job.phase=`Aguardando ${job.steps[i].delay}s`;
          await new Promise(resolve=>{const done=()=>{clearTimeout(timer);job.controller.signal.removeEventListener('abort',done);resolve();};const timer=setTimeout(done,job.steps[i].delay*1000);job.controller.signal.addEventListener('abort',done,{once:true});});}
        if(job.controller.signal.aborted)break;
        job.phase=`Enviando ${i+1}/${items.length}`;
        const result=await this.telegram.sendItem(items[i],{dialogId:job.dialogId},{recordingDelay:job.steps[i].recordingDelay||0});
        job.sent++;job.messageIds.push(result.messageId);job.updatedAt=Date.now();
      }
      job.state=job.controller.signal.aborted?'cancelled':'done';
      job.phase=job.state==='done'?'Concluído':'Interrompido';
    }catch(e){job.state='error';job.error=this.telegram.friendlyError(e);job.phase='Falha';}
    finally{job.updatedAt=Date.now();}
  }
}
