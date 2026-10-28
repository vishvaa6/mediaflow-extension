import {extractMedia,mediaFormat,mediaHeight} from './media-extraction.js';
import {mediaHeaders} from './media-headers.js';
import {getVideoMetadata} from './video-details.js';
import {installXDetection} from './x-detection.js';
import {installMissavDetection} from './missav-detection.js';

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
    if(/\.(?:m3u8|mp4|webm)(?:[?#]|$)/i.test(entry.name))add(entry.name,entry.name.match(/(?:[/_.-])(\d{3,4})p?(?:[/_.-])/)?.[1]);
  }
  return {pageUrl:baseUrl,...getVideoMetadata(doc,baseUrl),videoInfos:[...found.values()].slice(-64)};
}

export function installMediaDetection() {
  let timer,last='',currentPage=location.href,xDetection;
  const snapshot=()=>xDetection ? xDetection.snapshot() : detectDocumentMedia();
  const report=()=>{
    clearTimeout(timer);
    timer=null;
    if(location.href!==currentPage){currentPage=location.href;last='';}
    const result=snapshot(),key=JSON.stringify([currentPage,result.videoInfos,result.detectionError,result.detectionStatus]);
    if(key===last)return;last=key;
    chrome.runtime.sendMessage({type:'media-detection-report',...result}).catch(()=>{});
  };
  const schedule=()=>{if(xDetection){if(!timer)timer=setTimeout(report,150);}else{clearTimeout(timer);timer=setTimeout(report,250);}};
  xDetection=installXDetection(schedule) || installMissavDetection(schedule);
  chrome.runtime.onMessage.addListener((message,sender,respond)=>{
    if(sender.id && sender.id!==chrome.runtime.id)return false;
    if(message.command==='get_generic_video_info' && window.top===window){
      if(xDetection && message.refresh)xDetection.refresh(true);
      respond(snapshot());return false;
    }
    return false;
  });
  document.addEventListener('loadedmetadata',schedule,true);
  document.addEventListener('play',schedule,true);
  window.addEventListener('popstate',schedule);
  if(typeof PerformanceObserver!=='undefined'){
    const observer=new PerformanceObserver(schedule);
    try{observer.observe({type:'resource',buffered:true});}catch{}
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',schedule,{once:true});else schedule();
}
