import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
export class Sequences {
 constructor(dataDir,store=null){this.store=store;this.file=path.join(dataDir,'sequences.json');this.tail=Promise.resolve();}
 async init(){if(this.store){await this.store.getState("sequences");return;}try{await fs.access(this.file);}catch{await fs.writeFile(this.file,'[]');}}
 async list(){if(this.store)return (await this.store.getState("sequences"))??[];return JSON.parse(await fs.readFile(this.file,'utf8'));}
 mutate(fn){const task=this.tail.then(async()=>{const items=await this.list(),result=fn(items);if(this.store)await this.store.setState('sequences',items);else{await fs.writeFile(this.file+'.tmp',JSON.stringify(items,null,2));await fs.rename(this.file+'.tmp',this.file);}return result;});this.tail=task.catch(()=>{});return task;}
 save(input){return this.mutate(items=>{
  const name=String(input.name||'').trim().slice(0,80),steps=input.steps;
  if(!name||!Array.isArray(steps)||!steps.length||steps.length>30)throw new Error('Preencha o nome e entre 1 e 30 etapas.');
  if(steps.some(s=>typeof s.id!=='string'||!Number.isFinite(s.delay)||s.delay<0||s.delay>3600))throw new Error('Etapa inválida.');
  const item={id:input.id||crypto.randomUUID(),name,steps:steps.map(s=>({id:s.id,delay:s.delay}))};
  const index=items.findIndex(s=>s.id===item.id);if(index<0)items.push(item);else items[index]=item;return item;
 });}
 remove(id){return this.mutate(items=>{const i=items.findIndex(s=>s.id===id);if(i>=0)items.splice(i,1);return i>=0;});}
}
