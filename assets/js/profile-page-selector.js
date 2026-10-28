import {parseProfileDocument,profileVideoElements} from './profile-scanner.js';
import {profileKey,videoKey,downloadedRecord} from './video-details.js';
import {selectionView,rangeHint} from './profile-selection.js';
import {icon} from './icons.js';

// Isolated-world UI: no page scripts run and no page global is trusted.
export async function installProfilePageSelector() {
  if (window.top !== window || document.getElementById('mediaflow-profile-picker')) return;
  if(window.__mediaflowProfilePickerInstalling)return;
  window.__mediaflowProfilePickerInstalling=true;
  if (document.readyState === 'loading') await new Promise(resolve => document.addEventListener('DOMContentLoaded',resolve,{once:true}));
  if(document.getElementById('mediaflow-profile-picker'))return;
  const host=document.createElement('div');host.id='mediaflow-profile-picker';host.hidden=true;
  const shadow=host.attachShadow({mode:'open'});
  shadow.innerHTML=`<style>
    :host{all:initial;position:fixed;bottom:16px;right:16px;z-index:2147483647;font:12px/1.5 MediaFlowPoppins,sans-serif;color:#f8fafc;width:360px;max-width:calc(100vw - 32px)}
    *{box-sizing:border-box}.mf-icon{width:15px;height:15px;vertical-align:middle;flex-shrink:0}
    section{background:#111827f5;border:1px solid #354158;border-radius:12px;padding:12px;box-shadow:0 6px 20px #0006}
    header{display:flex;align-items:center;justify-content:space-between;gap:12px}
    .toolbar-brand{display:flex;align-items:center;gap:9px}.toolbar-brand>.mf-icon{width:26px;height:26px;padding:5px;background:#252e4b;border-radius:7px;color:#a5b4fc}
    .toolbar-brand>span{display:flex;flex-direction:column}.toolbar-brand strong{font:600 12px/17px MediaFlowMontserrat,MediaFlowPoppins,sans-serif}.toolbar-brand small{font-size:9px;color:#94a3b8;line-height:13px}
    button,select{font:inherit;color:inherit;background:#172033;border:1px solid #354158;border-radius:6px;padding:4px 8px;cursor:pointer;min-height:28px}
    button:hover{background:#263149}button:focus-visible,select:focus-visible{outline:2px solid #a5b4fc;outline-offset:2px}button:disabled{opacity:.5;cursor:default}
    .toolbar-status{padding:9px 0 8px}.toolbar-status p{margin:0;font-size:11px;line-height:17px}.toolbar-status small{display:block;color:#94a3b8;font-size:10px;margin-top:3px;font-variant-numeric:tabular-nums}
    .row{display:flex;flex-wrap:wrap;gap:6px}.toolbar-selection{padding-bottom:10px}.toolbar-selection button{font-size:10px;background:transparent}
    .toolbar-download{border-top:1px solid #2b3548;padding-top:10px;align-items:center;justify-content:space-between}
    .quality-label{display:flex;align-items:center;gap:7px;font-size:10px;color:#94a3b8}.quality-label select{font-size:10px;max-width:130px}
    .primary{background:#4f46e5;border-color:#6366f1;font-size:10px;font-weight:500;min-height:31px}.primary:hover{background:#4338ca}
    button[aria-pressed=true]{border-color:#818cf8;color:#c7d2fe;background:#252e4b}
    #error{color:#fda4af;margin:8px 0 0;font-size:10px;overflow-wrap:anywhere}#cancel{flex-basis:100%;background:transparent;border-color:#7f4047;color:#fda4af;font-size:10px}
    #close{display:grid;place-items:center;width:26px;height:26px;min-height:26px;padding:4px;background:transparent}
    :host([hidden]),[hidden]{display:none!important}
  </style><section aria-label="MediaFlow batch video selection"><header><span class="toolbar-brand">${icon('list-video')}<span><strong>MediaFlow</strong><small>Profile selection</small></span></span><button id="close" aria-label="Minimize video selection" aria-expanded="true"></button></header>
    <div id="body"><div class="toolbar-status"><p id="hint" role="status"></p><small id="count"></small></div><div class="row toolbar-selection"><button id="range">Select range</button><button id="new">Select new</button><button id="clear">Clear</button></div>
    <div class="row toolbar-download"><label class="quality-label">Quality<select id="quality" aria-label="Download quality"><option value="240">240p</option><option value="480">480p</option><option value="720">720p</option><option value="1080">1080p</option><option value="best" selected>Best available</option></select></label><button id="download" class="primary">Batch download</button><button id="cancel" hidden>Cancel batch & downloads</button></div><p id="error" role="alert" hidden></p></div></section>`;
  const style=document.createElement('style');style.id='mediaflow-selection-style';
  style.textContent=`.mediaflow-pick-card{position:relative!important}.mediaflow-pick-selected{outline:3px solid #818cf8!important;outline-offset:2px!important}.mediaflow-pick-tick{all:initial!important;box-sizing:border-box!important;position:absolute!important;top:8px!important;left:8px!important;z-index:1000!important;background:#172033!important;color:#fff!important;border:2px solid #a5b4fc!important;border-radius:7px!important;padding:5px 8px!important;font:700 13px/1.3 system-ui,sans-serif!important;cursor:pointer!important;box-shadow:0 2px 8px #0008!important}.mediaflow-pick-tick[aria-checked=true]{background:#252e4b!important;border-color:#a5b4fc!important}.mediaflow-pick-tick:focus-visible{outline:3px solid #a5b4fc!important}.mediaflow-pick-tick:disabled{cursor:default!important}`;
  document.documentElement.append(style);document.body.append(host);
  style.textContent+=`@font-face{font-family:MediaFlowPoppins;src:url('${(chrome.runtime.getURL?.('assets/fonts/poppins-500.ttf') || new URL('../fonts/poppins-500.ttf',import.meta.url).href)}')}@font-face{font-family:MediaFlowMontserrat;src:url('${(chrome.runtime.getURL?.('assets/fonts/montserrat-variable.ttf') || new URL('../fonts/montserrat-variable.ttf',import.meta.url).href)}')}.mediaflow-pick-card{border-radius:16px!important}.mediaflow-pick-selected{outline:none!important;box-shadow:0 0 0 2px #818cf8!important;background-color:#6366f10d!important}.mediaflow-pick-tick{display:inline-flex!important;align-items:center!important;gap:5px!important;font-family:MediaFlowPoppins,sans-serif!important;border-width:1px!important;border-radius:12px!important;background:#111827ed!important;padding:7px 10px!important;box-shadow:0 4px 12px #0004!important}.mediaflow-pick-tick .mf-icon{width:16px!important;height:16px!important;pointer-events:none!important}.mediaflow-pick-tick[aria-checked=true]{background:#252e4bf2!important;border-color:#a5b4fc!important}`;
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
      const owned=[...card.querySelectorAll('.mediaflow-pick-tick')];
      if(!button || !button.isConnected)button=owned.shift();
      for(const duplicate of owned)if(duplicate!==button)duplicate.remove();
      if(!button){button=document.createElement('button');button.type='button';button.className='mediaflow-pick-tick';button.setAttribute('role','checkbox');card.append(button);card.classList.add('mediaflow-pick-card');}
      button.dataset.videoKey=videoKey(url);
      const checked=view.keys.has(videoKey(url)),downloaded=!!downloadedRecord(history,url,video.videoUrl);
      const boundary=selection?.mode==='range' ? [selection.start===videoKey(url)?'Start':'',selection.end===videoKey(url)?'End':''].filter(Boolean).join(' / ') : '';
      const label=(checked?'Selected':'Select')+(boundary?' · '+boundary:'');
      const markup=icon(checked?'check':'circle')+'<span>'+label+'</span>';
      if(button.innerHTML!==markup)button.innerHTML=markup;
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
  shadow.getElementById('close').innerHTML=icon('chevron-down');
  shadow.getElementById('close').onclick=()=>{const body=shadow.getElementById('body');body.hidden=!body.hidden;shadow.getElementById('close').innerHTML=icon(body.hidden?'chevron-left':'chevron-down');shadow.getElementById('close').setAttribute('aria-expanded',String(!body.hidden));};
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
