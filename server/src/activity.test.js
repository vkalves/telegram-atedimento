import test from 'node:test';
import assert from 'node:assert/strict';
import {TelegramService} from './telegram.js';
import {Jobs} from './jobs.js';
import {FlowWorker} from './flows.js';
import {
  ActivityAbortedError, computeAudioDelay, computeTextDelay, loadActivityConfig,
  resolveActivityPlan, runTelegramActivity
} from './activity.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));

function service() {
  const tg = new TelegramService({apiId: 1, apiHash: 'test', dataDir: '/unused'});
  tg.resolveTarget = async target => ({id: target.dialogId, dialogId: target.dialogId});
  return tg;
}

test('texto e áudio calculam atrasos naturais com teto e piso', () => {
  const config = loadActivityConfig({deterministic: true, jitter: 0});
  const short = computeTextDelay('Oi', config);
  const long = computeTextDelay('A'.repeat(400) + ' palavra '.repeat(40), config);
  assert.equal(short, config.textMinMs);
  assert.equal(long, config.textMaxMs);
  assert.ok(computeTextDelay('Olá, tudo bem com você hoje?', config) > short);
  assert.equal(computeAudioDelay(0, config), config.audioMinMs);
  assert.equal(computeAudioDelay(600, config), config.audioMaxMs);
  assert.ok(computeAudioDelay(8, config) <= computeAudioDelay(20, config));
});

test('plano automático só existe quando o chamador pede activity; recordingDelay legado continua válido', () => {
  assert.equal(resolveActivityPlan({kind: 'text', text: 'Oi'}).delayMs, 0);
  assert.ok(resolveActivityPlan({kind: 'text', text: 'Oi, tudo bem?'}, {activity: 'auto', config: {deterministic: true}}).delayMs >= 1000);
  assert.equal(resolveActivityPlan({kind: 'voice', duration: 3}, {recordingDelay: 0.002}).delayMs, 2);
  assert.equal(resolveActivityPlan({kind: 'voice', duration: 3}, {activity: false, recordingDelay: 0}).delayMs, 0);
  assert.equal(resolveActivityPlan({kind: 'text', text: 'Oi'}, {activity: 'custom', config: {customTextMs: 1500}}).action, 'typing');
  assert.equal(resolveActivityPlan({kind: 'voice'}, {activity: 'auto'}).action, 'record');
});

test('texto dispara typing antes do envio e só envia depois do delay', async () => {
  const tg = service();
  const calls = [];
  tg.client = {
    invoke: async request => calls.push(request.action.className),
    sendMessage: async () => { calls.push('sent'); return {id: 7}; }
  };
  const started = Date.now();
  await tg.sendItem({kind: 'text', text: 'Oi'}, {dialogId: '11'}, {activityDelay: 25});
  assert.ok(Date.now() - started >= 20);
  assert.deepEqual(calls, ['SendMessageTypingAction', 'sent']);
});

test('áudio dispara recording antes do envio e só envia depois do delay', async () => {
  const tg = service();
  const calls = [];
  tg.client = {
    invoke: async request => calls.push(request.action.className),
    sendFile: async () => { calls.push('sent'); return {id: 8}; }
  };
  await tg.sendItem({path: '/x.ogg', duration: 2, kind: 'voice'}, {dialogId: '11'}, {recordingDelay: 0.02});
  assert.deepEqual(calls, ['SendMessageRecordAudioAction', 'sent']);
});

test('cancelamento durante o delay encerra o timer e não envia', async () => {
  const tg = service();
  const calls = [];
  tg.client = {
    invoke: async request => calls.push(request.action.className),
    sendMessage: async () => { calls.push('sent'); return {id: 1}; }
  };
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 15);
  await assert.rejects(
    tg.sendItem({kind: 'text', text: 'Olá'}, {dialogId: '11'}, {activityDelay: 200, signal: controller.signal}),
    error => error.name === 'ActivityAbortedError'
  );
  await sleep(30);
  assert.ok(calls.includes('SendMessageTypingAction'));
  assert.ok(calls.includes('SendMessageCancelAction'));
  assert.ok(!calls.includes('sent'));
});

test('erro no SetTyping não impede nem duplica o envio', async () => {
  const tg = service();
  let sent = 0;
  tg.client = {
    invoke: async () => { throw new Error('NETWORK'); },
    sendMessage: async () => { sent++; return {id: 3}; }
  };
  const result = await tg.sendItem({kind: 'text', text: 'Oi'}, {dialogId: '11'}, {activityDelay: 10});
  assert.equal(result.messageId, '3');
  assert.equal(sent, 1);
});

test('indicador é renovado e o intervalo some depois do envio', async () => {
  const actions = [];
  await runTelegramActivity({
    sendAction: async () => { actions.push('on'); },
    cancelAction: async () => { actions.push('off'); },
    delayMs: 45,
    renewEveryMs: 15
  });
  assert.ok(actions.filter(x => x === 'on').length >= 2);
  assert.equal(actions.includes('off'), false);
});

test('follow-up, fluxos e sequências usam a mesma atividade central', async () => {
  const order = [];
  const telegram = {
    requireAuthorized: async () => {},
    resolveTarget: async target => order.push(['resolve', target.dialogId]),
    simulateActivity: async (item, target) => order.push(['activity', item.kind, target.dialogId, item.text]),
    sendItem: async (item, target) => { order.push(['send', item.kind, target.dialogId]); return {messageId: '1'}; },
    friendlyError: e => e.message
  };
  const flows = {
    version: 2,
    dispatch: async run => { order.push(['dispatch', run.dialog_id]); return true; },
    finish: async (run, status) => order.push(['finish', status, run.dialog_id])
  };
  await new FlowWorker({flows, telegram, library: {get: async () => ({kind: 'voice', path: '/a.ogg', active: true})}}).execute({
    id: 'run', claim_token: 'token', dialog_id: '55', current_step: 0, snapshot: {steps: [{type: 'text', text: 'Oi'}]}
  });
  await new FlowWorker({flows, telegram, library: {}}).execute({
    id: 'fu', claim_token: 'token', dialog_id: '55', current_step: 0, dispatch_kind: 'followup',
    snapshot: {steps: [{type: 'reply', followupText: 'Ainda está aí?'}]}
  });
  assert.deepEqual(order.filter(x => x[0] === 'activity' || x[0] === 'dispatch' || x[0] === 'send'), [
    ['activity', 'text', '55', 'Oi'],
    ['dispatch', '55'],
    ['send', 'text', '55'],
    ['activity', 'text', '55', 'Ainda está aí?'],
    ['dispatch', '55'],
    ['send', 'text', '55']
  ]);

  const sent = [];
  const jobs = new Jobs({
    requireAuthorized: async () => {},
    friendlyError: e => e.message,
    sendItem: async (item, target, options) => { sent.push({id: item.id, dialogId: target.dialogId, activity: options.activity, signal: !!options.signal}); return {messageId: '9'}; }
  }, {get: async id => ({id, kind: 'text', text: 'Oi'})});
  jobs.create({requestId: 'request-act-1', dialogId: '77', steps: [{id: 't1', delay: 0}]});
  await sleep(20);
  assert.equal(sent[0].activity, 'auto');
  assert.equal(sent[0].signal, true);
  assert.equal(sent[0].dialogId, '77');
});

test('dois leads simultâneos não misturam destinatários da atividade', async () => {
  const seen = [];
  const telegram = {
    requireAuthorized: async () => {},
    resolveTarget: async target => seen.push(['resolve', target.dialogId]),
    simulateActivity: async (item, target) => seen.push(['activity', target.dialogId]),
    sendItem: async (item, target) => { seen.push(['send', target.dialogId]); return {messageId: '1'}; },
    friendlyError: e => e.message
  };
  const worker = new FlowWorker({
    flows: {version: 2, dispatch: async () => true, finish: async () => {}},
    telegram,
    library: {}
  });
  await Promise.all([
    worker.execute({id: 'a', claim_token: 't', dialog_id: '111', current_step: 0, snapshot: {steps: [{type: 'text', text: 'A'}]}}),
    worker.execute({id: 'b', claim_token: 't', dialog_id: '222', current_step: 0, snapshot: {steps: [{type: 'text', text: 'B'}]}})
  ]);
  assert.deepEqual(seen.filter(x => x[0] === 'activity').map(x => x[1]).sort(), ['111', '222']);
  assert.deepEqual(seen.filter(x => x[0] === 'send').map(x => x[1]).sort(), ['111', '222']);
  assert.equal(seen.filter(x => x[0] === 'activity' && x[1] === '111').length, 1);
  assert.equal(seen.filter(x => x[0] === 'send' && x[1] === '222').length, 1);
});

test('pausa ou cancelamento durante a preparação bloqueia o envio', async () => {
  let dispatchCalls = 0, sent = 0;
  const telegram = {
    requireAuthorized: async () => {},
    resolveTarget: async () => {},
    simulateActivity: async () => {},
    sendItem: async () => { sent++; return {messageId: '1'}; },
    friendlyError: e => e.message
  };
  await new FlowWorker({
    flows: {version: 2, dispatch: async () => { dispatchCalls++; return false; }, finish: async () => {}},
    telegram,
    library: {}
  }).execute({id: 'p', claim_token: 't', dialog_id: '1', current_step: 0, snapshot: {steps: [{type: 'text', text: 'Oi'}]}});
  assert.equal(dispatchCalls, 1);
  assert.equal(sent, 0);

  const aborting = {
    requireAuthorized: async () => {},
    resolveTarget: async () => {},
    simulateActivity: async () => { throw new ActivityAbortedError('state'); },
    sendItem: async () => { sent++; return {messageId: '1'}; },
    friendlyError: e => e.message
  };
  const finished = [];
  await new FlowWorker({
    flows: {version: 2, dispatch: async () => true, finish: async (...args) => finished.push(args)},
    telegram: aborting,
    library: {}
  }).execute({id: 'c', claim_token: 't', dialog_id: '1', current_step: 0, snapshot: {steps: [{type: 'text', text: 'Oi'}]}});
  assert.equal(sent, 0);
  assert.equal(finished.length, 0);
});

test('jobs cancelados no delay de atividade não enviam e não ficam em erro', async () => {
  const sent = [];
  const jobs = new Jobs({
    requireAuthorized: async () => {},
    friendlyError: e => e.message,
    sendItem: async (item, target, options) => {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, 80);
        options.signal.addEventListener('abort', () => { clearTimeout(timer); const err = new Error('stop'); err.name = 'ActivityAbortedError'; reject(err); }, {once: true});
      });
      sent.push(item.id);
      return {messageId: '1'};
    }
  }, {get: async id => ({id, kind: 'text', text: 'Oi'})});
  jobs.create({requestId: 'request-act-2', dialogId: '11', steps: [{id: 't1', delay: 0}]});
  await sleep(10);
  jobs.cancel('request-act-2');
  await sleep(40);
  assert.equal(sent.length, 0);
  assert.equal(jobs.get('request-act-2').state, 'cancelled');
});
