// The host is on the webpage, so backdrop-filter samples live page pixels.
(() => {
  if(globalThis.__mediaflowOverlayHostInstalled)return;
  globalThis.__mediaflowOverlayHostInstalled=true;
  // A panel from an extension instance that was reloaded can outlive its script.
  document.querySelectorAll('[data-mediaflow-glass-panel]').forEach(panel=>panel.remove());
  let host,frame,finish,preferredSize={width:900,height:750},resized=false;
  function applySize(value) {
    if(!host)return;
    const maxWidth=Math.max(1,innerWidth-16),maxHeight=Math.max(1,innerHeight-16);
    const width=Math.min(maxWidth,Math.max(Math.min(320,maxWidth),Math.round(Number(value.width)||900)));
    const height=Math.min(maxHeight,Math.max(Math.min(300,maxHeight),Math.round(Number(value.height)||750)));
    host.style.width=width+'px';host.style.height=height+'px';
  }
  function saveSize(){chrome.storage.local.set({mediaflowOverlaySize:preferredSize}).catch(()=>{});}
  const close=()=>{host?.remove();host=frame=null;finish?.({success:false});finish=null;};
  window.addEventListener('resize',()=>applySize(preferredSize));
  window.addEventListener('message',event=>{
    if(!frame || event.source!==frame.contentWindow)return;
    if(event.data?.type==='mediaflow-overlay-close')close();
    if(event.data?.type==='mediaflow-overlay-resize' && host){
      if(event.data.reset){preferredSize={width:900,height:750};}
      else {
        const {dx,dy}=event.data;
        if(!Number.isFinite(dx) || !Number.isFinite(dy))return;
        const bounds=host.getBoundingClientRect();
        preferredSize={width:bounds.width-dx,height:bounds.height+dy};
      }
      resized=true;applySize(preferredSize);
      preferredSize={width:host.getBoundingClientRect().width,height:host.getBoundingClientRect().height};
      if(event.data.commit)saveSize();
    }
    if(event.data?.type==='mediaflow-overlay-ready'){
      const panelStyle=getComputedStyle(host);
      const allowOpaque=matchMedia('(prefers-reduced-transparency: reduce)').matches || matchMedia('(prefers-contrast: more)').matches;
      if(panelStyle.backdropFilter==='none' && !allowOpaque){close();return;}
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
    host.style.cssText='position:fixed;z-index:2147483647;top:8px;right:8px;width:min(900px, calc(100vw - 16px));height:min(750px, calc(100vh - 16px));visibility:hidden;';
    preferredSize={width:900,height:750};resized=false;
    const currentHost=host;
    chrome.storage.local.get('mediaflowOverlaySize').then(saved=>{
      if(host!==currentHost || resized)return;
      preferredSize=saved.mediaflowOverlaySize || preferredSize;applySize(preferredSize);
    }).catch(()=>{});
    const shadow=host.attachShadow({mode:'closed'});
    const css=`:host{all:initial;border-radius:24px;overflow:hidden;background:rgba(172,175,182,.84);box-shadow:0 16px 60px #0006,0 0 0 1px #ffffff80;backdrop-filter:blur(28px) saturate(160%);-webkit-backdrop-filter:blur(28px) saturate(160%)} iframe{display:block;width:100%;height:100%;border:0;background:transparent} @media (prefers-color-scheme:dark){:host{background:rgba(23,24,29,.84)}} @media (prefers-reduced-transparency:reduce){:host{background:#f2f2f7;box-shadow:0 16px 60px #0004,0 0 0 1px #c7c7cc;backdrop-filter:none;-webkit-backdrop-filter:none}} @media (prefers-reduced-transparency:reduce) and (prefers-color-scheme:dark){:host{background:#242426;box-shadow:0 16px 60px #0008,0 0 0 1px #3a3a3c}} @media (prefers-contrast:more){:host{background:#f2f2f7;box-shadow:0 16px 60px #0005,0 0 0 2px #1c1c1e;backdrop-filter:none;-webkit-backdrop-filter:none}} @media (prefers-contrast:more) and (prefers-color-scheme:dark){:host{background:#171719;box-shadow:0 16px 60px #0008,0 0 0 2px #f5f5f7}} @media (prefers-reduced-motion:reduce){:host,iframe{transition:none!important;animation:none!important}}`;
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
