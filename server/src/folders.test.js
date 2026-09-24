import test from 'node:test';
import assert from 'node:assert/strict';
import {FlowWorker, validateFlow} from './flows.js';
import {folderNameFromSnapshot, nextFilterId, planFolderMove} from './folders.js';

const voice={id:'audio-1',kind:'voice',active:true,storedName:'audio.ogg'};

test('pasta do fluxo fica gravada na primeira etapa sem SQL novo', () => {
  const saved=validateFlow({name:'A',active:true,doneFolder:'  Finalizados  ',steps:[{type:'text',text:'Oi'}]},[voice]);
  assert.equal(saved.steps[0].doneFolder,'Finalizados');
  assert.equal(folderNameFromSnapshot({steps:saved.steps}),'Finalizados');
  assert.equal(folderNameFromSnapshot({steps:[{type:'text',text:'Oi'}]}),'');
});

test('plano reutiliza pasta existente e não duplica o lead', () => {
  const peer={userId:'123'};
  const filters=[{className:'DialogFilter',id:7,title:'Finalizados',includePeers:[{userId:'999'}],pinnedPeers:[]}];
  const created=planFolderMove({filters:[],title:'Finalizados',peer});
  assert.equal(created.action,'create');
  assert.equal(created.id,2);
  const updated=planFolderMove({filters,title:'finalizados',peer});
  assert.equal(updated.action,'update');
  assert.equal(updated.id,7);
  assert.equal(planFolderMove({filters:[{...filters[0],includePeers:[peer]}],title:'Finalizados',peer}).action,'noop');
  assert.equal(nextFilterId([{id:2},{id:3}]),4);
});

test('worker só move o lead quando a execução conclui todas as etapas', async () => {
  const moved=[];
  const telegram={
    requireAuthorized:async()=>{},
    resolveTarget:async()=>{},
    simulateActivity:async()=>{},
    sendItem:async()=>({messageId:'1'}),
    addPeerToFolder:async(dialogId,folder)=>moved.push([dialogId,folder]),
    friendlyError:e=>e.message
  };
  const worker=new FlowWorker({
    flows:{version:2,dispatch:async()=>true,finish:async run=>({...run,status:'done'})},
    telegram,
    library:{}
  });
  await worker.execute({id:'done',claim_token:'t',dialog_id:'55',current_step:0,snapshot:{steps:[{type:'text',text:'Oi',doneFolder:'Finalizados'}]}});
  assert.deepEqual(moved,[['55','Finalizados']]);
  await worker.maybeMoveToFolder({id:'done',status:'done',dialog_id:'55',snapshot:{steps:[{type:'text',text:'Oi',doneFolder:'Finalizados'}]}});
  assert.equal(moved.length,1);

  const mid=new FlowWorker({
    flows:{version:2,dispatch:async()=>true,finish:async run=>({...run,status:'running'})},
    telegram,
    library:{}
  });
  await mid.execute({id:'mid',claim_token:'t',dialog_id:'55',current_step:0,snapshot:{steps:[{type:'text',text:'Oi',doneFolder:'Finalizados'},{type:'wait',seconds:1}]}});
  assert.equal(moved.length,1);
});
