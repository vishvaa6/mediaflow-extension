import {extractMedia,mediaFormat,mediaHeight} from './media-extraction.js';
import {mediaHeaders} from './media-headers.js';
import {getVideoMetadata} from './video-details.js';
import {installXDetection} from './x-detection.js';
import {installMissavDetection} from './missav-detection.js';
import {installGenericPlayerDetection} from './generic-player-detection.js';
import {notifyIfContextInvalid} from './extension-context.js';

const videoResource=/\.(?:m3u8|mp4|webm)(?:[?#]|$)/i;

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
  for(const video of doc.querySelectorAll('video'))if(video.currentSrc || video.getAttribute('src'))add(video.currentSrc || video.getAttribute('src'),video.videoHeight,video.getAttribute('type'));
  for(const definition of extractMedia(doc.documentElement?.outerHTML || '').definitions)if(!definition.isMetadata)add(definition.videoUrl,definition.quality,definition.format,definition.headers);
  for(const entry of timing?.getEntriesByType?.('resource') || []){
    if(videoResource.test(entry.name))add(entry.name,entry.name.match(/(?:[/_.-])(\d{3,4})p?(?:[/_.-])/)?.[1]);
  }
  return {pageUrl:baseUrl,...getVideoMetadata(doc,baseUrl),videoInfos:[...found.values()].slice(-64)};
}

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
  siteDetection=installXDetection(schedule) || installMissavDetection(schedule);
  if(!siteDetection)genericPlayers=installGenericPlayerDetection();
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
