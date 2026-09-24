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
