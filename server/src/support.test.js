import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {SupportStore,SupportInbox,validateLeadPatch} from './support.js';
import {createApp} from './app.js';

test('support SQL: pagination, accounts, replies, manual edits, event replay and permissions',async()=>{
 const db=new PGlite();
 try{
  await db.exec('create role anon;create role authenticated;create role service_role;');
  const sql=await fs.readFile(new URL('../../supabase/ATENDIMENTO.sql',import.meta.url),'utf8');await db.exec(sql);await db.exec(sql);
  const query=async(sql,args=[])=>(await db.query(sql,args)).rows;
  const ingest=async(account,id,msg,incoming,date=new Date().toISOString())=>(await query('select * from ta_support_ingest($1,$2,$3,$4,$5,$6,$7,$8)',[account,id,'Lead '+id,null,msg,date,incoming,'Mensagem']))[0];
  let lead=await ingest('1','123',10,true);assert.equal(lead.status,'open');assert.equal(lead.needs_reply,true);
  await query("update ta_leads set notes='Contexto importante',priority=2 where account_id='1' and dialog_id='123'");
  lead=await ingest('1','123',11,false);assert.equal(lead.needs_reply,false);assert.equal(lead.status,'waiting');assert.equal(lead.notes,'Contexto importante');assert.equal(lead.priority,2);
  const version=lead.version;lead=await ingest('1','123',10,true);assert.equal(lead.version,version);assert.equal(lead.needs_reply,false);
  await query("update ta_leads set status='snoozed',due_at=now()+interval '1 day' where account_id='1' and dialog_id='123'");
  lead=await ingest('1','123',12,true);assert.equal(lead.status,'open');assert.equal(lead.due_at,null);
  await query("update ta_leads set status='done',needs_reply=false,status_changed_at=now() where account_id='1' and dialog_id='123'");
  lead=await ingest('1','123',13,true,'2020-01-01');assert.equal(lead.status,'done');assert.equal(lead.needs_reply,false); // delayed import cannot reopen a newer manual decision
  lead=await ingest('1','123',14,true,new Date(Date.now()+5000).toISOString());assert.equal(lead.status,'open');assert.equal(lead.needs_reply,true);
  await ingest('2','123',99,true);
  await query("insert into ta_leads(account_id,dialog_id,name) select '1',generate_series::text,'Pessoa '||generate_series from generate_series(1000,1999)");
  const queue=async(filter,offset=0,search='')=>(await query('select ta_support_queue($1,$2,$3,$4,$5) as data',['1',filter,search,offset,50]))[0].data;
  const first=await queue('all'),second=await queue('all',50);assert.equal(first.total,1001);assert.equal(first.items.length,50);assert.equal(first.items[0].dialog_id,'123');assert.equal(new Set([...first.items,...second.items].map(r=>r.dialog_id)).size,100);
  assert.equal((await queue('all',0,'%')).total,0);assert.equal((await queue('all',0,'Pessoa 1000')).total,1);assert.equal((await queue('reply')).total,1);
  await db.exec('set role anon');await assert.rejects(query('select * from ta_leads'),/permission denied/);await assert.rejects(query("select ta_support_queue('1')"),/permission denied/);await db.exec('reset role');
 }finally{await db.close();}
});

test('patch validation and optimistic concurrency preserve notes and reject invalid dates',async()=>{
 assert.throws(()=>validateLeadPatch({version:1,status:'snoozed'}),/data futura/);
 assert.throws(()=>validateLeadPatch({version:1,priority:3}),/Prioridade/);
 assert.throws(()=>validateLeadPatch({version:1,tags:['x'.repeat(33)]}),/Etiqueta/);
 const done=validateLeadPatch({version:2,status:'done'});assert.equal(done.needs_reply,false);assert.equal(done.due_at,null);assert.equal(done.version,3);
 const store=new SupportStore({request:async()=>[]});await assert.rejects(store.patch('1','123',{version:1,notes:'Meu rascunho'}),e=>e.status===409);
 const results=await store.bulk('1',{items:[{id:'123',version:1},{id:'456',version:1}],patch:{priority:2}});assert.equal(results.length,2);assert.ok(results.every(r=>!r.ok));
});

test('inbox retries DB failures without sending and skips old/foreign messages',async()=>{
 const calls=[];let fail=true;
 const inbox=new SupportInbox({support:{ingest:async(...args)=>{if(fail)throw Error('offline');calls.push(args);}},telegram:{requireAuthorized:async()=>{},client:{getMe:async()=>({id:'1'})},dialogMap:new Map()}});
 const event=(id,out=false)=>({message:{id,className:'Message',peerId:{userId:123},date:Math.floor(Date.now()/1000),out,message:'Olá'}});
 await inbox.capture(event(10));await new Promise(resolve=>setImmediate(resolve));assert.equal(inbox.pending.size,1);assert.ok(inbox.health().error);
 await inbox.capture(event(9));assert.equal([...inbox.pending.values()][0].event.id,10);
 fail=false;await inbox.flush();assert.equal(calls.length,1);assert.equal(inbox.pending.size,0);
 await inbox.capture({message:{id:11,className:'Message',peerId:{channelId:44}}});assert.equal(calls.length,1);
});

test('support API requires authentication and binds lead registration to the current target',async()=>{
 const writes=[];const token='x'.repeat(32);
 const app=createApp({token,telegram:{currentTarget:async()=>({id:'123',name:'A'}),friendlyError:e=>e.message},library:{uploadDir:'/tmp'},sequences:{},support:{ingest:async(...args)=>{writes.push(args);return {dialog_id:'123'};}},inbox:{accountId:async()=> '1'}});
 const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const base='http://127.0.0.1:'+server.address().port;
 try{
  assert.equal((await fetch(base+'/support/queue')).status,401);
  const request=body=>fetch(base+'/support/lead',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(body)});
  assert.equal((await request({peerKey:'123',dialogId:'456'})).status,400);assert.equal(writes.length,0);
  assert.equal((await request({peerKey:'123',dialogId:'123'})).status,200);assert.equal(writes[0][0],'1');
 }finally{await new Promise(r=>server.close(r));}
});
