// Try the rounded panel on the active page; use the extension popup as fallback.
export async function openPageOverlay(tab) {
  if(!chrome.storage?.session || !globalThis.crypto?.randomUUID || tab?.id==null || !/^https?:/i.test(tab.url || '')) return false;
  const token=crypto.randomUUID();
  const key='mediaflowOverlayGrant:'+token;
  try {
    await chrome.storage.session.set({[key]:Date.now()+10000});
    const send=()=>new Promise(resolve=>{
      const timeout=setTimeout(()=>resolve(null),5000);
      chrome.tabs.sendMessage(tab.id,{type:'mediaflow-overlay-toggle',token},result=>{
        clearTimeout(timeout);
        if(chrome.runtime.lastError)resolve({missingHost:true});else resolve(result);
      });
    });
    let response=await send();
    if(response?.missingHost && chrome.scripting?.executeScript){
      await chrome.scripting.executeScript({target:{tabId:tab.id},files:['src/pages/overlay-host.js']});
      response=await send();
    }
    return !!response?.success;
  } catch {return false;} finally {
    try{await chrome.storage.session.remove(key);}catch{}
  }
}

export async function handleOverlayAction(tab) {
  if(await openPageOverlay(tab))return 'overlay';
  if(tab?.id==null || !chrome.action?.setPopup)return 'unavailable';
  const popup='src/pages/popup/index.html?surface=popup';
  await chrome.action.setPopup({tabId:tab.id,popup});
  try {
    await chrome.action.openPopup({windowId:tab.windowId});
    await chrome.action.setPopup({tabId:tab.id,popup:''});
    return 'popup';
  } catch {
    // Older Chrome versions can open the configured popup on the next click.
    return 'popup-on-next-click';
  }
}

export function installOverlayAction() {
  const pending=new Set();
  chrome.action?.onClicked?.addListener(async tab=>{
    if(pending.has(tab.id))return;
    pending.add(tab.id);
    try {await handleOverlayAction(tab);} catch {} finally {pending.delete(tab.id);}
  });
}
