import {decodeMediaText} from './media-extraction.js';
import {parsePlaylist} from './hls-playlist.js';

export function isMissavPage(value){
  try{const url=new URL(value);return /^https?:$/.test(url.protocol) && /^(?:www\.)?missav\.(?:ws|live|com|ai)$/i.test(url.hostname);}catch{return false;}
}
export function missavVideoPage(value,base){
  try{
    const url=new URL(value,base);
    if(!isMissavPage(url.href))return '';
    const match=url.pathname.match(/^\/(?:dm\d+\/)?(en|ja|cn|zh|ko|ms|th|de|fr|vi|id|fil|pt)\/([a-z0-9][a-z0-9_-]*)\/?$/i);
    if(!match || !/\d/.test(match[2]) || /^(?:fc2|1pondo|10musume)$/i.test(match[2]))return '';
    return `${url.origin}/${match[1]}/${match[2]}`;
  }catch{return '';}
}
export function missavMediaUrl(value,base){
  try{const url=new URL(decodeMediaText(value),base);if(/^https?:$/.test(url.protocol) && /\.(?:m3u8|mp4|webm)$/i.test(url.pathname) && !/\/(?:preview|trailer)(?:[./_-]|$)/i.test(url.pathname))return url.href;}catch{}
  return '';
}
function unquote(value){
  return value.replace(/\\(u[\da-f]{4}|x[\da-f]{2}|[\s\S])/gi,(_,escaped)=>{
    if(/^[ux]/i.test(escaped))return String.fromCharCode(parseInt(escaped.slice(1),16));
    return ({n:'\n',r:'\r',t:'\t',b:'\b',f:'\f'})[escaped] ?? escaped;
  });
}
function unpackScripts(html){
  const texts=[String(html).slice(0,2*1024*1024)];
  // Decode the packer's data arguments. No page JavaScript is evaluated.
  const pattern=/\}\(\s*(['"])((?:\\.|(?!\1)[^\\])*?)\1\s*,\s*(\d{1,2})\s*,\s*(\d{1,5})\s*,\s*(['"])((?:\\.|(?!\5)[^\\])*?)\5\.split\(\s*['"]\|['"]\s*\)/g;
  const alphabet='0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  for(let depth=0;depth<3;depth++){
    const input=texts[depth];if(!input)break;
    const decoded=[];
    for(const match of input.matchAll(pattern)){
      const radix=Number(match[3]),count=Number(match[4]);
      if(radix<2 || radix>62 || count>5000 || match[2].length>1024*1024 || match[6].length>1024*1024)continue;
      const table=unquote(match[6]).split('|');
      decoded.push(unquote(match[2]).replace(/\b[\da-zA-Z]+\b/g,token=>{
        let index=0;for(const char of token){const digit=alphabet.indexOf(char);if(digit<0 || digit>=radix)return token;index=index*radix+digit;if(index>=count)return token;}
        return table[index] || token;
      }));
      if(decoded.length>=8)break;
    }
    if(decoded.length)texts.push(decoded.join('\n'));else break;
  }
  return texts;
}
export function extractMissavDefinitions(html,pageUrl){
  const found=new Map(),headers={Origin:new URL(pageUrl).origin,Referer:pageUrl};
  const add=(value,quality)=>{
    const videoUrl=missavMediaUrl(value,pageUrl);if(!videoUrl)return;
    const height=Number(new URL(videoUrl).pathname.match(/\/(\d{3,4})p?\//)?.[1]) || Number(quality) || 0;
    found.set(videoUrl,{videoUrl,quality:height,format:/\.m3u8(?:[?#]|$)/i.test(videoUrl)?'m3u8':/\.webm(?:[?#]|$)/i.test(videoUrl)?'webm':'mp4',headers});
  };
  const texts=unpackScripts(html);
  for(const text of texts){
    for(const match of text.matchAll(/\b(?:source\d*|hlsUrl|hls_url)\s*=\s*(['"])((?:\\.|(?!\1)[^\\])*?)\1/g))add(unquote(match[2]));
    for(const match of decodeMediaText(text).matchAll(/https?:\/\/surrit\.com\/[a-f0-9-]{36}\/(?:playlist|\d{3,4}p\/video)\.m3u8(?:\?[^\s'"<>\\]*)?/gi))add(match[0]);
    for(const match of text.matchAll(/<(?:video|source)\b[^>]*\bsrc\s*=\s*['"]([^'"]+)['"][^>]*>/gi))add(match[1]);
  }
  // Old packer tables are also readable when the wrapper was stripped.
  if(!found.size){
    const packed=String(html).match(/m3u8\|([a-f0-9|]+)\|com\|surrit\|https\|video/i)?.[1];
    const id=packed?.split('|').filter(Boolean).reverse().join('-');
    if(/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id || '')){
      add(`https://surrit.com/${id}/playlist.m3u8`);
      for(const quality of new Set([...String(html).matchAll(/\b(\d{3,4})p\b/g)].map(match=>match[1])))add(`https://surrit.com/${id}/${quality}p/video.m3u8`,quality);
    }
  }
  return [...found.values()];
}
export function missavNeedsVerification(html){return /<title[^>]*>\s*(?:Just a moment|Attention Required)|cf-chl-|challenge-platform\//i.test(String(html));}
export async function resolveMissavSources(html,pageUrl,fetchText){
  if(missavNeedsVerification(html))throw Error('Open MissAV in your browser, complete its verification, then refresh detection.');
  const definitions=extractMissavDefinitions(html,pageUrl),found=new Map();
  for(const definition of definitions){
    if(definition.format==='m3u8' && !definition.quality){
      try{
        const playlist=parsePlaylist(await fetchText(definition.videoUrl,definition.headers),definition.videoUrl);
        if(playlist.variants){for(const variant of playlist.variants)found.set(variant.url,{...definition,videoUrl:variant.url,quality:variant.height || 0});continue;}
      }catch(error){if(error.name==='AbortError')throw error;}
    }
    if(!found.has(definition.videoUrl))found.set(definition.videoUrl,definition);
  }
  return [...found.values()];
}
