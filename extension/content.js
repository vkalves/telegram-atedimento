(()=>{
  if(document.getElementById('telegram-atendimento-launcher'))return;
  const host=document.createElement('div');host.id='telegram-atendimento-launcher';
  host.style.cssText='position:fixed;right:18px;top:80px;z-index:2147483646';
  const root=host.attachShadow({mode:'closed'});
  root.innerHTML='<style>button{font:600 13px system-ui;background:#176e60;color:white;border:1px solid #ffffff40;border-radius:30px;padding:11px 16px;box-shadow:0 4px 20px #0003;cursor:pointer}button:hover{background:#11574b}</style><button title="Abrir seus áudios e respostas rápidas">♫ Atendimento</button>';
  root.querySelector('button').onclick=()=>chrome.runtime.sendMessage({type:'open-panel'}).catch(()=>{});
  document.documentElement.append(host);
})();
