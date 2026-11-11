// The host is on the webpage, so backdrop-filter samples live page pixels.
(() => {
  if(globalThis.__mediaflowOverlayHostInstalled)return;
  globalThis.__mediaflowOverlayHostInstalled=true;
  // A panel from an extension instance that was reloaded can outlive its script.
  document.querySelectorAll('[data-mediaflow-glass-panel]').forEach(panel=>panel.remove());
  let host,frame,finish;
  const close=()=>{host?.remove();host=frame=null;finish?.({success:false});finish=null;};
  window.addEventListener('message',event=>{
    if(!frame || event.source!==frame.contentWindow)return;
    if(event.data?.type==='mediaflow-overlay-close')close();
    if(event.data?.type==='mediaflow-overlay-ready'){
      const panelStyle=getComputedStyle(host);
      if(panelStyle.backdropFilter==='none' && !matchMedia('(prefers-reduced-transparency: reduce)').matches){close();return;}
      host.style.visibility='visible';finish?.({success:true});finish=null;
    }
  });
  document.addEventListener('keydown',event=>{if(host && event.key==='Escape')close();},true);
  document.addEventListener('pointerdown',event=>{if(host && !event.composedPath().includes(host))close();},true);
  chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{
    if(message?.type!=='mediaflow-overlay-toggle' || sender.id!==chrome.runtime.id)return;
    if(host){close();sendResponse({success:true});return;}
    if(typeof message.token!=='string' || !document.documentElement){sendResponse({success:false});return;}
    host=document.createElement('div');
    host.dataset.mediaflowGlassPanel='';
    host.style.cssText='position:fixed;z-index:2147483647;top:8px;right:8px;width:min(720px, calc(100vw - 16px));height:min(600px, calc(100vh - 16px));visibility:hidden;';
    const shadow=host.attachShadow({mode:'closed'});
    const css=`:host{all:initial;border-radius:20px;overflow:hidden;background:rgba(172,175,182,.88);box-shadow:0 16px 60px #0006,0 0 0 1px #ffffff80;backdrop-filter:blur(28px) saturate(160%);-webkit-backdrop-filter:blur(28px) saturate(160%)} iframe{display:block;width:100%;height:100%;border:0;background:transparent} @media (prefers-color-scheme:dark){:host{background:rgba(13,14,18,.90)}} @media (prefers-reduced-transparency:reduce){:host{background:#f2f2f7;backdrop-filter:none;-webkit-backdrop-filter:none}} @media (prefers-reduced-transparency:reduce) and (prefers-color-scheme:dark){:host{background:#242426}}`;
    try {const sheet=new CSSStyleSheet();sheet.replaceSync(css);shadow.adoptedStyleSheets=[sheet];}
    catch {const style=document.createElement('style');style.textContent=css;shadow.append(style);}
    frame=document.createElement('iframe');frame.title='MediaFlow';
    frame.src=chrome.runtime.getURL('src/pages/popup/overlay.html?surface=overlay');
    frame.addEventListener('load',()=>frame?.contentWindow?.postMessage({type:'mediaflow-overlay-grant',token:message.token},chrome.runtime.getURL('').slice(0,-1)),{once:true});
    shadow.append(frame);document.documentElement.append(host);
    let timeout=setTimeout(()=>{if(finish){close();}},4500);
    finish=result=>{clearTimeout(timeout);sendResponse(result);};
    return true;
  });
})();
