import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const cleanName = value => String(value || '').trim().replace(/\s+/g, ' ').slice(0, 40);

export class CategoryStore {
  constructor(dataDir, store = null, library = null) {
    this.store = store;
    this.library = library;
    this.file = path.join(dataDir, 'categories.json');
    this.tail = Promise.resolve();
  }

  async init() {
    if (this.store) {
      const saved = await this.store.getState('categories');
      if (saved === null || !Array.isArray(saved) || !saved.some(row => row?.name === 'Geral')) {
        const names = new Set(['Geral']);
        if (Array.isArray(saved)) for (const row of saved) if (cleanName(row?.name)) names.add(cleanName(row.name));
        if (this.library) for (const item of await this.library.list()) names.add(cleanName(item.category) || 'Geral');
        await this.store.setState('categories', [...names].map(name => ({id:crypto.randomUUID(), name, createdAt:new Date().toISOString()})));
      }
      return;
    }
    try { await fs.access(this.file); }
    catch {
      const names=new Set(['Geral']);
      if(this.library) for(const item of await this.library.list()) names.add(cleanName(item.category)||'Geral');
      await fs.writeFile(this.file,JSON.stringify([...names].map(name=>({id:crypto.randomUUID(),name,createdAt:new Date().toISOString()}))));
    }
  }

  async list() {
    const rows = this.store ? ((await this.store.getState('categories')) ?? []) : JSON.parse(await fs.readFile(this.file, 'utf8'));
    return rows.filter(row => row && row.id && row.name).sort((a,b)=>a.name.localeCompare(b.name, 'pt-BR'));
  }

  mutate(fn) {
    const task=this.tail.then(async()=>{
      const rows=await this.list(), result=await fn(rows);
      if(this.store) await this.store.setState('categories',rows);
      else { await fs.writeFile(this.file+'.tmp',JSON.stringify(rows,null,2));await fs.rename(this.file+'.tmp',this.file); }
      return result;
    });
    this.tail=task.catch(()=>{});
    return task;
  }

  add(input = {}) { return this.mutate(rows=>{
    const name=cleanName(input.name);
    if(!name) throw new Error('Informe um nome de categoria.');
    if(rows.some(row=>row.name.toLocaleLowerCase('pt-BR')===name.toLocaleLowerCase('pt-BR'))) throw new Error('Essa categoria já existe.');
    const row={id:crypto.randomUUID(),name,createdAt:new Date().toISOString()};rows.push(row);return row;
  }); }

  rename(id, input = {}) { return this.mutate(async rows=>{
    const row=rows.find(item=>item.id===id);if(!row)throw new Error('Categoria não encontrada.');
    const name=cleanName(input.name);if(!name)throw new Error('Informe um nome de categoria.');
    if(row.name==='Geral'&&name!=='Geral')throw new Error('A categoria Geral não pode ser renomeada.');
    if(rows.some(item=>item.id!==id&&item.name.toLocaleLowerCase('pt-BR')===name.toLocaleLowerCase('pt-BR')))throw new Error('Essa categoria já existe.');
    const old=row.name;row.name=name;
    if(this.library)await this.library.reassignCategory(old,name);
    return row;
  }); }

  remove(id) { return this.mutate(async rows=>{
    const index=rows.findIndex(item=>item.id===id);if(index<0)return false;
    const row=rows[index];if(row.name==='Geral')throw new Error('A categoria Geral não pode ser excluída.');
    rows.splice(index,1);if(this.library)await this.library.reassignCategory(row.name,'Geral');return true;
  }); }

  async ensure(name) {
    const clean=cleanName(name)||'Geral';
    const rows=await this.list();
    if(rows.some(row=>row.name.toLocaleLowerCase('pt-BR')===clean.toLocaleLowerCase('pt-BR')))return rows.find(row=>row.name.toLocaleLowerCase('pt-BR')===clean.toLocaleLowerCase('pt-BR'));
    return this.add({name:clean});
  }
}
