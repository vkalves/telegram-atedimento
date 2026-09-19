import test from 'node:test';
import assert from 'node:assert/strict';
import {TelegramService} from './telegram.js';
import {FlowWorker} from './flows.js';

test('histórico aceita apenas mensagens novas de entrada do peer exato, incluindo mídia',async()=>{
 const service=new TelegramService({apiId:1,apiHash:'test',dataDir:'/unused'});service.resolveTarget=async()=>({className:'User'});
 const base={className:'Message',id:101,date:1000,peerId:{userId:123n},fromId:{userId:123n},out:false};let options;
 service.client={getMe:async()=>({id:99n}),getMessages:async(_entity,o)=>{options=o;return [base,{...base,id:102,out:true},{...base,id:103,fromId:{userId:456n}},{...base,id:105,className:'MessageService'},{...base,id:106,media:{className:'MessageMediaDocument'}}];}};
 const page=await service.flowReplyPage({dialog_id:'123',reply_account_id:'99',reply_cursor:100});assert.deepEqual(page.messages.map(m=>m.id),[101,106]);assert.equal(page.cursor,106);assert.equal(page.complete,true);assert.deepEqual(options,{limit:100,minId:100,reverse:true});
 await assert.rejects(service.flowReplyPage({dialog_id:'123',reply_account_id:'another'}),/conta Telegram mudou/);
 service.client.getMessages=async()=>[{...base,peerId:{userId:456n}}];await assert.rejects(service.flowReplyPage({dialog_id:'123',reply_account_id:'99',reply_cursor:100}),/outra conversa/);
});
test('paginação de respostas não confunde 100 mensagens com histórico completo',async()=>{
 const service=new TelegramService({apiId:1,apiHash:'test',dataDir:'/unused'});service.resolveTarget=async()=>({className:'User'});
 service.client={getMe:async()=>({id:99n}),getMessages:async()=>Array.from({length:100},(_,i)=>({className:'Message',id:101+i,date:1000,out:true,peerId:{userId:123n}}))};
 const page=await service.flowReplyPage({dialog_id:'123',reply_account_id:'99',reply_cursor:100});assert.equal(page.complete,false);assert.equal(page.cursor,200);assert.equal(page.messages.length,0);
});
test('consulta lenta de um lead não bloqueia a próxima consulta de outro lead',async()=>{
 let release;const blocked=new Promise(r=>release=r);let calls=0;const processed=[];
 const worker=new FlowWorker({flows:{version:2,watch:async()=>++calls===1?[{id:'A'}]:[{id:'B'}],reply:async run=>processed.push(run.id)},telegram:{flowReplyPage:async run=>{if(run.id==='A')await blocked;return {};},friendlyError:e=>e.message},library:{}});
 await worker.pollReplies();await worker.pollReplies();await new Promise(r=>setImmediate(r));assert.deepEqual(processed,['B']);release();await Promise.all(worker.replyPending);assert.deepEqual(processed,['B','A']);
});
