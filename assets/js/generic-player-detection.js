import {createPlayerDownloadButtons,fetchPlayerText} from './player-download-button.js';
import {collectMediaSources} from './media-resolver.js';
import {mediaFormat,mediaHeight} from './media-extraction.js';
import {mediaHeaders} from './media-headers.js';
import {visibleArea} from './viewport.js';
import {recognizedVideoPage} from './video-details.js';

const videoPath=/\.(?:mp4|webm|m3u8)(?:[?#]|$)/i;
const unsupportedType=/^(?:audio|image)\/|dash\+xml/i;
const unsupportedPath=/\.(?:mpd|m4a|mp3|aac|jpg|jpeg|avif|webp|png|svg|gif|vtt|css|js)(?:[?#]|$)/i;
const sitePlayer=/^(?:(?:[^.]+\.)?(?:pornhub\.(?:com|org)|pornhubpremium\.com|redtube\.com)|xvideos\.com|xvv1deos\.com|xnxx\.(?:com|es)|xhamster\d*\.(?:com|desi)|123av\.com|rou\.video|tangxinvlog\.app|huangguoai\.com)$/i;
const nativeToolbar='.mgp_controlsBar,.mhp1138_controlsBar';
const nativePlayer='.mgp_player,.mhp1138_player,.video-element-wrapper-js,[id^="playerDiv"],#player';
const previewCard='.videoBox,.pcVideoListItem,.thumb-block,.thumb-list__item,.video-card';
const autoplayMarker=['class','id','aria-label','title','data-text','data-action','data-testid']
  .flatMap(attribute=>['autoplay','auto play','auto-play'].map(label=>`[${attribute}*="${label}" i]`)).join(',');

function nativePlayerControls(video){
  let fallback;
  for(let root=video.parentElement?.closest(nativePlayer);root;root=root.parentElement?.closest(nativePlayer)){
    const toolbar=root.querySelector(nativeToolbar);
    const mainVideo=root.querySelector('video.mgp_videoElement,video.mhp1138_videoElement') || (toolbar && root.querySelector('video'));
    if(mainVideo!==video)continue;
    fallback ||= {host:root};
    if(!toolbar)continue;
    const autoplay=[...toolbar.querySelectorAll(autoplayMarker)].find(node=>!node.closest('.mgp_contextMenu,.mhp1138_contextMenu,[role="menu"]'));
    const button=autoplay?.closest('button,[role="button"],[role="switch"],.mgp_button,.mhp1138_button') || autoplay;
    // On toolbars with an unlabelled Autoplay switch, Next sits immediately after it.
    const anchor=button && toolbar.contains(button) ? button : toolbar.querySelector('.mgp_nextBtn,.mhp1138_nextBtn');
    return {host:root,anchor};
  }
  return fallback;
}

function visibleToolbarAnchor(anchor){
  if(!anchor || anchor.closest('[aria-hidden="true"],[inert]') || getComputedStyle(anchor).pointerEvents==='none')return null;
  return visibleArea(anchor) ? anchor : null;
}

function mediaUrl(value,base){
  if(!value)return '';
  try{
    const url=new URL(value,base);
    return /^https?:$/.test(url.protocol) && !url.username && !url.password ? url.href : '';
  }catch{return '';}
}

function siteHostname(value){
  try{return new URL(value).hostname.replace(/^www\./,'');}catch{return '';}
}

function embedded123avPlayer(){
  return window.top!==window && siteHostname(location.href)==='javplayer.cc' &&
    [document.referrer,...Array.from(location.ancestorOrigins || [])].some(url=>siteHostname(url)==='123av.com');
}

function mainWatchPlayer(host,players){
  if(host==='123av.com'){
    const frame=[...document.querySelectorAll('iframe[src]')].find(element=>
      siteHostname(element.src)==='javplayer.cc' && /^\/e\/[\w]+\/?$/.test(new URL(element.src).pathname));
    if(frame)return frame;
  }
  let best=null,bestArea=0;
  for(const element of players){
    if(element.closest(previewCard))continue;
    const {width,height}=element.getBoundingClientRect();
    if(width<80 || height<44)continue;
    const area=width*height;
    if(area>bestArea){best=element;bestArea=area;}
  }
  return best;
}

function elementSources(player,pageUrl){
  const sources=new Map();
  const add=(value,type,quality)=>{
    const videoUrl=mediaUrl(value,pageUrl);
    if(!videoUrl || unsupportedType.test(type || '') || unsupportedPath.test(videoUrl))return;
    const old=sources.get(videoUrl);
    const resolution=new URL(videoUrl).pathname.match(/(?:^|[/_.-])(\d{3,4})p(?:[/_.-]|$)/i)?.[1];
    sources.set(videoUrl,{videoUrl,format:mediaFormat(videoUrl,type || old?.format),quality:mediaHeight(quality) || old?.quality || Number(resolution) || 'Auto'});
  };
  for(const source of player.querySelectorAll('source[src]')){
    add(source.getAttribute('src'),source.type,source.getAttribute('size') || source.getAttribute('label') || source.getAttribute('res'));
  }
  add(player.getAttribute('src'),player.getAttribute('type'));
  add(player.currentSrc,player.getAttribute('type'),player.videoHeight);
  return [...sources.values()];
}

export function installGenericPlayerDetection(){
  // The outer watch page owns the button for this embed and can resolve its token.
  if(embedded123avPlayer())return null;
  const encrypted=new WeakSet(),resolved=new Map(),pending=new Map();
  const watched=new Set();
  const resizeObserver=typeof ResizeObserver==='function' ? new ResizeObserver(schedule) : null;
  let pageSnapshot,frame=0;

  function visiblePlayers(){
    const pageUrl=location.href,host=siteHostname(pageUrl);
    const players=[...document.querySelectorAll('video:not(.preview):not([id^="preview-"])')];
    const topPage=window.top===window;
    const supportedSite=sitePlayer.test(host);
    const watchPage=topPage && supportedSite && (recognizedVideoPage(pageUrl) || host==='huangguoai.com' && /^\/detail\/\d+(?:\/|$)/.test(location.pathname));
    const main=watchPage ? mainWatchPlayer(host,players) : null;
    if(main?.matches('video') && (main.mediaKeys || encrypted.has(main)))return [];
    const metadataOnly=topPage && !watchPage && !players.length && !document.querySelector('iframe') && pageSnapshot?.pageUrl===pageUrl &&
      pageSnapshot.videoInfos.filter(source=>videoPath.test(source.videoUrl)).length===1 &&
      (document.querySelector('meta[property="og:type"][content^="video" i]') ||
        [...document.querySelectorAll('script[type="application/ld+json"]')].some(script=>/"@type"\s*:\s*"VideoObject"/.test(script.textContent)));
    const usingPageButton=watchPage && document.querySelector('body > .mediaflow-download-pill[data-page-download]:is(:hover,:focus-within,[data-menu-open])');
    const pageButton=Boolean((watchPage && (!main || !visibleArea(main) || usingPageButton) || metadataOnly) && document.body);
    const candidates=pageButton ? [document.body] : watchPage ? (main?[main]:[]) : players;
    const entries=[];
    for(const element of candidates){
      const video=element.matches('video');
      if(!pageButton){
        const {width,height}=element.getBoundingClientRect();
        if(element.mediaKeys || encrypted.has(element) || width<80 || height<44 || !visibleArea(element))continue;
      }
      const direct=video ? elementSources(element,pageUrl) : [];
      const raw=pageButton ? '' : element.getAttribute('src') || element.querySelector('source[src]')?.getAttribute('src') || element.currentSrc || '';
      const nativeControls=video ? nativePlayerControls(element) : null;
      const canResolve=watchPage || pageButton || Boolean(nativeControls) || players.length===1 && (supportedSite || !direct.length && (raw.startsWith('blob:') || raw===''));
      if(!direct.length && !canResolve)continue;
      const poster=mediaUrl(element.getAttribute('poster'),pageUrl);
      const sourceKey=JSON.stringify([pageUrl,pageButton?'page':raw,poster,direct.map(source=>source.videoUrl)]);
      const title=element.getAttribute('aria-label') || (pageSnapshot?.pageUrl===pageUrl && pageSnapshot.pageTitle) || document.title || 'Video';
      entries.push({element,pageUrl,sourceKey,poster,title,direct,canResolve,pageButton,watchPage,
        overlayHost:nativeControls?.host,toolbarAnchor:visibleToolbarAnchor(nativeControls?.anchor)});
      if(entries.length===16)break;
    }
    return entries;
  }

  function variants(entry){
    const videos=new Map();
    for(const source of [...entry.direct,...(entry.canResolve ? resolved.get(entry.sourceKey) || [] : [])]){
      const old=videos.get(source.videoUrl);
      if(old && source.quality==='Auto')continue;
      const thumbnail=entry.poster || (pageSnapshot?.pageUrl===entry.pageUrl ? pageSnapshot.thumbnail : '') || '';
      videos.set(source.videoUrl,{...source,pageUrl:entry.pageUrl,title:entry.title,thumbnail,
        thumbnails:thumbnail?[thumbnail]:[],headers:mediaHeaders(source.headers,entry.pageUrl)});
    }
    return [...videos.values()];
  }

  function loadEntry(entry){
    if(!entry.canResolve)return Promise.resolve();
    const key=entry.sourceKey;
    if(pending.has(key))return pending.get(key);
    if(resolved.has(key))return Promise.resolve();
    const job=(async()=>{
      let definitions=[];
      try{
        // The watch page can contain unrelated preview videos. Keep its player
        // configuration scripts and the primary element's own sources.
        let html;
        if(entry.overlayHost || entry.watchPage){
          const markup=[...document.querySelectorAll('meta,script')];
          const main=entry.pageButton ? mainWatchPlayer(siteHostname(entry.pageUrl),document.querySelectorAll('video:not(.preview):not([id^="preview-"])')) : entry.element;
          if(main)markup.push(main);
          html=markup.map(node=>node.outerHTML).join('\n');
        }else{
          html=document.documentElement.outerHTML;
        }
        ({definitions}=await collectMediaSources(html,entry.pageUrl,fetchPlayerText));
      }catch{}
      const normalize=(source,trustedType=false)=>{
        const videoUrl=mediaUrl(source.videoUrl,entry.pageUrl),format=mediaFormat(videoUrl,source.format);
        if(!videoUrl || unsupportedPath.test(videoUrl) || unsupportedType.test(source.format || '') ||
          !videoPath.test(videoUrl) && !trustedType && !entry.direct.some(video=>video.videoUrl===videoUrl))return [];
        return [{videoUrl,format,quality:mediaHeight(source.quality) || 'Auto',headers:source.headers}];
      };
      const knownSite=sitePlayer.test(new URL(entry.pageUrl).hostname.replace(/^www\./,''));
      let videos=definitions.flatMap(source=>normalize(source,knownSite));
      const hasAdditionalSources=videos.some(video=>!entry.direct.some(source=>source.videoUrl===video.videoUrl));
      if(!videos.length || knownSite && !hasAdditionalSources){
        let timeout;
        try{
          const result=await Promise.race([chrome.runtime.sendMessage({type:'media-player-sources'}),new Promise(resolve=>{timeout=setTimeout(resolve,6000);})]);
          const legacy=Array.isArray(result?.videoInfos) ? result.videoInfos.slice(0,64) : [];
          videos.push(...legacy.flatMap(source=>normalize(source,true)));
        }catch{}finally{clearTimeout(timeout);}
      }
      if(!videos.length && pageSnapshot?.pageUrl===entry.pageUrl && !entry.direct.length){
        // An observed stream can be tied to a lone blob player only when unambiguous.
        const playlists=pageSnapshot.videoInfos.filter(source=>source.format==='m3u8');
        if(playlists.length===1)videos=playlists.flatMap(source=>normalize(source));
      }
      if(sameEntry(entry)){
        if(videos.length || entry.direct.length)resolved.set(key,videos);
        while(resolved.size>32)resolved.delete(resolved.keys().next().value);
      }
    })().finally(()=>{pending.delete(key);refresh();});
    pending.set(key,job);return job;
  }

  const buttons=createPlayerDownloadButtons({variants,loadEntry,visiblePlayers,
    needsLoad:entry=>entry.canResolve && !resolved.has(entry.sourceKey)});
  const sameEntry=entry=>location.href===entry.pageUrl && visiblePlayers().some(current=>current.element===entry.element && current.sourceKey===entry.sourceKey);
  function refresh(){
    const entries=visiblePlayers(),elements=new Set(entries.map(entry=>entry.element));
    for(const element of watched)if(!elements.has(element)){resizeObserver?.unobserve(element);watched.delete(element);}
    for(const element of elements)if(!watched.has(element)){resizeObserver?.observe(element);watched.add(element);}
    buttons.sync(entries);
  }
  function schedule(){if(!frame)frame=requestAnimationFrame(()=>{frame=0;refresh();});}
  const isPlayerNode=node=>node.nodeType===1 && (node.matches('video,video source,iframe') || node.querySelector('video,iframe'));
  const isToolbarNode=node=>node.nodeType===1 && (node.matches(nativeToolbar) || node.querySelector(nativeToolbar));
  function affectsPlayer(change){
    if(change.target.closest?.('.mediaflow-download-pill'))return false;
    if(change.target.closest?.(nativeToolbar))return true;
    if(change.type==='attributes')return isPlayerNode(change.target);
    return change.target.matches?.(`video,${nativePlayer}`) || [...change.addedNodes,...change.removedNodes].some(node=>isPlayerNode(node) || isToolbarNode(node));
  }
  new MutationObserver(changes=>{
    if(!frame && changes.some(affectsPlayer))schedule();
  }).observe(document.documentElement,{subtree:true,childList:true,attributes:true,
    attributeFilter:['src','poster','width','height','class','style','hidden','id','aria-hidden','inert','aria-label','title','data-text','data-action','data-testid']});
  function refreshToolbar(event){
    if(event.target.closest?.(nativePlayer) && !event.target.closest('.mediaflow-download-pill'))schedule();
  }
  for(const type of ['transitionend','transitioncancel','animationend','pointerover','pointerout'])document.addEventListener(type,refreshToolbar,true);
  for(const type of ['pointerout','focusout'])document.addEventListener(type,event=>{
    if(event.target.closest?.('.mediaflow-download-pill[data-page-download]'))schedule();
  },true);
  for(const type of ['loadedmetadata','play','fullscreenchange'])document.addEventListener(type,schedule,true);
  document.addEventListener('encrypted',event=>{if(event.target.matches?.('video')){encrypted.add(event.target);schedule();}},true);
  window.addEventListener('scroll',schedule,{capture:true,passive:true});
  window.addEventListener('resize',schedule,{passive:true});
  window.addEventListener('popstate',schedule);
  window.navigation?.addEventListener('currententrychange',schedule);
  schedule();
  return {update(result){pageSnapshot=result;schedule();}};
}
