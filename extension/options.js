const $ = id => document.getElementById(id);
const saved = (await chrome.storage.local.get('connection')).connection || {};
$('apiUrl').value = saved.url || '';
$('token').value = saved.token || '';

function notice(text, type = '') {
  $('notice').textContent = text;
  $('notice').className = `notice ${type}`.trim();
}

function normalizeUrl(value) {
  const url = new URL(value.trim());
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Use um endereço HTTPS sem caminho, por exemplo https://telegram-atendimento.onrender.com');
  return url.origin;
}

$('form').onsubmit = async event => {
  event.preventDefault();
  const save = $('save');save.disabled = true;
  try {
    const url = normalizeUrl($('apiUrl').value), token = $('token').value.trim();
    if (token.length < 32) throw new Error('Confira a chave de acesso completa.');
    const granted = await chrome.permissions.request({origins:[url + '/*']});
    if (!granted) throw new Error('Autorize o acesso ao endereço da instalação para continuar.');
    const response = await fetch(url + '/health',{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(120000)});
    const data = await response.json().catch(()=>({}));
    if (!response.ok || !data.ok) throw new Error(data.error || `A instalação respondeu com erro ${response.status}.`);
    await chrome.storage.local.set({connection:{url,token}});
    notice('Conexão salva. Abra ou atualize o Telegram Web para usar a barra de áudios.','success');
  } catch (error) {notice(error.message || 'Não foi possível salvar a conexão.','error');}
  finally {save.disabled = false;}
};

$('clear').onclick = async () => {
  await chrome.storage.local.remove('connection');
  $('apiUrl').value = '';$('token').value = '';
  notice('Configuração apagada.');
};
