export function clampPopupSize(value={},screen={availWidth:800,availHeight:600}){
  const maxWidth=Math.min(800,Number(screen.availWidth)||800),maxHeight=Math.min(600,Number(screen.availHeight)||600);
  const width=Math.min(maxWidth,Math.max(Math.min(480,maxWidth),Math.floor(Number(value.width)||720)));
  const height=Math.min(maxHeight,Math.max(Math.min(360,maxHeight),Math.floor(Number(value.height)||600)));
  return {width,height};
}

export function createPopupSurface(){
  const surface=new URLSearchParams(location.search).get('surface')==='popup'?'popup':'tab';
  document.documentElement.dataset.surface=surface;
  let size=clampPopupSize({},window.screen);
  const apply=next=>{
    size=clampPopupSize(next,window.screen);
    document.documentElement.style.width=size.width+'px';
    document.documentElement.style.height=size.height+'px';
  };
  const persist=()=>chrome.storage.local.set({mediaflowPopupSize:size}).catch(()=>{});
  if(surface==='popup')apply(size);
  const ready=surface==='popup'?chrome.storage.local.get('mediaflowPopupSize').then(saved=>apply(saved.mediaflowPopupSize || size)).catch(()=>{}):Promise.resolve();
  function bindResize(handle){
    if(!handle || surface!=='popup')return;
    let drag;
    const end=()=>{drag=undefined;document.documentElement.classList.remove('popup-resizing');persist();};
    handle.addEventListener('pointerdown',event=>{
      if(event.button!==0)return;
      event.preventDefault();handle.focus({preventScroll:true});
      drag={x:event.screenX,y:event.screenY,...size};
      handle.setPointerCapture(event.pointerId);document.documentElement.classList.add('popup-resizing');
    });
    handle.addEventListener('pointermove',event=>{if(drag)apply({width:drag.width+event.screenX-drag.x,height:drag.height+event.screenY-drag.y});});
    for(const event of ['pointerup','pointercancel','lostpointercapture'])handle.addEventListener(event,end);
    handle.addEventListener('keydown',event=>{
      const delta={ArrowLeft:[-20,0],ArrowRight:[20,0],ArrowUp:[0,-20],ArrowDown:[0,20]}[event.key];
      if(!delta && event.key!=='Home')return;
      event.preventDefault();apply(event.key==='Home'?{}:{width:size.width+delta[0],height:size.height+delta[1]});persist();
    });
  }
  return {surface,ready,bindResize};
}
