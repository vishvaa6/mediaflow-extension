import {mediaHeaders} from './media-headers.js';

const MAX_REQUEST_HEADERS = 512;
const MIN_MEDIA_BYTES = 524288; // 512 KiB
const ALL_HTTP_URLS = {urls: ['http://*/*', 'https://*/*']};

const AD_DOMAIN_RE = /(?:^|[.-])(?:exoclick|juicyads|trafficjunky|tsyndicate|doubleclick|googlesyndication|adservice|popads)(?:[.-]|$)/i;
const VAST_PREROLL_RE = /(?:^|[^a-z])(?:vast|preroll|pre[-_]?roll)(?:\d*(?:[^a-z0-9]|$))/i;
const HLS_MIME_RE = /^(?:application\/vnd\.apple\.mpegurl|application\/x-mpegurl|audio\/mpegurl|audio\/x-mpegurl)$/i;
const MP4_MIME_RE = /^video\/(?:mp4|x-mp4)$/i;
const WEBM_MIME_RE = /^video\/webm$/i;
const NON_MEDIA_MIME_RE = /^(?:text\/html|application\/xhtml\+xml|application\/json|application\/(?:x-)?javascript|text\/javascript|text\/css|text\/vtt|image\/|font\/|application\/dash\+xml)/i;
const SEGMENT_EXT_RE = /\.(?:ts|m4s|cmfv|cmfa)$/i;
const NON_MEDIA_EXT_RE = /\.(?:html?|json|mjs|cjs|js|css|vtt|srt|ass|png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf|eot|mpd|mp3|m4a|aac|ogg|wav|xml)$/i;
const SEGMENT_PATH_RE = /\/(?:seg|chunk|frag)-/i;
const PREVIEW_PATH_RE = /\/preview|_preview|-preview|\/thumbs\/|\/thumb_vids\/|sprite|teaser/i;
const M3U8_EXT_RE = /\.m3u8\/?(?:[?#]|$)/i;
const MP4_EXT_RE = /\.mp4\/?(?:[?#]|$)/i;
const WEBM_EXT_RE = /\.webm\/?(?:[?#]|$)/i;
const HLS_PATH_RE = /\/hls\/.*(?:playlist|manifest)/i;
const STANDARD_HEIGHTS = new Set([2160, 1440, 1080, 720, 540, 480, 360, 240, 144]);

function httpUrl(value) {
  if (typeof value !== 'string' || !value) return '';
  try {
    const parsed = new URL(value);
    return /^https?:$/.test(parsed.protocol) && !parsed.username && !parsed.password ? parsed.href : '';
  } catch {
    return '';
  }
}

function parseContentLength(value) {
  if (value == null || value === '') return null;
  const num = Number(value);
  return Number.isFinite(num) && num >= 0 ? num : null;
}

function parseContentRangeTotal(value) {
  if (typeof value !== 'string' || !value) return null;
  const match = value.match(/^bytes\s+\d+-\d+\/(\d+)$/i);
  if (!match) return null;
  const total = Number(match[1]);
  return Number.isFinite(total) && total >= 0 ? total : null;
}

function getHeader(headers, targetName) {
  if (!Array.isArray(headers)) return '';
  for (const header of headers) {
    if (header?.name?.toLowerCase() === targetName && typeof header.value === 'string') {
      return header.value;
    }
  }
  return '';
}

function extractQualityFromUrl(parsed) {
  const pathname = parsed.pathname || '';
  const dim = pathname.match(/(?:^|[/_.-])(\d{3,4})x(\d{3,4})(?:[/_.-]|$)/i);
  if (dim) {
    const height = Math.min(Number(dim[1]), Number(dim[2]));
    if (height >= 144 && height <= 4320) return height;
  }
  const pMatch = pathname.match(/(?:^|[/_.-])(\d{3,4})p(?:[/_.-]|$)/i);
  if (pMatch) {
    const height = Number(pMatch[1]);
    if (height >= 144 && height <= 4320) return height;
  }
  const bare = pathname.match(/(?:^|[/_.-])(2160|1440|1080|720|540|480|360|240|144)(?:[/_.-]|$)/);
  if (bare && STANDARD_HEIGHTS.has(Number(bare[1]))) return Number(bare[1]);
  if (/(?:^|[/_.-])(?:4k|uhd)(?:[/_.-]|$)/i.test(pathname)) return 2160;
  if (/(?:^|[/_.-])(?:2k|qhd)(?:[/_.-]|$)/i.test(pathname)) return 1440;
  return 'Auto';
}

/**
 * Pure classifier for network requests observed via chrome.webRequest.
 * Returns {videoUrl, format, quality} or null when the request is an ad,
 * segment, preview clip, or otherwise not a downloadable stream.
 */
export function classifyNetworkStream({url, contentType = '', contentLength = null, type = ''} = {}) {
  const normalizedUrl = httpUrl(url);
  if (!normalizedUrl) return null;

  const parsed = new URL(normalizedUrl);
  const hostname = parsed.hostname.toLowerCase();
  const pathname = parsed.pathname || '';

  if (AD_DOMAIN_RE.test(hostname) || VAST_PREROLL_RE.test(normalizedUrl)) return null;
  if (SEGMENT_EXT_RE.test(pathname) || NON_MEDIA_EXT_RE.test(pathname)) return null;
  if (PREVIEW_PATH_RE.test(pathname)) return null;

  const ct = String(contentType || '').split(';')[0].trim().toLowerCase();
  const isHlsMime = HLS_MIME_RE.test(ct);
  if (ct && (NON_MEDIA_MIME_RE.test(ct) || (ct.startsWith('audio/') && !isHlsMime))) return null;

  const hasM3u8Ext = M3U8_EXT_RE.test(normalizedUrl);
  const hasMp4Ext = MP4_EXT_RE.test(normalizedUrl);
  const hasWebmExt = WEBM_EXT_RE.test(normalizedUrl);
  const hasHlsPath = HLS_PATH_RE.test(pathname) && !hasMp4Ext && !hasWebmExt && type !== 'main_frame';
  const isHls = isHlsMime || hasM3u8Ext || hasHlsPath;

  const isExtensionlessHls = (isHlsMime || hasHlsPath) && !hasM3u8Ext && !hasMp4Ext && !hasWebmExt;
  if (SEGMENT_PATH_RE.test(pathname) && !isExtensionlessHls) return null;

  const quality = extractQualityFromUrl(parsed);
  if (isHls) return {videoUrl: normalizedUrl, format: 'm3u8', quality};
  if (ct && ct.startsWith('text/')) return null;

  const isMp4Mime = MP4_MIME_RE.test(ct);
  const isWebmMime = WEBM_MIME_RE.test(ct);
  if (!hasMp4Ext && !hasWebmExt && !isMp4Mime && !isWebmMime) return null;

  const length = parseContentLength(contentLength);
  const allowUnknown = hasMp4Ext || hasWebmExt || type === 'media';
  if (length == null ? !allowUnknown : length <= MIN_MEDIA_BYTES) return null;

  const format = isWebmMime || (hasWebmExt && !isMp4Mime) ? 'webm' : 'mp4';
  return {videoUrl: normalizedUrl, format, quality};
}

function setBounded(map, key, value, limit = MAX_REQUEST_HEADERS) {
  if (map.has(key)) map.delete(key);
  map.set(key, value);
  while (map.size > limit) map.delete(map.keys().next().value);
}

function addListenerWithFallback(event, fn, filter, extraCandidates) {
  if (!event?.addListener) return;
  for (const extra of extraCandidates) {
    try {
      if (extra) event.addListener(fn, filter, extra);
      else event.addListener(fn, filter);
      return;
    } catch {
      // Fall back when the runtime does not recognize optional extraInfoSpec flags.
    }
  }
}

/**
 * Installs passive webRequest listeners to capture HLS playlists and direct video streams
 * along with the Referer and Origin headers sent by the player.
 */
export function installNetworkStreamObserver({discovery, notify} = {}) {
  const webRequest = globalThis.chrome?.webRequest;
  if (!webRequest?.onHeadersReceived?.addListener) return null;

  const requestHeaders = new Map();

  const onBeforeSendHeaders = details => {
    if (!details || details.tabId < 0 || !details.requestId) return;
    const headers = {};
    for (const header of details.requestHeaders || []) {
      const name = header?.name?.toLowerCase();
      const value = typeof header?.value === 'string' ? header.value.trim() : '';
      if (!value || /[\r\n]/.test(value)) continue;
      if (name === 'referer') headers.Referer = value;
      else if (name === 'origin') headers.Origin = value;
    }
    if (headers.Referer || headers.Origin) {
      setBounded(requestHeaders, details.requestId, headers);
    }
  };

  const cleanupRequest = details => {
    if (details?.requestId) requestHeaders.delete(details.requestId);
  };

  const onHeadersReceived = details => {
    if (!details || details.tabId < 0) return;
    if (details.statusCode != null && (details.statusCode < 200 || (details.statusCode >= 300 && details.statusCode !== 304))) {
      return;
    }

    const contentType = getHeader(details.responseHeaders, 'content-type');
    const contentRange = getHeader(details.responseHeaders, 'content-range');
    const contentLength = parseContentRangeTotal(contentRange) ?? getHeader(details.responseHeaders, 'content-length');
    const stream = classifyNetworkStream({
      url: details.url,
      contentType,
      contentLength,
      type: details.type
    });
    if (!stream) return;

    const captured = details.requestId ? {...requestHeaders.get(details.requestId)} : {};

    const reportWithTab = tab => {
      if (tab?.url && !/^https?:/.test(tab.url)) return;
      const tabPageUrl = httpUrl(tab?.url) || httpUrl(tab?.pendingUrl) || '';
      const docUrl = httpUrl(details.documentUrl);
      const refUrl = httpUrl(captured.Referer);
      const initUrl = httpUrl(details.initiator);
      const pageUrl = tabPageUrl || httpUrl(details.pageUrl) || (details.frameId === 0 ? (docUrl || refUrl) : '');
      const frameUrl = docUrl || refUrl || initUrl || pageUrl || '';
      const headers = mediaHeaders(captured, frameUrl || pageUrl);
      const accepted = discovery?.reportNetworkStream?.({
        tabId: details.tabId,
        frameId: Number.isInteger(details.frameId) ? details.frameId : 0,
        pageUrl,
        frameUrl,
        stream: Object.keys(headers).length ? {...stream, headers} : stream
      });
      if (accepted !== false) {
        notify?.({type: 'media-detection-updated', tabId: details.tabId});
      }
    };

    const tabsGet = globalThis.chrome?.tabs?.get;
    if (typeof tabsGet === 'function') {
      try {
        const lookup = tabsGet(details.tabId);
        if (lookup && typeof lookup.then === 'function') {
          lookup.then(reportWithTab, () => {});
        } else {
          reportWithTab(lookup);
        }
      } catch {}
    } else {
      reportWithTab(null);
    }
  };

  addListenerWithFallback(webRequest.onBeforeSendHeaders, onBeforeSendHeaders, ALL_HTTP_URLS, [
    ['requestHeaders', 'extraHeaders'],
    ['requestHeaders'],
    null
  ]);
  addListenerWithFallback(webRequest.onHeadersReceived, onHeadersReceived, ALL_HTTP_URLS, [
    ['responseHeaders'],
    null
  ]);
  webRequest.onCompleted?.addListener?.(cleanupRequest, ALL_HTTP_URLS);
  webRequest.onErrorOccurred?.addListener?.(cleanupRequest, ALL_HTTP_URLS);

  return {
    uninstall() {
      webRequest.onBeforeSendHeaders?.removeListener?.(onBeforeSendHeaders);
      webRequest.onHeadersReceived?.removeListener?.(onHeadersReceived);
      webRequest.onCompleted?.removeListener?.(cleanupRequest);
      webRequest.onErrorOccurred?.removeListener?.(cleanupRequest);
      requestHeaders.clear();
    }
  };
}
