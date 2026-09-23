const $ = id => document.getElementById(id);
const API_URL = 'https://telegram-atendimento.onrender.com';
const DEFAULT_DASHBOARD_URL = 'https://telegram-atendimento-dashboard.onrender.com';
const saved = (await chrome.storage.local.get('connection')).connection || {};
$('token').value = saved.token || '';
$('dashboardUrl').value = saved.dashboardUrl || DEFAULT_DASHBOARD_URL;
if (saved.url === API_URL && saved.token) {
  notice('Você já está conectado.','success');
  $('clear').hidden = false;
}

function notice(text, type = '') {
  $('notice').textContent = text;
  $('notice').className = `notice ${type}`.trim();
}

function normalizeDashboardUrl(value) {
  let url;
  try { url = new URL(String(value || '').trim()); }
  catch { throw new Error('Informe o endereço HTTPS do dashboard.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error('O endereço do dashboard precisa ser HTTPS e não pode ter parâmetros.');
  }
  return url.href.replace(/\/$/, '');
}

$('form').onsubmit = async event => {
  event.preventDefault();
  const save = $('save');save.disabled = true;
  try {
    const token = $('token').value.trim();
    if (!token) throw new Error('Digite sua senha.');
    const dashboardUrl = normalizeDashboardUrl($('dashboardUrl').value || DEFAULT_DASHBOARD_URL);
    const granted = await chrome.permissions.request({origins:[API_URL + '/*']});
    if (!granted) throw new Error('Autorize o acesso para continuar.');
    const response = await fetch(API_URL + '/library?kind=voice&active=true',{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(120000)});
    const data = await response.json().catch(()=>({}));
    if (response.status === 401) throw new Error('Senha incorreta. Tente novamente.');
    if (!response.ok || !Array.isArray(data.items)) throw new Error(data.error || 'Não foi possível entrar agora.');
    await chrome.storage.local.set({connection:{url:API_URL,token,dashboardUrl}});
    $('clear').hidden = false;
    notice('Login realizado. Volte ao Telegram Web.','success');
  } catch (error) {notice(error.message || 'Não foi possível salvar a conexão.','error');}
  finally {save.disabled = false;}
};

$('clear').onclick = async () => {
  await chrome.storage.local.remove('connection');
  $('token').value = '';$('clear').hidden = true;
  notice('Você saiu deste navegador.');
};
