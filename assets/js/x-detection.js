import {isXPage,extractXMedia,fetchXMedia} from './x-media.js';
import {visibleXPlayers,sameXThumbnail} from './x-viewport.js';

export function installXDetection(onUpdate) {
  if(!isXPage(location.href))return null;
  let observed={},timer;
  const publicCache=new Map(),pending=new Map(),watched=new Set();
  const key=entry=>entry.postId+':'+entry.index;
  function variants(entry){
    let videos=extractXMedia(observed,entry.pageUrl);
    // A virtualized card may show just one of a post's multiple videos. Match
    // its poster to the API media before relying on the DOM order.
    if(entry.poster && videos.length && !videos.some(video=>sameXThumbnail(entry.poster,video.thumbnail))){
      videos=[];
      for(let index=1;index<=4;index++){
        const candidate=extractXMedia(observed,`https://x.com/i/status/${entry.postId}/video/${index}`);
        if(candidate.some(video=>sameXThumbnail(entry.poster,video.thumbnail))){videos=candidate;break;}
      }
    }
    if(!videos.length)videos=publicCache.get(key(entry)) || [];
    if(!videos.length && entry.direct){
      const dimensions=new URL(entry.direct).pathname.match(/\/(\d{2,5})x(\d{2,5})\//);
      videos=[{videoUrl:entry.direct,quality:dimensions?Math.min(Number(dimensions[1]),Number(dimensions[2])):'Auto',
        format:/\.m3u8(?:[?#]|$)/i.test(entry.direct)?'m3u8':'mp4',site:'x',pageUrl:entry.pageUrl,
        title:`X ${entry.postId} - ${entry.title || 'Video'}`,thumbnail:entry.poster,thumbnails:entry.poster?[entry.poster]:[],
        headers:{Origin:'https://x.com',Referer:'https://x.com/'}}];
    }
    return videos;
  }
  function snapshot(){
    const videos=new Map();
    for(const entry of visibleXPlayers())for(const video of variants(entry))videos.set(video.pageUrl+'|'+video.videoUrl,video);
    const videoInfos=[...videos.values()].slice(0,64);
    return {site:'x',viewport:true,pageUrl:location.href,pageTitle:videoInfos[0]?.title || document.title,
      thumbnail:videoInfos[0]?.thumbnail || '',thumbnails:videoInfos[0]?.thumbnails || [],videoInfos};
  }
  function schedule(){if(!timer)timer=setTimeout(()=>{timer=null;refresh();},100);}
  const intersection=typeof IntersectionObserver!=='undefined'?new IntersectionObserver(schedule,{threshold:[0,0.01,0.25,0.5,1]}):null;
  function refresh(force=false){
    const entries=visibleXPlayers(),elements=new Set(entries.map(entry=>entry.element));
    for(const element of watched)if(!elements.has(element)){intersection?.unobserve(element);watched.delete(element);}
    for(const element of elements)if(!watched.has(element)){watched.add(element);intersection?.observe(element);}
    document.dispatchEvent(new CustomEvent('mediaflow:x:request',{detail:JSON.stringify({postIds:[...new Set(entries.map(entry=>entry.postId))]})}));
    onUpdate();
    const work=[];
    for(const entry of entries){
      const cacheKey=key(entry);
      if(variants(entry).length || !force && publicCache.has(cacheKey))continue;
      if(pending.has(cacheKey)){work.push(pending.get(cacheKey));continue;}
      if(pending.size>=2)continue;
      const job=(async()=>{
        try{
          const videos=await fetchXMedia(entry.pageUrl,async(url,headers)=>{
            const result=await chrome.runtime.sendMessage({type:'ext-fetch-text',url,headers});
            if(!result?.ok)throw Error(result?.error || 'Unable to read X post');
            return result.text;
          });
          publicCache.set(cacheKey,videos);
        }catch{publicCache.set(cacheKey,[]);}
        finally{
          while(publicCache.size>32)publicCache.delete(publicCache.keys().next().value);
          pending.delete(cacheKey);onUpdate();schedule();
        }
      })();
      pending.set(cacheKey,job);work.push(job);
    }
    return Promise.all(work);
  }
  document.addEventListener('mediaflow:x:media',event=>{
    if(typeof event.detail!=='string' || event.detail.length>512*1024)return;
    try{observed=JSON.parse(event.detail);onUpdate();}catch{}
  });
  document.addEventListener('mediaflow:x:navigate',schedule);
  for(const type of ['play','pause','loadedmetadata','fullscreenchange'])document.addEventListener(type,schedule,true);
  window.addEventListener('popstate',schedule);
  window.addEventListener('scroll',schedule,{passive:true,capture:true});
  window.addEventListener('resize',schedule,{passive:true});
  const mutations=new MutationObserver(schedule);
  mutations.observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['src','poster','href','style','class','hidden']});
  refresh();
  return {snapshot,refresh};
}
