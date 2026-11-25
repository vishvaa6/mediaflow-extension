import {mediaHeaders} from './media-headers.js';
import {isXPage, xPost, xMediaUrl} from './x-media.js';
import {isMissavPage, missavVideoPage, missavMediaUrl} from './missav-media.js';

const VALID_FORMATS = new Set(['mp4', 'webm', 'm3u8']);
const MAX_TABS = 32;
const MAX_FRAMES = 16;
const MAX_STREAMS = 64;

function httpUrl(value) {
  if (typeof value !== 'string' || !value) return '';
  try {
    const parsed = new URL(value);
    return /^https?:$/.test(parsed.protocol) && !parsed.username && !parsed.password ? parsed.href : '';
  } catch {
    return '';
  }
}

function streamQualityScore(video) {
  const match = String(Array.isArray(video.quality) ? video.quality[0] : video.quality || '').match(/\d+/);
  return match ? Number(match[0]) : 0;
}

function isMasterPlaylist(video) {
  if (video.format !== 'm3u8') return false;
  try {
    const {pathname} = new URL(video.videoUrl);
    const hasResolutionHint =
      /(?:^|[/_.-])(?:2160|1440|1080|720|540|480|360|240|144)p?(?:[/_.-]|$)/i.test(pathname) ||
      streamQualityScore(video) > 0;
    if (/(?:^|[/_.-])(?:master|main|manifest)(?:[._-][^/]*)?(?:\.m3u8)?(?:[?#]|$)/i.test(pathname)) return true;
    if (/(?:^|[/_.-])playlist(?:[._-][^/]*)?(?:\.m3u8)?(?:[?#]|$)/i.test(pathname) && !hasResolutionHint) return true;
    return !hasResolutionHint && !/chunklist/i.test(pathname);
  } catch {
    return false;
  }
}

function streamRank(video) {
  if (isMasterPlaylist(video)) return 3;
  if (video.format === 'mp4' || video.format === 'webm') return 2;
  return 1;
}

function headersEqual(a = {}, b = {}) {
  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  return keysA.length === keysB.length && keysA.every(key => a[key] === b[key]);
}

function boundMap(map, limit) {
  while (map.size > limit) map.delete(map.keys().next().value);
}

// Transient per-tab discovery only; no browsing log or cookies are persisted.
export function createMediaDiscovery() {
  const tabs = new Map();
  const subscribers = new Set();

  function notifySubscribers(event) {
    for (const fn of [...subscribers]) {
      try {
        fn(event);
      } catch {}
    }
  }

  function applySiteScope(item, pageUrl) {
    if (!pageUrl) return item;
    if (isXPage(pageUrl)) {
      const sourcePost = xPost(item.pageUrl || pageUrl);
      if (!sourcePost || !xMediaUrl(item.videoUrl)) return null;
      return {
        ...item,
        pageUrl: sourcePost.pageUrl,
        title: String(item.title || '').slice(0, 300),
        site: 'x'
      };
    }
    if (isMissavPage(pageUrl)) {
      const missavSource = missavVideoPage(item.pageUrl || pageUrl);
      if (!missavSource || !missavMediaUrl(item.videoUrl)) return null;
      return {
        ...item,
        pageUrl: missavSource,
        title: String(item.title || '').slice(0, 300),
        site: 'missav'
      };
    }
    return item;
  }

  function ensureTabEntry(tabId, pageUrl = '') {
    let entry = tabs.get(tabId);
    if (!entry) {
      entry = {pageUrl, frames: new Map(), network: new Map()};
      tabs.set(tabId, entry);
      boundMap(tabs, MAX_TABS);
      return entry;
    }
    if (pageUrl && entry.pageUrl && entry.pageUrl !== pageUrl) {
      entry = {pageUrl, frames: new Map(), network: new Map()};
      tabs.set(tabId, entry);
      return entry;
    }
    if (pageUrl && !entry.pageUrl) {
      entry.pageUrl = pageUrl;
      if (isXPage(pageUrl) || isMissavPage(pageUrl)) {
        for (const [fId, frameMap] of entry.network) {
          for (const [videoUrl, item] of frameMap) {
            const scoped = applySiteScope(item, pageUrl);
            if (!scoped) frameMap.delete(videoUrl);
            else frameMap.set(videoUrl, scoped);
          }
          if (!frameMap.size) entry.network.delete(fId);
        }
      }
    }
    return entry;
  }

  return {
    report(message, sender) {
      if (!Number.isInteger(sender.tab?.id)) return;
      const frameUrl = sender.url || message.pageUrl;
      const pageUrl = sender.tab.url || frameUrl;
      if (!frameUrl || !/^https?:/.test(frameUrl)) return;
      const key = sender.tab.id;
      const entry = ensureTabEntry(key, pageUrl);
      const videos = [];
      for (const video of (message.videoInfos || []).slice(0, MAX_STREAMS)) {
        try {
          const url = new URL(video.videoUrl);
          if (!/^https?:$/.test(url.protocol) || url.username || url.password || !VALID_FORMATS.has(video.format)) continue;
          const sourcePost = xPost(video.pageUrl);
          if (isXPage(pageUrl) && (!sourcePost || !xMediaUrl(url.href))) continue;
          const missavSource = missavVideoPage(video.pageUrl);
          if (isMissavPage(pageUrl) && (!missavSource || !missavMediaUrl(url.href))) continue;
          videos.push({
            videoUrl: url.href,
            quality: video.quality,
            format: video.format,
            headers: mediaHeaders(video.headers, frameUrl),
            ...(sourcePost || missavSource ? {
              pageUrl: sourcePost?.pageUrl || missavSource,
              title: String(video.title || '').slice(0, 300),
              thumbnail: video.thumbnail,
              thumbnails: video.thumbnails,
              site: sourcePost ? 'x' : 'missav'
            } : {})
          });
        } catch {}
      }
      entry.frames.set(sender.frameId || 0, videos);
      boundMap(entry.frames, MAX_FRAMES);
      boundMap(tabs, MAX_TABS);
      notifySubscribers({type: 'report', tabId: key, pageUrl});
    },

    reportNetworkStream({tabId, frameId = 0, pageUrl = '', frameUrl = '', stream} = {}) {
      if (!Number.isInteger(tabId) || tabId < 0 || !stream?.videoUrl) return false;
      const normalizedUrl = httpUrl(stream.videoUrl);
      if (!normalizedUrl || !VALID_FORMATS.has(stream.format)) return false;

      if (pageUrl && !httpUrl(pageUrl)) return false;
      const cleanPageUrl = httpUrl(pageUrl);
      const cleanFrameUrl = httpUrl(frameUrl);
      const existingEntry = tabs.get(tabId);
      const effectivePageUrl = cleanPageUrl || (
        existingEntry?.pageUrl && (!cleanPageUrl || existingEntry.pageUrl === cleanPageUrl)
          ? existingEntry.pageUrl
          : ''
      );

      let scoped = {
        videoUrl: normalizedUrl,
        quality: stream.quality || 'Auto',
        format: stream.format,
        headers: mediaHeaders(stream.headers, cleanFrameUrl || effectivePageUrl || stream.headers?.Referer),
        ...(stream.pageUrl ? {pageUrl: stream.pageUrl} : {}),
        ...(stream.title ? {title: String(stream.title).slice(0, 300)} : {}),
        ...(stream.thumbnail ? {thumbnail: stream.thumbnail} : {}),
        ...(stream.thumbnails ? {thumbnails: stream.thumbnails} : {})
      };
      if (effectivePageUrl) {
        scoped = applySiteScope(scoped, effectivePageUrl);
        if (!scoped) return false;
      }

      const entry = ensureTabEntry(tabId, cleanPageUrl);
      const targetFrame = Number.isInteger(frameId) ? frameId : 0;
      let frameMap = entry.network.get(targetFrame);
      if (!frameMap) {
        frameMap = new Map();
        entry.network.set(targetFrame, frameMap);
        boundMap(entry.network, MAX_FRAMES);
      }

      const previous = frameMap.get(scoped.videoUrl);
      if (previous) {
        const mergedQuality = previous.quality && previous.quality !== 'Auto'
          ? previous.quality
          : scoped.quality || 'Auto';
        const mergedHeaders = {...previous.headers, ...scoped.headers};
        const updated = {
          ...previous,
          ...scoped,
          quality: mergedQuality,
          headers: mergedHeaders
        };
        if (updated.quality === previous.quality && headersEqual(updated.headers, previous.headers)) {
          return false;
        }
        frameMap.set(scoped.videoUrl, updated);
        notifySubscribers({type: 'network', tabId, pageUrl: entry.pageUrl, stream: updated});
        return true;
      }

      frameMap.set(scoped.videoUrl, scoped);
      boundMap(frameMap, MAX_STREAMS);
      notifySubscribers({type: 'network', tabId, pageUrl: entry.pageUrl, stream: scoped});
      return true;
    },

    snapshot(tabId, pageUrl) {
      const entry = tabs.get(tabId);
      if (!entry || (pageUrl && entry.pageUrl && entry.pageUrl !== pageUrl)) return [];
      const merged = new Map();
      const mergeItem = (video, fromNetwork) => {
        const item = !entry.pageUrl && pageUrl ? applySiteScope(video, pageUrl) : video;
        if (!item) return;
        const old = merged.get(item.videoUrl);
        if (!old) {
          merged.set(item.videoUrl, item);
          return;
        }
        const oldQuality = old.quality && old.quality !== 'Auto' ? old.quality : '';
        const newQuality = item.quality && item.quality !== 'Auto' ? item.quality : '';
        const base = fromNetwork ? item : old;
        const preferred = fromNetwork ? old : item;
        merged.set(item.videoUrl, {
          ...base,
          ...preferred,
          quality: oldQuality || newQuality || 'Auto',
          headers: {...item.headers, ...old.headers}
        });
      };

      for (const frameVideos of entry.frames.values()) {
        for (const video of frameVideos) mergeItem(video, false);
      }
      for (const frameMap of entry.network.values()) {
        for (const video of frameMap.values()) mergeItem(video, true);
      }

      const items = [...merged.values()];
      items.sort((a, b) => streamRank(b) - streamRank(a) || streamQualityScore(b) - streamQualityScore(a));
      return items.slice(0, MAX_STREAMS);
    },

    subscribe(fn) {
      if (typeof fn !== 'function') return () => {};
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },

    remove(tabId) {
      const existed = tabs.delete(tabId);
      if (existed) notifySubscribers({type: 'remove', tabId});
    }
  };
}
