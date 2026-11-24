import {xPost,isXPage} from './x-media.js';
import {missavVideoPage,isMissavPage} from './missav-media.js';
import {is91PornWatchPage,is91PornPage} from './porn91-media.js';
import {
  normalizeSiteHost,
  isSupportedPlayerHost,
  isListingOrNonWatchPath,
  isRecognizedSiteWatchPage,
  stripLocalePathPrefix
} from './top-sites-registry.js';

const CANONICAL_KEY_HOST = {
  'pornhub.com': 'pornhub',
  'xvideos.com': 'xvideos',
  'xnxx.com': 'xnxx',
  'xhamster.com': 'xhamster'
};
const KVS_VIDEO_PATH_HOST = new Set([
  'txxx.com', 'anyporn.com', 'anysex.com', 'fpo.xxx', 'ok.xxx', 'ozeex.com',
  'porntrex.com', 'vipwank.com', 'xgroovy.com', 'youramateurporn.com', 'zbporn.com',
  'usersporn.com', 'viviporn.tv', '4tube.com', 'bigporn.com', 'justporn.com',
  'largehdtube.com', 'letsporn.com', 'porndroids.com', 'pornid.xxx', 'porzo.com',
  'qorno.com', 'sexvid.xxx', 'stocking-tease.com', 'porndoe.com'
]);

export function recognizedVideoPage(value){
  try{
    const url=new URL(value);
    if(!/^https?:$/.test(url.protocol))return false;
    if(is91PornWatchPage(value) || !!missavVideoPage(value) || !!xPost(value) || isRecognizedSiteWatchPage(value))return true;
    if(is91PornPage(value) || isMissavPage(value) || isXPage(value) || isSupportedPlayerHost(url.hostname))return false;
    if(isListingOrNonWatchPath(url.pathname))return false;
    return /view_video\.php/.test(url.pathname) && url.searchParams.has('viewkey') || /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?(?:video[.\d]|videos?\/|v\/)/i.test(url.pathname);
  }catch{return false;}
}

export function videoKey(value) {
  try {
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol)) return '';
    const post=xPost(value);
    if(post)return `x:${post.id}:video:${post.index}`;
    const missav=missavVideoPage(value);
    if(missav)return 'missav:'+new URL(missav).pathname.split('/').pop().toLowerCase();
    const normalizedHost = normalizeSiteHost(url.hostname);
    const host = CANONICAL_KEY_HOST[normalizedHost] || normalizedHost;
    const viewkey = url.searchParams.get('viewkey');
    if (viewkey) return `${host}:viewkey:${viewkey}`;
    const pathNoLocale = stripLocalePathPrefix(url.pathname);
    const xv = pathNoLocale.match(/^\/(?:video\.([a-z0-9_-]+)|video(\d+))(?:\/|$)/i) ||
      (host === 'xnxx' ? pathNoLocale.match(/^\/video-([a-z0-9_-]+)(?:\/|$)/i) : null);
    if (xv) return `${host}:video:${xv[1] || xv[2]}`;
    if (host === 'redtube.com') {
      const rt = pathNoLocale.match(/^\/(\d+)\/?$/);
      if (rt) return `${host}/${rt[1]}`;
    }
    if (host === 'youporn.com') {
      const yp = pathNoLocale.match(/^\/watch\/(\d+)(?:\/|$)/i);
      if (yp) return `${host}:video:${yp[1]}`;
    }
    if (host === 'tube8.com' && !isListingOrNonWatchPath(url.pathname)) {
      const t8 = pathNoLocale.match(/^\/(?:[^/]+\/[^/]+|porn-video)\/(\d+)(?:\/|$)/i) ||
        pathNoLocale.match(/^\/watch\/([a-z0-9_-]+)(?:\/|$)/i);
      if (t8) return `${host}:video:${t8[1]}`;
    }
    if (host === 'thumbzilla.com') {
      const tz = pathNoLocale.match(/^\/video\/([a-z0-9_-]+)(?:\/|$)/i);
      if (tz) return `${host}:video:${tz[1]}`;
    }
    if (host === 'spankbang.com') {
      const sb = pathNoLocale.match(/^\/([a-z0-9]+)\/video(?:\/|$)/i) ||
        pathNoLocale.match(/^\/video\/([a-z0-9_-]+)(?:\/|$)/i);
      if (sb) return `${host}:video:${sb[1].toLowerCase()}`;
    }
    if (host === 'eporner.com') {
      const ep = pathNoLocale.match(/^\/(?:video-|hd-porn\/)([a-z0-9_-]+)(?:\/|$)/i);
      if (ep) return `${host}:video:${ep[1]}`;
    }
    if (host === 'beeg.com') {
      const bg = pathNoLocale.match(/^\/(?:-?(\d{6,})|video\/([a-z0-9_-]+))\/?$/i);
      if (bg) return `${host}:video:${bg[1] || bg[2]}`;
    }
    if (host === 'tnaflix.com') {
      const tn = pathNoLocale.match(/\/video(\d+)(?:\/|$)/i);
      if (tn) return `${host}:video:${tn[1]}`;
    }
    if (host === 'youjizz.com') {
      const yj = pathNoLocale.match(/^\/videos\/(?:.*?-)?(\d+)\.html$/i);
      if (yj) return `${host}:video:${yj[1]}`;
    }
    if (KVS_VIDEO_PATH_HOST.has(host) || (isSupportedPlayerHost(normalizedHost) && /^\/videos\/\d+(?:\/|$)/i.test(pathNoLocale))) {
      const kvs = pathNoLocale.match(/^\/videos?\/(\d+)(?:\/|$)/i);
      if (kvs) return `${host}:video:${kvs[1]}`;
    }
    const path = (host === 'xhamster' ? pathNoLocale : url.pathname).replace(/\/+$/,'') || '/';
    const queryKeys = host==='huangguoai.com' ? ['v','id','video_id','ep'] : ['v','id','video_id'];
    const identity = queryKeys.map(key => url.searchParams.has(key) ? `${key}=${url.searchParams.get(key)}` : '').filter(Boolean).join('&');
    return `${host}${path}${identity ? '?'+identity : ''}`;
  } catch { return ''; }
}
export function profileKey(value, name = '') {
  try {
    const url = new URL(value);
    const root = url.pathname.match(/^\/(?:model|models|pornstar|channels?|users?|profiles?|creators?)\/[^/]+/i)?.[0] || url.pathname.replace(/\/videos(?:\/.*)?$/i,'');
    return `${url.hostname.toLowerCase().replace(/^www\./,'')}${root.replace(/\/$/,'')}`;
  } catch { return `creator:${String(name).trim().toLowerCase()}`; }
}
export function downloadedRecord(records, pageUrl, streamUrl) {
  const key = videoKey(pageUrl);
  return records.find(record => (key && record.pageUrl && videoKey(record.pageUrl) === key) || (streamUrl && record.url === streamUrl));
}
// Build once for bulk checks rather than scanning the entire history for every
// profile card. This deliberately preserves page-alias and exact stream matching.
export function createDownloadedLookup(records=[]) {
  const pages=new Set(),streams=new Set();
  for(const record of records){
    if(record.pageUrl){const key=videoKey(record.pageUrl);if(key)pages.add(key);}
    if(record.url)streams.add(record.url);
  }
  return (pageUrl,streamUrl,key=pageUrl?videoKey(pageUrl):'')=>!!(key && pages.has(key) || streamUrl && streams.has(streamUrl));
}
export function qualityNumber(value) {
  const displayed = Array.isArray(value) ? value[0] : value;
  return Number(String(displayed || '').match(/\d+/)?.[0]) || Infinity;
}
export function sortQualities(videos) {
  const rank = video => /^(mp4|webm)$/i.test(video.format || '') ? 0 : 1;
  return [...videos].sort((a,b) => qualityNumber(a.quality)-qualityNumber(b.quality) || rank(a)-rank(b));
}
export function getVideoMetadata(doc, baseUrl) {
  const urls = [];
  const add = value => {
    if (typeof value !== 'string' || !value.trim()) return;
    try { const url = new URL(value,baseUrl); if (/^https?:$/.test(url.protocol)) urls.push(url.href); } catch {}
  };
  for (const node of doc.querySelectorAll('video[poster]')) add(node.getAttribute('poster'));
  for (const selector of ['meta[property="og:image"]','meta[name="twitter:image"]','meta[property="twitter:image"]','link[rel="image_src"]']) {
    for (const node of doc.querySelectorAll(selector)) add(node.getAttribute('content') || node.getAttribute('href'));
  }
  const visit = object => {
    if (!object || typeof object !== 'object') return;
    if (Array.isArray(object)) { object.forEach(visit); return; }
    if (object['@type'] === 'VideoObject' || object.thumbnailUrl) for (const url of [].concat(object.thumbnailUrl || [])) add(url);
    if (object['@graph']) visit(object['@graph']);
  };
  for (const script of doc.querySelectorAll('script[type="application/ld+json"]')) { try { visit(JSON.parse(script.textContent)); } catch {} }
  for (const script of doc.querySelectorAll('script:not([src])')) {
    for (const match of (script.textContent || '').matchAll(/"(?:image_url|thumbnail_url|video_thumbnail|poster)"\s*:\s*"((?:\\.|[^"\\])*)"/g)) {
      try { add(JSON.parse('"'+match[1]+'"')); } catch {}
    }
  }
  const thumbnails = [...new Set(urls)];
  return {pageUrl:baseUrl,pageTitle:doc.querySelector('meta[property="og:title"]')?.getAttribute('content') || doc.title || '',thumbnail:thumbnails[0] || '',thumbnails};
}
