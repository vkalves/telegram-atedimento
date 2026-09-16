const $ = id => document.getElementById(id);
const API_URL = 'https://telegram-atendimento.onrender.com';
const saved = (await chrome.storage.local.get('connection')).connection || {};
$('token').value = saved.token || '';
if (saved.url === API_URL && saved.token) {
  notice('Você já está conectado.','success');
  $('clear').hidden = false;
}

function notice(text, type = '') {
  $('notice').textContent = text;
  $('notice').className = `notice ${type}`.trim();
}

$('form').onsubmit = async event => {
  event.preventDefault();
  const save = $('save');save.disabled = true;
  try {
    const token = $('token').value.trim();
    if (!token) throw new Error('Digite sua senha.');
    const granted = await chrome.permissions.request({origins:[API_URL + '/*']});
    if (!granted) throw new Error('Autorize o acesso para continuar.');
    const response = await fetch(API_URL + '/library?kind=voice&active=true',{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(120000)});
    const data = await response.json().catch(()=>({}));
    if (response.status === 401) throw new Error('Senha incorreta. Tente novamente.');
    if (!response.ok || !Array.isArray(data.items)) throw new Error(data.error || 'Não foi possível entrar agora.');
    await chrome.storage.local.set({connection:{url:API_URL,token}});
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
