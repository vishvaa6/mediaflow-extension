import {createPlayerDownloadButtons,fetchPlayerText} from './player-download-button.js';
import {collectMediaSources} from './media-resolver.js';
import {mediaFormat,mediaHeight} from './media-extraction.js';
import {mediaHeaders} from './media-headers.js';
import {visibleArea} from './viewport.js';
import {recognizedVideoPage} from './video-details.js';
import {is91PornPage,is91PornWatchPage,find91PornPlayer} from './porn91-media.js';
import {isXPage} from './x-media.js';
import {isMissavPage} from './missav-media.js';
import {isSupportedPlayerHost,normalizeSiteHost} from './top-sites-registry.js';

const videoPath=/\.(?:mp4|webm|m3u8)\/?(?:[?#]|$)/i;
const unsupportedType=/^(?:audio|image)\/|dash\+xml/i;
const unsupportedPath=/\.(?:mpd|m4a|mp3|aac|jpg|jpeg|avif|webp|png|svg|gif|vtt|css|js)(?:[?#]|$)/i;
const nativeToolbar='.mgp_controlsBar,.mhp1138_controlsBar';
const genericNativeHost='.fp-player,.fluid_video_wrapper,#kt_player,.jwplayer,.video-js,.plyr,#player-container,#video-player-bg';
const nativePlayer=`.mgp_player,.mhp1138_player,.video-element-wrapper-js,[id^="playerDiv"],#player,${genericNativeHost}`;
const previewCard='.videoBox,.pcVideoListItem,.thumb-block,.thumb-list__item,.video-card,.video-item,.video-thumb,.thumb-image-container,.videoUList > li';
const previewClassOrId=/\b(?:thumb(?:nail)?|preview)[-_a-z0-9]*\b|video[-_]?preview|preview[-_]?video/i;
const previewMediaPath=/(?:^|[/_.-])(?:preview|previews|thumbs?|thumb_vids?|t_video|sprite|teaser)(?:[/_.-]|$)/i;
const adStreamHost=/(?:^|\.)(?:exoclick|realsrv|juicyads|trafficjunky|tsyndicate|doubleclick|googlesyndication|googletagmanager|googleadservices|adservice|popads|popcash|adsterra|propellerads|hilltopads|clickadu|chaturbate|stripchat|bongacams|livejasmin|cam4|camsoda|imlive|disqus|facebook|twitter|instagram|tiktok|hcaptcha|recaptcha)\b/i;
const adIframePath=/\/(?:ads?|banner|promo|pop(?:up|under)?|widget|comments?|chat|share|login|signup|social|pixel|beacon|cdn-cgi)\b/i;
const adIframeAttr=/\b(?:ad|ads|advert|advertisement|banner|promo|sponsor|chat|cam|widget|social|comment|pixel)\b/i;
const vastOrPreroll=/(?:^|[^a-z])(?:vast|preroll|pre[-_]?roll)(?:\d*(?:[^a-z0-9]|$))/i;
const iframePlayerHosts=new Set(['hqporner.com','tnaflix.com','4tube.com','porndoe.com']);
const noIframeFallbackHosts=new Set([
  'pornhub.com','redtube.com','xvideos.com','xnxx.com','xhamster.com',
  'youporn.com','tube8.com','thumbzilla.com','youjizz.com',
  'eporner.com','spankbang.com','beeg.com','txxx.com'
]);
const autoplayMarker=['class','id','aria-label','title','data-text','data-action','data-testid']
  .flatMap(attribute=>['autoplay','auto play','auto-play'].map(label=>`[${attribute}*="${label}" i]`)).join(',');

function nativePlayerControls(video){
  let fallback;
  for(let root=video.parentElement?.closest(nativePlayer);root;root=root.parentElement?.closest(nativePlayer)){
    const toolbar=root.querySelector(nativeToolbar);
    const mainVideo=root.querySelector('video.mgp_videoElement,video.mhp1138_videoElement') ||
      (toolbar && root.querySelector('video')) ||
      (!toolbar && root.matches?.(genericNativeHost) && (root.querySelector('video.vjs-tech,video.jw-video,video.fp-engine') || [...root.querySelectorAll('video:not(.preview):not([id^="preview-"])')].find(node=>!isThumbnailPreviewVideo(node))));
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

function visibleToolbarAnchor(anchor,view=globalThis.window){
  if(!anchor || anchor.closest?.('[aria-hidden="true"],[inert]') || view?.getComputedStyle?.(anchor)?.pointerEvents==='none')return null;
  return visibleArea(anchor,view) ? anchor : null;
}

function mediaUrl(value,base){
  if(!value)return '';
  try{
    const url=new URL(value,base);
    return /^https?:$/.test(url.protocol) && !url.username && !url.password ? url.href : '';
  }catch{return '';}
}

function embeddedWatchPlayer(url,win=globalThis.window,doc=globalThis.document){
  if(!win || !doc || win.top===win)return false;
  const href=url || win.location?.href || '';
  const host=normalizeSiteHost(href);
  const ancestors=[doc.referrer,...Array.from(win.location?.ancestorOrigins || [])].map(origin=>normalizeSiteHost(origin)).filter(Boolean);
  if(host==='javplayer.cc' && ancestors.includes('123av.com'))return true;
  if((host==='mydaddy.cc' || host.endsWith('.mydaddy.cc') || host==='tnaflix.com' || host.endsWith('.tnaflix.com')) &&
    ancestors.some(ancestor=>iframePlayerHosts.has(ancestor)))return true;
  return false;
}

function matchesGenericPlayer(url=globalThis.location?.href || ''){
  if(!url)return false;
  try{if(!/^https?:$/.test(new URL(url).protocol))return false;}catch{return false;}
  return !isXPage(url) && !isMissavPage(url) && !embeddedWatchPlayer(url);
}

export function isThumbnailPreviewVideo(video,pageUrl=''){
  if(!video?.matches?.('video'))return false;
  if(video.closest?.(previewCard))return true;
  const classAndId=`${video.getAttribute?.('class') || ''} ${video.id || ''}`;
  if(previewClassOrId.test(classAndId))return true;
  const link=video.closest?.('a[href]');
  if(link){
    const href=mediaUrl(link.getAttribute?.('href') || link.href,pageUrl);
    if(href && href!==pageUrl && (recognizedVideoPage(href) || (!video.controls && !video.hasAttribute?.('controls'))))return true;
  }
  const silentLoop=Boolean((video.muted || video.hasAttribute?.('muted')) && (video.loop || video.hasAttribute?.('loop')) && !video.controls && !video.hasAttribute?.('controls'));
  if(silentLoop){
    const src=mediaUrl(video.getAttribute?.('src') || video.currentSrc || video.querySelector?.('source[src]')?.getAttribute?.('src'),pageUrl);
    if(src){
      try{if(previewMediaPath.test(new URL(src).pathname))return true;}catch{}
    }
  }
  return false;
}

function isAdIframe(frame,pageUrl){
  const rawSrc=frame.getAttribute?.('src') || frame.src || '';
  const srcUrl=mediaUrl(rawSrc,pageUrl);
  if(!srcUrl || srcUrl===pageUrl)return true;
  try{
    const parsed=new URL(srcUrl);
    if(adStreamHost.test(parsed.hostname) || adIframePath.test(parsed.pathname))return true;
  }catch{return true;}
  const attrs=`${frame.id || ''} ${frame.getAttribute?.('class') || ''} ${frame.getAttribute?.('name') || ''} ${frame.getAttribute?.('title') || ''}`;
  if(adIframeAttr.test(attrs))return true;
  if(frame.hasAttribute?.('hidden') || frame.getAttribute?.('aria-hidden')==='true')return true;
  if(frame.closest?.('[class*="advert" i],[id*="advert" i]'))return true;
  return false;
}

function isPlayerIframeCandidate(frame,host,pageUrl){
  if(isAdIframe(frame,pageUrl))return false;
  const rawSrc=frame.getAttribute?.('src') || frame.src || '';
  const srcUrl=mediaUrl(rawSrc,pageUrl);
  if(!srcUrl)return false;
  try{
    const parsed=new URL(srcUrl);
    if(iframePlayerHosts.has(host) || isSupportedPlayerHost(parsed.hostname))return true;
    if(frame.hasAttribute?.('allowfullscreen'))return true;
    if(/\b(?:embed|player|video|stream)\b|\/(?:e|v)\//i.test(`${parsed.hostname} ${parsed.pathname}`))return true;
    const attrs=`${frame.id || ''} ${frame.getAttribute?.('class') || ''}`;
    return /\b(?:player|video|embed|frame)\b/i.test(attrs);
  }catch{return false;}
}

function mainWatchPlayer(host,players,doc=document,pageUrl=location.href,view=doc?.defaultView || globalThis.window){
  if(is91PornPage(pageUrl))return find91PornPlayer(doc);
  if(host==='123av.com'){
    const frame=[...doc.querySelectorAll('iframe[src]')].find(element=>
      normalizeSiteHost(element.src)==='javplayer.cc' && /^\/e\/[\w]+\/?$/.test(new URL(element.src).pathname));
    if(frame)return frame;
  }
  let best=null,bestArea=0;
  for(const element of players){
    if(isThumbnailPreviewVideo(element,pageUrl))continue;
    const {width,height}=element.getBoundingClientRect();
    if(width<80 || height<44)continue;
    const area=width*height;
    if(area>bestArea){best=element;bestArea=area;}
  }
  if(best)return best;
  if(noIframeFallbackHosts.has(host))return null;
  let bestFrame=null,bestFrameArea=0;
  for(const frame of doc.querySelectorAll('iframe[src]')){
    if(!isPlayerIframeCandidate(frame,host,pageUrl))continue;
    const style=view?.getComputedStyle?.(frame);
    if(style && (style.display==='none' || style.visibility==='hidden' || style.visibility==='collapse' || Number(style.opacity)===0))continue;
    const {width,height}=frame.getBoundingClientRect();
    if(width<280 || height<160)continue;
    const area=width*height;
    if(area>bestFrameArea){bestFrame=frame;bestFrameArea=area;}
  }
  return bestFrame;
}

function elementSources(player,pageUrl){
  const sources=new Map();
  const add=(value,type,quality)=>{
    const videoUrl=mediaUrl(value,pageUrl);
    if(!videoUrl || unsupportedType.test(type || '') || unsupportedPath.test(videoUrl))return;
    const old=sources.get(videoUrl);
    const resolution=new URL(videoUrl).pathname.match(/(?:^|[/_.-])(\d{3,4})p?(?:[/_.-]|$)/i)?.[1];
    sources.set(videoUrl,{videoUrl,format:mediaFormat(videoUrl,type || old?.format),quality:mediaHeight(quality) || old?.quality || Number(resolution) || 'Auto'});
  };
  for(const source of player.querySelectorAll('source[src]')){
    add(source.getAttribute('src'),source.type,source.getAttribute('size') || source.getAttribute('label') || source.getAttribute('res'));
  }
  add(player.getAttribute('src'),player.getAttribute('type'));
  add(player.currentSrc,player.getAttribute('type'),player.videoHeight);
  return [...sources.values()];
}

export function collectGenericPlayers(doc=globalThis.document,pageUrl=globalThis.location?.href || '',context={}){
  if(!doc || !pageUrl)return [];
  const view=context?.view ?? (context?.innerWidth!=null ? context : globalThis.window);
  const encrypted=context?.encrypted;
  const pageSnapshot=context?.pageSnapshot;
  const host=normalizeSiteHost(pageUrl);
  const players=[...doc.querySelectorAll('video:not(.preview):not([id^="preview-"])')];
  const topPage=context.topPage ?? (!view || view.top===view);
  if(topPage && is91PornPage(pageUrl) && !is91PornWatchPage(pageUrl))return [];
  const supportedSite=isSupportedPlayerHost(pageUrl);
  const watchPage=topPage && supportedSite && recognizedVideoPage(pageUrl);
  const main=watchPage ? mainWatchPlayer(host,players,doc,pageUrl,view) : null;
  if(main?.matches('video') && (main.mediaKeys || encrypted?.has(main)))return [];
  const metadataOnly=topPage && !watchPage && !players.length && !doc.querySelector('iframe') && pageSnapshot?.pageUrl===pageUrl &&
    pageSnapshot.videoInfos.filter(source=>videoPath.test(source.videoUrl)).length===1 &&
    (doc.querySelector('meta[property="og:type"][content^="video" i]') ||
      [...doc.querySelectorAll('script[type="application/ld+json"]')].some(script=>/"@type"\s*:\s*"VideoObject"/.test(script.textContent)));
  const usingPageButton=watchPage && doc.querySelector('body > .mediaflow-download-pill[data-page-download]:is(:hover,:focus-within,[data-menu-open])');
  const pageButton=Boolean((watchPage && (!main || !visibleArea(main,view) || usingPageButton) || metadataOnly) && doc.body);
  const candidates=pageButton ? [doc.body] : watchPage ? (main?[main]:[]) : players;
  const nonPreviewCount=players.filter(node=>{
    if(isThumbnailPreviewVideo(node,pageUrl))return false;
    const {width,height}=node.getBoundingClientRect();
    return width>=80 && height>=44;
  }).length;
  const entries=[];
  for(const element of candidates){
    const video=element.matches('video');
    if(!pageButton){
      if(video && isThumbnailPreviewVideo(element,pageUrl))continue;
      const {width,height}=element.getBoundingClientRect();
      if(element.mediaKeys || encrypted?.has(element) || width<80 || height<44 || !visibleArea(element,view))continue;
    }
    const direct=video ? elementSources(element,pageUrl) : [];
    const raw=pageButton ? '' : element.getAttribute('src') || element.querySelector('source[src]')?.getAttribute('src') || element.currentSrc || '';
    const nativeControls=video ? nativePlayerControls(element) : null;
    const canResolve=watchPage || pageButton || Boolean(nativeControls) || nonPreviewCount===1 && (supportedSite || !direct.length && (raw.startsWith('blob:') || raw===''));
    if(!direct.length && !canResolve)continue;
    const poster=mediaUrl(element.getAttribute('poster'),pageUrl);
    const sourceKey=JSON.stringify([pageUrl,pageButton?'page':raw,poster,direct.map(source=>source.videoUrl)]);
    const title=element.getAttribute('aria-label') || (pageSnapshot?.pageUrl===pageUrl && pageSnapshot.pageTitle) || doc.title || 'Video';
    entries.push({element,pageUrl,sourceKey,poster,title,direct,canResolve,pageButton,watchPage,
      overlayHost:nativeControls?.host,toolbarAnchor:visibleToolbarAnchor(nativeControls?.anchor,view)});
    if(entries.length===16)break;
  }
  return entries;
}

function isMasterPlaylist(video){
  if(video.format!=='m3u8')return false;
  try{
    const {pathname}=new URL(video.videoUrl);
    const quality=mediaHeight(video.quality);
    const hasResolutionHint=/(?:^|[/_.-])(?:2160|1440|1080|720|540|480|360|240|144)p?(?:[/_.-]|$)/i.test(pathname) || quality>0;
    if(/(?:^|[/_.-])(?:master|main|manifest)(?:[._-][^/]*)?(?:\.m3u8)?(?:[?#]|$)/i.test(pathname))return true;
    if(/(?:^|[/_.-])playlist(?:[._-][^/]*)?(?:\.m3u8)?(?:[?#]|$)/i.test(pathname) && !hasResolutionHint)return true;
    return !hasResolutionHint && !/chunklist/i.test(pathname);
  }catch{return false;}
}

function sourceRank(video){
  if(isMasterPlaylist(video))return 3;
  if(video.format==='mp4' || video.format==='webm')return 2;
  return 1;
}

function mergeNormalizedSources(sources){
  const byUrl=new Map();
  for(const item of sources){
    const existing=byUrl.get(item.videoUrl);
    if(!existing){byUrl.set(item.videoUrl,item);continue;}
    const oldQuality=mediaHeight(existing.quality);
    const nextQuality=mediaHeight(item.quality);
    byUrl.set(item.videoUrl,{
      ...existing,
      ...item,
      quality:oldQuality || nextQuality || 'Auto',
      headers:{...item.headers,...existing.headers}
    });
  }
  return [...byUrl.values()].sort((a,b)=>sourceRank(b)-sourceRank(a) || mediaHeight(b.quality)-mediaHeight(a.quality));
}

function isPreviewOrAdStream(videoUrl,domPreviewUrls,allowedUrls){
  if(domPreviewUrls?.has(videoUrl) && !allowedUrls?.has(videoUrl))return true;
  if(vastOrPreroll.test(videoUrl))return true;
  try{
    const parsed=new URL(videoUrl);
    if(adStreamHost.test(parsed.hostname) || previewMediaPath.test(parsed.pathname))return true;
  }catch{return true;}
  return false;
}

function collectDomPreviewUrls(pageUrl){
  const urls=new Set();
  for(const video of document.querySelectorAll('video')){
    if(!isThumbnailPreviewVideo(video,pageUrl))continue;
    for(const source of elementSources(video,pageUrl))urls.add(source.videoUrl);
    const raw=mediaUrl(video.getAttribute('src') || video.currentSrc,pageUrl);
    if(raw)urls.add(raw);
  }
  return urls;
}

export function installGenericPlayerDetection(){
  // The outer watch page owns the button for this embed and can resolve its token.
  if(embeddedWatchPlayer(location.href))return null;
  const encrypted=new WeakSet(),resolved=new Map(),pending=new Map();
  const watched=new Set();
  const resizeObserver=typeof ResizeObserver==='function' ? new ResizeObserver(schedule) : null;
  let pageSnapshot,networkSnapshot,snapshotFetch=null,observedVersion=0,frame=0;

  const visiblePlayers=()=>genericPlayerDetector.collect(document,location.href,{encrypted,pageSnapshot,view:window});

  function normalizeSource(source,pageUrl,trustedType=false,domPreviewUrls=null,allowedUrls=null){
    const videoUrl=mediaUrl(source?.videoUrl,pageUrl),format=mediaFormat(videoUrl,source?.format);
    if(!videoUrl || unsupportedPath.test(videoUrl) || unsupportedType.test(source?.format || '') ||
      !videoPath.test(videoUrl) && !trustedType)return [];
    if(isPreviewOrAdStream(videoUrl,domPreviewUrls,allowedUrls))return [];
    return [{videoUrl,format,quality:mediaHeight(source?.quality) || 'Auto',headers:source?.headers}];
  }

  function filterObservedStreams(videoInfos,pageUrl,allowedUrls=null){
    if(!Array.isArray(videoInfos) || !videoInfos.length)return [];
    const domPreviewUrls=collectDomPreviewUrls(pageUrl);
    const out=[];
    for(const source of videoInfos){
      const validFormat=/^(?:mp4|webm|m3u8)$/i.test(source?.format || '');
      out.push(...normalizeSource(source,pageUrl,validFormat,domPreviewUrls,allowedUrls));
    }
    return out;
  }

  function isLoneNonPreviewBlobEntry(entry){
    if(!entry?.element?.matches?.('video') || entry.direct.length)return false;
    const nonPreview=[...document.querySelectorAll('video:not(.preview):not([id^="preview-"])')]
      .filter(node=>!isThumbnailPreviewVideo(node,entry.pageUrl) && node.getBoundingClientRect().width>=80 && node.getBoundingClientRect().height>=44);
    return nonPreview.length===1 && nonPreview[0]===entry.element;
  }

  function invalidateResolvedForObserved(videoInfos,pageUrl){
    const observed=filterObservedStreams(videoInfos,pageUrl);
    if(!observed.length)return false;
    observedVersion++;
    const observedUrls=observed.map(item=>item.videoUrl);
    const currentEntries=visiblePlayers();
    const allowNonEmptyUpdate=currentEntries.some(entry=>entry.watchPage || entry.pageButton || isLoneNonPreviewBlobEntry(entry));
    let invalidated=false;
    for(const [key,list] of [...resolved.entries()]){
      let keyPage='';
      try{keyPage=JSON.parse(key)[0];}catch{}
      if(keyPage!==pageUrl)continue;
      if(list.length===0 || (allowNonEmptyUpdate && observedUrls.some(url=>!list.some(item=>item.videoUrl===url)))){
        resolved.delete(key);
        invalidated=true;
      }
    }
    return invalidated || currentEntries.some(entry=>entry.canResolve && !resolved.has(entry.sourceKey) && (entry.watchPage || entry.pageButton || isLoneNonPreviewBlobEntry(entry)));
  }

  function preloadObservedEntries(){
    const entries=visiblePlayers();
    for(const entry of entries){
      if(!entry.canResolve || resolved.has(entry.sourceKey) || pending.has(entry.sourceKey))continue;
      if(entry.watchPage || entry.pageButton || isLoneNonPreviewBlobEntry(entry)){
        loadEntry(entry);
      }
    }
  }

  async function queryDetectionSnapshot(targetUrl,{force=false,invalidate=true}={}){
    const send=globalThis.chrome?.runtime?.sendMessage;
    if(typeof send!=='function')return null;
    if(snapshotFetch && !force)return snapshotFetch;
    const job=(async()=>{
      let timeout;
      try{
        const result=await Promise.race([
          Promise.resolve().then(()=>send({type:'media-detection-snapshot'})),
          new Promise(resolve=>{timeout=setTimeout(resolve,2000);})
        ]);
        if(location.href!==targetUrl)return null;
        if(result && Array.isArray(result.videoInfos) && (!result.pageUrl || result.pageUrl===targetUrl)){
          networkSnapshot={pageUrl:targetUrl,videoInfos:result.videoInfos};
          if(invalidate && invalidateResolvedForObserved(result.videoInfos,targetUrl)){
            schedule();
          }
          return result.videoInfos;
        }
      }catch{}finally{
        clearTimeout(timeout);
        if(snapshotFetch===job)snapshotFetch=null;
      }
      return null;
    })();
    snapshotFetch=job;
    return job;
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
    const startVersion=observedVersion;
    const job=(async()=>{
      let definitions=[];
      if(is91PornPage(entry.pageUrl) && entry.direct.length){resolved.set(key,[]);return;}
      try{
        // The watch page can contain unrelated preview videos. Keep its player
        // configuration scripts and the primary element's own sources.
        let html;
        if(entry.overlayHost || entry.watchPage){
          const markup=[...document.querySelectorAll('meta,script')];
          const main=entry.pageButton ? mainWatchPlayer(normalizeSiteHost(entry.pageUrl),document.querySelectorAll('video:not(.preview):not([id^="preview-"])'),document,entry.pageUrl) : entry.element;
          if(main)markup.push(main);
          for(const node of document.querySelectorAll('iframe[src],[data-streamkey]')){
            if(node===main)continue;
            if(node.matches('iframe[src]') && isAdIframe(node,entry.pageUrl))continue;
            markup.push(node.cloneNode(false));
          }
          html=markup.map(node=>node.outerHTML).join('\n');
        }else{
          html=document.documentElement.outerHTML;
        }
        ({definitions}=await collectMediaSources(html,entry.pageUrl,fetchPlayerText));
      }catch{}
      const normalize=(source,trustedType=false)=>
        normalizeSource(source,entry.pageUrl,trustedType || entry.direct.some(video=>video.videoUrl===mediaUrl(source?.videoUrl,entry.pageUrl)));
      const knownSite=isSupportedPlayerHost(entry.pageUrl);
      let videos=definitions.flatMap(source=>normalize(source,knownSite));
      const hasAdditionalSources=videos.some(video=>!entry.direct.some(source=>source.videoUrl===video.videoUrl));
      if(!is91PornPage(entry.pageUrl) && (!videos.length || knownSite && !hasAdditionalSources)){
        let timeout;
        try{
          const result=await Promise.race([chrome.runtime.sendMessage({type:'media-player-sources'}),new Promise(resolve=>{timeout=setTimeout(resolve,6000);})]);
          const legacy=Array.isArray(result?.videoInfos) ? result.videoInfos.slice(0,64) : [];
          videos.push(...legacy.flatMap(source=>normalize(source,true)));
        }catch{}finally{clearTimeout(timeout);}
      }
      const canMergeObserved=!is91PornPage(entry.pageUrl) && (entry.watchPage || entry.pageButton || isLoneNonPreviewBlobEntry(entry));
      if(canMergeObserved){
        const domStreams=pageSnapshot?.pageUrl===entry.pageUrl && Array.isArray(pageSnapshot.videoInfos) ? pageSnapshot.videoInfos : [];
        let snapStreams=networkSnapshot?.pageUrl===entry.pageUrl && Array.isArray(networkSnapshot.videoInfos) ? networkSnapshot.videoInfos : [];
        if(!domStreams.length || !snapStreams.length || !videos.length){
          const fetched=await queryDetectionSnapshot(entry.pageUrl,{invalidate:false});
          if(fetched?.length)snapStreams=fetched;
        }
        const allowedUrls=new Set([...entry.direct,...videos].map(video=>video.videoUrl));
        videos.push(...filterObservedStreams([...snapStreams,...domStreams],entry.pageUrl,allowedUrls));
      }
      videos=mergeNormalizedSources(videos);
      if(sameEntry(entry)){
        if(videos.length || entry.direct.length || observedVersion===startVersion){
          resolved.set(key,videos);
          while(resolved.size>32)resolved.delete(resolved.keys().next().value);
        }
      }
    })().finally(()=>{
      pending.delete(key);
      refresh();
      if(observedVersion!==startVersion && sameEntry(entry) && !resolved.has(key))preloadObservedEntries();
    });
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
  const handleNavigation=()=>{networkSnapshot=null;schedule();queryDetectionSnapshot(location.href,{force:true}).then(streams=>{if(streams?.length)preloadObservedEntries();});};
  window.addEventListener('popstate',handleNavigation);
  window.navigation?.addEventListener('currententrychange',handleNavigation);
  globalThis.chrome?.runtime?.onMessage?.addListener?.((message,sender)=>{
    if(sender?.id && globalThis.chrome?.runtime?.id && sender.id!==globalThis.chrome.runtime.id)return false;
    if(message?.type==='media-detection-updated'){
      queryDetectionSnapshot(location.href,{force:true}).then(streams=>{if(streams?.length)preloadObservedEntries();});
    }
    return false;
  });
  schedule();
  queryDetectionSnapshot(location.href).then(streams=>{if(streams?.length)preloadObservedEntries();});
  return {
    update(result){
      if(result?.pageUrl && result.pageUrl!==location.href)return;
      pageSnapshot=result;
      const shouldPreload=invalidateResolvedForObserved(result?.videoInfos,result?.pageUrl || location.href);
      schedule();
      if(shouldPreload)preloadObservedEntries();
    }
  };
}

export const genericPlayerDetector = Object.freeze({
  id: 'generic-player',
  matches: matchesGenericPlayer,
  collect: collectGenericPlayers,
  install: installGenericPlayerDetection
});
