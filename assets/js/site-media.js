import {decodeMediaText,mediaFormat} from './media-extraction.js';
import {isXPage,fetchXMedia} from './x-media.js';
import {isMissavPage,extractMissavDefinitions} from './missav-media.js';

export async function siteDefinitions(html,pageUrl,fetchText) {
  if(isXPage(pageUrl))return fetchXMedia(pageUrl,fetchText);
  const page=new URL(pageUrl),host=page.hostname.replace(/^www\./,'');
  if(host==='123av.com'){
    let embed;
    const sources=[...html.matchAll(/<iframe\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi)].map(match=>match[1]);
    sources.push(...[...html.matchAll(/https?:\/\/javplayer\.cc\/e\/[^\s"'<>]+/gi)].map(match=>match[0]));
    for(const value of sources){try{const candidate=new URL(decodeMediaText(value),pageUrl);if(/^https?:$/.test(candidate.protocol) && /^\/e\/[\w]+\/?$/.test(candidate.pathname)){embed=candidate;break;}}catch{}}
    if(!embed)return [];
    const api=new URL('/stream',embed);api.search=embed.search;api.searchParams.set('id',embed.pathname.match(/\/e\/(\w+)/)[1]);
    const text=await fetchText(api.href,{Origin:embed.origin,Referer:embed.href,Accept:'application/json,*/*'});
    let stream;try{const result=JSON.parse(text);stream=result.media?.stream || result.stream;}catch{}
    stream ||= text.match(/https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*/i)?.[0];
    if(typeof stream!=='string')throw Error('The 123av player returned no available stream. Open the video page and start playback, then retry.');
    return [{videoUrl:new URL(decodeMediaText(stream),embed).href,format:'m3u8',quality:0,headers:{Origin:embed.origin,Referer:embed.origin+'/'}}];
  }
  if(isMissavPage(pageUrl))return extractMissavDefinitions(html,pageUrl);
  if(host==='tangxinvlog.app'){
    const image=html.match(/<meta\b[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i)?.[1];
    const prefix=decodeMediaText(image).match(/^(https?:\/\/[^/]+\/videos\/\d+)\/cover\.jpg/i)?.[1];
    return prefix ? [{videoUrl:prefix+'/index.m3u8',format:'m3u8',quality:0}] : [];
  }
  if(host==='rou.video'){
    const id=page.pathname.match(/^\/v\/([^/]+)\/?$/)?.[1];
    return id ? [{videoUrl:new URL('/api/hls/'+encodeURIComponent(id),pageUrl).href,format:'m3u8',quality:0}] : [];
  }
  if(host==='huangguoai.com'){
    let initial;try{initial=JSON.parse(html.match(/<script\b[^>]*id=["']videoInitialData["'][^>]*>([\s\S]*?)<\/script>/i)?.[1] || '{}');}catch{return [];}
    const id=page.pathname.match(/^\/(?:video|detail)\/(\d+)/)?.[1];if(!id)return [];
    const episode=page.pathname.match(/\/ep-(\d+)/)?.[1] || page.searchParams.get('ep') || initial.ep || 1;
    let url;
    try{const result=JSON.parse(await fetchText(new URL(`/api/videos/${id}/play?ep=${episode}`,pageUrl).href,{Referer:pageUrl}));if((result.status===1 || result.code===200) && (result.data?.ep_num==null || Number(result.data.ep_num)===Number(episode)))url=result.data?.video_url;}catch{}
    if(String(initial.id)===id)url ||= initial.epPlaySrcs?.[String(episode)] || (Number(initial.ep || 1)===Number(episode) ? initial.videoSrc : '');
    return typeof url==='string' && /^https?:/.test(url) ? [{videoUrl:url,format:mediaFormat(url),quality:0}] : [];
  }
  return [];
}
