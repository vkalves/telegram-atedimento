import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {FlowWorker} from './flows.js';

test('PostgreSQL migration, independent flows, recovery, deduplication, logs and permissions',async()=>{
 const db=new PGlite();
 try{
  await db.exec('create role anon;create role authenticated;create role service_role;');
  const sql=await fs.readFile(new URL('../../supabase/FLUXOS-PARTE-1.sql',import.meta.url),'utf8');
  await db.exec(sql);await db.exec(sql); // repeatable, no data removal
  const query=async(sql,args=[])=>(await db.query(sql,args)).rows;
  const steps=[{type:'text',text:'Primeira'},{type:'wait',seconds:3},{type:'audio',audioId:'existing'},{type:'wait',seconds:5},{type:'text',text:'Última'}];
  const [flow]=await query('insert into ta_flows(name,steps) values($1,$2) returning *',['Boas-vindas',JSON.stringify(steps)]);
  const start=async(id,dialog)=>(await query('select * from ta_flow_start($1,$2,$3,$4)',[id,flow.id,dialog,'Lead '+dialog]))[0];
  const id=randomUUID(),a=await start(id,'123'),b=await start(randomUUID(),'456');
  assert.notEqual(a.id,b.id);assert.equal((await start(id,'123')).id,a.id);
  const concurrent=await Promise.all([start(randomUUID(),'123'),start(randomUUID(),'123')]);assert.ok(concurrent.every(r=>r.id===a.id));
  await assert.rejects(start(id,'789'),/outra execução/);
  const [other]=await query('insert into ta_flows(name,steps) values($1,$2) returning *',['Outro',JSON.stringify(steps)]);
  await assert.rejects(query('select * from ta_flow_start($1,$2,$3,$4)',[randomUUID(),other.id,'123','A']),/outro fluxo/);
  await query("update ta_flows set steps='[{\"type\":\"text\",\"text\":\"Editado\"}]',active=false where id=$1",[flow.id]);
  assert.deepEqual((await query('select snapshot from ta_flow_runs where id=$1',[a.id]))[0].snapshot.steps,steps);
  const rpc={claim:()=>query('select * from ta_flow_claim()'),finish:async(run,status,message=null,error=null)=>(await query('select * from ta_flow_finish($1,$2,$3,$4,$5)',[run.id,run.claim_token,status,message,error]))[0]};
  const claimed=await rpc.claim();assert.equal(claimed.length,2);assert.equal((await rpc.claim()).length,0);
  const sent=[];const fixture={flows:rpc,library:{get:async()=>({kind:'voice',path:'/same-library.ogg',active:true})},telegram:{requireAuthorized:async()=>{},resolveTarget:async()=>{},sendItem:async(item,target)=>{sent.push({item,target});return {messageId:String(sent.length)};},friendlyError:e=>e.message}};
  for(const r of claimed)await new FlowWorker(fixture).execute(r);
  // Duplicate result acknowledgement cannot advance twice.
  await rpc.finish(claimed[0],'completed','1');
  assert.ok((await query('select current_step from ta_flow_runs')).every(r=>r.current_step===1));
  await rpc.claim();assert.ok((await query('select status from ta_flow_runs')).every(r=>r.status==='waiting'));
  assert.equal((await rpc.claim()).length,0); // waits must not fire early
  // Resume only lead A after a server restart; B keeps its own wait.
  await query("update ta_flow_runs set due_at=now()-interval '1 second' where id=$1",[a.id]);
  const [audio]=await rpc.claim();assert.equal(audio.id,a.id);assert.equal(audio.current_step,2);
  await new FlowWorker(fixture).execute(audio);assert.equal(sent[2].item.kind,'voice');assert.equal(sent[2].target.dialogId,'123');
  await rpc.claim();await query("update ta_flow_runs set due_at=now()-interval '1 second' where id=$1",[a.id]);
  const [last]=await rpc.claim();await new FlowWorker(fixture).execute(last);
  const [done]=await query('select * from ta_flow_runs where id=$1',[a.id]);assert.equal(done.status,'done');assert.ok(done.completed_at);
  assert.equal((await query('select status from ta_flow_runs where id=$1',[b.id]))[0].status,'waiting');
  assert.equal((await start(randomUUID(),'123')).id,a.id); // fast accidental restart
  const logs=await query("select * from ta_flow_logs where run_id=$1 and event='completed'",[a.id]);assert.equal(logs.length,5);
  // Recovery of an unacknowledged send must not resend, and blocks new starts.
  await query("update ta_flow_runs set due_at=now()-interval '1 second' where id=$1",[b.id]);const [lost]=await rpc.claim();
  await query("update ta_flow_runs set updated_at=now()-interval '11 minutes' where id=$1",[b.id]);assert.equal((await rpc.claim()).length,0);
  assert.equal((await query('select status from ta_flow_runs where id=$1',[b.id]))[0].status,'uncertain');
  assert.equal((await start(randomUUID(),'456')).id,b.id);
  // Wrong claim token cannot acknowledge someone else's step.
  await rpc.finish({...lost,claim_token:randomUUID()},'completed','999');assert.equal((await query('select status from ta_flow_runs where id=$1',[b.id]))[0].status,'uncertain');
  await query('select * from ta_flow_cancel($1)',[b.id]);assert.equal((await query('select status from ta_flow_runs where id=$1',[b.id]))[0].status,'cancelled');
  await rpc.finish(lost,'completed','999');assert.equal((await query('select status from ta_flow_runs where id=$1',[b.id]))[0].status,'cancelled');
  await assert.rejects(start(randomUUID(),'999'),/desativado/);
  // Cancel during an external send: finish current send, never execute next step.
  await query('update ta_flows set active=true,steps=$2 where id=$1',[flow.id,JSON.stringify(steps)]);
  const c=await start(randomUUID(),'789');const [sending]=await rpc.claim();assert.equal(sending.id,c.id);
  await query('select * from ta_flow_cancel($1)',[c.id]);
  assert.equal((await query('select status from ta_flow_runs where id=$1',[c.id]))[0].status,'sending');
  await rpc.finish(sending,'completed','1000');
  assert.equal((await query('select status from ta_flow_runs where id=$1',[c.id]))[0].status,'cancelled');assert.equal((await rpc.claim()).length,0);
  await db.exec('set role anon');await assert.rejects(query('select * from ta_flow_runs'),/permission denied/);await assert.rejects(query('select * from ta_flow_claim()'),/permission denied/);await db.exec('reset role');
 }finally{await db.close();}
});
