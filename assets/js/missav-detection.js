import {isMissavPage,missavVideoPage,missavNeedsVerification,resolveMissavSources} from './missav-media.js';
import {getVideoMetadata} from './video-details.js';
import {visibleArea} from './viewport.js';

export function visibleMissavEntries(doc=document,pageUrl=location.href,view=window){
  const entries=new Map(),current=missavVideoPage(pageUrl);
  if(current){
    const player=[...doc.querySelectorAll('video')].find(video=>!video.classList.contains('preview') && !video.id.startsWith('preview-'));
    if(player && visibleArea(player,view))entries.set(current,{element:player,pageUrl:current,main:true,title:doc.querySelector('h1')?.textContent?.trim() || doc.title});
  }
  for(const card of doc.querySelectorAll('.thumbnail')){
    if(!visibleArea(card,view))continue;
    const link=[...card.querySelectorAll('a[href]')].find(link=>missavVideoPage(link.getAttribute('href'),pageUrl));
    if(!link)continue;
    const source=missavVideoPage(link.getAttribute('href'),pageUrl);
    if(entries.has(source))continue;
    const image=card.querySelector('img'),raw=image?.getAttribute('data-src') || image?.getAttribute('src');
    let thumbnail='';try{const url=new URL(raw,pageUrl);if(/^https?:$/.test(url.protocol))thumbnail=url.href;}catch{}
    const title=[...card.querySelectorAll('a[href]')].map(link=>link.textContent?.trim()).find(text=>text && !/^[\d:]+$/.test(text)) || image?.getAttribute('alt') || link.getAttribute('alt') || 'MissAV video';
    entries.set(source,{element:card,pageUrl:source,main:false,title,thumbnail});
  }
  return [...entries.values()].slice(0,12);
}

export function installMissavDetection(onUpdate){
  if(!isMissavPage(location.href))return null;
  const cache=new Map(),pending=new Map(),watched=new Set();
  let timer;
  function snapshot(){
    const entries=visibleMissavEntries(),videos=new Map(),errors=[];
    for(const entry of entries){
      const result=cache.get(entry.pageUrl);
      for(const video of result?.videos || [])videos.set(video.pageUrl+'|'+video.videoUrl,video);
      if(result?.error)errors.push(result.error);
    }
    const videoInfos=[...videos.values()].slice(0,64),first=videoInfos[0];
    return {site:'missav',viewport:true,pageUrl:location.href,pageTitle:first?.title || document.title,
      thumbnail:first?.thumbnail || '',thumbnails:first?.thumbnails || [],videoInfos,
      detectionError:errors[0] || '',detectionStatus:entries.some(entry=>pending.has(entry.pageUrl))?'Resolving visible MissAV videos…':''};
  }
  function schedule(){if(!timer)timer=setTimeout(()=>{timer=null;refresh();},150);}
  const intersection=typeof IntersectionObserver!=='undefined'?new IntersectionObserver(schedule,{threshold:[0,0.01,0.5,1]}):null;
  async function fetchText(url,headers,signal){
    const requestHeaders=new Headers(headers || {});
    for(const header of ['Origin','Referer','Cookie'])requestHeaders.delete(header);
    try{
      const response=await fetch(url,{headers:requestHeaders,credentials:'include',cache:'no-store',signal:AbortSignal.any([signal,AbortSignal.timeout(15000)])});
      if(!response.ok)throw Error(`HTTP ${response.status}`);
      const text=await response.text();
      if(missavNeedsVerification(text))throw Error('Verification needed');
      return text;
    }catch(error){
      if(signal.aborted)throw signal.reason || new DOMException('Stopped','AbortError');
      const result=await chrome.runtime.sendMessage({type:'ext-fetch-text',url,headers});
      if(signal.aborted)throw signal.reason || new DOMException('Stopped','AbortError');
      if(!result?.ok || missavNeedsVerification(result.text))throw Error('Open the video on MissAV, complete any verification, then refresh detection.');
      return result.text;
    }
  }
  function refresh(force=false){
    const entries=visibleMissavEntries(),active=new Set(entries.map(entry=>entry.pageUrl)),elements=new Set(entries.map(entry=>entry.element));
    for(const [url,job] of pending)if(!active.has(url)){job.controller.abort();pending.delete(url);}
    for(const element of watched)if(!elements.has(element)){intersection?.unobserve(element);watched.delete(element);}
    for(const element of elements)if(!watched.has(element)){intersection?.observe(element);watched.add(element);}
    const work=[];
    for(const entry of entries){
      const cached=cache.get(entry.pageUrl);
      if(!force && cached && Date.now()-cached.at<(cached.error?60000:5*60000))continue;
      if(pending.has(entry.pageUrl)){work.push(pending.get(entry.pageUrl).promise);continue;}
      if(pending.size>=2)continue;
      const job={controller:new AbortController()};pending.set(entry.pageUrl,job);
      job.promise=(async()=>{
        try{
          const getText=(url,headers)=>fetchText(url,headers,job.controller.signal);
          const html=entry.main?document.documentElement.outerHTML:await getText(entry.pageUrl,{Referer:location.href});
          const definitions=await resolveMissavSources(html,entry.pageUrl,getText);
          if(!definitions.length)throw Error('Open the video on MissAV and refresh detection when the player is ready.');
          const doc=entry.main?document:new DOMParser().parseFromString(html,'text/html');
          const metadata=getVideoMetadata(doc,entry.pageUrl),title=doc.querySelector('h1')?.textContent?.trim() || metadata.pageTitle || entry.title;
          const thumbnail=metadata.thumbnail || entry.thumbnail || '';
          const videos=definitions.map(def=>({...def,quality:def.quality || 'Auto',site:'missav',pageUrl:entry.pageUrl,title,thumbnail,thumbnails:metadata.thumbnails?.length?metadata.thumbnails:thumbnail?[thumbnail]:[]}));
          if(!job.controller.signal.aborted)cache.set(entry.pageUrl,{videos,error:'',at:Date.now()});
        }catch(error){if(!job.controller.signal.aborted)cache.set(entry.pageUrl,{videos:[],error:error.message,at:Date.now()});}
        finally{
          if(pending.get(entry.pageUrl)===job)pending.delete(entry.pageUrl);
          while(cache.size>48)cache.delete(cache.keys().next().value);
          onUpdate();schedule();
        }
      })();
      work.push(job.promise);
    }
    onUpdate();return Promise.all(work);
  }
  const mutations=new MutationObserver(changes=>{
    if(changes.some(change=>[...change.addedNodes].some(node=>node.nodeName==='SCRIPT'))){const page=missavVideoPage(location.href);if(cache.get(page)?.error)cache.delete(page);}
    schedule();
  });
  mutations.observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['src','data-src','poster','href','style','class','hidden']});
  window.addEventListener('scroll',schedule,{passive:true,capture:true});window.addEventListener('resize',schedule,{passive:true});window.addEventListener('popstate',schedule);
  document.addEventListener('loadedmetadata',()=>{const page=missavVideoPage(location.href);if(cache.get(page)?.error)cache.delete(page);schedule();},true);
  document.addEventListener('play',schedule,true);
  refresh();return {snapshot,refresh};
}
