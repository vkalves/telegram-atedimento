import express from 'express';
import cors from 'cors';
import multer from 'multer';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import {Jobs} from './jobs.js';
export function createApp({telegram,library,sequences,token,extensionIds=[],dashboardOrigins=[]}){
 if(!token||token.length<32)throw new Error('Configure um ACCESS_TOKEN com pelo menos 32 caracteres.');
 const app=express(),jobs=new Jobs(telegram,library),rates=new Map();
 const allowedDashboards=new Set(dashboardOrigins.map(origin=>String(origin).trim().replace(/\/$/,'')).filter(Boolean));
 const allowed=origin=>!origin||(/^chrome-extension:\/\/[a-p]{32}$/.test(origin)&&(!extensionIds.length||extensionIds.includes(origin.split('://')[1])))||allowedDashboards.has(origin);
 app.set('trust proxy',1);app.disable('x-powered-by');
 app.use(cors({origin:(origin,cb)=>cb(null,allowed(origin)),methods:['GET','POST','PATCH','DELETE'],allowedHeaders:['Content-Type','Authorization']}));
 app.use((req,res,next)=>{
  res.set('Cache-Control','no-store');
  if(!allowed(req.get('Origin')))return res.status(403).json({error:'Origem não autorizada.'});
  if(req.path==='/health'&&req.method==='GET')return res.json({ok:true,version:'3.0.1'});
  const supplied=Buffer.from(req.get('Authorization')||''),expected=Buffer.from('Bearer '+token);
  if(supplied.length!==expected.length||!crypto.timingSafeEqual(supplied,expected))return res.status(401).json({error:'Chave de acesso inválida. Confira a conexão nas configurações.'});
  if(req.path.startsWith('/auth/')&&req.method==='POST'){
   const now=Date.now(),key=req.ip;for(const [k,v]of rates)if(now-v.since>60000)rates.delete(k);
   const entry=rates.get(key)||{since:now,count:0};entry.count++;rates.set(key,entry);if(entry.count>12)return res.status(429).json({error:'Aguarde um minuto antes de tentar novamente.'});
  }
  next();
 });
 app.use(express.json({limit:'1mb'}));
 const upload=multer({dest:library.uploadDir,limits:{fileSize:50*1024*1024,files:1}});
 app.get('/auth/status',async(_q,r)=>r.json(await telegram.status()));
 app.post('/auth/start',async(q,r)=>{const phone=String(q.body.phone||'').replace(/\s/g,'');if(!/^\+\d{8,16}$/.test(phone))throw new Error('Use o telefone com DDI: +55...');await telegram.startLogin(phone);r.json({ok:true});});
 app.post('/auth/code',(q,r)=>{if(!q.body.code)throw new Error('Informe o código.');telegram.submitCode(String(q.body.code).trim());r.json({ok:true});});
 app.post('/auth/password',(q,r)=>{if(!q.body.password)throw new Error('Informe a senha.');telegram.submitPassword(String(q.body.password));r.json({ok:true});});
 app.post('/context',async(q,r)=>r.json({target:await telegram.currentTarget(String(q.body.peerKey||''))}));
 app.get('/library',async(_q,r)=>r.json({items:await library.list()}));
 app.post('/library',upload.single('file'),async(q,r)=>{try{r.json({item:await library.add(q.file,q.body)});}finally{if(q.file)await fs.rm(q.file.path,{force:true}).catch(()=>{});}});
 app.patch('/library/:id',async(q,r)=>r.json({item:await library.update(q.params.id,q.body)}));
 app.delete('/library/:id',async(q,r)=>{if([...jobs.jobs.values()].some(j=>j.state==='running'))throw new Error('Aguarde ou pare os envios antes de excluir itens.');r.json({ok:await library.remove(q.params.id)});});
 app.get('/library/:id/preview',async(q,r)=>{const item=await library.get(q.params.id);if(!item?.path)return r.status(404).json({error:'Arquivo não encontrado.'});r.sendFile(item.path);});
 app.get('/sequences',async(_q,r)=>r.json({sequences:await sequences.list()}));
 app.post('/sequences',async(q,r)=>r.json({sequence:await sequences.save(q.body)}));
 app.delete('/sequences/:id',async(q,r)=>r.json({ok:await sequences.remove(q.params.id)}));
 app.post('/jobs',async(q,r)=>{
  // Resolve again on the server and bind the request to this exact recipient.
  const target=await telegram.currentTarget(String(q.body.peerKey||''));
  if(target.id!==String(q.body.dialogId))throw new Error('A conversa mudou. Aguarde a atualização do destinatário e tente novamente.');
  r.json({job:jobs.create({...q.body,dialogId:target.id,targetName:target.name})});
 });
 app.get('/jobs',(_q,r)=>r.json({jobs:[...jobs.jobs.keys()].map(id=>jobs.get(id))}));
 app.post('/jobs/:id/cancel',(q,r)=>r.json({job:jobs.cancel(q.params.id)}));
 app.use((err,_q,r,_n)=>r.status(err.code==='LIMIT_FILE_SIZE'?413:400).json({error:err.code==='LIMIT_FILE_SIZE'?'O arquivo excede 50 MB.':telegram.friendlyError(err)}));
 return app;
}
