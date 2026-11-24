import {
  decodeMediaText,
  mediaHeight,
  mediaFormat,
  urlHeightHint,
  tagAttribute,
  extractKvsDefinitions,
  extractKvsFlashvars,
  parseJsObjectLiteral,
  parseJsArrayLiteral
} from './kvs-media.js';

export {decodeMediaText, mediaHeight, mediaFormat};
export function jsonAssignment(html,pattern) {
  const match=pattern.exec(html);if(!match)return null;
  const start=match.index+match[0].length;
  let depth=0,quote=false,escaped=false;
  for(let i=start;i<html.length;i++){
    const ch=html[i];
    if(quote){if(escaped)escaped=false;else if(ch==='\\')escaped=true;else if(ch==='"')quote=false;}
    else if(ch==='"')quote=true;
    else if(ch==='{' || ch==='[')depth++;
    else if(ch==='}' || ch===']'){
      if(--depth===0){try{return JSON.parse(html.slice(start,i+1));}catch{return null;}}
    }else if(!depth && !/\s/.test(ch))return null;
  }
  return null;
}
export function extractSpankbangStreams(streamData) {
  if (!streamData || typeof streamData !== 'object') return [];
  const root = streamData.stream_data && typeof streamData.stream_data === 'object' ? streamData.stream_data : streamData;
  const found = [];
  for (const [key, value] of Object.entries(root)) {
    if (/cover|thumb|poster|preview|sprite|image/i.test(key)) continue;
    const urls = Array.isArray(value) ? value : [value];
    for (const entry of urls) {
      if (typeof entry !== 'string') continue;
      const url = decodeMediaText(entry).trim();
      if (!url || !/^(?:https?:)?\/\//i.test(url)) continue;
      if (/preview|sprite|\.(?:jpe?g|png|webp|avif|gif|vtt)(?:[?#]|$)/i.test(url)) continue;
      const quality = mediaHeight(key) || urlHeightHint(url) || 0;
      const format = mediaFormat(url, /m3u8|hls/i.test(key) ? 'm3u8' : '');
      found.push({videoUrl: url.startsWith('//') ? `https:${url}` : url, quality, format});
    }
  }
  return found;
}

export function extractMedia(html) {
  const definitions=[];
  const add=(url,quality=0,type='',extra={})=>{
    url=decodeMediaText(url).trim();
    if(!url || /^(?:blob:|data:|javascript:)/i.test(url))return;
    if(url.startsWith('//'))url='https:'+url;
    const format=mediaFormat(url,type);
    const height=mediaHeight(quality);
    const existing=definitions.find(def=>def.videoUrl===url && (mediaHeight(def.quality)===height || !mediaHeight(def.quality) || !height));
    if(existing){
      if(!mediaHeight(existing.quality) && height)existing.quality=quality;
      if(extra.isMetadata && existing.isMetadata===undefined)existing.isMetadata=extra.isMetadata;
      return;
    }
    definitions.push({videoUrl:url,quality,format,...extra});
  };
  const addMindGeekDef=(def,fallbackQuality=0)=>{
    if(!def || typeof def!=='object' || typeof def.videoUrl!=='string')return;
    const rawFormat=String(def.format || def.type || 'mp4');
    if(!/^(?:mp4|webm|hls|m3u8)$/i.test(rawFormat))return;
    const decodedUrl=decodeMediaText(def.videoUrl).trim();
    const hasDirectExt=/\.(?:mp4|webm|m3u8)(?:[?#]|$)/i.test(decodedUrl);
    add(decodedUrl,def.quality || def.label || def.height || fallbackQuality,rawFormat,{isMetadata:!hasDirectExt});
  };
  const addEncodingsArray=(items,fallbackQuality=0)=>{
    if(!Array.isArray(items))return;
    for(const item of items){
      if(!item || typeof item!=='object')continue;
      const rawUrl=item.filename || item.src || item.url || item.file || item.videoUrl;
      if(typeof rawUrl!=='string')continue;
      const q=item.quality || item.label || item.height || item.res || item.name || fallbackQuality || 0;
      add(rawUrl,q,item.type || item.format || '');
    }
  };
  const flashvars=jsonAssignment(html,/(?:var|let|const)\s+flashvars_\d+\s*=\s*/);
  for(const def of flashvars?.mediaDefinitions || [])addMindGeekDef(def);
  for(const match of html.matchAll(/(?:["']mediaDefinitions?["']|\bmediaDefinitions?)\s*:\s*/gi)){
    const arr=parseJsArrayLiteral(html,match.index+match[0].length);
    if(Array.isArray(arr))for(const def of arr)addMindGeekDef(def);
  }
  for(const def of extractKvsDefinitions(html))add(def.videoUrl,def.quality,def.format);
  for(const match of html.matchAll(/(?:(?:var|let|const)\s+|window\.)?stream_data\s*=\s*/gi)){
    const obj=parseJsObjectLiteral(html,match.index+match[0].length);
    for(const def of extractSpankbangStreams(obj))add(def.videoUrl,def.quality,def.format);
  }
  for(const match of html.matchAll(/\bstream_url_([a-z0-9]+)\s*[:=]\s*(['"])((?:\\.|(?!\2)[^\\\r\n])*?)\2/gi)){
    if(/^(?:live|preview)/i.test(match[1]))continue;
    add(match[3],mediaHeight(match[1]),/m3u8|hls/i.test(match[1])?'m3u8':'');
  }
  for(const match of html.matchAll(/(?:(?:var|let|const)\s+|window\.)?(?:dataEncodings|encodings)\s*[:=]\s*/gi)){
    const arr=parseJsArrayLiteral(html,match.index+match[0].length);
    addEncodingsArray(arr);
  }
  for(const [method,type,quality]of [['setVideoHLS','m3u8',0],['setVideoUrlHigh','mp4',720],['setVideoUrlLow','mp4',480]]){
    const match=html.match(new RegExp('html5player\\.'+method+'\\(["\']([^"\']+)["\']\\)'));
    if(match)add(match[1],quality,type);
  }
  for(const match of html.matchAll(/<(?:video|source)\b[^>]*>/gi)){
    const tag=match[0],url=tagAttribute(tag,'src') || tagAttribute(tag,'data-src');
    if(!url)continue;
    const isSource=/^<source\b/i.test(tag);
    const quality=tagAttribute(tag,'size') || tagAttribute(tag,'data-quality') || tagAttribute(tag,'data-res') ||
      tagAttribute(tag,'data-label') || tagAttribute(tag,'label') || tagAttribute(tag,'res') ||
      (isSource?tagAttribute(tag,'title'):'') || 0;
    add(url,quality,tagAttribute(tag,'type'));
  }
  let visited=0;
  const visit=(object,quality=0,depth=0)=>{
    if(!object || typeof object!=='object' || depth>12 || ++visited>10000)return;
    if(Array.isArray(object)){object.forEach(item=>visit(item,quality,depth+1));return;}
    const q=object.quality || object.label || object.height || object.res || object.size || quality;
    if(object.videoUrl && /^(?:mp4|webm|hls|m3u8)$/i.test(String(object.format || '')))addMindGeekDef(object,q);
    for(const [key,value]of Object.entries(object)){
      if((key==='dataEncodings' || key==='encodings') && Array.isArray(value)){addEncodingsArray(value,q);continue;}
      if(typeof value==='string' && /^(?:file|src|url|video_?url|contentUrl|hls|m3u8|stream|chromecastSource|filename)$/i.test(key) && /\.(?:m3u8|mp4|webm)(?:[?#]|$)/i.test(decodeMediaText(value)))add(value,q,object.type || object.format);
      else if(value && typeof value==='object')visit(value,mediaHeight(key) || q,depth+1);
    }
  };
  for(const match of html.matchAll(/<script\b[^>]*type=["']application\/(?:ld\+)?json["'][^>]*>([\s\S]*?)<\/script>/gi))try{visit(JSON.parse(match[1]));}catch{}
  for(const pattern of [/(?:window\.)?initials\s*=\s*/,/(?:window\.)?page_params\s*=\s*/,/(?:window\.)?__PRELOADED_STATE__\s*=\s*/])visit(jsonAssignment(html,pattern));
  const visitConfig=(node,fallbackQuality=0,depth=0)=>{
    if(!node || typeof node!=='object' || depth>8)return;
    if(Array.isArray(node)){node.forEach(item=>visitConfig(item,fallbackQuality,depth+1));return;}
    const q=node.quality || node.label || node.res || node.size || node.height || node.title || fallbackQuality;
    const typeHint=typeof node.type==='string'?node.type:typeof node.format==='string'?node.format:'';
    for(const [key,value]of Object.entries(node)){
      if(/^(?:file|src|url|video_?url|hls|m3u8)$/i.test(key) && typeof value==='string'){
        const decoded=decodeMediaText(value).trim();
        if(/\.(?:m3u8|mp4|webm)(?:[?#]|$)/i.test(decoded) || /video\/|mpegurl|m3u8|^hls$/i.test(typeHint))add(decoded,q,typeHint || (/hls|m3u8/i.test(key)?'m3u8':''));
      }else if(value && typeof value==='object' && !/poster|thumb|preview|ad|vast|track|sprite/i.test(key)){
        visitConfig(value,mediaHeight(key) || q,depth+1);
      }
    }
  };
  for(const match of html.matchAll(/(?:\b(?:sources|playlist)\s*:\s*|\.(?:setup|src)\s*\(\s*)/gi)){
    const offset=match.index+match[0].length;
    const parsed=parseJsArrayLiteral(html,offset) || parseJsObjectLiteral(html,offset);
    if(parsed)visitConfig(parsed);
  }
  // Quoted media fields in JW Player, Video.js and similar configurations.
  for(const match of html.matchAll(/(?:["'](?:file|src|contentUrl|video_?url|hls|m3u8)["']|\b(?:file|src|hls|m3u8))\s*[:=]\s*(["'])((?:\\.|(?!\1)[^\\\r\n])*?)\1/gi)){
    const url=decodeMediaText(match[2]);if(/\.(?:m3u8|mp4|webm)(?:[?#]|$)/i.test(url))add(url);
  }
  const kvsTitle=extractKvsFlashvars(html)?.video_title;
  const title=decodeMediaText(flashvars?.video_title || kvsTitle || html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] || '');
  return {title:title.replace(/ - XVIDEOS\.COM/i,''),definitions};
}
