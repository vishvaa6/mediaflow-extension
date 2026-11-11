import {extractMedia,decodeMediaText as decode,mediaHeight} from './media-extraction.js';
import {siteDefinitions} from './site-media.js';
import {expandXPlaylist} from './x-media.js';
import {parsePlaylist} from './hls-playlist.js';
export {extractMedia} from './media-extraction.js';
function playlistVariants(text, baseUrl) {
  const parsed=parsePlaylist(text,baseUrl);
  if (!parsed.variants) return [];
  // Passing a child playlist to the worker loses its master audio group.
  // Only expose variants that contain their audio; if none qualify, keep the
  // master so the downloader reports the unsupported separate track safely.
  return parsed.variants.filter(variant=>!parsed.audioGroups.includes(variant.audio))
    .map(variant=>({format:'m3u8',quality:variant.height,videoUrl:variant.url}));
}
const height = definition => mediaHeight(definition.quality);
export function chooseDefinition(definitions, preference,{preferMp4=false}={}) {
  const sorted = definitions.filter(def => def.videoUrl).sort((a,b) => height(b)-height(a) || (preferMp4?Number(b.format==='mp4')-Number(a.format==='mp4'):0));
  if (preference === 'mp4') return sorted.find(def => def.format === 'mp4');
  const wanted = mediaHeight(preference);
  return wanted ? sorted.find(def => height(def) === wanted) || sorted.find(def => height(def) < wanted) || sorted[0] : sorted[0];
}
export async function collectMediaSources(html,pageUrl,fetchText,requiredFormat) {
  const media = extractMedia(html), definitions = [];
  const site = await siteDefinitions(html,pageUrl,fetchText);
  for (const definition of [...site,...media.definitions]) {
    if (!definition.videoUrl) continue;
    const url = new URL(decode(definition.videoUrl),pageUrl).href;
    const format = definition.format === 'hls' || definition.format === 'm3u8' || /\.m3u8(?:[?#]|$)/i.test(url) ? 'm3u8' : definition.format || 'mp4';
    if (requiredFormat && format !== requiredFormat) continue;
    if (definition.isMetadata) {
      try {
        const result = JSON.parse(await fetchText(url,{Referer:pageUrl}));
        if (Array.isArray(result)) definitions.push(...result.map(def => ({...def,videoUrl:new URL(decode(def.videoUrl),url).href,format:'mp4',headers:definition.headers})));
      } catch { /* Other definitions may still provide a working stream. */ }
    } else definitions.push({...definition,videoUrl:url,format});
  }
  return {definitions,title:media.title};
}

export async function resolveMedia(html,pageUrl,preference,fetchText,{format:requiredFormat,strictQuality=false,preferMp4=false} = {}) {
  const {definitions,title}=await collectMediaSources(html,pageUrl,fetchText,requiredFormat);
  const expanded = [];
  for (const definition of definitions) {
    if (definition.format === 'm3u8' && preference !== 'mp4') {
      try {
        if (definition.site === 'x') {
          expanded.push(...await expandXPlaylist(definition,fetchText));
          continue;
        }
        const variants = playlistVariants(await fetchText(definition.videoUrl,definition.headers || {Referer:pageUrl}),definition.videoUrl);
        expanded.push(...(variants.length ? variants.map(variant=>({...definition,...variant})) : [definition]));
      } catch { expanded.push(definition); }
    } else expanded.push(definition);
  }
  const wanted=mediaHeight(preference);
  const candidates = strictQuality && wanted > 0 ? expanded.filter(def => height(def) === wanted) : expanded;
  const chosen = chooseDefinition(candidates,preference,{preferMp4});
  if (!chosen && requiredFormat) throw Error('The original video quality/format is unavailable. Cached data was kept; retry when it is available.');
  if (!chosen) throw Error(preference === 'mp4' ? 'No MP4 stream is available for this video' : 'No supported video stream found');
  const videoUrl = new URL(decode(chosen.videoUrl),pageUrl).href;
  const quality = height(chosen);
  return {title:chosen.title || title,url:videoUrl,format:chosen.format,quality:String(quality || 'Auto'),...(chosen.headers ? {headers:chosen.headers} : {})};
}

export function safeFilePart(value) {
  let part = decode(value).replace(/\.(mp4|webm|m3u8|ts)$/i,'').replace(/[<>:"/\\|?*\x00-\x1f]/g,' ').replace(/\s+/g,' ').trim().replace(/[. ]+$/,'').slice(0,120);
  if (/^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(part)) part = '_'+part;
  return part || 'video';
}
