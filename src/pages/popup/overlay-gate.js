// A website may embed this page, but cannot initialize the privileged UI without
// the one-time grant sent directly to this frame by the extension's content script.
let started=false;
window.addEventListener('message',async event=>{
  if(started || event.source!==window.parent || event.data?.type!=='mediaflow-overlay-grant' || typeof event.data.token!=='string')return;
  const key='mediaflowOverlayGrant:'+event.data.token;
  try {
    const grant=await chrome.storage.session.get(key);
    if(typeof grant[key]!=='number' || grant[key]<Date.now() || started)return;
    started=true;
    await chrome.storage.session.remove(key);
    await import('./index.js');
    window.parent.postMessage({type:'mediaflow-overlay-ready'},'*');
    window.addEventListener('keydown',event=>{if(event.key==='Escape')window.parent.postMessage({type:'mediaflow-overlay-close'},'*');});
  } catch {}
});
