import {parseProfileDocument,profileVideoElements} from './profile-scanner.js';
import {profileKey,videoKey,downloadedRecord} from './video-details.js';
import {selectionView,rangeHint} from './profile-selection.js';

// Isolated-world UI: no page scripts run and no page global is trusted.
export async function installProfilePageSelector() {
  if (window.top !== window || document.getElementById('mediaflow-profile-picker')) return;
  if (document.readyState === 'loading') await new Promise(resolve => document.addEventListener('DOMContentLoaded',resolve,{once:true}));
  const host=document.createElement('div');host.id='mediaflow-profile-picker';host.hidden=true;
  const shadow=host.attachShadow({mode:'open'});
  shadow.innerHTML=`<style>
    :host{all:initial;position:fixed;bottom:18px;right:18px;z-index:2147483647;font:13px/1.5 system-ui,sans-serif;color:#eef2ff;max-width:min(470px,calc(100vw - 36px))}
    *{box-sizing:border-box}section{background:#172033;border:1px solid #52617a;border-radius:14px;padding:14px;box-shadow:0 6px 30px #0008}
    header{display:flex;align-items:center;justify-content:space-between;gap:16px;font-weight:700}button,select{font:inherit;color:inherit;background:#28364f;border:1px solid #65758f;border-radius:7px;padding:6px 10px;cursor:pointer}button:disabled{opacity:.5;cursor:default}
    .row{display:flex;flex-wrap:wrap;gap:7px;margin-top:10px}.primary{background:#4f46e5;border-color:#818cf8}p{margin:8px 0 0}small{color:#cbd5e1}button[aria-pressed=true]{outline:2px solid #22d3ee}#error{color:#fda4af}#cancel{background:#7f1d1d}#close{padding:1px 7px}
    :host([hidden]),[hidden]{display:none!important}
  </style><section aria-label="MediaFlow batch video selection"><header>MediaFlow · Batch selection<button id="close" aria-label="Minimize video selection">−</button></header>
    <div id="body"><p id="hint" role="status"></p><small id="count"></small><div class="row"><button id="range">Select range</button><button id="new">Select new</button><button id="clear">Clear</button></div>
    <div class="row"><select id="quality" aria-label="Download quality"><option value="240">240p</option><option value="480">480p</option><option value="720">720p</option><option value="1080">1080p</option><option value="best" selected>Best available</option><option value="mp4">MP4 only</option></select><button id="download" class="primary">Batch download</button><button id="cancel" hidden>Cancel batch & downloads</button></div><p id="error" role="alert" hidden></p></div></section>`;
  const style=document.createElement('style');style.id='mediaflow-selection-style';
  style.textContent=`.mediaflow-pick-card{position:relative!important}.mediaflow-pick-selected{outline:3px solid #22c55e!important;outline-offset:2px!important}.mediaflow-pick-tick{all:initial!important;box-sizing:border-box!important;position:absolute!important;top:8px!important;left:8px!important;z-index:1000!important;background:#172033!important;color:#fff!important;border:2px solid #a5b4fc!important;border-radius:7px!important;padding:5px 8px!important;font:700 13px/1.3 system-ui,sans-serif!important;cursor:pointer!important;box-shadow:0 2px 8px #0008!important}.mediaflow-pick-tick[aria-checked=true]{background:#166534!important;border-color:#4ade80!important}.mediaflow-pick-tick:focus-visible{outline:3px solid #22d3ee!important}.mediaflow-pick-tick:disabled{cursor:default!important}`;
  document.documentElement.append(style);document.body.append(host);
  let saved=await chrome.storage.local.get(['profileScanState','profileSelectionState','m3u8DownloadHistory','profileBatchState','downloadQueueState']);
  let cards=new Map(),profile,selection,view,pending=0,refreshTimer,scanRequest=false;
  const text=(id,value)=>{const node=shadow.getElementById(id);if(node.textContent!==value)node.textContent=value;};
  const error=message=>{text('error',message);shadow.getElementById('error').hidden=!message;};
  const supported=()=>/^\/(?:models?|pornstar|channels?|users?|profiles?|creators?)\/[^/]+(?:\/|$)/i.test(location.pathname);
  async function send(message) {
    const response=await chrome.runtime.sendMessage(message);
    if(!response?.success)throw Error(response?.error || 'Unable to update batch selection');
    return response;
  }
  async function ensureScan() {
    const scan=saved.profileScanState;
    if(scan && profileKey(scan.profileUrl)===profileKey(location.href) && ['scanning','complete'].includes(scan.status))return;
    if(scanRequest)return;
    scanRequest=true;
    try{await send({type:'profile-scan-start',url:location.href});}finally{scanRequest=false;}
  }
  async function select(action,video) {
    pending++;refresh();error('');
    try{
      const response=await send({type:'profile-selection-update',profileUrl:location.href,action,video});
      saved.profileSelectionState=response.selection;
      if(action.type!=='clear')await ensureScan();
    }catch(e){error(e.message);}finally{pending--;refresh();}
  }
  function refresh() {
    clearTimeout(refreshTimer);
    host.hidden=!supported();
    if(host.hidden){for(const [card,button]of cards){card.classList.remove('mediaflow-pick-card','mediaflow-pick-selected');button.remove();}cards.clear();return;}
    profile=parseProfileDocument(document,location.href);
    const key=profileKey(location.href),scan=saved.profileScanState,history=saved.m3u8DownloadHistory?.records || [];
    const sameScan=scan && profileKey(scan.profileUrl)===key;
    const inventory=sameScan && scan.videos?.length ? scan.videos : profile.videos;
    selection=saved.profileSelectionState?.profileKey===key ? saved.profileSelectionState : null;
    view=selectionView(inventory,selection,history);
    const present=new Map();
    for(const {card,url}of profileVideoElements(document,location.href)){
      if(present.has(card))continue;
      const video=profile.videos.find(video=>videoKey(video.url)===videoKey(url));if(!video)continue;
      let button=cards.get(card);
      if(!button){button=document.createElement('button');button.type='button';button.className='mediaflow-pick-tick';button.setAttribute('role','checkbox');card.append(button);card.classList.add('mediaflow-pick-card');}
      button.dataset.videoKey=videoKey(url);
      const checked=view.keys.has(videoKey(url)),downloaded=!!downloadedRecord(history,url,video.videoUrl);
      const boundary=selection?.mode==='range' ? [selection.start===videoKey(url)?'Start':'',selection.end===videoKey(url)?'End':''].filter(Boolean).join(' / ') : '';
      const label=(downloaded?'✓ Downloaded':checked?'✓ Selected':'○ Select')+(boundary?' · '+boundary:'');
      if(button.textContent!==label)button.textContent=label;
      button.setAttribute('aria-checked',String(checked));button.setAttribute('aria-label',label+': '+video.title);
      button.disabled=!!pending || downloaded && !(selection?.mode==='range' && !selection.end);
      card.classList.toggle('mediaflow-pick-selected',checked);present.set(card,button);
    }
    for(const [card,button]of cards)if(!present.has(card)){card.classList.remove('mediaflow-pick-card','mediaflow-pick-selected');button.remove();}
    cards=present;
    const scanning=sameScan && scan.status==='scanning';
    text('hint',rangeHint(selection,view));
    text('count',`${view.videos.length} selected · ${scanning?'Scanning all pages…':sameScan?`${scan.pagesScanned || 0} pages scanned`:'Choose videos to scan all pages'}`);
    for(const id of ['range','new','clear'])shadow.getElementById(id).disabled=!!pending;
    shadow.getElementById('range').setAttribute('aria-pressed',String(selection?.mode==='range' && !selection.end));
    const batch=saved.profileBatchState,batchHere=batch?.profileKey===key;
    const running=batch && ['running','cancelling'].includes(batch.status);
    const batchTasks=(saved.downloadQueueState?.tasks || []).filter(task=>task.batchId && task.batchProfileKey===key).length;
    shadow.getElementById('download').disabled=!!pending || !view.complete || !view.videos.length || !sameScan || scan.status!=='complete' || running;
    text('download',`Batch download (${view.videos.length})`);
    shadow.getElementById('cancel').hidden=!batchTasks && !(batchHere && running);
    text('cancel',`Cancel batch & downloads${batchTasks?' ('+batchTasks+')':''}`);
    shadow.getElementById('cancel').disabled=!!pending || batch?.status==='cancelling';
  }
  shadow.getElementById('close').onclick=()=>{const body=shadow.getElementById('body');body.hidden=!body.hidden;text('close',body.hidden?'+':'−');};
  for(const type of ['range','new','clear'])shadow.getElementById(type).onclick=()=>select({type});
  shadow.getElementById('download').onclick=async()=>{
    pending++;refresh();error('');
    try{await send({type:'profile-batch-selected',profileUrl:location.href,quality:shadow.getElementById('quality').value});}
    catch(e){error(e.message);}finally{pending--;refresh();}
  };
  shadow.getElementById('cancel').onclick=async()=>{
    pending++;refresh();
    try{await send({type:'profile-batch-cancel',profileKey:profileKey(location.href),batchId:saved.profileBatchState?.id});}
    catch(e){error(e.message);}finally{pending--;refresh();}
  };
  document.addEventListener('click',event=>{
    if(event.composedPath().includes(host))return;
    const target=event.target instanceof Element ? event.target : event.target.parentElement;
    const entry=[...cards].find(([card])=>card.contains(target));if(!entry)return;
    const [card,button]=entry;
    const picking=selection?.mode==='range' && !selection.end;
    if(!picking && !target.closest('.mediaflow-pick-tick'))return;
    event.preventDefault();event.stopImmediatePropagation();
    if(pending || button.disabled)return;
    const video=profile.videos.find(video=>videoKey(video.url)===button.dataset.videoKey);
    if(video)select({type:picking?'pick':'toggle',key:videoKey(video.url)},video);
  },true);
  chrome.storage.onChanged.addListener((changes,area)=>{
    if(area!=='local')return;
    let changed=false;
    for(const key of ['profileScanState','profileSelectionState','m3u8DownloadHistory','profileBatchState','downloadQueueState'])if(changes[key]){saved[key]=changes[key].newValue;changed=true;}
    if(changed)refresh();
  });
  const observer=new MutationObserver(changes=>{
    if(changes.every(change=>host.contains(change.target) || change.target.closest?.('.mediaflow-pick-tick')))return;
    clearTimeout(refreshTimer);refreshTimer=setTimeout(refresh,150);
  });
  observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['href']});
  window.addEventListener('popstate',refresh);
  refresh();
}
