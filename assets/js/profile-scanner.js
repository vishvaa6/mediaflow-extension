// Shared by the offscreen document and content scripts. Never execute page scripts.
export function httpUrl(value, base) {
  if (!value || !String(value).trim()) return '';
  try {
    const url = new URL(String(value || '').trim(), base);
    return /^https?:$/.test(url.protocol) ? url.href : '';
  } catch { return ''; }
}

export function creatorRoot(value) {
  const url = new URL(value);
  const match = url.pathname.match(/^\/(?:model|models|pornstar|channels?|users?|profiles?|creators?)\/[^/]+/i);
  return match ? match[0].replace(/\/$/, '') : url.pathname.replace(/\/videos(?:\/.*)?$|\/\d+\/?$/i, '').replace(/\/$/, '');
}

export function cardOwner(link,baseUrl=link.ownerDocument.baseURI) {
  const known=link.closest('li.videoBox, .pcVideoListItem, .thumb-block, .thumb-list__item, [data-video-id], .videoUList > li, .video-card, .video-item, article');
  if(known)return known;
  // Thumbnail, title and duration links must have the same visual owner.
  let parent=link.parentElement,candidate=link;
  for(let depth=0;parent && depth<4;depth++,parent=parent.parentElement){
    if(parent.matches('body,main,section,ul,ol,nav'))break;
    if(parent.querySelector('img,video') && [...parent.querySelectorAll('a[href]')].filter(a=>/view_video\.php|\/videos?[./]/.test(a.getAttribute('href'))).every(a=>{
      try{const one=new URL(a.getAttribute('href'),baseUrl),two=new URL(link.getAttribute('href'),baseUrl);return one.pathname===two.pathname && one.searchParams.get('viewkey')===two.searchParams.get('viewkey');}catch{return false;}
    }))candidate=parent;
    else if(parent.querySelector('img,video'))break;
  }
  return candidate;
}
export function profileVideoElements(doc,baseUrl) {
  const base = new URL(baseUrl), result = [];
  for (const link of doc.querySelectorAll('a[href*="view_video.php"], a[href*="/video"]')) {
    const url = httpUrl(link.getAttribute('href'),baseUrl);
    if (!url) continue;
    const parsed = new URL(url);
    if (parsed.origin !== base.origin || !(/view_video\.php/.test(parsed.pathname) && parsed.searchParams.has('viewkey') || /\/video(?:\.[\w-]+|\d[\w-]*)(?:\/|$)|\/videos?\/(?:[\w-]+\/)*\d[\w-]*(?:\/|$)/i.test(parsed.pathname))) continue;
    const card = cardOwner(link,baseUrl);
    if (!card.closest('.recommended, .recommendations, #recommendedVideos, .related-videos')) result.push({link,card,url,parsed});
  }
  return result;
}

export function parseProfileDocument(doc, baseUrl) {
  const base = new URL(baseUrl);
  const root = creatorRoot(baseUrl);
  const absolute = value => httpUrl(value, baseUrl);
  const clean = text => String(text || '').replace(/\s+/g, ' ').trim();
  const imageUrls = img => {
    if (!img) return [];
    const values = ['data-thumb_url', 'data-thumb-url', 'data-src', 'data-original', 'data-lazy-src', 'data-lazy', 'data-poster', 'src'].map(a => img.getAttribute(a));
    for (const attr of ['data-srcset', 'srcset']) {
      const candidates = (img.getAttribute(attr) || '').split(',').map(s => s.trim().split(/\s+/)[0]).filter(Boolean);
      values.unshift(...candidates.reverse());
    }
    return [...new Set(values.map(absolute).filter(url => url && !/\.(?:mp4|webm)(?:[?#]|$)/i.test(url) && !/(?:blank|spacer|placeholder|transparent)\./i.test(url)))];
  };
  const name = doc.querySelector('h1.profileUserName, .profileUserName, .userContainer .title, .nameSubscribe .username, #profileHeader h1, .profile-title, .channel-title, .profile-header-info h1, h1');
  const avatar = doc.querySelector('.userContainer img, .profile-header img, img.userAvatar, img.channel-avatar, .thumb-block-channel img');
  const videos = new Map();
  for (const {link,card,url,parsed} of profileVideoElements(doc,baseUrl)) {
    const id = parsed.searchParams.get('viewkey') || parsed.pathname.replace(/\/$/, '');
    const img = card.querySelector('img') || link.querySelector('img');
    const titleEl = card.querySelector('.title a, a.title, .videoTitle, [data-title]');
    const titleText=titleEl?.querySelector('h2,h3,span:not(.duration)')?.textContent || titleEl?.textContent;
    const titleCandidates=[titleEl?.getAttribute('title'),titleEl?.getAttribute('data-title'),titleText,...[...card.querySelectorAll('a[title],a[href]')].map(node=>node.getAttribute('title')),img?.getAttribute('alt'),...[...card.querySelectorAll('a[href]')].map(node=>node.textContent),link.getAttribute('title'),link.textContent].map(clean);
    const title=titleCandidates.find(value=>value && !/^(?:\d+:){1,2}\d+(?:\s+\S+)?$/.test(value) && !/^(?:select|selected|downloaded|not downloaded)$/i.test(value)) || '';
    const thumbnails = imageUrls(img);
    const item = {id, url, title: title || `Video ${id}`, thumbnail: thumbnails[0] || '', thumbnails,
      duration: clean(card.querySelector('.duration, [data-role="video-duration"]')?.textContent),
      views: clean(card.querySelector('.views')?.textContent)};
    const old = videos.get(id);
    if (!old || (!old.thumbnail && item.thumbnail) || old.title.startsWith('Video ')) videos.set(id, item);
  }
  const nextPages = new Set();
  let videosPage = '';
  for (const link of doc.querySelectorAll('a[href], link[rel="next"]')) {
    const url = absolute(link.getAttribute('href'));
    if (!url) continue;
    const parsed = new URL(url);
    if (parsed.origin !== base.origin || creatorRoot(url) !== root) continue;
    parsed.hash = '';
    if (/\/videos\/?$/i.test(parsed.pathname) && !parsed.search && !videosPage) videosPage = parsed.href;
    const inPager = link.closest('.pagination, .pager, .paging, .pagination3, [aria-label*="agination"], .page-list, .pageList');
    const next = /\bnext\b/i.test(link.getAttribute('rel') || '') || /^(?:next|next page|›|»|→)$/i.test(clean(link.textContent)) || /next/i.test(link.getAttribute('aria-label') || '');
    const numbered = /^\d+$/.test(clean(link.textContent));
    const pageURL = [...parsed.searchParams.keys()].some(k => /^(?:page|p|from|offset)$/i.test(k)) || /\/(?:videos\/)?\d+\/?$/.test(parsed.pathname);
    if ((inPager && (next || numbered || pageURL)) || next || (numbered && pageURL)) nextPages.add(parsed.href);
  }
  return {profileName:clean(name?.textContent || doc.title?.replace(/ - [^-]+$/, '')), profileAvatar:imageUrls(avatar)[0] || '',
    profileUrl:baseUrl, videos:[...videos.values()], nextPages:[...nextPages], videosPage};
}

export async function crawlProfile(url, {fetchPage, parsePage, onProgress = async () => {}, signal}) {
  const start = new URL(url);
  if (!/^https?:$/.test(start.protocol)) throw new Error('Enter a valid http or https creator URL');
  start.hash = '';
  const root = creatorRoot(start.href);
  if (!root || root === '/') throw new Error('Enter the creator profile URL, including the creator name');
  // A pasted page 4 must still scan from the first videos page.
  if (start.pathname.replace(/\/$/,'') !== root) start.pathname = start.pathname.replace(/\/(?:page\/)?\d+\/?$/, '');
  for (const key of ['page', 'p', 'from', 'offset']) start.searchParams.delete(key);
  const pending = [start.href], visited = new Set(), videos = new Map();
  let profileName = '', profileAvatar = '', pagesScanned = 0;
  while (pending.length) {
    signal?.throwIfAborted();
    const pageUrl = pending.shift();
    if (visited.has(pageUrl)) continue;
    visited.add(pageUrl);
    const parsed = await parsePage(await fetchPage(pageUrl), pageUrl);
    signal?.throwIfAborted();
    profileName ||= parsed.profileName;
    profileAvatar ||= parsed.profileAvatar;
    // Prefer the creator's videos listing to overview/featured/recommended cards.
    if (!pagesScanned && parsed.videosPage && parsed.videosPage !== pageUrl && !visited.has(parsed.videosPage)) {
      pending.unshift(parsed.videosPage);
      continue;
    }
    pagesScanned++;
    for (const video of parsed.videos) {
      const old = videos.get(video.id);
      if (!old) videos.set(video.id, video);
      else videos.set(video.id, {...old, thumbnail:old.thumbnail || video.thumbnail, thumbnails:[...new Set([...(old.thumbnails || []), ...(video.thumbnails || [])])]});
    }
    for (const next of parsed.nextPages || []) {
      const candidate = new URL(next, pageUrl);
      candidate.hash = '';
      // Most pagers link page 1 even when the starting URL omits ?page=1.
      // Treat those aliases as one page so its videos are not fetched twice.
      for (const key of ['page','p']) if (candidate.searchParams.get(key) === '1') candidate.searchParams.delete(key);
      if (candidate.origin === start.origin && creatorRoot(candidate.href) === root && !visited.has(candidate.href) && !pending.includes(candidate.href)) pending.push(candidate.href);
    }
    await onProgress({profileName, profileAvatar, profileUrl:start.href, videos:[...videos.values()], pagesScanned, currentPage:pageUrl, remainingPages:pending.length});
  }
  return {profileName, profileAvatar, profileUrl:start.href, videos:[...videos.values()], pagesScanned};
}
