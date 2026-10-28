import {mediaHeaders} from './media-headers.js';
import {isXPage,xPost,xMediaUrl} from './x-media.js';
import {isMissavPage,missavVideoPage,missavMediaUrl} from './missav-media.js';

// Transient per-tab discovery only; no browsing log or cookies are persisted.
export function createMediaDiscovery() {
  const tabs=new Map();
  return {
    report(message,sender){
      if(!Number.isInteger(sender.tab?.id))return;
      const frameUrl=sender.url || message.pageUrl,pageUrl=sender.tab.url || frameUrl;
      if(!frameUrl || !/^https?:/.test(frameUrl))return;
      const key=sender.tab.id;
      let entry=tabs.get(key);
      if(!entry || entry.pageUrl!==pageUrl){entry={pageUrl,frames:new Map()};tabs.set(key,entry);}
      const videos=[];
      for(const video of (message.videoInfos || []).slice(0,64)){
        try{const url=new URL(video.videoUrl);if(!/^https?:$/.test(url.protocol) || !['mp4','webm','m3u8'].includes(video.format))continue;
          const sourcePost=xPost(video.pageUrl);
          if(isXPage(pageUrl) && (!sourcePost || !xMediaUrl(url.href)))continue;
          const missavSource=missavVideoPage(video.pageUrl);
          if(isMissavPage(pageUrl) && (!missavSource || !missavMediaUrl(url.href)))continue;
          videos.push({videoUrl:url.href,quality:video.quality,format:video.format,headers:mediaHeaders(video.headers,frameUrl),
            ...(sourcePost || missavSource ? {pageUrl:sourcePost?.pageUrl || missavSource,title:String(video.title || '').slice(0,300),thumbnail:video.thumbnail,thumbnails:video.thumbnails,site:sourcePost?'x':'missav'} : {})});
        }catch{}
      }
      entry.frames.set(sender.frameId || 0,videos);
      while(entry.frames.size>16)entry.frames.delete(entry.frames.keys().next().value);
      while(tabs.size>32)tabs.delete(tabs.keys().next().value);
    },
    snapshot(tabId,pageUrl){
      const entry=tabs.get(tabId);
      if(!entry || pageUrl && entry.pageUrl!==pageUrl)return [];
      return [...new Map([...entry.frames.values()].flat().map(video=>[video.videoUrl,video])).values()].slice(-64);
    },
    remove(tabId){tabs.delete(tabId);}
  };
}
