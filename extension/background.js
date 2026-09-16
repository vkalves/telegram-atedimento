const ALLOWED_REQUESTS={
 '/health':['GET'],'/auth/status':['GET'],'/auth/start':['POST'],'/auth/code':['POST'],'/auth/password':['POST'],
 '/context':['POST'],'/library':['GET'],'/jobs':['POST','GET']
};
chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'}).catch(()=>{});
async function apiRequest({path,method='GET',body}){
 const allowed=ALLOWED_REQUESTS[path];if(!allowed?.includes(method))throw new Error('Operação não autorizada pela extensão.');
 const {connection={}}=await chrome.storage.local.get('connection');if(!connection.url||!connection.token)throw new Error('Configure a extensão pelo ícone na barra do Chrome.');
 const headers={Authorization:'Bearer '+connection.token};if(body!==undefined){headers['Content-Type']='application/json';body=JSON.stringify(body);}
 let response;try{response=await fetch(connection.url+path,{method,headers,body,signal:AbortSignal.timeout(path==='/health'?120000:30000)});}catch{throw new Error('O servidor não respondeu. Aguarde o Render iniciar e tente novamente.');}
 if(!response.ok){const data=await response.json().catch(()=>({}));throw new Error(data.error||`Erro ${response.status}`);}return response.json();
}
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
 if(sender.id!==chrome.runtime.id)return;
 if(message?.type==='api'){apiRequest(message).then(data=>reply({ok:true,data})).catch(error=>reply({ok:false,error:error.message}));return true;}
 if(message?.type==='connection-status'){chrome.storage.local.get('connection').then(({connection})=>reply({configured:!!(connection?.url&&connection?.token)}));return true;}
});
