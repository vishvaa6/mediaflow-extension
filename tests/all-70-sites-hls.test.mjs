import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TOP_VIDEO_SITES,
  isTopVideoSite,
  isSupportedPlayerHost,
  isRecognizedSiteWatchPage
} from '../assets/js/top-sites-registry.js';
import {recognizedVideoPage, videoKey} from '../assets/js/video-details.js';
import {computeKvsLicenseToken} from '../assets/js/kvs-media.js';
import {collectMediaSources, resolveMedia} from '../assets/js/media-resolver.js';
import {classifyNetworkStream} from '../assets/js/network-stream-observer.js';
import {createMediaDiscovery} from '../assets/js/media-discovery.js';
import {
  collectGenericPlayers,
  installGenericPlayerDetection,
  isThumbnailPreviewVideo
} from '../assets/js/generic-player-detection.js';

const MASTER_M3U8 = [
  '#EXTM3U',
  '#EXT-X-STREAM-INF:BANDWIDTH=1200000,RESOLUTION=1280x720',
  '720/variant.m3u8',
  '#EXT-X-STREAM-INF:BANDWIDTH=2800000,RESOLUTION=1920x1080',
  '1080/variant.m3u8'
].join('\n');

const MEDIA_M3U8 = '#EXTM3U\n#EXTINF:4.0,\nseg-0.ts\n#EXT-X-ENDLIST';

function scrambleKvsHash(realHash, licenseCode) {
  const token = computeKvsLicenseToken(licenseCode);
  const chars = [...realHash.slice(0, 32)];
  const prefixSums = Array(32).fill(0);
  let sum = 0;
  for (let k = 31; k >= 0; k--) {
    sum += Number(token[k]);
    prefixSums[k] = sum;
  }
  for (let k = 0; k < 32; k++) {
    const swap = (k + prefixSums[k]) % 32;
    [chars[k], chars[swap]] = [chars[swap], chars[k]];
  }
  return chars.join('') + realHash.slice(32);
}

function encodeTxxxPayload(value) {
  return btoa(value)
    .replace(/A/g, '\u0410')
    .replace(/B/g, '\u0412')
    .replace(/C/g, '\u0421')
    .replace(/E/g, '\u0415')
    .replace(/M/g, '\u041c')
    .replace(/\+/g, '.')
    .replace(/\//g, ',')
    .replace(/=/g, '~');
}

function buildWatchUrl(domain, numericId = '654321', slug = 'sample-stream') {
  const base = `https://www.${domain}`;
  if (domain.startsWith('pornhub.')) return `${base}/view_video.php?viewkey=ph${numericId}`;
  if (domain.startsWith('xvideos.')) return `${base}/video.xv${numericId}/${slug}`;
  if (domain.startsWith('xnxx.')) return `${base}/video-xn${numericId}/${slug}`;
  if (domain === 'redtube.com') return `${base}/${numericId}`;
  if (domain === 'youporn.com') return `${base}/watch/${numericId}/${slug}/`;
  if (domain === 'tube8.com') return `${base}/general/${slug}/${numericId}/`;
  if (domain === 'thumbzilla.com') return `${base}/video/ph${numericId}/${slug}`;
  if (domain === 'spankbang.com') return `https://${domain}/sb${numericId}/video/${slug}`;
  if (domain === 'eporner.com') return `${base}/video-ep${numericId}/${slug}/`;
  if (domain === 'beeg.com') return `https://${domain}/-1000${numericId}`;
  if (domain.startsWith('hqporner.')) return `https://${domain}/hdporn/${numericId}-${slug}.html`;
  if (domain === 'tnaflix.com') return `${base}/general/${slug}/video${numericId}`;
  if (domain === 'youjizz.com') return `${base}/videos/${slug}-${numericId}.html`;
  if (domain.startsWith('xhamster.')) return `${base}/videos/${slug}-${numericId}`;
  if (domain === 'txxx.com') return `https://${domain}/videos/${numericId}/${slug}/`;
  if (domain.startsWith('pornone.')) return `${base}/general/${slug}/${numericId}/`;
  if (domain.startsWith('anysex.')) return `${base}/videos/${numericId}/${slug}/`;
  if (domain === 'theyarehuge.com') return `${base}/v/${slug}-${numericId}/`;
  if (domain === 'iwank.tv') return `${base}/en/${numericId}/${slug}`;
  if (domain === 'anybunny.org') return `${base}/top/${numericId}-${slug}.html`;
  if (domain.startsWith('perfectgirls.')) return `${base}/gal/${numericId}/${slug}`;
  if (domain.startsWith('xxxbunker.')) return `${base}/videos/${numericId}/${slug}`;
  if (domain.startsWith('porngrey.')) return `${base}/videos/${numericId}/${slug}`;
  return `${base}/videos/${numericId}/${slug}/`;
}

const MINDGEEK_DOMAINS = new Set(['pornhub.com', 'redtube.com', 'youporn.com', 'tube8.com', 'thumbzilla.com']);
const WGCZ_DOMAINS = new Set(['xvideos.com', 'xnxx.com']);
const IFRAME_EMBED_DOMAINS = new Set([
  'hqporner.com', '4tube.com', 'tnaflix.com', 'porndoe.com',
  'fuq.com', 'tubegalore.com', 'tubesafari.com', 'ixxx.com',
  'dinotube.com', 'lobstertube.com', 'tiava.com', 'assoass.com'
]);
const KVS_DOMAINS = new Set([
  'anyporn.com', 'anysex.com', 'fpo.xxx', 'ok.xxx', 'ozeex.com',
  'porntrex.com', 'vipwank.com', 'xgroovy.com', 'youramateurporn.com', 'zbporn.com',
  'usersporn.com', 'viviporn.tv', 'bigporn.com', 'justporn.com',
  'largehdtube.com', 'letsporn.com', 'porndroids.com', 'pornid.xxx',
  'porzo.com', 'qorno.com', 'sexvid.xxx', 'stocking-tease.com'
]);

function buildSiteHlsFixture(domain, index, watchUrl) {
  const cdnBase = `https://cdn-${index}.hls-fixture.test/streams/${index}`;
  const masterUrl = `${cdnBase}/master.m3u8`;
  const replies = new Map([
    [masterUrl, MASTER_M3U8],
    [`${cdnBase}/720/variant.m3u8`, MEDIA_M3U8],
    [`${cdnBase}/1080/variant.m3u8`, MEDIA_M3U8]
  ]);

  if (MINDGEEK_DOMAINS.has(domain)) {
    const apiUrl = new URL('/api/hls_definitions.json', watchUrl).href;
    replies.set(apiUrl, JSON.stringify([{format: 'hls', quality: 'Auto', videoUrl: masterUrl}]));
    const html = domain === 'pornhub.com'
      ? `<script>var flashvars_1 = {"video_title":"Clip ${index}","mediaDefinitions":[{"format":"hls","videoUrl":"/api/hls_definitions.json"}]};</script>`
      : `<script>window.page_params = {"video_player_setup":{"mediaDefinitions":[{"format":"hls","videoUrl":"/api/hls_definitions.json"}]}};</script>`;
    return {
      family: 'mindgeek-hls-json',
      html,
      replies,
      expected1080: `${cdnBase}/1080/variant.m3u8`,
      expected720: `${cdnBase}/720/variant.m3u8`
    };
  }

  if (WGCZ_DOMAINS.has(domain)) {
    return {
      family: 'wgcz-setVideoHLS',
      html: `<script>html5player.setVideoHLS("${masterUrl}");html5player.setVideoUrlLow("https://cdn-${index}.hls-fixture.test/low.mp4");</script>`,
      replies,
      expected1080: `${cdnBase}/1080/variant.m3u8`,
      expected720: `${cdnBase}/720/variant.m3u8`
    };
  }

  if (domain === 'xhamster.com') {
    return {
      family: 'initials-hls',
      html: `<script>window.initials = ${JSON.stringify({xplayerSettings: {sources: {hls: {h264: {url: masterUrl}}}}})};</script>`,
      replies,
      expected1080: `${cdnBase}/1080/variant.m3u8`,
      expected720: `${cdnBase}/720/variant.m3u8`
    };
  }

  if (domain === 'spankbang.com') {
    const apiUrl = new URL('/api/videos/stream?id=sb6543-key', watchUrl).href;
    replies.set(apiUrl, JSON.stringify({m3u8: [masterUrl], '720p': [`${cdnBase}/720.mp4`]}));
    return {
      family: 'spankbang-stream-hls',
      html: `<script>var stream_data = {"m3u8":["${masterUrl}"],"4k":["${cdnBase}/4k.mp4"]};</script>`,
      apiFallbackHtml: '<div id="video" data-streamkey="sb6543-key"></div>',
      replies,
      expected1080: `${cdnBase}/1080/variant.m3u8`,
      expected720: `${cdnBase}/720/variant.m3u8`
    };
  }

  if (domain === 'eporner.com') {
    const hash = '0123456789abcdef1020304050607080';
    let calc = '';
    for (let i = 0; i < 32; i += 8) calc += BigInt('0x' + hash.slice(i, i + 8)).toString(36);
    const pageHost = new URL(watchUrl).hostname;
    const apiUrl = new URL(
      `/xhr/video/ep654321?hash=${encodeURIComponent(calc)}&domain=${encodeURIComponent(pageHost)}&fallback=false&embed=true&supportedFormats=mp4`,
      watchUrl
    ).href;
    replies.set(apiUrl, JSON.stringify({sources: {hls: {auto: {src: masterUrl}}}}));
    return {
      family: 'eporner-xhr-hls',
      html: `<script>var EP={video:{player:{vid:'ep654321',hash:'${hash}'}}};</script>`,
      replies,
      expected1080: `${cdnBase}/1080/variant.m3u8`,
      expected720: `${cdnBase}/720/variant.m3u8`
    };
  }

  if (domain === 'beeg.com') {
    const factsUrl = 'https://store.externulls.com/facts/file/1000654321';
    const hls1080 = 'https://video.beeg.com/data=pc/1080/tpl.m3u8';
    const hls720 = 'https://video.beeg.com/data=pc/720/tpl.m3u8';
    replies.set(factsUrl, JSON.stringify({
      file: {
        hls_resources: {
          fl_cdn_1080: '{DATA_MARKERS}/1080/tpl.m3u8',
          fl_cdn_720: '{DATA_MARKERS}/720/tpl.m3u8'
        }
      }
    }));
    replies.set(hls1080, MEDIA_M3U8);
    replies.set(hls720, MEDIA_M3U8);
    return {
      family: 'beeg-externulls-hls',
      html: '<div id="player"></div>',
      replies,
      expected1080: hls1080,
      expected720: hls720
    };
  }

  if (domain === 'txxx.com') {
    const apiUrl = new URL('/api/videofile.php?video_id=654321&lifetime=8640000', watchUrl).href;
    const encodedMaster = encodeTxxxPayload(masterUrl);
    replies.set(apiUrl, JSON.stringify([{video_url: encodedMaster, format: 'hls'}]));
    return {
      family: 'txxx-decoded-hls',
      html: '<div class="player"></div>',
      replies,
      expected1080: `${cdnBase}/1080/variant.m3u8`,
      expected720: `${cdnBase}/720/variant.m3u8`
    };
  }

  if (domain === 'youjizz.com') {
    return {
      family: 'youjizz-encodings-hls',
      html: `<script>var dataEncodings = [{"name":"hls","filename":"${masterUrl.replace(/^https:/, '')}"}];</script>`,
      replies,
      expected1080: `${cdnBase}/1080/variant.m3u8`,
      expected720: `${cdnBase}/720/variant.m3u8`
    };
  }

  if (IFRAME_EMBED_DOMAINS.has(domain)) {
    const embedHost = domain.startsWith('hqporner.') ? 'https://mydaddy.cc' : `https://player-${index}.embed-host.test`;
    const embedUrl = domain.startsWith('hqporner.')
      ? `${embedHost}/video/abc${index}/`
      : `${embedHost}/embed/${index}`;
    replies.set(
      embedUrl,
      `<script>jwplayer("v").setup({sources:[{file:"${masterUrl}",type:"application/x-mpegURL"}]});</script>`
    );
    return {
      family: 'cross-origin-iframe-hls',
      isIframe: true,
      embedUrl,
      html: `<iframe src="https://ads.exoclick.com/banner" width="300" height="250"></iframe><div id="embed-wrap"><iframe src="${embedUrl}" width="640" height="360" allowfullscreen></iframe></div>`,
      replies,
      expected1080: `${cdnBase}/1080/variant.m3u8`,
      expected720: `${cdnBase}/720/variant.m3u8`,
      expectedHeaders: {Origin: embedHost, Referer: embedUrl}
    };
  }

  if (KVS_DOMAINS.has(domain)) {
    const licenseCode = '$7049281635490128';
    const realHash = '0123456789abcdef0123456789abcdef';
    const scrambled = scrambleKvsHash(realHash, licenseCode);
    const kvsMasterRoot = `https://cdn-${index}.kvs-hls.test/get_file/1/${realHash}/654321`;
    const kvsMasterUrl = `${kvsMasterRoot}/master.m3u8/`;
    const kvsEncoded = `function/0/https://cdn-${index}.kvs-hls.test/get_file/1/${scrambled}/654321/master.m3u8/`;
    const kvsMasterBody = [
      '#EXTM3U',
      '#EXT-X-STREAM-INF:BANDWIDTH=1200000,RESOLUTION=1280x720',
      '../720/variant.m3u8',
      '#EXT-X-STREAM-INF:BANDWIDTH=2800000,RESOLUTION=1920x1080',
      '../1080/variant.m3u8'
    ].join('\n');
    replies.set(kvsMasterUrl, kvsMasterBody);
    replies.set(`${kvsMasterRoot}/720/variant.m3u8`, MEDIA_M3U8);
    replies.set(`${kvsMasterRoot}/1080/variant.m3u8`, MEDIA_M3U8);
    return {
      family: 'kvs-license-hls',
      html: `<div id="kt_player"><video src="blob:kvs"></video></div><script>var flashvars = {video_title:'KVS ${index}',license_code:'${licenseCode}',video_url:'${kvsEncoded}',video_url_text:'Auto'};</script>`,
      replies,
      expected1080: `${kvsMasterRoot}/1080/variant.m3u8`,
      expected720: `${kvsMasterRoot}/720/variant.m3u8`
    };
  }

  const playerVariant = index % 3;
  if (playerVariant === 0) {
    return {
      family: 'fluidplayer-hls',
      html: `<div class="fluid_video_wrapper"><video id="fp"><source src="${masterUrl}" type="application/x-mpegURL" title="Auto"></video></div>`,
      replies,
      expected1080: `${cdnBase}/1080/variant.m3u8`,
      expected720: `${cdnBase}/720/variant.m3u8`
    };
  }
  if (playerVariant === 1) {
    return {
      family: 'jwplayer-hls',
      html: `<div class="jwplayer"></div><script>jwplayer("player").setup({sources:[{file:"${masterUrl}",type:"application/vnd.apple.mpegurl"}]});</script>`,
      replies,
      expected1080: `${cdnBase}/1080/variant.m3u8`,
      expected720: `${cdnBase}/720/variant.m3u8`
    };
  }
  return {
    family: 'videojs-hls',
    html: `<div class="video-js"><video class="vjs-tech"><source src="${masterUrl}" type="application/x-mpegURL"></video></div>`,
    replies,
    expected1080: `${cdnBase}/1080/variant.m3u8`,
    expected720: `${cdnBase}/720/variant.m3u8`
  };
}

// --- Lightweight DOM harness for collectGenericPlayers & installGenericPlayerDetection ---

function createStyleStore(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    display: initial.display || 'block',
    visibility: initial.visibility || 'visible',
    opacity: initial.opacity || '1',
    overflowX: initial.overflowX || 'visible',
    overflowY: initial.overflowY || 'visible',
    pointerEvents: initial.pointerEvents || 'auto',
    position: initial.position || 'static',
    getPropertyValue: prop => values.get(prop) || '',
    setProperty: (prop, val) => { values.set(prop, String(val)); },
    removeProperty: prop => { values.delete(prop); }
  };
}

function matchesSimpleSelector(node, singleSelector) {
  const s = singleSelector.trim();
  if (!s) return false;
  if (s.includes(':is(:hover') || s === ':hover' || s === ':focus-within' || s.includes(':has(')) return false;
  if (s === ':popover-open') return Boolean(node._popoverOpen);
  if (s.includes(' > ')) {
    const [parentSel, childSel] = s.split(' > ').map(part => part.trim());
    return Boolean(node.parentElement && matchesSimpleSelector(node.parentElement, parentSel) && matchesSimpleSelector(node, childSel));
  }
  if (s === 'video:not(.preview):not([id^="preview-"])') {
    return node.tagName === 'VIDEO' && !node._classes.has('preview') && !String(node.id || '').startsWith('preview-');
  }
  if (s === 'a[href]') return node.tagName === 'A' && node.getAttribute('href') != null;
  if (s === 'source[src]') return node.tagName === 'SOURCE' && node.getAttribute('src') != null;
  if (s === 'iframe[src]') return node.tagName === 'IFRAME' && (node.getAttribute('src') != null || Boolean(node.src));
  if (s === '[data-streamkey]') return node.getAttribute('data-streamkey') != null;
  if (s.startsWith('#')) return node.id === s.slice(1);
  if (s.startsWith('.')) {
    const [cls, ...attrParts] = s.slice(1).split('[');
    if (!node._classes.has(cls)) return false;
    return attrParts.every(part => node.hasAttribute(part.replace(/\]$/, '').split('=')[0]));
  }
  const tagAndClass = s.match(/^([a-z0-9]+)\.([a-z0-9_-]+)$/i);
  if (tagAndClass) return node.tagName === tagAndClass[1].toUpperCase() && node._classes.has(tagAndClass[2]);
  const prefixId = s.match(/^\[id\^="([^"]+)"\]$/);
  if (prefixId) return String(node.id || '').startsWith(prefixId[1]);
  const attrContains = s.match(/^\[([a-z-]+)\*="([^"]+)"\s*i?\]$/i);
  if (attrContains) {
    const val = node.getAttribute(attrContains[1]) || (attrContains[1] === 'class' ? [...node._classes].join(' ') : '');
    return val.toLowerCase().includes(attrContains[2].toLowerCase());
  }
  const attrExact = s.match(/^\[([a-z-]+)(?:="([^"]*)")?\]$/i);
  if (attrExact) {
    return attrExact[2] === undefined
      ? node.hasAttribute(attrExact[1])
      : node.getAttribute(attrExact[1]) === attrExact[2];
  }
  return node.tagName === s.toUpperCase();
}

function createMockElement(tag, ownerDocument, {attrs = {}, classes = [], id = '', rect = {left: 0, top: 0, right: 640, bottom: 360, width: 640, height: 360}, style = {}} = {}) {
  const listeners = new Map();
  const node = {
    nodeType: 1,
    tagName: tag.toUpperCase(),
    nodeName: tag.toUpperCase(),
    id,
    ownerDocument,
    parentElement: null,
    _attrs: {...attrs},
    _classes: new Set(classes),
    _children: [],
    style: createStyleStore(style),
    clientTop: 0,
    clientLeft: 0,
    clientWidth: rect.width,
    scrollTop: 0,
    scrollLeft: 0,
    isConnected: true,
    hidden: false,
    disabled: false,
    inert: false,
    _text: '',
    _popoverOpen: false,
    get children() { return node._children; },
    get firstElementChild() { return node._children[0] || null; },
    get previousElementSibling() {
      if (!node.parentElement) return null;
      const idx = node.parentElement._children.indexOf(node);
      return idx > 0 ? node.parentElement._children[idx - 1] : null;
    },
    get src() { return node._attrs.src || ''; },
    set src(v) { node._attrs.src = String(v); },
    get className() { return [...node._classes].join(' '); },
    set className(v) { node._classes = new Set(String(v || '').split(/\s+/).filter(Boolean)); },
    get href() { return node._attrs.href || ''; },
    get outerHTML() {
      const attrStr = Object.entries(node._attrs).map(([k, v]) => `${k}="${v}"`).join(' ');
      const open = `<${tag}${node.id ? ` id="${node.id}"` : ''}${node._classes.size ? ` class="${[...node._classes].join(' ')}"` : ''}${attrStr ? ' ' + attrStr : ''}>`;
      return `${open}${node._children.map(c => c.outerHTML || '').join('')}${node._text}</${tag}>`;
    },
    get innerHTML() { return node._text; },
    set innerHTML(v) { node._text = String(v); },
    get textContent() {
      if (node._children.length) return node._children.map(c => c.textContent).join('');
      return node._text;
    },
    set textContent(v) {
      node._children = [];
      node._text = String(v ?? '');
    },
    classList: {
      add: (...cls) => cls.forEach(c => node._classes.add(c)),
      remove: (...cls) => cls.forEach(c => node._classes.delete(c)),
      contains: cls => node._classes.has(cls),
      toggle: (cls, force) => {
        const next = force === undefined ? !node._classes.has(cls) : Boolean(force);
        if (next) node._classes.add(cls); else node._classes.delete(cls);
        return next;
      }
    },
    getAttribute: name => {
      if (name === 'class') return node._classes.size ? [...node._classes].join(' ') : (node._attrs.class ?? null);
      if (name === 'id') return node.id || node._attrs.id || null;
      return name in node._attrs ? node._attrs[name] : null;
    },
    setAttribute: (name, val) => {
      if (name === 'id') node.id = String(val);
      else if (name === 'class') node._classes = new Set(String(val).split(/\s+/).filter(Boolean));
      else node._attrs[name] = String(val);
    },
    hasAttribute: name => node.getAttribute(name) !== null,
    toggleAttribute: (name, force) => {
      const has = node.hasAttribute(name);
      const next = force === undefined ? !has : Boolean(force);
      if (next) node._attrs[name] = '';
      else delete node._attrs[name];
      return next;
    },
    getBoundingClientRect: () => rect,
    append: (...items) => {
      for (const item of items) {
        if (typeof item === 'string') {
          const textSpan = createMockElement('span', ownerDocument);
          textSpan.textContent = item;
          textSpan.parentElement = node;
          node._children.push(textSpan);
        } else if (item) {
          if (item.parentElement) item.parentElement._children = item.parentElement._children.filter(c => c !== item);
          item.parentElement = node;
          item.isConnected = true;
          node._children.push(item);
        }
      }
    },
    insertBefore: (child, before) => {
      if (child.parentElement) child.parentElement._children = child.parentElement._children.filter(c => c !== child);
      child.parentElement = node;
      child.isConnected = true;
      const idx = before ? node._children.indexOf(before) : -1;
      if (idx === -1) node._children.push(child);
      else node._children.splice(idx, 0, child);
      return child;
    },
    replaceChildren: (...items) => {
      for (const child of node._children) { child.parentElement = null; child.isConnected = false; }
      node._children = [];
      node._text = '';
      node.append(...items);
    },
    insertAdjacentHTML: (_pos, html) => {
      const span = createMockElement('span', ownerDocument);
      span._text = html.replace(/<[^>]*>/g, '');
      node.append(span);
    },
    remove: () => {
      if (node.parentElement) {
        node.parentElement._children = node.parentElement._children.filter(c => c !== node);
        node.parentElement = null;
      }
      node.isConnected = false;
    },
    cloneNode: () => createMockElement(tag, ownerDocument, {attrs: {...node._attrs}, classes: [...node._classes], id: node.id, rect, style}),
    contains: other => {
      for (let cur = other; cur; cur = cur.parentElement) if (cur === node) return true;
      return false;
    },
    matches: selector => selector.split(',').some(part => matchesSimpleSelector(node, part)),
    closest: selector => {
      for (let cur = node; cur; cur = cur.parentElement) if (cur.matches?.(selector)) return cur;
      return null;
    },
    querySelectorAll: selector => {
      const out = [];
      const walk = cur => {
        for (const child of cur._children) {
          if (child.matches(selector)) out.push(child);
          walk(child);
        }
      };
      walk(node);
      return out;
    },
    querySelector: selector => node.querySelectorAll(selector)[0] || null,
    addEventListener: (type, fn) => {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    },
    dispatch: (type, extra = {}) => {
      const event = {
        type,
        target: node,
        isTrusted: true,
        preventDefault() {},
        stopPropagation() {},
        stopImmediatePropagation() {},
        ...extra
      };
      for (const fn of listeners.get(type) || []) fn(event);
    },
    focus() {},
    hidePopover() {
      node._popoverOpen = false;
      node.dispatch('beforetoggle', {newState: 'closed'});
      node.dispatch('toggle', {newState: 'closed'});
    },
    showPopover() {
      node._popoverOpen = true;
      node.dispatch('beforetoggle', {newState: 'open'});
      node.dispatch('toggle', {newState: 'open'});
    }
  };
  return node;
}

function createMockDom(pageUrl) {
  const doc = {
    title: 'Watch Fixture',
    referrer: '',
    activeElement: null,
    documentElement: null,
    scrollingElement: null,
    body: null,
    createElement: tag => createMockElement(tag, doc),
    addEventListener() {},
    querySelector: sel => doc.documentElement.querySelector(sel),
    querySelectorAll: sel => doc.documentElement.querySelectorAll(sel)
  };
  doc.documentElement = createMockElement('html', doc, {rect: {left: 0, top: 0, right: 1280, bottom: 800, width: 1280, height: 800}});
  doc.scrollingElement = doc.documentElement;
  doc.body = createMockElement('body', doc, {rect: {left: 0, top: 0, right: 1280, bottom: 800, width: 1280, height: 800}});
  doc.documentElement.append(doc.body);

  const view = {
    innerWidth: 1280,
    innerHeight: 800,
    location: new URL(pageUrl),
    getComputedStyle: el => el?.style || createStyleStore(),
    addEventListener() {}
  };
  view.top = view;
  doc.defaultView = view;
  return {doc, view};
}

const flushAsync = async (turns = 6) => {
  for (let i = 0; i < turns; i++) await new Promise(resolve => setImmediate(resolve));
};

test('Layer A: all 70 sites in TOP_VIDEO_SITES recognize watch routes, compute stable videoKeys, and exclude listing paths', () => {
  assert.equal(TOP_VIDEO_SITES.length, 70);
  assert.equal(new Set(TOP_VIDEO_SITES).size, 70);

  for (const domain of TOP_VIDEO_SITES) {
    const watchUrl1 = buildWatchUrl(domain, '654321', 'alpha-clip');
    const watchUrl2 = buildWatchUrl(domain, '654322', 'beta-clip');

    assert.equal(isTopVideoSite(domain), true, `isTopVideoSite(${domain})`);
    assert.equal(isSupportedPlayerHost(watchUrl1), true, `isSupportedPlayerHost(${watchUrl1})`);
    assert.equal(isRecognizedSiteWatchPage(watchUrl1), true, `isRecognizedSiteWatchPage(${watchUrl1})`);
    assert.equal(recognizedVideoPage(watchUrl1), true, `recognizedVideoPage(${watchUrl1})`);

    const key1 = videoKey(watchUrl1);
    const key2 = videoKey(watchUrl2);
    assert.ok(key1.length > 0, `non-empty videoKey for ${watchUrl1}`);
    assert.notEqual(key1, key2, `distinct videoKeys on ${domain}`);

    for (const listingPath of ['/', '/categories/featured', '/search?q=sample', '/tags/hd', '/models/creator']) {
      const listingUrl = `https://www.${domain}${listingPath}`;
      assert.equal(recognizedVideoPage(listingUrl), false, `listing URL must be excluded: ${listingUrl}`);
    }
  }
});

test('Layer B: all 70 sites extract and expand .m3u8 HLS streams across their player/API/embed families', async () => {
  assert.equal(TOP_VIDEO_SITES.length, 70);
  const coveredFamilies = new Set();

  for (const [index, domain] of TOP_VIDEO_SITES.entries()) {
    const watchUrl = buildWatchUrl(domain, '654321', 'sample-stream');
    const fixture = buildSiteHlsFixture(domain, index, watchUrl);
    coveredFamilies.add(fixture.family);

    const fetchText = async (url, headers) => {
      if (fixture.isIframe && url === fixture.embedUrl) {
        assert.equal(headers?.Referer, watchUrl, `iframe fetch Referer for ${domain}`);
      }
      const body = fixture.replies.get(url);
      if (!body) throw Error(`Unexpected fetch URL for ${domain}: ${url}`);
      return body;
    };

    const collected = await collectMediaSources(fixture.html, watchUrl, fetchText, 'm3u8');
    assert.ok(collected.definitions.length >= 1, `${domain} (${fixture.family}) must collect at least 1 HLS source`);
    assert.ok(collected.definitions.every(d => d.format === 'm3u8'), `${domain} definitions must be m3u8`);

    const resolved1080 = await resolveMedia(fixture.html, watchUrl, '1080', fetchText, {format: 'm3u8', strictQuality: true});
    assert.equal(resolved1080.format, 'm3u8', `${domain} 1080p format`);
    assert.equal(resolved1080.quality, '1080', `${domain} 1080p quality`);
    assert.equal(resolved1080.url, fixture.expected1080, `${domain} 1080p HLS variant URL`);

    const resolved720 = await resolveMedia(fixture.html, watchUrl, '720', fetchText, {format: 'm3u8', strictQuality: true});
    assert.equal(resolved720.format, 'm3u8', `${domain} 720p format`);
    assert.equal(resolved720.quality, '720', `${domain} 720p quality`);
    assert.equal(resolved720.url, fixture.expected720, `${domain} 720p HLS variant URL`);

    if (fixture.expectedHeaders) {
      assert.deepEqual(resolved1080.headers, fixture.expectedHeaders, `${domain} embed headers`);
    }

    if (fixture.apiFallbackHtml) {
      const apiResolved = await resolveMedia(fixture.apiFallbackHtml, watchUrl, '1080', fetchText, {format: 'm3u8', strictQuality: true});
      assert.equal(apiResolved.url, fixture.expected1080, `${domain} streamkey API HLS fallback`);
    }
  }

  for (const expectedFamily of [
    'mindgeek-hls-json',
    'wgcz-setVideoHLS',
    'initials-hls',
    'spankbang-stream-hls',
    'eporner-xhr-hls',
    'beeg-externulls-hls',
    'txxx-decoded-hls',
    'youjizz-encodings-hls',
    'cross-origin-iframe-hls',
    'kvs-license-hls',
    'fluidplayer-hls',
    'jwplayer-hls',
    'videojs-hls'
  ]) {
    assert.equal(coveredFamilies.has(expectedFamily), true, `missing player family coverage: ${expectedFamily}`);
  }
});

test('Layer C: all 70 sites capture .m3u8 + extensionless HLS via webRequest/discovery and resolve multi-playlist HLS in generic-player-detection', async () => {
  assert.equal(TOP_VIDEO_SITES.length, 70);
  const discovery = createMediaDiscovery();

  const prevGlobals = {
    window: globalThis.window,
    document: globalThis.document,
    location: globalThis.location,
    getComputedStyle: globalThis.getComputedStyle,
    matchMedia: globalThis.matchMedia,
    requestAnimationFrame: globalThis.requestAnimationFrame,
    cancelAnimationFrame: globalThis.cancelAnimationFrame,
    MutationObserver: globalThis.MutationObserver,
    chrome: globalThis.chrome
  };

  try {
    for (const [index, domain] of TOP_VIDEO_SITES.entries()) {
      const tabId = index + 100;
      const watchUrl = buildWatchUrl(domain, '654321', 'network-hls');
      const watchOrigin = new URL(watchUrl).origin;
      const isIframeSite = IFRAME_EMBED_DOMAINS.has(domain);
      const embedOrigin = domain.startsWith('hqporner.') ? 'https://mydaddy.cc' : `https://player-${index}.embed-host.test`;
      const frameUrl = isIframeSite ? `${embedOrigin}/video/frame-${index}` : watchUrl;
      const expectedHeaders = {
        Referer: frameUrl,
        Origin: isIframeSite ? embedOrigin : watchOrigin
      };

      const cdnBase = `https://net-${index}.hls-cdn.test/vod/${index}`;
      const childVariantUrl = `${cdnBase}/720/variant.m3u8`;
      const masterPlaylistUrl = `${cdnBase}/master.m3u8`;
      const extlessManifestUrl = `${cdnBase}/hls/manifest?token=sig_${index}`;

      // 1. Passive webRequest classification (.m3u8 + extensionless application/vnd.apple.mpegurl)
      const classifiedChild = classifyNetworkStream({
        url: childVariantUrl,
        contentType: 'application/vnd.apple.mpegurl',
        type: 'xmlhttprequest'
      });
      const classifiedMaster = classifyNetworkStream({
        url: masterPlaylistUrl,
        contentType: 'application/vnd.apple.mpegurl',
        type: 'xmlhttprequest'
      });
      const classifiedExtless = classifyNetworkStream({
        url: extlessManifestUrl,
        contentType: 'application/vnd.apple.mpegurl; charset=utf-8',
        type: 'xmlhttprequest'
      });

      assert.equal(classifiedChild?.format, 'm3u8', `${domain} child .m3u8 classification`);
      assert.equal(classifiedMaster?.format, 'm3u8', `${domain} master .m3u8 classification`);
      assert.equal(classifiedExtless?.format, 'm3u8', `${domain} extensionless HLS classification`);

      // Report child variant BEFORE master + extensionless stream to verify master prioritization
      assert.equal(discovery.reportNetworkStream({
        tabId,
        frameId: isIframeSite ? 2 : 0,
        pageUrl: watchUrl,
        frameUrl,
        stream: {...classifiedChild, headers: expectedHeaders}
      }), true);
      assert.equal(discovery.reportNetworkStream({
        tabId,
        frameId: isIframeSite ? 2 : 0,
        pageUrl: watchUrl,
        frameUrl,
        stream: {...classifiedMaster, headers: expectedHeaders}
      }), true);
      assert.equal(discovery.reportNetworkStream({
        tabId,
        frameId: isIframeSite ? 2 : 0,
        pageUrl: watchUrl,
        frameUrl,
        stream: {...classifiedExtless, headers: expectedHeaders}
      }), true);

      const tabStreams = discovery.snapshot(tabId, watchUrl);
      assert.equal(tabStreams.length, 3, `${domain} discovery snapshot count`);
      assert.equal(tabStreams[0].videoUrl, masterPlaylistUrl, `${domain} master playlist prioritized first`);
      assert.deepEqual(tabStreams[0].headers, expectedHeaders, `${domain} captured HLS headers`);

      // 2. End-to-end generic-player-detection resolution with playlists.length >= 2 on blob <video> or <iframe>
      const {doc, view} = createMockDom(watchUrl);
      const wrap = createMockElement('div', doc, {id: 'player-container'});
      doc.body.append(wrap);
      if (isIframeSite) {
        wrap.append(createMockElement('iframe', doc, {
          attrs: {src: frameUrl, allowfullscreen: ''},
          rect: {left: 20, top: 20, right: 660, bottom: 380, width: 640, height: 360}
        }));
      } else {
        wrap.append(createMockElement('video', doc, {
          attrs: {src: `blob:${watchOrigin}/mse-${index}`},
          rect: {left: 20, top: 20, right: 660, bottom: 380, width: 640, height: 360}
        }));
      }

      const enqueued = [];
      let rafQueue = [];
      globalThis.window = view;
      globalThis.document = doc;
      globalThis.location = view.location;
      globalThis.getComputedStyle = view.getComputedStyle;
      globalThis.matchMedia = () => ({matches: true});
      globalThis.MutationObserver = class { observe() {} disconnect() {} };
      globalThis.requestAnimationFrame = fn => { rafQueue.push(fn); return rafQueue.length; };
      globalThis.cancelAnimationFrame = () => {};
      globalThis.chrome = {
        storage: {local: {get: async () => ({})}, onChanged: {addListener() {}}},
        runtime: {
          id: 'hls-70-test',
          onMessage: {addListener() {}},
          sendMessage: async message => {
            if (message.type === 'media-detection-snapshot') {
              // Intentionally pass child variant ahead of master (playlists.length === 3)
              return {pageUrl: watchUrl, videoInfos: [tabStreams[2], tabStreams[0], tabStreams[1]]};
            }
            if (message.type === 'ext-fetch-text') {
              if (message.url === masterPlaylistUrl) return {ok: true, text: MASTER_M3U8};
              if (message.url === childVariantUrl || message.url === extlessManifestUrl) return {ok: true, text: MEDIA_M3U8};
              return {ok: false, error: 'Not found'};
            }
            if (message.type === 'download-queue-enqueue') {
              enqueued.push(message);
              return {success: true};
            }
            return {success: true};
          }
        }
      };

      const flushAll = async () => {
        for (let step = 0; step < 8; step++) {
          while (rafQueue.length) {
            const batch = rafQueue;
            rafQueue = [];
            for (const fn of batch) fn();
          }
          await flushAsync(2);
        }
      };

      const handle = installGenericPlayerDetection();
      assert.ok(handle, `installGenericPlayerDetection on ${domain}`);
      await flushAll();

      const pill = doc.querySelector('.mediaflow-download-pill');
      assert.ok(pill, `glass download pill mounted on ${domain}`);

      const menu = pill.querySelector('.mediaflow-quality-menu');
      menu.showPopover();
      await flushAll();

      const optionTexts = pill.querySelectorAll('.mediaflow-quality-option').map(opt => opt.textContent.trim());
      assert.ok(optionTexts.includes('1080p HLS'), `${domain} glass menu includes 1080p HLS (got ${optionTexts.join(', ')})`);
      assert.ok(optionTexts.includes('720p HLS'), `${domain} glass menu includes 720p HLS (got ${optionTexts.join(', ')})`);

      const downloadBtn = pill.querySelector('.mediaflow-download');
      downloadBtn.dispatch('click');
      await flushAll();

      assert.equal(enqueued.length, 1, `${domain} download button enqueued 1 HLS stream`);
      assert.equal(enqueued[0].format, 'm3u8');
      assert.equal(enqueued[0].url, `${cdnBase}/1080/variant.m3u8`);
      assert.equal(enqueued[0].pageUrl, watchUrl);
      assert.deepEqual(enqueued[0].headers, expectedHeaders, `${domain} enqueue preserved stream headers`);

      discovery.remove(tabId);
    }
  } finally {
    for (const [key, val] of Object.entries(prevGlobals)) {
      if (val === undefined) delete globalThis[key];
      else globalThis[key] = val;
    }
  }
});

test('Layer D: all 70 sites produce resolvable watch-page player entries and exclude hover-preview thumbnails', () => {
  assert.equal(TOP_VIDEO_SITES.length, 70);

  for (const [index, domain] of TOP_VIDEO_SITES.entries()) {
    const watchUrl = buildWatchUrl(domain, '654321', 'button-check');
    const isIframeSite = IFRAME_EMBED_DOMAINS.has(domain);

    // 1. Watch page with visible main player + hover-preview thumbnails
    {
      const {doc, view} = createMockDom(watchUrl);

      const thumbCard = createMockElement('div', doc, {classes: ['thumb-block']});
      const cardPreview = createMockElement('video', doc, {attrs: {src: `https://cdn.test/${index}/preview.mp4`}});
      thumbCard.append(cardPreview);
      doc.body.append(thumbCard);

      const linkedPreviewLink = createMockElement('a', doc, {attrs: {href: buildWatchUrl(domain, '999999', 'related')}});
      const linkedPreview = createMockElement('video', doc, {attrs: {src: `https://cdn.test/${index}/related.mp4`}});
      linkedPreviewLink.append(linkedPreview);
      doc.body.append(linkedPreviewLink);

      let mainElement;
      if (isIframeSite) {
        const embedSrc = domain.startsWith('hqporner.') ? 'https://mydaddy.cc/video/abc' : `https://player-${index}.embed.test/embed/${index}`;
        mainElement = createMockElement('iframe', doc, {
          attrs: {src: embedSrc, allowfullscreen: ''},
          rect: {left: 40, top: 40, right: 680, bottom: 400, width: 640, height: 360}
        });
      } else {
        mainElement = createMockElement('video', doc, {
          attrs: {src: `blob:https://www.${domain}/player-${index}`, controls: ''},
          rect: {left: 40, top: 40, right: 680, bottom: 400, width: 640, height: 360}
        });
      }
      doc.body.append(mainElement);

      assert.equal(isThumbnailPreviewVideo(cardPreview, watchUrl), true);
      assert.equal(isThumbnailPreviewVideo(linkedPreview, watchUrl), true);
      if (!isIframeSite) assert.equal(isThumbnailPreviewVideo(mainElement, watchUrl), false);

      const entries = collectGenericPlayers(doc, watchUrl, {view});
      assert.equal(entries.length, 1, `${domain} watch page should yield exactly 1 entry`);
      assert.equal(entries[0].element, mainElement, `${domain} watch entry targets main player`);
      assert.equal(entries[0].canResolve, true, `${domain} watch entry has canResolve=true`);
      assert.equal(entries[0].watchPage, true, `${domain} watch entry has watchPage=true`);
      assert.equal(entries[0].pageButton, false, `${domain} visible player uses in-player pill`);
    }

    // 2. Watch page with offscreen/loading player falls back to pageButton
    {
      const {doc, view} = createMockDom(watchUrl);
      const offscreenPlayer = createMockElement('video', doc, {
        attrs: {src: `blob:https://www.${domain}/offscreen-${index}`},
        rect: {left: 40, top: 1600, right: 680, bottom: 1960, width: 640, height: 360}
      });
      doc.body.append(offscreenPlayer);

      const fallbackEntries = collectGenericPlayers(doc, watchUrl, {view});
      assert.equal(fallbackEntries.length, 1, `${domain} offscreen watch page yields 1 fallback entry`);
      assert.equal(fallbackEntries[0].pageButton, true, `${domain} offscreen watch page uses pageButton`);
      assert.equal(fallbackEntries[0].canResolve, true);
    }

    // 3. Listing page with hover-preview thumbnails yields 0 entries
    {
      const listingUrl = `https://www.${domain}/categories/featured`;
      const {doc, view} = createMockDom(listingUrl);
      const item = createMockElement('div', doc, {classes: ['thumb-list__item']});
      item.append(createMockElement('video', doc, {attrs: {src: `https://cdn.test/${index}/hover-preview.mp4`}}));
      doc.body.append(item);

      const listingEntries = collectGenericPlayers(doc, listingUrl, {view});
      assert.equal(listingEntries.length, 0, `${domain} listing page hover-previews must yield 0 entries`);
    }
  }
});
