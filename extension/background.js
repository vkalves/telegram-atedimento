chrome.sidePanel.setPanelBehavior({openPanelOnActionClick:true}).catch(()=>{});
chrome.runtime.onMessage.addListener((message,sender,reply)=>{
 if(message.type==='open-panel'&&sender.tab&&sender.url?.startsWith('https://web.telegram.org/')){
  chrome.sidePanel.open({tabId:sender.tab.id}).then(()=>reply({ok:true})).catch(e=>reply({error:e.message}));return true;
 }
 if(message.type==='context'&&sender.url?.startsWith(chrome.runtime.getURL('panel.html'))){
  chrome.tabs.query({active:true,windowId:message.windowId}).then(tabs=>{
   const tab=tabs[0];return tab?.url?.startsWith('https://web.telegram.org/')?{href:tab.url,tabId:tab.id}:{href:'',tabId:null};
  }).then(reply).catch(()=>reply({href:''}));return true;
 }
});
