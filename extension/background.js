const TELEGRAM_WEB = 'https://web.telegram.org/';

function isTelegramSender(sender) {
  return sender?.tab?.url?.startsWith(TELEGRAM_WEB);
}

function isSupportedPath(path) {
  return /^\/(?:health|context|library(?:\?.*)?|jobs(?:\/[^/]+\/cancel)?)$/.test(path);
}

async function getConnection() {
  const {connection} = await chrome.storage.local.get('connection');
  if (!connection?.url || !connection?.token) return null;
  return connection;
}

async function apiRequest(path, {method = 'GET', body} = {}) {
  if (!isSupportedPath(path)) throw new Error('Operação não disponível na extensão.');
  const connection = await getConnection();
  if (!connection) throw new Error('Configure a extensão em Opções antes de usar os áudios.');

  let url;
  try { url = new URL(path, connection.url); } catch { throw new Error('Endereço da instalação inválido.'); }
  if (url.origin !== connection.url) throw new Error('Endereço da instalação inválido.');

  const headers = {Authorization: `Bearer ${connection.token}`};
  const timeout = path === '/health' || path === '/context' ? 120000 : 30000;
  const options = {method, headers, signal: AbortSignal.timeout(timeout)};
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }
  let response;
  try { response = await fetch(url, options); }
  catch { throw new Error('A instalação online não respondeu. Confira o Render e a internet.'); }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Erro ${response.status}`);
  return data;
}

chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage().catch(() => {}));

chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (!isTelegramSender(sender)) return false;

  if (message?.type === 'connection-status') {
    getConnection().then(connection => reply({configured:!!connection})).catch(() => reply({configured:false}));
    return true;
  }

  if (message?.type === 'open-options') {
    chrome.runtime.openOptionsPage().then(() => reply({ok:true})).catch(error => reply({error:error.message}));
    return true;
  }

  if (message?.type === 'api') {
    apiRequest(String(message.path || ''), {method:message.method || 'GET', body:message.body})
      .then(data => reply({ok:true, data}))
      .catch(error => reply({ok:false, error:error.message}));
    return true;
  }

  return false;
});
