import test from 'node:test';
import assert from 'node:assert/strict';
import {TelegramService} from './telegram.js';
import {FlowWorker} from './flows.js';

test('histórico aceita apenas mensagens novas de entrada do peer exato, incluindo mídia e texto para condições',async()=>{
 const service=new TelegramService({apiId:1,apiHash:'test',dataDir:'/unused'});service.resolveTarget=async()=>({className:'User'});
 const base={className:'Message',id:101,date:1000,peerId:{userId:123n},fromId:{userId:123n},out:false};let options;
 service.client={getMe:async()=>({id:99n}),getMessages:async(_entity,o)=>{options=o;return [base,{...base,id:102,out:true},{...base,id:103,fromId:{userId:456n}},{...base,id:105,className:'MessageService'},{...base,id:106,media:{className:'MessageMediaDocument'}}];}};
 const page=await service.flowReplyPage({dialog_id:'123',reply_account_id:'99',reply_cursor:100});assert.deepEqual(page.messages.map(m=>m.id),[101,106]);assert.equal(page.messages[1].type,'MessageMediaDocument');assert.equal(page.messages[0].text,'');assert.equal(page.cursor,106);assert.equal(page.complete,true);assert.deepEqual(options,{limit:100,minId:100,reverse:true});
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

test('indicadores usam ações MTProto oficiais e podem ser cancelados',async()=>{
 const service=new TelegramService({apiId:1,apiHash:'test',dataDir:'/unused'});service.resolveTarget=async()=>({className:'User'});const actions=[];
 service.client={invoke:async request=>actions.push(request.action.className)};
 for(const action of ['typing','record-audio','upload-audio','photo','video','document'])await service.sendActivity({dialogId:'123'},action);
 await service.cancelActivity({dialogId:'123'});
 assert.deepEqual(actions,['SendMessageTypingAction','SendMessageRecordAudioAction','SendMessageUploadAudioAction','SendMessageUploadPhotoAction','SendMessageUploadVideoAction','SendMessageUploadDocumentAction','SendMessageCancelAction']);
 await assert.rejects(service.sendActivity({dialogId:'123'},'inventado'),/não suportado/);
});

test('eventos privados identificam conta, conversa, direção e perfil sem depender do navegador',async()=>{
 const service=new TelegramService({apiId:1,apiHash:'test',dataDir:'/unused'});let callback,getMeCalls=0;const received=[];
 service.client={addEventHandler:handler=>callback=handler,getMe:async()=>{getMeCalls++;return {id:99n};},getPeerId:async()=>123n};service.onMessage(message=>received.push(message));service.installMessageHandler();
 await callback({isPrivate:true,chatId:123n,message:{id:7,date:1000,out:false,message:'Oi',getSender:async()=>({firstName:'Ana',username:'ana'})}});
 await callback({isPrivate:true,chatId:123n,message:{id:8,date:1001,out:false,message:'Tudo bem?',getSender:async()=>({firstName:'Ana',username:'ana'})}});
 assert.equal(received[0].accountId,'99');assert.equal(received[0].dialogId,'123');assert.equal(received[0].direction,'incoming');assert.equal(received[0].target.firstName,'Ana');assert.equal(received[0].text,'Oi');
 assert.equal(received.length,2);assert.equal(getMeCalls,1,'a conta é consultada uma única vez, não a cada update');
});

test('updates sem helpers de entidade usam resolução segura e continuam chegando aos observadores',async()=>{
 const service=new TelegramService({apiId:1,apiHash:'test',dataDir:'/unused'});let callback;const received=[];
 service.client={addEventHandler:handler=>callback=handler,getMe:async()=>({id:99n}),getPeerId:async()=>123n};
 service.resolveTarget=async()=>({className:'User',firstName:'Fallback',username:'fallback'});
 service.onMessage(message=>received.push(message));service.installMessageHandler();
 await callback({isPrivate:true,chatId:123n,message:{id:9,date:new Date(1000_000),out:false,message:'Entrada'}});
 await callback({isPrivate:true,chatId:123n,message:{id:10,date:1001,out:true,message:'Saída'}});
 assert.deepEqual(received.map(message=>[message.direction,message.target.firstName]),[['incoming','Fallback'],['outgoing','Fallback']]);
});
