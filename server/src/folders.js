import {Api} from 'teleproto';

export function folderTitle(value) {
  const name = String(value || '').trim().replace(/\s+/g, ' ').slice(0, 12);
  return name || '';
}

export function folderNameFromSnapshot(snapshot) {
  return folderTitle(snapshot?.doneFolder) || folderTitle(snapshot?.steps?.[0]?.doneFolder);
}

function titleOf(filter) {
  const title = filter?.title;
  if (title && typeof title === 'object') return String(title.text || title.value || '');
  return String(title || '');
}

function peerKey(peer) {
  return String(peer?.userId || peer?.channelId || peer?.chatId || '');
}

export function nextFilterId(filters) {
  const used = new Set((filters || []).map(filter => Number(filter.id)).filter(id => Number.isInteger(id) && id > 0));
  for (let id = 2; id < 255; id++) if (!used.has(id)) return id;
  throw new Error('O Telegram atingiu o limite de pastas nesta conta.');
}

export function listDialogFilters(raw) {
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw?.filters)) return raw.filters;
  if (Array.isArray(raw?.dialogFilters)) return raw.dialogFilters;
  return [];
}

function apiTitle(name, existing) {
  if (existing && typeof existing === 'object') return existing;
  if (Api.TextWithEntities) return new Api.TextWithEntities({text: name, entities: []});
  return name;
}

export function planFolderMove({filters, title, peer}) {
  const wanted = folderTitle(title);
  if (!wanted || !peer) return {action: 'skip'};
  const list = (filters || []).filter(filter => filter && (filter.className === 'DialogFilter' || Number.isInteger(Number(filter.id))));
  const existing = list.find(filter => titleOf(filter).toLocaleLowerCase('pt-BR') === wanted.toLocaleLowerCase('pt-BR'));
  const key = peerKey(peer);
  if (existing) {
    const already = [...(existing.includePeers || []), ...(existing.pinnedPeers || [])].some(item => peerKey(item) === key);
    if (already) return {action: 'noop', id: existing.id};
    return {action: 'update', id: existing.id, filter: existing, includePeers: [...(existing.includePeers || []), peer]};
  }
  return {action: 'create', id: nextFilterId(list), title: wanted, includePeers: [peer]};
}

export async function applyFolderMove(client, entity, folderName) {
  const title = folderTitle(folderName);
  if (!title) return {moved: false};
  const peer = await client.getInputEntity(entity);
  const raw = await client.invoke(new Api.messages.GetDialogFilters());
  const plan = planFolderMove({filters: listDialogFilters(raw), title, peer});
  if (plan.action === 'skip' || plan.action === 'noop') return {moved: plan.action !== 'skip', existed: plan.action === 'noop'};
  const base = plan.filter || {};
  const filter = new Api.DialogFilter({
    id: plan.id,
    title: apiTitle(plan.title || titleOf(base) || title, plan.action === 'update' ? base.title : undefined),
    pinnedPeers: base.pinnedPeers || [],
    includePeers: plan.includePeers,
    excludePeers: base.excludePeers || []
  });
  try {
    await client.invoke(new Api.messages.UpdateDialogFilter({id: plan.id, filter}));
  } catch {
    filter.title = title;
    await client.invoke(new Api.messages.UpdateDialogFilter({id: plan.id, filter}));
  }
  return {moved: true, created: plan.action === 'create'};
}
