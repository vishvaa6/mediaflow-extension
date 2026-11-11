import {videoKey,recognizedVideoPage} from './video-details.js';
import {xPost,isXPage} from './x-media.js';
import {cardOwner} from './profile-scanner.js';
import {icon} from './icons.js';
import {visibleXPlayers} from './x-viewport.js';
import {affectsPage} from './extension-mutations.js';

export {recognizedVideoPage};
export async function installDownloadBadges(){
  if(window.top!==window || window.__mediaflowDownloadBadges)return;
  window.__mediaflowDownloadBadges=true;
  if(document.readyState==='loading')await new Promise(resolve=>document.addEventListener('DOMContentLoaded',resolve,{once:true}));
  let records=(await chrome.storage.local.get('m3u8DownloadHistory')).m3u8DownloadHistory?.records || [],timer;
  let pageKeys=new Set(),streamUrls=new Set();
  const indexHistory=()=>{
    pageKeys=new Set(records.map(record=>record.pageUrl && videoKey(record.pageUrl)).filter(Boolean));
    streamUrls=new Set(records.map(record=>record.url).filter(Boolean));
  };
  indexHistory();
  let owners=new Map();
  const style=document.createElement('style');style.id='mediaflow-download-status-style';
  style.textContent=`.mediaflow-status-owner{position:relative!important}.mediaflow-download-status{all:initial!important;box-sizing:border-box!important;display:inline-flex!important;align-items:center!important;gap:5px!important;position:absolute!important;bottom:8px!important;left:8px!important;z-index:998!important;padding:5px 8px!important;border-radius:9px!important;background:#111827ed!important;border:1px solid #64748b77!important;color:#cbd5e1!important;font:500 10px/1.4 MediaFlowPoppins,system-ui,sans-serif!important;pointer-events:none!important;box-shadow:0 3px 10px #0004!important}.mediaflow-download-status[data-downloaded=true]{color:#c7d2fe!important;border-color:#818cf888!important;background:#252e4bed!important}.mediaflow-download-status .mf-icon{width:13px!important;height:13px!important;flex-shrink:0!important}@font-face{font-family:MediaFlowPoppins;src:url('${(chrome.runtime.getURL?.('assets/fonts/poppins-500.ttf') || new URL('../fonts/poppins-500.ttf',import.meta.url).href)}')}`;
  style.textContent+=`.mediaflow-download-status{border-radius:999px!important;background:#29292bd9!important;border-color:#ffffff40!important;color:#f5f5f7!important;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif!important;backdrop-filter:blur(16px) saturate(140%)!important;box-shadow:inset 0 1px #ffffff26,0 2px 8px #0003!important}.mediaflow-download-status[data-downloaded=true]{color:#b9f6c8!important;border-color:#ffffff40!important;background:#29292bd9!important}@media(prefers-reduced-transparency:reduce){.mediaflow-download-status{background:#29292b!important;backdrop-filter:none!important}}@media(prefers-contrast:more){.mediaflow-download-status{border-color:#fff!important;background:#29292b!important}}`;
  document.documentElement.append(style);
  const refresh=()=>{
    clearTimeout(timer);const targets=new Map();
    for(const player of isXPage(location.href)?visibleXPlayers():[]){
      const owner=player.element.matches('video')?player.element.parentElement:player.element;
      if(owner)targets.set(owner,{pageUrl:player.pageUrl,key:videoKey(player.pageUrl)});
    }
    const cards=new Map();
    for(const link of document.querySelectorAll('a[href]')){
      const url=link.href;if(!recognizedVideoPage(url))continue;
      if(xPost(url))continue;
      // A thumbnail and its title can have different nested data-video-id
      // attributes. Prefer their shared visual card over those inner nodes.
      const card=link.closest('.videoBox,.pcVideoListItem,.thumb-block,.thumb-list__item,.videoUList > li,.video-card,.video-item') || cardOwner(link);
      const visual=card && (card.matches('.thumbnail,li.videoBox,.pcVideoListItem,.thumb-block,.thumb-list__item,[data-video-id],.video-card,.video-item') || card.querySelector('img,video'));
      if(visual && !cards.has(card)){
        const preview=card.querySelector('img,video');
        const previewOwner=preview?.parentElement?.matches('picture')?preview.parentElement.parentElement:preview?.parentElement;
        const owner=card.matches('.thumbnail')?card:card.querySelector('.thumbnail') || previewOwner || card;
        cards.set(card,{owner,pageUrl:url,key:videoKey(url)});
      }
    }
    // Some layouts nest multiple recognized card types for the same video.
    // Keep the innermost card in that case, but never merge separate cards
    // merely because they happen to link to the same video.
    const byVideo=new Map();
    for(const [card,video]of cards){if(!byVideo.has(video.key))byVideo.set(video.key,[]);byVideo.get(video.key).push({card,...video});}
    for(const group of byVideo.values())for(const entry of group){
      if(group.some(other=>other.card!==entry.card && entry.card.contains(other.card)))continue;
      const {owner,pageUrl,key}=entry;if(!targets.has(owner))targets.set(owner,{pageUrl,key});
    }
    for(const video of document.querySelectorAll('video,iframe.player__frame,iframe[src*="javplayer.cc/e/"]')){
      if([...cards.keys(),...targets.keys()].some(owner=>owner.contains(video)))continue;
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
      const downloaded=!!(video.pageUrl && pageKeys.has(videoKey(video.pageUrl)) || video.streamUrl && streamUrls.has(video.streamUrl));
      const html=icon(downloaded?'check-check':'circle')+'<span>'+(downloaded?'Downloaded':'Not downloaded')+'</span>';
      if(badge.dataset.downloaded!==String(downloaded) || !badge.firstElementChild)badge.innerHTML=html;
      badge.dataset.downloaded=String(downloaded);badge.dataset.videoKey=video.key;
      next.set(owner,badge);
    }
    for(const [owner,badge]of owners)if(!next.has(owner)){badge.remove();owner.classList.remove('mediaflow-status-owner');}
    owners=next;
  };
  const schedule=()=>{clearTimeout(timer);timer=setTimeout(refresh,150);};
  chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local' && changes.m3u8DownloadHistory){records=changes.m3u8DownloadHistory.newValue?.records || [];indexHistory();schedule();}});
  const observer=new MutationObserver(changes=>{if(changes.some(affectsPage))schedule();});
  observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['href','src']});
  for(const event of ['popstate','loadedmetadata','play','scroll','resize'])window.addEventListener(event,schedule,true);
  refresh();
}
