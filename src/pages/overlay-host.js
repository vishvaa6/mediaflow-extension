// The host is on the webpage, so backdrop-filter samples live page pixels
// through a CSP-safe pure-SVG Snell bezel lens with chromatic dispersion.
(() => {
  if(globalThis.__mediaflowOverlayHostInstalled)return;
  globalThis.__mediaflowOverlayHostInstalled=true;
  // A panel from an extension instance that was reloaded can outlive its script.
  document.querySelectorAll('[data-mediaflow-glass-panel],[data-mediaflow-glass-defs="overlay"]').forEach(node=>node.remove());
  let host,defsSvg,frame,finish,preferredSize={width:900,height:750},resized=false;
  const SVG_NS='http://www.w3.org/2000/svg';
  function svgEl(tag,attrs){
    const el=document.createElementNS(SVG_NS,tag);
    for(const [k,v] of Object.entries(attrs))el.setAttribute(k,String(v));
    return el;
  }
  function ensureOverlayDefs(){
    if(defsSvg?.isConnected)return defsSvg;
    defsSvg=svgEl('svg',{class:'mediaflow-optics-defs','data-mediaflow-glass-defs':'overlay','aria-hidden':'true',width:'0',height:'0'});
    defsSvg.style.position='fixed';defsSvg.style.width='0';defsSvg.style.height='0';defsSvg.style.pointerEvents='none';defsSvg.style.overflow='hidden';
    // Fast CSP- & Trusted-Types-safe pure-SVG bezel refraction (zero innerHTML, zero feImage URLs).
    const defs=svgEl('defs',{});
    const filter=svgEl('filter',{id:'mf-overlay-bezel-lens',x:'0%',y:'0%',width:'100%',height:'100%','color-interpolation-filters':'sRGB'});
    filter.append(
      svgEl('feFlood',{'flood-color':'#000','flood-opacity':'1',x:'2%',y:'2%',width:'96%',height:'96%',result:'mask'}),
      svgEl('feGaussianBlur',{in:'mask',stdDeviation:'6',result:'height'}),
      svgEl('feOffset',{in:'height',dx:'2',dy:'0',result:'hx1'}),
      svgEl('feOffset',{in:'height',dx:'-2',dy:'0',result:'hx2'}),
      svgEl('feComposite',{in:'hx1',in2:'hx2',operator:'arithmetic',k1:'0',k2:'0.5',k3:'-0.5',k4:'0.5',result:'dxA'}),
      svgEl('feOffset',{in:'height',dx:'0',dy:'2',result:'hy1'}),
      svgEl('feOffset',{in:'height',dx:'0',dy:'-2',result:'hy2'}),
      svgEl('feComposite',{in:'hy1',in2:'hy2',operator:'arithmetic',k1:'0',k2:'0.5',k3:'-0.5',k4:'0.5',result:'dyA'}),
      svgEl('feColorMatrix',{in:'dxA',type:'matrix',values:'0 0 0 1 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0 1',result:'dxR'}),
      svgEl('feColorMatrix',{in:'dyA',type:'matrix',values:'0 0 0 0 0  0 0 0 1 0  0 0 0 0 0  0 0 0 0 1',result:'dyG'}),
      svgEl('feBlend',{in:'dxR',in2:'dyG',mode:'screen',result:'dispMap'}),
      svgEl('feDisplacementMap',{in:'SourceGraphic',in2:'dispMap',scale:'14',xChannelSelector:'R',yChannelSelector:'G',result:'disp'}),
      svgEl('feComposite',{in:'disp',in2:'SourceGraphic',operator:'over'})
    );
    defs.append(filter);
    defsSvg.append(defs);
    document.documentElement.append(defsSvg);
    return defsSvg;
  }
  function applySize(value) {
    if(!host)return;
    const maxWidth=Math.max(1,innerWidth-16),maxHeight=Math.max(1,innerHeight-16);
    const width=Math.min(maxWidth,Math.max(Math.min(320,maxWidth),Math.round(Number(value.width)||900)));
    const height=Math.min(maxHeight,Math.max(Math.min(300,maxHeight),Math.round(Number(value.height)||750)));
    host.style.width=width+'px';host.style.height=height+'px';
  }
  function saveSize(){chrome.storage.local.set({mediaflowOverlaySize:preferredSize}).catch(()=>{});}
  const close=()=>{host?.remove();defsSvg?.remove();host=defsSvg=frame=null;finish?.({success:false});finish=null;};
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
      host.style.visibility='visible';
      if(!matchMedia('(prefers-reduced-motion: reduce)').matches){
        host.setAttribute('data-liquid-open','');
      }
      finish?.({success:true});finish=null;
    }
  });
  document.addEventListener('keydown',event=>{if(host && event.key==='Escape')close();},true);
  document.addEventListener('pointerdown',event=>{if(host && !event.composedPath().includes(host))close();},true);
  chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{
    if(message?.type!=='mediaflow-overlay-toggle' || sender.id!==chrome.runtime.id)return;
    if(host){close();sendResponse({success:true});return;}
    if(typeof message.token!=='string' || !document.documentElement){sendResponse({success:false});return;}
    ensureOverlayDefs();
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
    const css=`:host{all:initial;border-radius:24px;overflow:hidden;background:rgba(12,12,16,.48);box-shadow:inset 0 1.5px 0 rgba(255,255,255,.38),inset 1.5px 0 0 rgba(255,255,255,.18),inset 0 -1.5px 0 rgba(255,255,255,.12),0 20px 64px #0008,0 0 0 1px #ffffff38;backdrop-filter:blur(28px) saturate(150%) brightness(.92) url(#mf-overlay-bezel-lens);-webkit-backdrop-filter:blur(28px) saturate(150%) brightness(.92)} iframe{display:block;width:100%;height:100%;border:0;background:transparent} @media (prefers-color-scheme:dark){:host{background:rgba(8,8,12,.52);box-shadow:inset 0 1.5px 0 rgba(255,255,255,.28),inset 1.5px 0 0 rgba(255,255,255,.14),inset 0 -1.5px 0 rgba(255,255,255,.1),0 20px 64px #000a,0 0 0 1px #ffffff30}} @media (prefers-reduced-transparency:reduce){:host{background:#f2f2f7;box-shadow:0 16px 60px #0004,0 0 0 1px #c7c7cc;backdrop-filter:none;-webkit-backdrop-filter:none}} @media (prefers-reduced-transparency:reduce) and (prefers-color-scheme:dark){:host{background:#242426;box-shadow:0 16px 60px #0008,0 0 0 1px #3a3a3c}} @media (prefers-contrast:more){:host{background:#f2f2f7;box-shadow:0 16px 60px #0005,0 0 0 2px #1c1c1e;backdrop-filter:none;-webkit-backdrop-filter:none}} @media (prefers-contrast:more) and (prefers-color-scheme:dark){:host{background:#171719;box-shadow:0 16px 60px #0008,0 0 0 2px #f5f5f7}} @media (prefers-reduced-motion:reduce){:host,iframe{transition:none!important;animation:none!important}}`;
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
