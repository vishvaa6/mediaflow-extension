export const decodeMediaText = value => String(value || '').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&#x2f;/gi,'/').replace(/\\\//g,'/').replace(/\\u0026/gi,'&');
export const mediaHeight = value => Number(String(Array.isArray(value) ? value[0] : value || '').match(/\d{3,4}/)?.[0]) || 0;
export function mediaFormat(url,type = '') {
  if (/m3u8|mpegurl|^hls$/i.test(type) || /\.m3u8(?:[?#]|$)/i.test(url)) return 'm3u8';
  if (/webm/i.test(type) || /\.webm(?:[?#]|$)/i.test(url)) return 'webm';
  return 'mp4';
}
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
function attribute(tag,name){return decodeMediaText(tag.match(new RegExp('\\b'+name+'\\s*=\\s*["\']([^"\']*)["\']','i'))?.[1]);}

export function extractMedia(html) {
  const definitions=[];
  const add=(url,quality=0,type='',extra={})=>{
    url=decodeMediaText(url);if(!url || /^(?:blob:|data:|javascript:)/i.test(url))return;
    const format=mediaFormat(url,type);
    if(!definitions.some(def=>def.videoUrl===url && String(def.quality)===String(quality)))definitions.push({videoUrl:url,quality,format,...extra});
  };
  const flashvars=jsonAssignment(html,/(?:var|let|const)\s+flashvars_\d+\s*=\s*/);
  for(const def of flashvars?.mediaDefinitions || [])if(def.videoUrl)add(def.videoUrl,def.quality,def.format,{isMetadata:def.format==='mp4' && !/\.mp4(?:[?#]|$)/i.test(def.videoUrl)});
  for(const [method,type,quality]of [['setVideoHLS','m3u8',0],['setVideoUrlHigh','mp4',720],['setVideoUrlLow','mp4',480]]){
    const match=html.match(new RegExp('html5player\\.'+method+'\\(["\']([^"\']+)["\']\\)'));
    if(match)add(match[1],quality,type);
  }
  for(const match of html.matchAll(/<(?:video|source)\b[^>]*>/gi)){
    const tag=match[0],url=attribute(tag,'src') || attribute(tag,'data-src');
    if(url)add(url,attribute(tag,'size') || attribute(tag,'label') || attribute(tag,'res') || 0,attribute(tag,'type'));
  }
  let visited=0;
  const visit=(object,quality=0,depth=0)=>{
    if(!object || typeof object!=='object' || depth>12 || ++visited>10000)return;
    if(Array.isArray(object)){object.forEach(item=>visit(item,quality,depth+1));return;}
    const q=object.quality || object.label || object.height || quality;
    if(object.videoUrl && object.format==='mp4')add(object.videoUrl,q,'mp4',{isMetadata:!/\.mp4(?:[?#]|$)/i.test(object.videoUrl)});
    for(const [key,value]of Object.entries(object)){
      if(typeof value==='string' && /^(?:file|src|url|video_?url|contentUrl|hls|m3u8|stream|chromecastSource)$/i.test(key) && /\.(?:m3u8|mp4|webm)(?:[?#]|$)/i.test(decodeMediaText(value)))add(value,q,object.type || object.format);
      else if(value && typeof value==='object')visit(value,mediaHeight(key) || q,depth+1);
    }
  };
  for(const match of html.matchAll(/<script\b[^>]*type=["']application\/(?:ld\+)?json["'][^>]*>([\s\S]*?)<\/script>/gi))try{visit(JSON.parse(match[1]));}catch{}
  for(const pattern of [/(?:window\.)?initials\s*=\s*/,/(?:window\.)?page_params\s*=\s*/])visit(jsonAssignment(html,pattern));
  // Quoted media fields in JW Player, Video.js and similar configurations.
  for(const match of html.matchAll(/(?:["'](?:file|src|contentUrl|video_?url|hls|m3u8)["']|\b(?:file|src|hls|m3u8))\s*[:=]\s*(["'])((?:\\.|(?!\1)[^\\\r\n])*?)\1/gi)){
    const url=decodeMediaText(match[2]);if(/\.(?:m3u8|mp4|webm)(?:[?#]|$)/i.test(url))add(url);
  }
  const title=decodeMediaText(flashvars?.video_title || html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] || '');
  return {title:title.replace(/ - XVIDEOS\.COM/i,''),definitions};
}
