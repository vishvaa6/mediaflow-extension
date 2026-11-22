import {removeHlsCache} from './hls-downloader.js';
import {fetchBytes, restoreError} from './network.js';

export async function removeCache(name) {
  if (!name) return;
  try {
    await (await navigator.storage.getDirectory()).removeEntry(name);
  } catch {}
}

export async function removeTaskCache(task) {
  if (task?.outputCacheFileName && task.outputCacheFileName !== task.opfsCacheFileName) {
    await removeCache(task.outputCacheFileName);
  }
  if (task?.format === 'm3u8') {
    try { await removeHlsCache(task.opfsCacheFileName); } catch {}
  } else {
    await removeCache(task?.opfsCacheFileName);
  }
}

export function createOffscreenManager() {
  let offscreenPromise = null;

  async function ensureOffscreen() {
    if (!offscreenPromise) {
      offscreenPromise = (async () => {
        if (await chrome.offscreen?.hasDocument?.()) return;
        try {
          await chrome.offscreen.createDocument({
            url: 'src/pages/offscreen/index.html',
            reasons: ['BLOBS', 'DOM_PARSER', 'WORKERS'],
            justification: 'Run persistent video transfer/conversion workers, save cached files and parse creator listings'
          });
        } catch (error) {
          if (!/already exists|single offscreen/i.test(error?.message || '')) throw error;
        }
      })().finally(() => { offscreenPromise = null; });
    }
    return offscreenPromise;
  }

  return {ensureOffscreen, removeCache, removeTaskCache};
}

export function createResourceFetcher({useOffscreen, ensureOffscreen, headerRules, notify}) {
  async function fetchResource(url, headers = {}, image = false, signal) {
    const parsed = new URL(url);
    if (!/^https?:$/.test(parsed.protocol)) throw Error('Invalid URL');
    if (useOffscreen) {
      await ensureOffscreen();
      const id = crypto.randomUUID(), abort = () => notify({type: 'mf-fetch-cancel', id});
      signal?.throwIfAborted();
      signal?.addEventListener('abort', abort, {once: true});
      try {
        const result = await chrome.runtime.sendMessage({type: 'mf-fetch-resource', id, url: parsed.href, headers, image});
        signal?.throwIfAborted();
        if (!result?.ok) throw restoreError(result?.error || {message: 'The request failed'});
        return image ? result.dataUrl : result.text;
      } finally { signal?.removeEventListener('abort', abort); }
    }
    return headerRules.withHeaders(parsed.href, headers, async requestHeaders => {
      const response = await fetchBytes(parsed.href, {headers: requestHeaders, signal, maxBytes: image ? 5 * 1024 * 1024 : 16 * 1024 * 1024});
      if (!image) return new TextDecoder().decode(response.data);
      const mime = (response.headers.get('Content-Type') || '').split(';')[0];
      if (!/^image\/(jpeg|png|webp|gif|avif)$/i.test(mime)) throw Error('The thumbnail URL did not return an image');
      if (response.data.length > 5 * 1024 * 1024) throw Error('Thumbnail is too large');
      let binary = '';
      for (let i = 0; i < response.data.length; i += 8192) binary += String.fromCharCode(...response.data.subarray(i, i + 8192));
      return `data:${mime};base64,${btoa(binary)}`;
    });
  }

  const fetchText = (url, headers, signal) => fetchResource(url, headers, false, signal);
  return {fetchResource, fetchText};
}
