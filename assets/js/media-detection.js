import {extractMedia,mediaFormat,mediaHeight} from './media-extraction.js';
import {mediaHeaders} from './media-headers.js';
import {getVideoMetadata} from './video-details.js';
import {xDetector} from './x-detection.js';
import {missavDetector} from './missav-detection.js';
import {genericPlayerDetector} from './generic-player-detection.js';
import {notifyIfContextInvalid} from './extension-context.js';
import {is91PornPage,is91PornWatchPage,find91PornPlayer} from './porn91-media.js';

const videoResource=/\.(?:m3u8|mp4|webm)(?:[?#]|$)/i;

export function createDetector({id,matches,collect,install}) {
  if(typeof id!=='string' || !id.trim())throw TypeError('Detector id must be a non-empty string');
  if(typeof matches!=='function')throw TypeError(`Detector "${id}" must define matches(url)`);
  if(typeof collect!=='function')throw TypeError(`Detector "${id}" must define collect(doc)`);
  const detector={
    id:id.trim(),
    matches(url=globalThis.location?.href || ''){
      try{return Boolean(matches(url));}catch{return false;}
    },
    collect(doc=globalThis.document,url=globalThis.location?.href || '',context){
      return collect(doc,url,context);
    }
  };
  if(typeof install==='function')detector.install=install;
  return Object.freeze(detector);
}

export function runDetectors(detectors=SITE_DETECTORS,{doc=globalThis.document,url=globalThis.location?.href || '',context,firstOnly=false}={}) {
  const results=[];
  for(const detector of detectors){
    if(!detector?.matches?.(url))continue;
    results.push({id:detector.id,detector,items:detector.collect(doc,url,context)});
    if(firstOnly)break;
  }
  return results;
}

export function detectDocumentMedia(doc=document,baseUrl=location.href,timing=performance) {
  const found=new Map();
  const add=(value,quality=0,type='',headers)=>{
    try{
      const url=new URL(value,baseUrl);
      if(!/^https?:$/.test(url.protocol))return;
      const video={videoUrl:url.href,quality:mediaHeight(quality) || 'Auto',format:mediaFormat(url.href,type),headers:mediaHeaders(headers,baseUrl)};
      const old=found.get(url.href);
      if(!old || old.quality==='Auto')found.set(url.href,video);
    }catch{}
  };
  if(is91PornPage(baseUrl)){
    const player=is91PornWatchPage(baseUrl) ? find91PornPlayer(doc) : null;
    if(player){
      if(player.currentSrc || player.getAttribute('src'))add(player.currentSrc || player.getAttribute('src'),player.videoHeight,player.getAttribute('type'));
      for(const source of player.querySelectorAll('source[src]'))add(source.getAttribute('src'),source.getAttribute('size') || source.getAttribute('label'),source.getAttribute('type'));
    }
    return {pageUrl:baseUrl,...getVideoMetadata(doc,baseUrl),videoInfos:[...found.values()]};
  }
  for(const video of doc.querySelectorAll('video'))if(video.currentSrc || video.getAttribute('src'))add(video.currentSrc || video.getAttribute('src'),video.videoHeight,video.getAttribute('type'));
  for(const definition of extractMedia(doc.documentElement?.outerHTML || '').definitions)if(!definition.isMetadata)add(definition.videoUrl,definition.quality,definition.format,definition.headers);
  for(const entry of timing?.getEntriesByType?.('resource') || []){
    if(videoResource.test(entry.name))add(entry.name,entry.name.match(/(?:[/_.-])(\d{3,4})p?(?:[/_.-])/)?.[1]);
  }
  return {pageUrl:baseUrl,...getVideoMetadata(doc,baseUrl),videoInfos:[...found.values()].slice(-64)};
}

export const documentDetector=createDetector({
  id:'document',
  matches:url=>{try{return /^https?:$/.test(new URL(url).protocol);}catch{return false;}},
  collect:(doc,url,context)=>detectDocumentMedia(doc,url,context?.timing)
});

export const SITE_DETECTORS=Object.freeze([
  createDetector(xDetector),
  createDetector(missavDetector)
]);

export const DETECTORS=Object.freeze([
  ...SITE_DETECTORS,
  createDetector(genericPlayerDetector),
  documentDetector
]);

export function installMediaDetection() {
  let timer,last='',currentPage=location.href,siteDetection,genericPlayers;
  const snapshot=()=>siteDetection ? siteDetection.snapshot() : detectDocumentMedia();
  const report=()=>{
    clearTimeout(timer);
    timer=null;
    if(location.href!==currentPage){currentPage=location.href;last='';}
    const result=snapshot(),key=JSON.stringify([currentPage,result.videoInfos,result.detectionError,result.detectionStatus,result.pageTitle,result.thumbnail,result.thumbnails]);
    if(key===last)return;last=key;
    genericPlayers?.update(result);
    try{Promise.resolve(chrome.runtime.sendMessage({type:'media-detection-report',...result})).catch(notifyIfContextInvalid);}
    catch(error){notifyIfContextInvalid(error);}
  };
  const schedule=()=>{if(siteDetection){if(!timer)timer=setTimeout(report,150);}else{clearTimeout(timer);timer=setTimeout(report,250);}};
  const matchedSite=SITE_DETECTORS.find(detector=>detector.matches(currentPage));
  siteDetection=matchedSite?.install?.(schedule) || null;
  if(!siteDetection && genericPlayerDetector.matches(currentPage))genericPlayers=genericPlayerDetector.install();
  chrome.runtime.onMessage.addListener((message,sender,respond)=>{
    if(sender.id && sender.id!==chrome.runtime.id)return false;
    if(message.command==='get_generic_video_info' && window.top===window){
      if(siteDetection && message.refresh)siteDetection.refresh(true);
      respond(snapshot());return false;
    }
    return false;
  });
  document.addEventListener('loadedmetadata',schedule,true);
  document.addEventListener('play',schedule,true);
  window.addEventListener('popstate',schedule);
  if(!siteDetection && typeof PerformanceObserver!=='undefined'){
    const observer=new PerformanceObserver(list=>{if(list.getEntries().some(entry=>videoResource.test(entry.name)))schedule();});
    try{observer.observe({type:'resource',buffered:true});}catch{}
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',schedule,{once:true});else schedule();
}
