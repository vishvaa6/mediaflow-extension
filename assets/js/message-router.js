import {errorData} from './network.js';
import {downloadedRecord} from './video-details.js';
import {isXPage} from './x-media.js';
import {isMissavPage} from './missav-media.js';

export const sameExtension = sender => !sender?.id || sender.id === chrome.runtime.id;

export function offscreenOnly(sender) {
  const prefix = chrome.runtime?.getURL?.('src/pages/offscreen/');
  return !sender?.tab && Boolean(prefix && sender?.url?.startsWith(prefix));
}

export const tabOnly = sender => Number.isInteger(sender?.tab?.id);

export function createMessageRouter(routes) {
  const table = routes instanceof Map ? routes : new Map(Object.entries(routes));

  return function routeMessage(message, sender, respond) {
    if (!message || typeof message.type !== 'string') return false;
    if (!sameExtension(sender)) return false;
    const entry = table.get(message.type);
    if (!entry) return false;
    const handler = typeof entry === 'function' ? {handle: entry} : entry;
    if (handler.guard && !handler.guard(sender, message)) return false;
    if (handler.sync) {
      const result = handler.handle(message, sender);
      respond(result ?? {success: true});
      return false;
    }
    let operation;
    try {
      operation = Promise.resolve(handler.handle(message, sender));
    } catch (error) {
      operation = Promise.reject(error);
    }
    if (handler.raw) {
      operation.then(
        result => respond({ok: true, ...(result && typeof result === 'object' ? result : {})}),
        error => respond({ok: false, error: error?.message || String(error)})
      );
      return true;
    }
    operation.then(
      result => respond({success: true, ...(result && typeof result === 'object' ? result : {})}),
      error => respond({success: false, error: error?.message || String(error), detail: errorData(error)})
    );
    return true;
  };
}

export function installMessageRouter(routes) {
  const listener = createMessageRouter(routes);
  chrome.runtime.onMessage.addListener(listener);
  return listener;
}

export function buildQueueRoutes({
  getReady,
  active,
  windowManager,
  discovery,
  headerRules,
  offscreen,
  profileBatch,
  queueStorage,
  historyStorage,
  settingsStorage,
  admit,
  serial,
  pause,
  resume,
  remove,
  patch,
  schedule,
  getSchedulingPromise,
  fetchResource,
  fetchText,
  notify
}) {
  const enqueue = async message => {
    const url = new URL(message.url);
    if (!/^https?:$/.test(url.protocol)) throw Error('Invalid video URL');
    const format = message.format === 'hls' || message.format === 'm3u8' || /\.m3u8(?:[?#]|$)/i.test(url.href)
      ? 'm3u8'
      : message.format === 'webm' ? 'webm' : 'mp4';
    const settings = await settingsStorage.get();
    const taskId = await admit({...message, url: url.href, format, outputFormat: message.outputFormat || settings.outputFormat || 'mp4'});
    if (!taskId) throw Error('Pending queue is full. Wait for a download to start or increase the queue limit in Settings.');
    return {id: taskId};
  };

  const clearByStatus = status => async () => {
    for (const task of (await queueStorage.get()).tasks.filter(t => t.status === status)) {
      await serial(task.id, () => remove(task.id));
    }
  };

  const cancelByKind = kind => async () => {
    for (const task of (await queueStorage.get()).tasks.filter(t => (t.format === 'm3u8' ? 'm3u8' : 'mp4') === kind)) {
      await serial(task.id, () => remove(task.id));
    }
  };

  const resumeTask = message => serial(message.taskId, () => resume(message.taskId)).then(() => getSchedulingPromise() || schedule());
  const removeTask = message => serial(message.taskId, () => remove(message.taskId));
  const runBatch = fn => () => getReady().then(() => profileBatch.controlBatch(fn));

  return {
    'mediaflow-source-tab': message => windowManager.source(message.windowId),
    'mf-run-event': {
      guard: offscreenOnly,
      sync: true,
      handle: message => {
        getReady().then(() => active.get(message.taskId)?.instance?.handle?.(message)).catch(console.error);
        return {success: true};
      }
    },
    'mf-header-add': {
      guard: offscreenOnly,
      handle: message => getReady().then(async () => ({result: await headerRules.addHeaders(message.url, message.headers)}))
    },
    'mf-header-release': {
      guard: offscreenOnly,
      handle: message => getReady().then(async () => { await headerRules.releaseHeaders(message.id); return {}; })
    },
    'mf-run-rpc': {
      guard: offscreenOnly,
      handle: message => getReady().then(async () => {
        const id = message.taskId;
        const entry = active.get(id);
        if (!entry || entry.instance?.runId !== message.runId || entry.deleted) throw Error('This download is no longer active');
        if (message.method === 'source') {
          const source = message.params;
          if (downloadedRecord((await historyStorage.get()).records || [], entry.task.pageUrl, source.url)) {
            serial(id, () => remove(id)).catch(console.error);
            return {result: {skip: true}};
          }
          Object.assign(entry.task, source);
          entry.kind = source.format === 'm3u8' ? 'm3u8' : 'mp4';
          await patch(id, source);
          return {result: {skip: false}};
        }
        if (message.method === 'headers') return {result: await headerRules.addHeaders(message.params.url, message.params.headers)};
        if (message.method === 'release-headers') { await headerRules.releaseHeaders(message.params.id); return {}; }
        throw Error('Unknown worker operation');
      })
    },
    'media-detection-report': {
      sync: true,
      handle: (message, sender) => {
        discovery.report(message, sender);
        if (sender.tab?.id != null) notify({type: 'media-detection-updated', tabId: sender.tab.id});
        return {success: true};
      }
    },
    'media-detection-snapshot': async message => {
      const tab = chrome.tabs?.get ? await chrome.tabs.get(message.tabId) : null;
      const pageUrl = tab?.url || message.pageUrl;
      return {
        videoInfos: discovery.snapshot(message.tabId, pageUrl),
        pageUrl,
        ...(isXPage(pageUrl) ? {site: 'x'} : isMissavPage(pageUrl) ? {site: 'missav'} : {})
      };
    },
    'media-player-sources': {
      guard: sender => tabOnly(sender) && Boolean(chrome.tabs?.sendMessage),
      handle: (_message, sender) => chrome.tabs.sendMessage(sender.tab.id, {command: 'get_video_info'}, {frameId: sender.frameId || 0}).catch(() => ({}))
    },
    'download-queue-enqueue': enqueue,
    'm3u8-download-start': enqueue,
    'mp4-download-start': enqueue,
    'download-queue-pause': message => serial(message.taskId, () => pause(message.taskId)),
    'download-queue-resume': resumeTask,
    'download-queue-retry': resumeTask,
    'download-queue-delete': removeTask,
    'download-queue-cancel': removeTask,
    'download-queue-clear-queued': clearByStatus('queued'),
    'download-queue-clear-errors': clearByStatus('error'),
    'download-queue-snapshot': () => queueStorage.get().then(state => ({state})),
    'download-history-remove': message => historyStorage.removeRecord(message.recordId),
    'download-history-clear': () => historyStorage.clearAll(),
    'm3u8-download-cancel': cancelByKind('m3u8'),
    'mp4-download-cancel': cancelByKind('mp4'),
    'open-download-item': async message => {
      let items = typeof message.downloadId === 'number' ? await chrome.downloads.search({id: message.downloadId}) : [];
      if (!items.length && message.url) items = await chrome.downloads.search({url: message.url});
      if (!items.length && message.fileName) items = await chrome.downloads.search({query: [message.fileName]});
      if (!items.length) throw Error('Download not found');
      await chrome.downloads.show(items[0].id);
    },
    'open-video-page': async message => {
      const url = new URL(message.url);
      if (!/^https?:$/.test(url.protocol)) throw Error('Invalid video page');
      await chrome.tabs.create({url: url.href});
    },
    'open-downloads-folder': {
      sync: true,
      handle: () => { chrome.downloads.showDefaultFolder(); return {success: true}; }
    },
    'ext-fetch-text': {
      raw: true,
      handle: async message => ({text: await fetchText(message.url, message.headers)})
    },
    'ext-fetch-image': {
      raw: true,
      handle: async message => ({dataUrl: await fetchResource(message.url, {Referer: message.pageUrl || message.url}, true)})
    },
    'ext-fetch-video-metadata': async message => {
      await offscreen.ensureOffscreen();
      const result = await chrome.runtime.sendMessage({
        type: 'video-parse-metadata',
        html: await fetchText(message.url, {Referer: message.url}),
        pageUrl: message.url
      });
      if (!result?.ok) throw Error(result?.error || 'Unable to read video thumbnail');
      return result.metadata;
    },
    'profile-scan-start': {
      sync: true,
      handle: message => profileBatch.startProfileScan(message.url)
    },
    'profile-scan-stop': {
      sync: true,
      handle: () => profileBatch.stopProfileScan()
    },
    'profile-results-clear': () => profileBatch.clearProfileResults(),
    'profile-selection-update': message => profileBatch.updateSelection(message),
    'profile-batch-selected': message => runBatch(() => profileBatch.batchSelectedProfile(message))(),
    'profile-batch-start': message => runBatch(() => profileBatch.beginProfileBatch(message))(),
    'profile-batch-cancel': message => runBatch(() => profileBatch.cancelProfileBatch(message))(),
    'profile-batch-pause': message => runBatch(() => profileBatch.batchAction(message, 'pause'))(),
    'profile-batch-resume': message => runBatch(() => profileBatch.batchAction(message, 'resume'))(),
    'profile-batch-retry-failed': message => runBatch(() => profileBatch.batchAction(message, 'retry'))()
  };
}
