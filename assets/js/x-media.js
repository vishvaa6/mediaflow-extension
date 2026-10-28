// X post metadata is shared by page detection and background link renewal.
export function isXPage(value) {
  try { const url=new URL(value); return /^https?:$/.test(url.protocol) && /^(?:(?:www|m|mobile)\.)?(?:x|twitter)\.com$/i.test(url.hostname); }
  catch { return false; }
}

export function xPost(value) {
  if (!isXPage(value)) return null;
  const url = new URL(value);
  const match = url.pathname.match(/^\/(?:[^/]+\/status|i\/web\/status|i\/status|statuses|i\/videos\/tweet)\/(\d+)(?:\/(?:video|photo)\/(\d+))?\/?$/);
  if (!match) return null;
  const index = Number(match[2] || 1);
  if (!Number.isSafeInteger(index) || index < 1 || index > 4) return null;
  return {id:match[1],index,pageUrl:`https://x.com/i/status/${match[1]}/video/${index}`};
}

export function xMediaUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && url.hostname === 'video.twimg.com' && !url.username && !url.password && /\.(?:mp4|m3u8)$/i.test(url.pathname)) return url.href;
  } catch {}
  return '';
}

function thumbnailUrl(value) {
  try { const url=new URL(value); if(url.protocol==='https:' && url.hostname==='pbs.twimg.com')return url.href; } catch {}
  return '';
}

export function extractXMedia(payload,pageUrl) {
  const post=xPost(pageUrl);
  if(!post)return [];
  const found=new Map(), pending=[{value:payload,depth:0}];
  let visited=0;
  while(pending.length && visited++<10000){
    const {value,depth}=pending.pop();
    if(!value || typeof value!=='object' || depth>32)continue;
    const legacy=value.legacy || value;
    if(String(value.rest_id || value.id_str || legacy.id_str || '')===post.id){
      const media=legacy.extended_entities?.media || value.mediaDetails || legacy.entities?.media || [];
      const videos=Array.isArray(media) ? media.filter(item=>['video','animated_gif'].includes(item?.type)) : [];
      const item=videos[post.index-1], info=item?.video_info || item?.video || item?.media_info;
      const title=`X ${post.id} - ${String(legacy.full_text || value.text || '').replace(/\s+/g,' ').trim().slice(0,160) || 'Video'}${videos.length>1?' - Video '+post.index:''}`;
      const thumbnail=thumbnailUrl(item?.media_url_https || item?.poster || item?.media_url);
      for(const variant of Array.isArray(info?.variants) ? info.variants.slice(0,16) : []){
        const videoUrl=xMediaUrl(variant?.url || variant?.src);
        if(!videoUrl)continue;
        const dimensions=new URL(videoUrl).pathname.match(/\/(\d{2,5})x(\d{2,5})\//);
        const quality=dimensions ? Math.min(Number(dimensions[1]),Number(dimensions[2])) : 'Auto';
        found.set(videoUrl,{videoUrl,quality,format:/\.m3u8(?:[?#]|$)/i.test(videoUrl)?'m3u8':'mp4',
          title,thumbnail,thumbnails:thumbnail?[thumbnail]:[],pageUrl:post.pageUrl,site:'x',
          headers:{Origin:'https://x.com',Referer:'https://x.com/'}});
      }
    }
    for(const child of Object.values(value))if(child && typeof child==='object')pending.push({value:child,depth:depth+1});
  }
  return [...found.values()];
}

export function xSyndicationUrl(pageUrl) {
  const post=xPost(pageUrl);
  if(!post)throw Error('Open an X/Twitter post containing a video');
  const url=new URL('https://cdn.syndication.twimg.com/tweet-result');
  url.searchParams.set('id',post.id);
  url.searchParams.set('lang','en');
  // X's public embed token; also documented in yt-dlp's Twitter extractor:
  // https://github.com/yt-dlp/yt-dlp/blob/master/yt_dlp/extractor/twitter.py
  url.searchParams.set('token',((Number(post.id)/1e15)*Math.PI).toString(36).replace(/[0.]/g,''));
  return url.href;
}

export async function fetchXMedia(pageUrl,fetchText) {
  const payload=JSON.parse(await fetchText(xSyndicationUrl(pageUrl),{Referer:'https://x.com/'}));
  const videos=extractXMedia(payload,pageUrl);
  if(!videos.length)throw Error('No downloadable X video is available. Open the post on X, play the video, then refresh video detection.');
  return videos;
}
