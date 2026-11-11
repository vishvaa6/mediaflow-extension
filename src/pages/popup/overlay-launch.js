// The browser action remains a fallback for restricted pages and blocked frames.
export async function openPageOverlay() {
  if(!chrome.storage?.session || !globalThis.crypto?.randomUUID)return;
  let key;
  try {
    const tabs=await new Promise(resolve=>chrome.tabs.query({active:true,currentWindow:true},resolve));
    const tab=tabs?.[0];
    if(tab?.id==null || !/^https?:/i.test(tab.url || ''))return;
    const token=crypto.randomUUID();
    key='mediaflowOverlayGrant:'+token;
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
    if(response?.success){await chrome.storage.session.remove(key);window.close();return;}
    return {fallback:true};
  } catch {return {fallback:true};} finally {
    if(key)try{await chrome.storage.session.remove(key);}catch{}
  }
}
