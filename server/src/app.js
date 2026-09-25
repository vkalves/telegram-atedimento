import express from 'express';
import cors from 'cors';
import multer from 'multer';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import {Jobs} from './jobs.js';
export function createApp({telegram,library,sequences,categories=null,flows=null,support=null,inbox=null,token,extensionPassword='',extensionIds=[],dashboardOrigins=[]}){
 if(!token||token.length<32)throw new Error('Configure um ACCESS_TOKEN com pelo menos 32 caracteres.');
 if(extensionPassword&&extensionPassword.length<8)throw new Error('Configure EXTENSION_PASSWORD com pelo menos 8 caracteres.');
 const app=express(),jobs=new Jobs(telegram,library),rates=new Map(),loginRates=new Map();
 const configuredDashboardOrigins=Array.isArray(dashboardOrigins)?dashboardOrigins:String(dashboardOrigins||'').split(',');
 const dashboardOriginSet=new Set(['https://telegram-atendimento-dashboard.onrender.com',...configuredDashboardOrigins].map(origin=>String(origin).trim().replace(/\/$/,'')).filter(Boolean));
 const localDashboard=/^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/;
 const allowed=origin=>!origin||((/^chrome-extension:\/\/[a-p]{32}$/.test(origin)&&(!extensionIds.length||extensionIds.includes(origin.split('://')[1])))||dashboardOriginSet.has(origin.replace(/\/$/,''))||localDashboard.test(origin));
 app.set('trust proxy',1);app.disable('x-powered-by');
 app.use(cors({origin:(origin,cb)=>cb(null,allowed(origin)),methods:['GET','POST','PATCH','DELETE'],allowedHeaders:['Content-Type','Authorization']}));
 app.use((req,res,next)=>{
  res.set('Cache-Control','no-store');
  if(!allowed(req.get('Origin')))return res.status(403).json({error:'Origem não autorizada.'});
  if(req.path==='/health'&&req.method==='GET')return res.json({ok:true,version:'4.0.4',apiVersion:'3.0.1',extensionPasswordConfigured:!!extensionPassword});
  const origin=req.get('Origin')||'',supplied=Buffer.from(req.get('Authorization')||'');
  const matches=secret=>{const expected=Buffer.from('Bearer '+secret);return supplied.length===expected.length&&crypto.timingSafeEqual(supplied,expected);};
  const extensionOrigin=/^chrome-extension:\/\/([a-p]{32})$/.exec(origin);
  const trustedExtension=!!extensionOrigin&&(!extensionIds.length||extensionIds.includes(extensionOrigin[1]));
  // ACCESS_TOKEN is usable for server-to-server calls. The simpler extension
  // password must be tied to the browser extension origin, otherwise a leaked
  // password could be replayed from curl or an unrelated website.
  const authorized=matches(token)||(extensionPassword&&trustedExtension&&matches(extensionPassword));
  if(!authorized){
   const now=Date.now(),key=req.ip;for(const [k,v]of loginRates)if(now-v.since>60000)loginRates.delete(k);
   const entry=loginRates.get(key)||{since:now,count:0};entry.count++;loginRates.set(key,entry);
   if(entry.count>12)return res.status(429).json({error:'Muitas tentativas. Aguarde um minuto.'});
   return res.status(401).json({error:'Senha incorreta.'});
  }
  loginRates.delete(req.ip);
  if(req.path.startsWith('/auth/')&&req.method==='POST'){
   const now=Date.now(),key=req.ip;for(const [k,v]of rates)if(now-v.since>60000)rates.delete(k);
   const entry=rates.get(key)||{since:now,count:0};entry.count++;rates.set(key,entry);if(entry.count>12)return res.status(429).json({error:'Aguarde um minuto antes de tentar novamente.'});
  }
  next();
 });
 app.use(express.json({limit:'1mb'}));
 const upload=multer({dest:library.uploadDir,limits:{fileSize:50*1024*1024,files:1,fields:10,fieldSize:64*1024,parts:11}});
 app.get('/auth/status',async(_q,r)=>r.json(await telegram.status()));
 app.post('/auth/start',async(q,r)=>{const phone=String(q.body.phone||'').replace(/\s/g,'');if(!/^\+\d{8,16}$/.test(phone))throw new Error('Use o telefone com DDI: +55...');await telegram.startLogin(phone);r.json({ok:true});});
 app.post('/auth/code',(q,r)=>{if(!q.body.code)throw new Error('Informe o código.');telegram.submitCode(String(q.body.code).trim());r.json({ok:true});});
 app.post('/auth/password',(q,r)=>{if(!q.body.password)throw new Error('Informe a senha.');telegram.submitPassword(String(q.body.password));r.json({ok:true});});
 app.post('/context',async(q,r)=>r.json({target:await telegram.currentTarget(String(q.body.peerKey||''))}));
 app.use('/support',(_q,r,next)=>support&&inbox?next():r.status(503).json({error:'Aplique ATENDIMENTO.sql no Supabase e reinicie a API para habilitar a central de atendimento.'}));
 app.get('/support/queue',async(q,r)=>{const account=await inbox.accountId();r.json({...await support.queue(account,q.query),account,health:inbox.health()});});
 app.post('/support/import',async(_q,r)=>r.json(await inbox.importRecent()));
 app.post('/support/lead',async(q,r)=>{
  const target=await telegram.currentTarget(String(q.body.peerKey||''));
  if(target.id!==String(q.body.dialogId))throw new Error('A conversa mudou. Abra o painel novamente.');
  r.json({lead:await support.ingest(await inbox.accountId(),target)});
 });
 app.patch('/support/leads/:id',async(q,r)=>r.json({lead:await support.patch(await inbox.accountId(),q.params.id,q.body)}));
 app.post('/support/bulk',async(q,r)=>r.json({results:await support.bulk(await inbox.accountId(),q.body)}));
 app.get('/support/replies',async(_q,r)=>r.json({items:await support.replies()}));
 app.post('/support/replies',async(q,r)=>r.json({item:await support.saveReply(q.body)}));
 app.patch('/support/replies/:id',async(q,r)=>r.json({item:await support.saveReply(q.body,q.params.id)}));
 app.delete('/support/replies/:id',async(q,r)=>r.json({ok:await support.removeReply(q.params.id,q.body.version)}));
 app.get('/library',async(q,r)=>{
  let items=await library.list();
  if(q.query.kind)items=items.filter(item=>(item.kind||'voice')===String(q.query.kind));
  if(q.query.active==='true')items=items.filter(item=>item.active!==false);
  if(q.query.active==='false')items=items.filter(item=>item.active===false);
  if(q.query.category)items=items.filter(item=>(item.category||'Geral')===String(q.query.category));
  if(q.query.search){const search=String(q.query.search).toLocaleLowerCase('pt-BR');items=items.filter(item=>`${item.name} ${item.text||''}`.toLocaleLowerCase('pt-BR').includes(search));}
  r.json({items});
 });
 app.post('/library',upload.single('file'),async(q,r)=>{try{if(categories)await categories.ensure(q.body.category);r.json({item:await library.add(q.file,q.body)});}finally{if(q.file)await fs.rm(q.file.path,{force:true}).catch(()=>{});}});
 app.patch('/library/reorder',async(q,r)=>r.json({items:await library.reorder(q.body?.ids)}));
 app.patch('/library/:id',async(q,r)=>{if(categories&&q.body.category!==undefined)await categories.ensure(q.body.category);r.json({item:await library.update(q.params.id,q.body)});});
 app.post('/library/:id/file',upload.single('file'),async(q,r)=>{try{r.json({item:await library.replaceFile(q.params.id,q.file)});}finally{if(q.file)await fs.rm(q.file.path,{force:true}).catch(()=>{});}});
 app.delete('/library/:id',async(q,r)=>{if([...jobs.jobs.values()].some(j=>j.state==='running'))throw new Error('Aguarde ou pare os envios antes de excluir itens.');r.json({ok:await library.remove(q.params.id)});});
 app.get('/library/:id/preview',async(q,r)=>{const item=await library.get(q.params.id);if(!item?.path)return r.status(404).json({error:'Arquivo não encontrado.'});r.sendFile(item.path);});
 app.get('/categories',async(_q,r)=>r.json({categories:categories?await categories.list():[]}));
 app.post('/categories',async(q,r)=>{if(!categories)throw new Error('Categorias não estão disponíveis nesta instalação.');r.json({category:await categories.add(q.body)});});
 app.patch('/categories/:id',async(q,r)=>{if(!categories)throw new Error('Categorias não estão disponíveis nesta instalação.');r.json({category:await categories.rename(q.params.id,q.body)});});
 app.delete('/categories/:id',async(q,r)=>{if(!categories)throw new Error('Categorias não estão disponíveis nesta instalação.');r.json({ok:await categories.remove(q.params.id)});});
 // Fluxos são opcionais para preservar instalações durante a migração SQL.
 app.use(['/flows','/flow-runs'],(_q,r,next)=>flows?next():r.status(503).json({error:'Aplique as migrações das Partes 1 e 2 e reinicie o servidor para habilitar os fluxos.'}));
 app.get('/flows',async(_q,r)=>r.json({flows:await flows.list()}));
 app.post('/flows',async(q,r)=>r.json({flow:await flows.save(q.body,library)}));
 app.patch('/flows/:id',async(q,r)=>r.json({flow:await flows.save(q.body,library,q.params.id)}));
 app.delete('/flows/:id',async(q,r)=>r.json({ok:await flows.remove(q.params.id)}));
 app.get('/flow-runs',async(q,r)=>r.json({runs:await flows.runs(q.query.dialogId)}));
 app.get('/flow-runs/:id/logs',async(q,r)=>r.json({logs:await flows.logs(q.params.id)}));
 app.post('/flow-runs',async(q,r)=>{
  const target=await telegram.currentTarget(String(q.body.peerKey||''));
  if(target.id!==String(q.body.dialogId))throw new Error('A conversa mudou. Selecione o fluxo novamente.');
  r.json({run:await flows.start(q.body,target)});
 });
 app.post('/flow-runs/:id/control',async(q,r)=>r.json({run:await flows.control(q.params.id,q.body)}));
 app.post('/flow-runs/:id/cancel',async(q,r)=>r.json({run:await flows.cancel(q.params.id)}));
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
 app.use((err,_q,r,_n)=>{
  const messages={LIMIT_FILE_SIZE:'O arquivo excede 50 MB.',LIMIT_FIELD_SIZE:'Os dados do formulário excedem o limite permitido.',LIMIT_FIELD_COUNT:'O formulário contém campos demais.',LIMIT_PART_COUNT:'O formulário contém partes demais.',LIMIT_UNEXPECTED_FILE:'Campo de arquivo inesperado.'};
  const message=messages[err.code]||telegram.friendlyError(err);
  r.status(err.status===409?409:err.code==='LIMIT_FILE_SIZE'?413:400).json({error:message});
 });
 return app;
}
