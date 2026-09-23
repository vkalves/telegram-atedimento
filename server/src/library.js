import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { convertToTelegramVoice, convertToTelegramVideo } from './audio.js';

const boolValue = (value, fallback = false) => {
  if (value === undefined || value === null || value === '') return fallback;
  return value === true || value === 'true' || value === '1' || value === 1;
};

const orderValue = (value, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= 100000 ? number : fallback;
};

const allowedExtensions = {
  voice:['.mp3','.m4a','.wav','.aac','.ogg','.opus','.mp4','.webm'],
  image:['.jpg','.jpeg','.png'],
  video:['.mp4'],
  file:['.pdf','.doc','.docx','.xls','.xlsx','.txt','.csv','.zip']
};

const mimeByExtension = {
  '.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.mp4':'video/mp4',
  '.pdf':'application/pdf','.doc':'application/msword',
  '.docx':'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls':'application/vnd.ms-excel','.xlsx':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.txt':'text/plain','.csv':'text/csv','.zip':'application/zip'
};

export class VoiceLibrary {
  constructor(dataDir, store = null) {
    this.store = store;
    this.downloads = new Map();
    this.libraryDir = path.join(dataDir, 'library');
    this.metaPath = path.join(dataDir, 'library.json');
    this.uploadDir = path.join(dataDir, 'uploads');
    this.tail = Promise.resolve();
  }
  async init() {
    await fs.mkdir(this.libraryDir, {recursive:true});
    await fs.mkdir(this.uploadDir, {recursive:true});
    if (this.store) {
      const items = await this.store.getState("library");
      if (Array.isArray(items) && items.some(item => item.active === undefined || item.sortOrder === undefined)) {
        const migrated = [...items]
          .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
          .map((item, index) => ({
            ...item,
            active: item.active !== false,
            category: String(item.category || 'Geral').slice(0, 40),
            sortOrder: index,
            updatedAt: item.updatedAt || item.createdAt || new Date().toISOString()
          }));
        await this.store.setState('library', migrated);
      }
      return;
    }
    try { await fs.access(this.metaPath); }
    catch { await this.write([]); return; }
    const items=JSON.parse(await fs.readFile(this.metaPath,'utf8'));
    if(Array.isArray(items)&&items.some(item=>item.active===undefined||item.sortOrder===undefined)){
      const migrated=[...items].sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||''))).map((item,index)=>({...item,active:item.active!==false,category:String(item.category||'Geral').slice(0,40),sortOrder:index,updatedAt:item.updatedAt||item.createdAt||new Date().toISOString()}));
      await this.write(migrated);
    }
  }
  async read() { if(this.store) return (await this.store.getState("library")) ?? []; return JSON.parse(await fs.readFile(this.metaPath, 'utf8')); }
  async write(items) {
    if(this.store) return this.store.setState("library",items);
    const tmp = this.metaPath + '.tmp';
    await fs.writeFile(tmp, JSON.stringify(items, null, 2));
    await fs.rename(tmp, this.metaPath);
  }
  lock(fn) { const task = this.tail.then(fn); this.tail = task.catch(()=>{}); return task; }
  async list() {
    return (await this.read()).sort((a, b) => {
      const aOrder = Number.isFinite(Number(a.sortOrder)) ? Number(a.sortOrder) : Number.MAX_SAFE_INTEGER;
      const bOrder = Number.isFinite(Number(b.sortOrder)) ? Number(b.sortOrder) : Number.MAX_SAFE_INTEGER;
      if (aOrder !== bOrder) return aOrder - bOrder;
      return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
    });
  }
  async get(id) {
    const item = (await this.read()).find(x=>x.id===id);
    if(item?.storedName && this.store) {
      const file=path.join(this.libraryDir,path.basename(item.storedName));
      try { await fs.access(file); } catch {
        if(!this.downloads.has(item.id)) {
          const task=this.store.download(item.storedName,file+'.part').then(()=>fs.rename(file+'.part',file)).catch(async err=>{await fs.rm(file+'.part',{force:true}).catch(()=>{});throw err;}).finally(()=>this.downloads.delete(item.id));
          this.downloads.set(item.id,task);
        }
        await this.downloads.get(item.id);
      }
    }
    return item ? {...item, path: item.storedName ? path.join(this.libraryDir, path.basename(item.storedName)) : null} : null;
  }
  add(file, input = {}) { return this.lock(async()=>{
    const kind = input.kind || 'voice';
    if(!['voice','text','image','video','file'].includes(kind))throw new Error('Tipo de conteúdo inválido.');
    const existing = await this.read();
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const item = {
      id,
      kind,
      name:String(input.name || (file && path.parse(file.originalname).name) || 'Resposta').slice(0,80),
      category:String(input.category || 'Geral').trim().slice(0,40) || 'Geral',
      active:boolValue(input.active, true),
      favorite:boolValue(input.favorite, false),
      sortOrder:orderValue(input.sortOrder, existing.length),
      createdAt:now,
      updatedAt:now
    };
    let output,uploaded=false;
    try {
      if (kind === 'text') {
        item.text = String(input.text || '').trim();
        if (!item.text || item.text.length > 4096) throw new Error('O texto precisa ter entre 1 e 4096 caracteres.');
      } else {
        if (!file) throw new Error('Selecione um arquivo.');
        const ext = path.extname(file.originalname).toLowerCase();
        if (!allowedExtensions[kind]?.includes(ext)) throw new Error('Formato incompatível com o tipo selecionado.');
        item.originalName = path.basename(file.originalname).slice(0, 180);
        item.storedName = id + (kind === 'voice' ? '.ogg' : ext);
        output = path.join(this.libraryDir, item.storedName);
        if (kind === 'voice') Object.assign(item, await convertToTelegramVoice(file.path,output));
        else if(kind === 'video') Object.assign(item, await convertToTelegramVideo(file.path,output));
        else await fs.copyFile(file.path,output);
        item.size = (await fs.stat(output)).size;
        if(this.store) {
          const mime=kind==='voice'?'audio/ogg':mimeByExtension[ext];
          await this.store.upload(item.storedName,output,mime);uploaded=true;
        }
      }
      const items = await this.read();items.push(item);await this.write(items);return item;
    } catch(e) {
      if(uploaded) await this.store.remove(item.storedName).catch(()=>{});
      if(output) await fs.rm(output,{force:true}).catch(()=>{});
      throw e;
    }
    finally { if(file) await fs.rm(file.path,{force:true}).catch(()=>{}); }
  }); }
  update(id, input) { return this.lock(async()=>{
    const items=await this.read(), item=items.find(x=>x.id===id);
    if(!item) throw new Error('Item não encontrado.');
    if(input.active !== undefined) item.active=boolValue(input.active, item.active !== false);
    if(input.favorite !== undefined) item.favorite=!!input.favorite;
    if(input.name !== undefined) item.name=String(input.name).trim().slice(0,80) || item.name;
    if(input.category !== undefined) item.category=String(input.category).trim().slice(0,40) || 'Geral';
    if(input.sortOrder !== undefined) item.sortOrder=orderValue(input.sortOrder, item.sortOrder || 0);
    if(input.text !== undefined && item.kind==='text') {
      const text=String(input.text).trim();if(!text || text.length>4096) throw new Error('Texto inválido.');item.text=text;
    }
    item.updatedAt=new Date().toISOString();
    await this.write(items);return item;
  }); }

  replaceFile(id, file) { return this.lock(async()=>{
    const items=await this.read(), item=items.find(x=>x.id===id);
    if(!item) throw new Error('Conteúdo não encontrado.');
    if(item.kind === 'text') throw new Error('Mensagens de texto não possuem arquivo para substituir.');
    if(!file) throw new Error('Selecione um arquivo.');
    const ext=path.extname(file.originalname).toLowerCase();
    if(!allowedExtensions[item.kind]?.includes(ext)) throw new Error('Formato incompatível com este conteúdo.');
    const oldName=item.storedName;
    const newName=crypto.randomUUID()+(item.kind==='voice'?'.ogg':item.kind==='video'?'.mp4':ext);
    const output=path.join(this.libraryDir,newName);
    let uploaded=false;
    try {
      let converted={};
      if(item.kind==='voice')converted=await convertToTelegramVoice(file.path,output);
      else if(item.kind==='video')converted=await convertToTelegramVideo(file.path,output);
      else await fs.copyFile(file.path,output);
      if(this.store) {await this.store.upload(newName,output,item.kind==='voice'?'audio/ogg':mimeByExtension[path.extname(newName)]);uploaded=true;}
      const replacement={...item,storedName:newName,originalName:path.basename(file.originalname).slice(0,180),...converted,size:(await fs.stat(output)).size,updatedAt:new Date().toISOString()};
      items[items.findIndex(x=>x.id===id)]=replacement;
      await this.write(items);
      if(oldName && oldName !== newName) {
        if(this.store) await this.store.remove(oldName).catch(()=>{});
        await fs.rm(path.join(this.libraryDir,path.basename(oldName)),{force:true}).catch(()=>{});
      }
      return replacement;
    } catch(e) {
      if(uploaded) await this.store.remove(newName).catch(()=>{});
      await fs.rm(output,{force:true}).catch(()=>{});
      throw e;
    } finally {
      await fs.rm(file.path,{force:true}).catch(()=>{});
    }
  }); }

  reorder(ids) { return this.lock(async()=>{
    if(!Array.isArray(ids) || ids.length > 1000) throw new Error('Ordem inválida.');
    const items=await this.list();
    const selected=[];
    const selectedIds=new Set();
    for(const id of ids) {
      if(typeof id !== 'string' || selectedIds.has(id)) continue;
      const item=items.find(x=>x.id===id);
      if(item) { selected.push(item); selectedIds.add(id); }
    }
    let cursor=0;
    const ordered=items.map(item=>selectedIds.has(item.id)?selected[cursor++]:item);
    const now=new Date().toISOString();
    ordered.forEach((item,index)=>{item.sortOrder=index; if(selectedIds.has(item.id)) item.updatedAt=now;});
    await this.write(ordered);
    return ordered;
  }); }

  reassignCategory(from, to = 'Geral') { return this.lock(async()=>{
    const source=String(from || '').trim(), destination=String(to || 'Geral').trim() || 'Geral';
    if(!source || source === destination) return;
    const items=await this.read();let changed=false;
    for(const item of items) if((item.category || 'Geral') === source) { item.category=destination.slice(0,40);item.updatedAt=new Date().toISOString();changed=true; }
    if(changed) await this.write(items);
  }); }

  remove(id) { return this.lock(async()=>{
    const items=await this.read(),item=items.find(x=>x.id===id);if(!item)return false;
    await this.write(items.filter(x=>x.id!==id));
    if(item.storedName && this.store)await this.store.remove(item.storedName);
    if(item.storedName)await fs.rm(path.join(this.libraryDir,path.basename(item.storedName)),{force:true});return true;
  }); }
}
