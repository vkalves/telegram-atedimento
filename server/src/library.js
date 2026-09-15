import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { convertToTelegramVoice, convertToTelegramVideo } from './audio.js';

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
    if (this.store) { await this.store.getState("library"); return; }
    try { await fs.access(this.metaPath); } catch { await this.write([]); }
  }
  async read() { if(this.store) return (await this.store.getState("library")) ?? []; return JSON.parse(await fs.readFile(this.metaPath, 'utf8')); }
  async write(items) {
    if(this.store) return this.store.setState("library",items);
    const tmp = this.metaPath + '.tmp';
    await fs.writeFile(tmp, JSON.stringify(items, null, 2));
    await fs.rename(tmp, this.metaPath);
  }
  lock(fn) { const task = this.tail.then(fn); this.tail = task.catch(()=>{}); return task; }
  async list() { return (await this.read()).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)); }
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
    const id = crypto.randomUUID();
    const item = {id, kind, name:String(input.name || (file && path.parse(file.originalname).name) || 'Resposta').slice(0,80), category:String(input.category || 'Geral').slice(0,40), createdAt:new Date().toISOString()};
    let output;
    try {
      if (kind === 'text') {
        item.text = String(input.text || '').trim();
        if (!item.text || item.text.length > 4096) throw new Error('O texto precisa ter entre 1 e 4096 caracteres.');
      } else {
        if (!file) throw new Error('Selecione um arquivo.');
        const ext = path.extname(file.originalname).toLowerCase();
        const allowed = {voice:['.mp3','.m4a','.wav','.aac','.ogg','.opus','.mp4','.webm'],image:['.jpg','.jpeg','.png'],video:['.mp4']};
        if (!allowed[kind]?.includes(ext)) throw new Error('Formato incompatível com o tipo selecionado.');
        item.storedName = id + (kind === 'voice' ? '.ogg' : ext);
        output = path.join(this.libraryDir, item.storedName);
        if (kind === 'voice') Object.assign(item, await convertToTelegramVoice(file.path,output));
        else if(kind === 'video') Object.assign(item, await convertToTelegramVideo(file.path,output));
        else await fs.copyFile(file.path,output);
        item.size = (await fs.stat(output)).size;
        if(this.store) {
          const mime=kind==='voice'?'audio/ogg':kind==='video'?'video/mp4':ext==='.png'?'image/png':'image/jpeg';
          await this.store.upload(item.storedName,output,mime);
        }
      }
      const items = await this.read();items.push(item);await this.write(items);return item;
    } catch(e) { if(output) await fs.rm(output,{force:true}).catch(()=>{}); throw e; }
    finally { if(file) await fs.rm(file.path,{force:true}).catch(()=>{}); }
  }); }
  update(id, input) { return this.lock(async()=>{
    const items=await this.read(), item=items.find(x=>x.id===id);
    if(!item) throw new Error('Item não encontrado.');
    if(input.favorite !== undefined) item.favorite=!!input.favorite;
    if(input.name !== undefined) item.name=String(input.name).trim().slice(0,80) || item.name;
    if(input.category !== undefined) item.category=String(input.category).trim().slice(0,40) || 'Geral';
    if(input.text !== undefined && item.kind==='text') {
      const text=String(input.text).trim();if(!text || text.length>4096) throw new Error('Texto inválido.');item.text=text;
    }
    await this.write(items);return item;
  }); }
  remove(id) { return this.lock(async()=>{
    const items=await this.read(),item=items.find(x=>x.id===id);if(!item)return false;
    await this.write(items.filter(x=>x.id!==id));
    if(item.storedName && this.store)await this.store.remove(item.storedName);
    if(item.storedName)await fs.rm(path.join(this.libraryDir,path.basename(item.storedName)),{force:true});return true;
  }); }
}
