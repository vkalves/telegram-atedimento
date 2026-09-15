import test from 'node:test';
import assert from 'node:assert/strict';
import {SupabaseStore} from './supabase-store.js';
test('REST adapter uses the private table, minimal upsert and server-only key',async()=>{
 const calls=[],store=new SupabaseStore({url:'https://example.supabase.co',key:'legacy-service-role-test',fetchImpl:async(url,options)=>{calls.push({url,options});return options.method==='POST'?new Response(null,{status:201}):new Response(JSON.stringify([{payload:['saved']}]),{status:200});}});
 assert.deepEqual(await store.getState('library'),['saved']);await store.setState('library',['next']);
 assert.match(calls[0].url,/ta_state\?select=payload&id=eq.library$/);assert.equal(calls[0].options.headers.Authorization,'Bearer legacy-service-role-test');assert.match(calls[1].options.headers.Prefer,/merge-duplicates/);assert.equal(JSON.parse(calls[1].options.body).id,'library');
});
test('new secret keys use apikey without an invalid JWT bearer',async()=>{
 let options;const store=new SupabaseStore({url:'https://example.supabase.co',key:'sb_secret_TEST',fetchImpl:async(_u,o)=>{options=o;return new Response('[]');}});assert.equal(await store.getState('library'),null);assert.equal(options.headers.apikey,'sb_secret_TEST');assert.equal(options.headers.Authorization,undefined);
});
test('error bodies never expose provider data and arbitrary object paths are refused',async()=>{
 const store=new SupabaseStore({url:'https://example.supabase.co',key:'secret',fetchImpl:async()=>new Response('sensitive provider details',{status:403})});
 await assert.rejects(store.getState('library'),e=>e.message.includes('403')&&!e.message.includes('sensitive'));
 assert.throws(()=>store.objectPath('../session.enc'));assert.throws(()=>store.objectPath('https://example.com/a.png'));
});
test('private media downloads use the authenticated route and stream to disk',async()=>{
 const fs=await import('node:fs/promises'),os=await import('node:os'),path=await import('node:path');
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'sb-adapter-'));let called;
 try{
  const store=new SupabaseStore({url:'https://example.supabase.co',key:'legacy-test',fetchImpl:async url=>{called=url;return new Response('audio-bytes');}});
  const file=path.join(dir,'a.ogg');await store.download('abc-123.ogg',file);
  assert.match(called,/\/object\/authenticated\/ta-media\/abc-123.ogg$/);assert.equal(await fs.readFile(file,'utf8'),'audio-bytes');
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
