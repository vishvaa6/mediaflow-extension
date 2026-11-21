export function is91PornPage(value) {
  try {const url=new URL(value);return /^https?:$/.test(url.protocol) && /^(?:[^.]+\.)*91porn\.com$/i.test(url.hostname);} catch {return false;}
}

export function is91PornWatchPage(value) {
  try {const url=new URL(value);return is91PornPage(value) && /^\/view_video(?:_hd)?\.php$/i.test(url.pathname) && !!url.searchParams.get('viewkey');} catch {return false;}
}

export function find91PornPlayer(doc) {
  for(const selector of ['#player_one_html5_api','.video-js video','video.vjs-tech','video']){
    const video=[...doc.querySelectorAll(selector)].find(node=>node.matches('video') && !node.matches('.preview,[id^="preview-"]') && !node.closest('.videoBox,.pcVideoListItem,.thumb-block,.thumb-list__item,.video-card,.preview,[class*="advert" i]'));
    if(video)return video;
  }
  return null;
}

export function extract91PornPlayerMarkup(html) {
  for(const match of String(html || '').matchAll(/<video\b[^>]*>[\s\S]*?<\/video\s*>/gi)){
    const tag=match[0].slice(0,match[0].indexOf('>')+1);
    if(/(?:^|\s)id\s*=\s*["']player_one_html5_api["']/i.test(tag) || /(?:^|\s)class\s*=\s*["'][^"']*\bvjs-tech\b/i.test(tag))return match[0];
  }
  return '';
}
