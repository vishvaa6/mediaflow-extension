import {xPost} from './x-media.js';
import {missavVideoPage} from './missav-media.js';

export function recognizedVideoPage(value){
  try{
    const url=new URL(value);
    if(!/^https?:$/.test(url.protocol))return false;
    return !!missavVideoPage(value) || !!xPost(value) || /view_video\.php/.test(url.pathname) && url.searchParams.has('viewkey') || /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?(?:video[.\d]|videos?\/|v\/)/i.test(url.pathname) || /^(?:www\.)?redtube\.com$/i.test(url.hostname) && /^\/\d+\/?$/.test(url.pathname);
  }catch{return false;}
}

export function videoKey(value) {
  try {
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol)) return '';
    const post=xPost(value);
    if(post)return `x:${post.id}:video:${post.index}`;
    let host = url.hostname.toLowerCase().replace(/^www\./,'');
    const missav=missavVideoPage(value);
    if(missav)return 'missav:'+new URL(missav).pathname.split('/').pop().toLowerCase();
    if(/^(?:[^.]+\.)?pornhub\.(?:com|org)$|^pornhubpremium\.com$/.test(host))host='pornhub';
    if(/^(?:xvideos\.com|xvv1deos\.com|xnxx\.(?:com|es))$/.test(host))host=host.startsWith('xnxx')?'xnxx':'xvideos';
    if(/^xhamster(?:\d+)?\.(?:com|desi)$/.test(host))host='xhamster';
    const viewkey = url.searchParams.get('viewkey');
    if (viewkey) return `${host}:viewkey:${viewkey}`;
    const xv = url.pathname.match(/^\/(?:video\.([a-z0-9_-]+)|video(\d+))(?:\/|$)/i);
    if (xv) return `${host}:video:${xv[1] || xv[2]}`;
    const path = url.pathname.replace(/\/+$/,'') || '/';
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
