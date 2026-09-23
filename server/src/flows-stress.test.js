import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';

test('120 leads advance concurrently without crossing replies or duplicating sends',async()=>{
 const db=new PGlite(),query=async(sql,args=[])=>(await db.query(sql,args)).rows;
 try{
  await db.exec('create role anon;create role authenticated;create role service_role;');
  for(const file of ['FLUXOS-PARTE-1.sql','FLUXOS-PARTE-2.sql','FLUXOS-PARTE-3.sql'])await db.exec(await fs.readFile(new URL('../../supabase/'+file,import.meta.url),'utf8'));
  const steps=[{id:'reply_01',type:'reply',timeoutSeconds:0,timeoutAction:'end'},{id:'message_1',type:'text',text:'Recebido',activity:{enabled:false,type:'typing',durationSeconds:0}}];
  const [flow]=await query('insert into ta_flows(name,steps) values($1,$2) returning *',['Carga',JSON.stringify(steps)]);
  const total=120,runs=[];
  for(let index=1;index<=total;index++){
   const dialog=String(100000+index);
   const [run]=await query('select * from ta_flow_start_v3($1,$2,$3,$4,$5,$6)',[randomUUID(),flow.id,dialog,'Lead '+index,JSON.stringify({id:dialog,name:'Lead '+index,firstName:'Lead'}),'manual']);runs.push(run);
  }
  const armed=[];
  while(armed.length<total){
   const batch=await query('select * from ta_flow_claim()');assert.ok(batch.length>0&&batch.length<=20);
   for(const run of batch){
    const [waiting]=await query('select * from ta_flow_arm($1,$2,$3,$4)',[run.id,run.claim_token,500,'account-A']);armed.push(waiting);
   }
  }
  const stamp=new Date().toISOString();
  for(let index=0;index<armed.length;index++){
   const run=armed[index],messageId=1000+index;
   const [resumed]=await query('select * from ta_flow_incoming($1,$2,$3,$4,$5,$6,$7)',['account-A',run.dialog_id,messageId,stamp,`Resposta ${run.dialog_id}`,'text',JSON.stringify(run.target)]);
   assert.equal(resumed.id,run.id);assert.equal(resumed.dialog_id,run.dialog_id);assert.equal(Number(resumed.last_reply.id),messageId);
  }
  let finished=0;
  while(finished<total){
   const batch=await query('select * from ta_flow_claim()');assert.ok(batch.length>0&&batch.length<=20);
   for(const run of batch){
    assert.equal((await query('select ta_flow_dispatch($1,$2) as ok',[run.id,run.claim_token]))[0].ok,true);
    const [done]=await query('select * from ta_flow_finish($1,$2,$3,$4,$5)',[run.id,run.claim_token,'completed',String(5000+finished),null]);assert.equal(done.status,'done');finished++;
   }
  }
  const [summary]=await query("select count(*)::int total,count(*) filter(where status='done')::int done,count(distinct dialog_id)::int dialogs from ta_flow_runs where flow_id=$1",[flow.id]);
  assert.deepEqual(summary,{total,done:total,dialogs:total});
  const [evidence]=await query("select count(*) filter(where l.event='reply_received')::int replies,count(*) filter(where l.event='completed' and l.step=1)::int sends from ta_flow_logs l join ta_flow_runs r on r.id=l.run_id where r.flow_id=$1",[flow.id]);
  assert.deepEqual(evidence,{replies:total,sends:total});
 }finally{await db.close();}
});
