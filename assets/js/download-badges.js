import {videoKey,downloadedRecord} from './video-details.js';
import {missavVideoPage} from './missav-media.js';
import {xPost,isXPage} from './x-media.js';
import {cardOwner} from './profile-scanner.js';
import {icon} from './icons.js';
import {visibleXPlayers} from './x-viewport.js';

export function recognizedVideoPage(value){
  try{
    const url=new URL(value);
    if(!/^https?:$/.test(url.protocol))return false;
    return !!missavVideoPage(value) || !!xPost(value) || /view_video\.php/.test(url.pathname) && url.searchParams.has('viewkey') || /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?(?:video[.\d]|videos?\/|v\/)/i.test(url.pathname) || /^(?:www\.)?redtube\.com$/i.test(url.hostname) && /^\/\d+\/?$/.test(url.pathname);
  }catch{return false;}
}
export async function installDownloadBadges(){
  if(window.top!==window || window.__mediaflowDownloadBadges)return;
  window.__mediaflowDownloadBadges=true;
  if(document.readyState==='loading')await new Promise(resolve=>document.addEventListener('DOMContentLoaded',resolve,{once:true}));
  let records=(await chrome.storage.local.get('m3u8DownloadHistory')).m3u8DownloadHistory?.records || [],timer;
  let owners=new Map();
  const style=document.createElement('style');style.id='mediaflow-download-status-style';
  style.textContent=`.mediaflow-status-owner{position:relative!important}.mediaflow-download-status{all:initial!important;box-sizing:border-box!important;display:inline-flex!important;align-items:center!important;gap:5px!important;position:absolute!important;bottom:8px!important;left:8px!important;z-index:998!important;padding:5px 8px!important;border-radius:9px!important;background:#111827ed!important;border:1px solid #64748b77!important;color:#cbd5e1!important;font:500 10px/1.4 MediaFlowPoppins,system-ui,sans-serif!important;pointer-events:none!important;box-shadow:0 3px 10px #0004!important}.mediaflow-download-status[data-downloaded=true]{color:#c7d2fe!important;border-color:#818cf888!important;background:#252e4bed!important}.mediaflow-download-status .mf-icon{width:13px!important;height:13px!important;flex-shrink:0!important}@font-face{font-family:MediaFlowPoppins;src:url('${(chrome.runtime.getURL?.('assets/fonts/poppins-500.ttf') || new URL('../fonts/poppins-500.ttf',import.meta.url).href)}')}`;
  document.documentElement.append(style);
  const refresh=()=>{
    clearTimeout(timer);const targets=new Map();
    for(const player of isXPage(location.href)?visibleXPlayers():[]){
      const owner=player.element.matches('video')?player.element.parentElement:player.element;
      if(owner)targets.set(owner,{pageUrl:player.pageUrl,key:videoKey(player.pageUrl)});
    }
    for(const link of document.querySelectorAll('a[href]')){
      const url=link.href;if(!recognizedVideoPage(url))continue;
      let owner;
      if(xPost(url))continue;
      else owner=link.closest('.thumbnail') || cardOwner(link);
      const visual=owner && (owner.matches('.thumbnail,li.videoBox,.pcVideoListItem,.thumb-block,.thumb-list__item,[data-video-id],.video-card,.video-item') || owner.querySelector('img,video'));
      if(visual && !targets.has(owner))targets.set(owner,{pageUrl:url,key:videoKey(url)});
    }
    for(const video of document.querySelectorAll('video,iframe.player__frame,iframe[src*="javplayer.cc/e/"]')){
      if([...targets.keys()].some(owner=>owner.contains(video)))continue;
      const source=video.currentSrc || video.src;
      if(!recognizedVideoPage(location.href) && !/^https?:/.test(source))continue;
      const owner=video.parentElement;if(!owner || targets.has(owner))continue;
      targets.set(owner,{pageUrl:recognizedVideoPage(location.href)?location.href:'',streamUrl:source,key:recognizedVideoPage(location.href)?videoKey(location.href):source});
    }
    const next=new Map();
    for(const [owner,video]of targets){
      let badge=owners.get(owner) || [...owner.children].find(node=>node.classList.contains('mediaflow-download-status'));
      if(!badge){badge=document.createElement('span');badge.className='mediaflow-download-status';owner.append(badge);}
      owner.classList.add('mediaflow-status-owner');
      const downloaded=!!downloadedRecord(records,video.pageUrl,video.streamUrl);
      const html=icon(downloaded?'check-check':'circle')+'<span>'+(downloaded?'Downloaded':'Not downloaded')+'</span>';
      if(badge.innerHTML!==html)badge.innerHTML=html;
      badge.dataset.downloaded=String(downloaded);badge.dataset.videoKey=video.key;
      next.set(owner,badge);
    }
    for(const [owner,badge]of owners)if(!next.has(owner)){badge.remove();owner.classList.remove('mediaflow-status-owner');}
    owners=next;
  };
  const schedule=()=>{clearTimeout(timer);timer=setTimeout(refresh,150);};
  chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local' && changes.m3u8DownloadHistory){records=changes.m3u8DownloadHistory.newValue?.records || [];schedule();}});
  const observer=new MutationObserver(changes=>{if(changes.some(change=>!change.target.closest?.('.mediaflow-download-status,.mediaflow-pick-tick,#mediaflow-profile-picker')))schedule();});
  observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['href','src']});
  for(const event of ['popstate','loadedmetadata','play','scroll','resize'])window.addEventListener(event,schedule,true);
  refresh();
}
