import {
  decodeMediaText,
  mediaFormat,
  mediaHeight,
  extractMedia,
  extractSpankbangStreams
} from './media-extraction.js';
import {tagAttribute} from './kvs-media.js';
import {isXPage, fetchXMedia} from './x-media.js';
import {isMissavPage, extractMissavDefinitions} from './missav-media.js';
import {normalizeSiteHost, isTopVideoSite} from './top-sites-registry.js';

const TXXX_CHAR_MAP = {
  '\u0410': 'A', '\u0412': 'B', '\u0421': 'C', '\u0415': 'E', '\u041d': 'H',
  '\u0406': 'I', '\u041a': 'K', '\u041c': 'M', '\u041e': 'O', '\u0420': 'P',
  '\u0422': 'T', '\u0425': 'X',
  '\u0430': 'a', '\u0441': 'c', '\u0435': 'e', '\u043e': 'o', '\u0440': 'p',
  '\u0443': 'y', '\u0445': 'x',
  '.': '+', ',': '/', '~': '=', '-': '+', '_': '/'
};

const AD_IFRAME_HOST_RE = /(?:^|\.)(?:exoclick|realsrv|juicyads|trafficjunky|tsyndicate|doubleclick|googlesyndication|googletagmanager|googleadservices|adservice|popads|popcash|adsterra|propellerads|hilltopads|clickadu|chaturbate|stripchat|bongacams|livejasmin|cam4|camsoda|imlive|disqus|facebook|twitter|instagram|tiktok|hcaptcha|recaptcha)\b/i;
const AD_IFRAME_PATH_RE = /\/(?:ads?|banner|promo|pop(?:up|under)?|widget|comments?|chat|share|login|signup|social|pixel|beacon|cdn-cgi)\b/i;
const AD_IFRAME_ATTR_RE = /\b(?:ad|ads|advert|advertisement|banner|promo|sponsor|chat|cam|widget|social|comment|pixel)\b/i;

const IFRAME_PLAYER_HOSTS = new Set(['hqporner.com', 'tnaflix.com', '4tube.com', 'porndoe.com']);
const NO_IFRAME_FALLBACK_HOSTS = new Set([
  'pornhub.com', 'redtube.com', 'xvideos.com', 'xnxx.com', 'xhamster.com',
  'youporn.com', 'tube8.com', 'thumbzilla.com', 'youjizz.com',
  'eporner.com', 'spankbang.com', 'beeg.com', 'txxx.com'
]);

export function decodeTxxxVideoUrl(value) {
  const raw = decodeMediaText(value).trim();
  if (!raw) return '';
  if (/^(?:https?:)?\/\//i.test(raw) || raw.startsWith('/')) return raw;
  const normalized = raw.replace(/./g, ch => TXXX_CHAR_MAP[ch] ?? ch).replace(/\s+/g, '');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  try {
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, ch => ch.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return '';
  }
}

function findPlayerIframeUrls(html, pageUrl, host) {
  const candidates = [];
  const seen = new Set();
  for (const match of String(html || '').matchAll(/<iframe\b[^>]*>/gi)) {
    const tag = match[0];
    const rawSrc = tagAttribute(tag, 'src') || tagAttribute(tag, 'data-src');
    if (!rawSrc || /^(?:about:|javascript:|data:)/i.test(rawSrc.trim())) continue;
    let embedUrl;
    try {
      embedUrl = new URL(rawSrc.trim(), pageUrl);
    } catch {
      continue;
    }
    if (!/^https?:$/i.test(embedUrl.protocol) || embedUrl.href === pageUrl || seen.has(embedUrl.href)) continue;
    seen.add(embedUrl.href);

    const id = tagAttribute(tag, 'id');
    const cls = tagAttribute(tag, 'class');
    const width = Number(tagAttribute(tag, 'width'));
    const height = Number(tagAttribute(tag, 'height'));
    if (AD_IFRAME_HOST_RE.test(embedUrl.hostname)) continue;
    if (AD_IFRAME_PATH_RE.test(embedUrl.pathname)) continue;
    if (AD_IFRAME_ATTR_RE.test(`${id} ${cls}`)) continue;
    if ((width > 0 && width < 100) || (height > 0 && height < 100)) continue;

    let score = 0;
    if (embedUrl.hostname === 'mydaddy.cc' || embedUrl.hostname.endsWith('.mydaddy.cc')) score += 10;
    if (/\b(?:embed|player|video|e)\b/i.test(`${embedUrl.hostname} ${embedUrl.pathname}`)) score += 5;
    if (/\ballowfullscreen\b/i.test(tag)) score += 3;
    if (/\b(?:player|video|embed|frame)\b/i.test(`${id} ${cls}`)) score += 2;
    if (score > 0 || host === 'hqporner.com') candidates.push({embedUrl, score});
  }
  return candidates.sort((a, b) => b.score - a.score).slice(0, 2).map(item => item.embedUrl);
}

async function resolveEporner(html, page, pageUrl, fetchText) {
  if (typeof fetchText !== 'function') return [];
  const vid = html.match(/(?:EP\.video\.player\.vid|["']?vid["']?)\s*[:=]\s*["']([a-z0-9_-]+)["']/i)?.[1] ||
    page.pathname.match(/\/(?:video-|hd-porn\/)([a-z0-9_-]+)/i)?.[1];
  const hash = html.match(/(?:EP\.video\.player\.hash|["']?hash["']?)\s*[:=]\s*["']([a-f0-9]{32})["']/i)?.[1];
  if (!vid || !hash) return [];

  let calc = '';
  for (let i = 0; i < 32; i += 8) {
    calc += BigInt('0x' + hash.slice(i, i + 8)).toString(36);
  }
  const apiUrl = new URL(
    `/xhr/video/${encodeURIComponent(vid)}?hash=${encodeURIComponent(calc)}&domain=${encodeURIComponent(page.hostname)}&fallback=false&embed=true&supportedFormats=mp4`,
    pageUrl
  ).href;

  try {
    const data = JSON.parse(await fetchText(apiUrl, {Referer: pageUrl}));
    const out = [];
    const pushSource = (entry, fallbackFormat, keyLabel = '') => {
      const raw = typeof entry === 'string' ? entry : (entry?.src || entry?.url || entry?.videoUrl);
      if (typeof raw !== 'string' || !raw.trim()) return;
      const videoUrl = new URL(decodeMediaText(raw), pageUrl).href;
      const format = mediaFormat(videoUrl, fallbackFormat);
      const quality = mediaHeight(entry?.labelShort || entry?.label || entry?.quality || keyLabel) || 0;
      out.push({videoUrl, format, quality});
    };
    for (const [fmtKey, fallbackFormat] of [['hls', 'm3u8'], ['mp4', 'mp4'], ['webm', 'webm']]) {
      const bucket = data?.sources?.[fmtKey];
      if (!bucket) continue;
      if (typeof bucket === 'string' || Array.isArray(bucket)) {
        for (const item of [].concat(bucket)) pushSource(item, fallbackFormat);
      } else if (typeof bucket === 'object') {
        for (const [key, item] of Object.entries(bucket)) pushSource(item, fallbackFormat, key);
      }
    }
    return out;
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    return [];
  }
}

async function resolveSpankbang(html, pageUrl, fetchText) {
  const hasInlineStreamData = /\bstream_data\s*=\s*\{[^}]*(?:https?:|\/\/)/i.test(html) ||
    /\bstream_url_[a-z0-9]+\s*[:=]\s*["'][^"']*(?:https?:|\/\/)/i.test(html);
  if (hasInlineStreamData || typeof fetchText !== 'function') return [];
  const streamKey = html.match(/data-streamkey\s*=\s*["']([^"']+)["']/i)?.[1] ||
    html.match(/["']streamkey["']\s*:\s*["']([^"']+)["']/i)?.[1];
  if (!streamKey) return [];

  try {
    const apiUrl = new URL(`/api/videos/stream?id=${encodeURIComponent(streamKey)}`, pageUrl).href;
    const data = JSON.parse(await fetchText(apiUrl, {Referer: pageUrl}));
    return extractSpankbangStreams(data);
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    return [];
  }
}

async function resolveBeeg(page, pageUrl, fetchText) {
  if (typeof fetchText !== 'function') return [];
  const id = page.pathname.match(/\/-?(\d{6,})(?:\/|$)/)?.[1] ||
    page.pathname.match(/\/video\/(\d{6,})(?:\/|$)/i)?.[1];
  if (!id) return [];

  try {
    const facts = JSON.parse(await fetchText(`https://store.externulls.com/facts/file/${id}`, {Referer: pageUrl}));
    const hlsResources = facts?.file?.hls_resources || facts?.hls_resources || facts?.data?.hls_resources || {};
    const out = [];
    for (const [key, uri] of Object.entries(hlsResources)) {
      if (typeof uri !== 'string' || !uri.trim()) continue;
      const cleanUri = decodeMediaText(uri).trim().replace('{DATA_MARKERS}', 'data=pc');
      const videoUrl = /^https?:\/\//i.test(cleanUri)
        ? cleanUri
        : `https://video.beeg.com/${cleanUri.replace(/^\/+/, '')}`;
      out.push({videoUrl, format: 'm3u8', quality: mediaHeight(key) || 0});
    }
    return out;
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    return [];
  }
}

async function resolveTxxx(html, page, pageUrl, fetchText) {
  if (typeof fetchText !== 'function') return [];
  const id = page.pathname.match(/\/videos?\/(\d+)(?:\/|$)/i)?.[1] ||
    html.match(/\b(?:video_id|videoId)\s*[:=]\s*["']?(\d+)["']?/i)?.[1];
  if (!id) return [];

  try {
    const apiUrl = new URL(`/api/videofile.php?video_id=${encodeURIComponent(id)}&lifetime=8640000`, pageUrl).href;
    const payload = JSON.parse(await fetchText(apiUrl, {Referer: pageUrl}));
    const entries = Array.isArray(payload) ? payload : [payload];
    const out = [];
    for (const entry of entries) {
      if (!entry || typeof entry.video_url !== 'string') continue;
      const decoded = decodeTxxxVideoUrl(entry.video_url);
      if (!decoded || /_preview\.(?:mp4|webm|m3u8)/i.test(decoded)) continue;
      const videoUrl = new URL(decoded, pageUrl).href;
      const urlQ = decoded.match(/(?:^|[/_.-])(\d{3,4}p|4k|2k|uhd|qhd)(?:[/_.-]|$)/i)?.[1];
      const quality = mediaHeight(entry.format || entry.quality || entry.label) || mediaHeight(urlQ) || 0;
      const format = mediaFormat(videoUrl, entry.format || '');
      out.push({videoUrl, format, quality});
    }
    return out;
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    return [];
  }
}

async function resolvePlayerIframes(html, pageUrl, host, fetchText) {
  if (typeof fetchText !== 'function') return [];
  const forceCheck = IFRAME_PLAYER_HOSTS.has(host);
  if (!forceCheck && NO_IFRAME_FALLBACK_HOSTS.has(host)) return [];
  if (!forceCheck && extractMedia(html).definitions.some(def => !def.isMetadata)) return [];

  const iframes = findPlayerIframeUrls(html, pageUrl, host);
  for (const embedUrl of iframes) {
    try {
      const embedHtml = await fetchText(embedUrl.href, {Referer: pageUrl});
      const extracted = extractMedia(embedHtml);
      const headers = {Origin: embedUrl.origin, Referer: embedUrl.href};
      const out = [];
      for (const def of extracted.definitions) {
        if (!def.videoUrl) continue;
        const resolved = new URL(decodeMediaText(def.videoUrl), embedUrl.href).href;
        if (/(?:_preview\.(?:mp4|webm|m3u8)|\/preview(?:s|_|\/|-))/i.test(resolved)) continue;
        out.push({...def, videoUrl: resolved, headers});
      }
      if (out.length) return out;
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
    }
  }
  return [];
}

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
  const normalizedHost = normalizeSiteHost(page.hostname);
  if (normalizedHost === 'eporner.com') return resolveEporner(html, page, pageUrl, fetchText);
  if (normalizedHost === 'spankbang.com') return resolveSpankbang(html, pageUrl, fetchText);
  if (normalizedHost === 'beeg.com') return resolveBeeg(page, pageUrl, fetchText);
  if (normalizedHost === 'txxx.com') return resolveTxxx(html, page, pageUrl, fetchText);
  if (isTopVideoSite(normalizedHost)) return resolvePlayerIframes(html, pageUrl, normalizedHost, fetchText);
  return [];
}
