import {SpeedMeter} from './speed.js';
import {DirectDownloader} from './direct-downloader.js';
import {resolveMedia} from './media-resolver.js';
import {HlsDownloader as PersistentHlsDownloader} from './hls-downloader.js';
import {downloadedRecord} from './video-details.js';
import {mediaHeaders} from './media-headers.js';
import {createMediaDiscovery} from './media-discovery.js';
import {installNetworkStreamObserver} from './network-stream-observer.js';
import {isXPage} from './x-media.js';
import {OffscreenDownload} from './offscreen-client.js';
import {networkError, transientError, retryDelay, restoreError} from './network.js';
import {needsSourceRefresh} from './source-refresh.js';
import {installWindowManager} from './window-manager.js';
import {normalizeQueueLimit, normalizePendingLimit} from './queue-limits.js';
import {MP4_CONVERTER_VERSION} from './mp4-output.js';
import {createHeaderRules} from './header-rules.js';
import {createOffscreenManager, createResourceFetcher} from './offscreen-manager.js';
import {createFileSaver} from './file-saver.js';
import {createProfileBatch} from './profile-batch.js';
import {installMessageRouter, buildQueueRoutes} from './message-router.js';

const isActiveStatus = status => status === 'downloading' || status === 'retrying';
const CLEAR_RETRY = {retryAt: undefined, retryAttempt: undefined, retryMax: undefined, retryError: undefined};
const SOURCE_REFRESH_RE = /open the original video page|open the post on x|open missav|474|expired/i;
const isSourceRefreshError = error => Boolean(error?.needsSourceRefresh || needsSourceRefresh(error) || SOURCE_REFRESH_RE.test(error?.message || ''));
const needsMp4Rebuild = task => task.format === 'm3u8' && task.outputFormat === 'mp4' && task.outputExtension === 'mp4' && task.outputConverterVersion !== MP4_CONVERTER_VERSION;

export function installQueueManager({queueStorage, historyStorage, settingsStorage, HlsDownloader = PersistentHlsDownloader, registerBlob, bindBlob, clearBlob, formatFilename, withSubdir}) {
  const active = new Map(), operations = new Map(), meter = new SpeedMeter();
  const useOffscreen = HlsDownloader === PersistentHlsDownloader && Boolean(chrome.offscreen?.createDocument);
  const windowManager = installWindowManager();
  const headerRules = createHeaderRules();
  const offscreen = createOffscreenManager();
  const discovery = createMediaDiscovery();
  chrome.tabs?.onRemoved?.addListener(tabId => discovery.remove(tabId));

  let retryTimer, schedulingPromise, scheduling = false, reschedule = false, initialized = false;
  let admissionOperation = Promise.resolve(), roomRevision = 0;
  const roomWaiters = new Set();
  const signalQueueChange = () => { roomRevision++; for (const wake of [...roomWaiters]) wake(); };
  const taskById = async id => (await queueStorage.get()).tasks.find(t => t.id === id);
  const patch = (id, value) => queueStorage.updateTask(id, value);
  const notify = message => chrome.runtime.sendMessage(message).catch(() => {});
  installNetworkStreamObserver({discovery, notify});
  const {fetchResource, fetchText} = createResourceFetcher({useOffscreen, ensureOffscreen: offscreen.ensureOffscreen, headerRules, notify});

  const serial = (id, fn) => {
    const next = (operations.get(id) || Promise.resolve()).then(fn);
    const settled = next.catch(() => {});
    operations.set(id, settled);
    return next.finally(() => { if (operations.get(id) === settled) operations.delete(id); });
  };

  function waitForQueueRoom(signal, revision) {
    return new Promise((resolve, reject) => {
      signal.throwIfAborted();
      const done = () => { roomWaiters.delete(done); signal.removeEventListener('abort', abort); resolve(); };
      const abort = () => { roomWaiters.delete(done); signal.removeEventListener('abort', abort); reject(signal.reason); };
      roomWaiters.add(done);
      signal.addEventListener('abort', abort, {once: true});
      if (roomRevision !== revision) done();
    });
  }

  // Serialize the check and insertion so simultaneous requests cannot overfill the queue.
  function admit(value, signal) {
    const next = admissionOperation.then(async () => {
      signal?.throwIfAborted();
      if (value.batchId && profileBatch.pausedBatches.has(value.batchId)) return null;
      const limit = normalizePendingLimit((await settingsStorage.get()).maxPendingTasks);
      if (limit && (await queueStorage.get()).tasks.filter(task => task.status === 'queued').length >= limit) return null;
      signal?.throwIfAborted();
      if (value.batchId && profileBatch.pausedBatches.has(value.batchId)) return null;
      const id = await queueStorage.enqueue(value);
      schedule();
      return id;
    });
    admissionOperation = next.catch(() => {});
    return next;
  }

  const recordCompletion = (task, entry) => historyStorage.addRecord(
    entry?.savedFileName || task.savedFileName || task.fileName || 'video',
    task.url,
    task.pageUrl,
    {
      taskId: task.id, batchId: task.batchId, title: task.title || task.fileName, creator: task.creator, quality: task.quality,
      format: entry?.task?.outputExtension || task.outputExtension || task.format, thumbnail: task.thumbnail, thumbnails: task.thumbnails,
      bytes: entry?.task?.outputBytes || task.outputBytes || entry?.instance?.getBytesReceived?.() || task.fetchedBytes || task.cachedBytes,
      downloadId: entry?.saveId ?? task.chromeDownloadId
    }
  );

  const fileSaver = createFileSaver({
    ensureOffscreen: offscreen.ensureOffscreen, registerBlob, bindBlob, clearBlob, formatFilename, withSubdir, notify,
    queueStorage, settingsStorage, active, useOffscreen, needsMp4Rebuild, patch, progress, completed, failed,
    recordCompletion, removeTaskCache: offscreen.removeTaskCache, schedule
  });

  const callbacks = (task, entry) => ({
    onProgress: data => progress(task, entry, data),
    onComplete: () => completed(task, entry).catch(console.error),
    onError: error => failed(task, entry, error).catch(console.error)
  });

  const remoteInstance = (task, entry) => new OffscreenDownload({
    task: {...task, downloadSubdir: entry.subdir},
    ensureOffscreen: offscreen.ensureOffscreen,
    saveFile: options => fileSaver.saveFile({...options, entry}),
    ...callbacks(task, entry),
    onFailure: error => failed(entry.task, entry, error).catch(console.error),
    onSourceRefreshed: async source => { Object.assign(entry.task, source); entry.kind = source.format === 'm3u8' ? 'm3u8' : 'mp4'; await patch(task.id, source); }
  });

  async function completed(task, entry) {
    if (active.get(task.id) !== entry || entry.deleted || entry.finished) return;
    entry.finished = true; Object.assign(entry.task, CLEAR_RETRY);
    active.delete(task.id); clearTimeout(entry.progressTimer); meter.clear(task.id);
    await recordCompletion(task, entry);
    await queueStorage.removeTask(task.id);
    await entry.instance?.destroy?.(true);
    if (useOffscreen && !(entry.instance instanceof OffscreenDownload)) await notify({type: 'mf-offscreen-command', command: 'drop', taskId: task.id});
    await offscreen.removeTaskCache(task);
    notify({type: 'download-task-complete', taskId: task.id, fileName: task.fileName});
    schedule();
  }

  async function failed(task, entry, error) {
    if (active.get(task.id) !== entry || entry.deleted || entry.finished || entry.paused) return;
    entry.finished = true; Object.assign(entry.task, CLEAR_RETRY);
    active.delete(task.id); clearTimeout(entry.progressTimer); meter.clear(task.id);
    error = networkError(error);
    const current = await taskById(task.id), retryCount = Math.max(0, Math.min(1000000, Number(current?.retryCount) || 0));
    const retry = transientError(error);
    await patch(task.id, {
      outputReady: entry.task.outputReady, outputCacheFileName: entry.task.outputCacheFileName, outputExtension: entry.task.outputExtension,
      outputBytes: entry.task.outputBytes, outputConverterVersion: entry.task.outputConverterVersion, fallbackReason: entry.task.fallbackReason,
      status: retry ? 'queued' : 'error', phase: retry ? 'waiting' : 'error',
      error: error.message, errorCode: error.code || error.name, errorStatus: error.status,
      retryCount: retry ? Math.min(1000000, retryCount + 1) : retryCount,
      nextRetryAt: retry ? Date.now() + retryDelay(retryCount + 1, error.retryAfter) : undefined,
      needsSourceRefresh: !retry && isSourceRefreshError(error) ? true : undefined,
      downloadSpeed: 0, speedFormatted: '', isFileDownloading: false, chromeDownloadId: undefined,
      cachedBytes: entry.instance?.getBytesReceived?.() || task.cachedBytes, ...CLEAR_RETRY
    });
    await entry.instance?.destroy?.(false);
    if (useOffscreen && !(entry.instance instanceof OffscreenDownload)) await notify({type: 'mf-offscreen-command', command: 'drop', taskId: task.id});
    if (!retry) notify({type: 'download-task-error', taskId: task.id, error: error.message});
    schedule();
  }

  function progress(task, entry, data) {
    if (active.get(task.id) !== entry || entry.deleted || entry.finished) return;
    const bytes = data.bytesReceived == null ? Number(entry.task.cachedBytes || task.cachedBytes) || 0 : Number(data.bytesReceived) || 0;
    if (!entry.progressSeeded) { meter.clear(task.id); meter.update(task.id, bytes); entry.progressSeeded = true; }
    if (data.isFileDownloading) entry.phase = 'saving';
    else if (data.phase) entry.phase = data.phase;
    if (typeof data.chromeDownloadId === 'number') {
      entry.saveId = data.chromeDownloadId;
      if (entry.paused) chrome.downloads.pause(entry.saveId).catch(error => failed(task, entry, error.message));
    }
    const value = {
      progress: data.progress == null ? (Number(entry.task.progress ?? task.progress) || 0) : Math.max(0, Number(data.progress) || 0),
      finishNum: data.finishNum == null ? (entry.task.finishNum || 0) : (data.finishNum || 0),
      targetSegment: data.targetSegment == null ? (entry.task.targetSegment || (entry.kind === 'm3u8' ? 0 : 1)) : data.targetSegment,
      errorNum: data.errorNum == null ? (entry.task.errorNum || 0) : (data.errorNum || 0),
      fetchedBytes: bytes, cachedBytes: bytes, isFileDownloading: Boolean(data.isFileDownloading),
      ...meter.update(task.id, bytes, entry.paused || data.isFileDownloading || Boolean(data.retrying))
    };
    if (typeof data.chromeDownloadId === 'number') value.chromeDownloadId = data.chromeDownloadId;
    if (data.totalBytes > 0) value.totalBytes = data.totalBytes;
    if (data.outputExtension) value.outputExtension = data.outputExtension;
    if (data.outputBytes > 0) value.outputBytes = data.outputBytes;
    if (data.outputConverterVersion) value.outputConverterVersion = data.outputConverterVersion;
    if (data.phase) value.phase = data.phase;
    if (data.fallbackReason) value.fallbackReason = data.fallbackReason;
    if (data.outputCacheFileName) { value.outputCacheFileName = data.outputCacheFileName; value.outputReady = Boolean(data.isFileDownloading) || data.phase === 'saving'; }
    if (data.savedFileName) { entry.savedFileName = data.savedFileName; value.savedFileName = data.savedFileName; }

    let retryChanged = false;
    if (!entry.paused) {
      if (data.retrying) {
        Object.assign(value, {status: 'retrying', retryAt: data.retryAt, retryAttempt: data.retryAttempt, retryMax: data.retryMax, retryError: data.retryError || ''});
        retryChanged = entry.task.status !== 'retrying' || entry.task.retryAt !== value.retryAt || entry.task.retryAttempt !== value.retryAttempt || entry.task.retryMax !== value.retryMax || entry.task.retryError !== value.retryError;
      } else if (entry.task.status === 'retrying' || task.status === 'retrying') {
        Object.assign(value, {status: 'downloading'}, CLEAR_RETRY);
        if (!data.phase && entry.phase === 'retrying') { entry.phase = 'downloading'; value.phase = 'downloading'; }
        retryChanged = true;
      }
    }

    const critical = typeof data.chromeDownloadId === 'number' || Boolean(data.outputCacheFileName && value.outputReady) || Boolean(data.phase && data.phase !== entry.task.phase) || retryChanged;
    Object.assign(entry.task, value);
    if (critical) {
      const merged = entry.latestProgress ? {...entry.latestProgress, ...value} : value;
      entry.latestProgress = null; clearTimeout(entry.progressTimer); entry.progressTimer = null;
      return patch(task.id, merged);
    }
    entry.latestProgress = {...entry.latestProgress, ...value};
    if (!entry.progressTimer) entry.progressTimer = setTimeout(() => {
      entry.progressTimer = null;
      if (active.get(task.id) !== entry || entry.finished) return;
      const latest = entry.latestProgress; entry.latestProgress = null;
      patch(task.id, latest).catch(console.error);
    }, 200);
  }

  async function start(task) {
    if (active.has(task.id)) return;
    const fresh = await taskById(task.id);
    if (fresh?.status !== 'queued' || profileBatch.cancelledBatches.has(fresh.batchId)) return;
    if (fresh.batchId && downloadedRecord((await historyStorage.get()).records || [], fresh.pageUrl, fresh.url)) {
      await queueStorage.removeTask(fresh.id); await offscreen.removeTaskCache(fresh); return;
    }
    const kind = fresh.format === 'm3u8' || /\.m3u8(?:[?#]|$)/i.test(fresh.url) ? 'm3u8' : 'mp4';
    const entry = {kind, phase: 'starting', paused: false, task: fresh, controller: new AbortController()};
    active.set(task.id, entry);
    try {
      const settings = await settingsStorage.get();
      if (entry.deleted || profileBatch.cancelledBatches.has(fresh.batchId)) return;
      entry.subdir = settings.downloadSubdir || '';
      const cb = callbacks(fresh, entry), saveForTask = options => fileSaver.saveFile({...options, entry});
      if (fresh.outputReady && fresh.outputCacheFileName && !needsMp4Rebuild(fresh)) { await fileSaver.exportCachedSave(fresh, entry); return; }
      if (needsMp4Rebuild(fresh)) { fresh.outputReady = false; await patch(task.id, {outputReady: false}); }
      if (useOffscreen) {
        entry.instance = remoteInstance(fresh, entry);
        Object.assign(entry.task, {status: 'downloading', ...CLEAR_RETRY});
        await patch(task.id, {status: 'downloading', phase: fresh.url ? 'downloading' : 'resolving', startedAt: fresh.startedAt || Date.now(), nextRetryAt: undefined, error: undefined, needsSourceRefresh: undefined, downloadSpeed: 0, isFileDownloading: false, ...CLEAR_RETRY});
        if (entry.deleted || entry.paused) return;
        await entry.instance.start(); return;
      }
      if (!fresh.url) {
        const fetchForTask = (url, headers) => fetchText(url, headers, entry.controller.signal);
        const media = await resolveMedia(await fetchForTask(fresh.pageUrl, {Referer: fresh.pageUrl}), fresh.pageUrl, fresh.quality, fetchForTask, {preferMp4: fresh.outputFormat === 'mp4'});
        entry.controller.signal.throwIfAborted();
        if (downloadedRecord((await historyStorage.get()).records || [], fresh.pageUrl, media.url)) { active.delete(task.id); await queueStorage.removeTask(task.id); schedule(); return; }
        Object.assign(fresh, media); entry.kind = media.format === 'm3u8' ? 'm3u8' : 'mp4'; await patch(fresh.id, media);
      }
      const resolveSource = fresh.pageUrl ? async signal => {
        const fetchFresh = (url, headers) => fetchText(url, headers, signal);
        const html = isXPage(fresh.pageUrl) ? '' : await fetchFresh(fresh.pageUrl, {Referer: fresh.pageUrl});
        const media = await resolveMedia(html, fresh.pageUrl, fresh.quality, fetchFresh, {format: kind === 'm3u8' ? 'm3u8' : fresh.format || 'mp4', strictQuality: true});
        return {...media, headers: mediaHeaders(media.headers || fresh.headers, fresh.pageUrl)};
      } : undefined;
      entry.instance = entry.kind === 'm3u8'
        ? new HlsDownloader({maxConcurrent: 4, retryInterval: 1000, timeout: 60000, saveFile: saveForTask, resolveSource, ...cb})
        : new DirectDownloader({saveFile: saveForTask, resolveSource, onSourceRefreshed: async source => { if (entry.deleted) return; const update = {url: source.url, headers: source.headers}; Object.assign(entry.task, update); await patch(task.id, update); }});
      Object.assign(entry.task, {status: 'downloading', ...CLEAR_RETRY});
      await patch(task.id, {status: 'downloading', startedAt: Date.now(), error: undefined, needsSourceRefresh: undefined, downloadSpeed: 0, speedFormatted: '0 B/s', isFileDownloading: false, chromeDownloadId: undefined, ...CLEAR_RETRY});
      if (entry.deleted || profileBatch.cancelledBatches.has(fresh.batchId)) return;
      entry.phase = 'fetching'; meter.update(task.id, kind === 'mp4' ? fresh.cachedBytes || 0 : 0);
      const running = entry.kind === 'm3u8'
        ? entry.instance.start(fresh.url, {outputFormat: fresh.outputFormat || 'source', fileName: fresh.fileName || 'video', headers: fresh.headers, quality: fresh.quality, opfsFileName: fresh.opfsCacheFileName, downloadSubdir: entry.subdir})
        : entry.instance.start({...fresh, ...cb, resumeFromByte: fresh.cachedBytes || 0, opfsFileName: fresh.opfsCacheFileName, downloadSubdir: entry.subdir});
      Promise.resolve(running).catch(error => failed(fresh, entry, error.message));
    } catch (error) { await failed(fresh, entry, error); }
  }

  function schedule() {
    signalQueueChange(); reschedule = true;
    if (!initialized) return Promise.resolve();
    if (schedulingPromise) return schedulingPromise;
    schedulingPromise = drainQueue().finally(() => { schedulingPromise = null; if (reschedule) schedule(); });
    return schedulingPromise;
  }

  async function drainQueue() {
    reschedule = true;
    if (scheduling || !initialized) return;
    scheduling = true;
    try {
      while (reschedule) {
        reschedule = false;
        const limit = normalizeQueueLimit((await settingsStorage.get()).maxConcurrentTasks);
        const snapshot = (await queueStorage.get()).tasks;
        const running = snapshot.filter(t => isActiveStatus(t.status) || (active.has(t.id) && !active.get(t.id).paused && !active.get(t.id).finished)).sort((a, b) => a.createdAt - b.createdAt);
        for (const {id} of running.slice(limit).reverse()) {
          await serial(id, async () => { const task = await taskById(id); if (isActiveStatus(task?.status)) await pause(id, true); });
        }
        const tasks = (await queueStorage.get()).tasks;
        for (const task of tasks.filter(t => t.status === 'queued').sort((a, b) => a.createdAt - b.createdAt)) {
          if (profileBatch.cancelledBatches.has(task.batchId) || profileBatch.pausedBatches.has(task.batchId) || task.nextRetryAt > Date.now()) continue;
          const recovered = tasks.filter(t => isActiveStatus(t.status) && !active.has(t.id)).length;
          if (recovered + [...active.values()].filter(e => !e.paused && !e.finished).length >= limit) break;
          await serial(task.id, () => active.get(task.id)?.paused || typeof task.chromeDownloadId === 'number' ? resumeNow(task.id) : start(task));
        }
      }
    } catch (error) { console.error('[queue] schedule', error); }
    finally {
      scheduling = false; clearTimeout(retryTimer);
      const waiting = (await queueStorage.get()).tasks.filter(task => task.status === 'queued' && task.nextRetryAt > Date.now());
      if (waiting.length) {
        const when = Math.min(...waiting.map(task => task.nextRetryAt));
        retryTimer = setTimeout(() => schedule(), Math.max(1, when - Date.now())); retryTimer.unref?.();
        chrome.alarms?.create('mediaflow-queue-retry', {when});
      } else chrome.alarms?.clear('mediaflow-queue-retry');
    }
  }

  async function pause(id, queueLimited = false) {
    const task = await taskById(id);
    if (!task) throw Error('Task not found');
    if (task.status === 'paused') return;
    if (!['queued', 'downloading', 'retrying', 'error'].includes(task.status)) throw Error('Task cannot be paused');
    await patch(id, {queueLimited});
    const entry = active.get(id);
    if (entry) {
      entry.paused = true;
      if (entry.progressTimer) { clearTimeout(entry.progressTimer); entry.progressTimer = null; }
      if (entry.phase === 'saving') {
        const saveId = entry.saveId ?? task.chromeDownloadId;
        if (typeof saveId === 'number') { try { await chrome.downloads.pause(saveId); } catch (error) { entry.paused = false; throw error; } }
      } else { entry.controller?.abort(); await entry.instance?.pauseSoft(); }
      entry.latestProgress = null;
      Object.assign(entry.task, {status: queueLimited ? 'queued' : 'paused', ...CLEAR_RETRY});
    } else if (typeof task.chromeDownloadId === 'number') await chrome.downloads.pause(task.chromeDownloadId);
    if (await taskById(id)) {
      await patch(id, {status: queueLimited ? 'queued' : 'paused', ...(queueLimited ? {phase: 'waiting'} : {}), cachedBytes: entry?.instance?.getBytesReceived?.() ?? task.cachedBytes, downloadSpeed: 0, speedFormatted: '', ...CLEAR_RETRY});
    }
    meter.clear(id); schedule();
  }

  async function resume(id) {
    const task = await taskById(id);
    if (!task) throw Error('Task not found');
    if (task.batchId && profileBatch.pausedBatches.has(task.batchId)) throw Error('Resume the batch before resuming this download.');
    if (isActiveStatus(task.status)) return;
    await patch(id, {status: 'queued', error: undefined, needsSourceRefresh: undefined, retryCount: 0, nextRetryAt: undefined, ...CLEAR_RETRY});
    schedule();
  }

  async function resumeNow(id) {
    const task = await taskById(id);
    if (!task) throw Error('Task not found');
    let entry = active.get(id);
    if (task.status !== 'queued') return;
    const limit = normalizeQueueLimit((await settingsStorage.get()).maxConcurrentTasks);
    const occupied = [...active.values()].filter(e => !e.paused && !e.finished).length + (await queueStorage.get()).tasks.filter(t => isActiveStatus(t.status) && !active.has(t.id)).length;
    if (occupied >= limit) { await patch(id, {status: 'queued', error: undefined}); schedule(); return; }
    if (entry?.phase === 'saving' || typeof task.chromeDownloadId === 'number') {
      if (!entry) { entry = {kind: task.format === 'm3u8' ? 'm3u8' : 'mp4', phase: 'saving', task, paused: true, recoveredSave: true, instance: {getBytesReceived: () => task.cachedBytes || 0}}; active.set(id, entry); }
      const saveId = entry.saveId ?? task.chromeDownloadId;
      entry.paused = false;
      try { if (typeof saveId === 'number') await chrome.downloads.resume(saveId); }
      catch (error) { if (!task.opfsCacheFileName) { entry.paused = true; throw error; } await fileSaver.exportCachedSave(task, entry); return; }
      Object.assign(entry.task, {status: 'downloading', ...CLEAR_RETRY});
      await patch(id, {status: 'downloading', error: undefined, needsSourceRefresh: undefined, ...CLEAR_RETRY});
      return;
    }
    if (entry && !entry.instance) { active.delete(id); await start(task); return; }
    if (entry) {
      entry.paused = false; entry.finished = false; entry.progressSeeded = false; meter.clear(id);
      Object.assign(entry.task, {status: 'downloading', ...CLEAR_RETRY});
      await patch(id, {status: 'downloading', error: undefined, needsSourceRefresh: undefined, downloadSpeed: 0, speedFormatted: '0 B/s', ...CLEAR_RETRY});
      if (entry.instance instanceof OffscreenDownload || (entry.kind === 'm3u8' && (entry.instance.persistent || entry.instance.tsUrlList?.length))) Promise.resolve(entry.instance.resume()).catch(error => failed(task, entry, error));
      else if (entry.kind === 'mp4') entry.instance.start({...task, ...callbacks(task, entry), resumeFromByte: entry.instance.getBytesReceived(), opfsFileName: task.opfsCacheFileName, downloadSubdir: entry.subdir}).catch(error => failed(task, entry, error.message));
      else { active.delete(id); await entry.instance.destroy(false); await patch(id, {status: 'queued', ...CLEAR_RETRY}); schedule(); }
    } else {
      await patch(id, {status: 'queued', error: undefined, needsSourceRefresh: undefined, isFileDownloading: false, chromeDownloadId: undefined, downloadSpeed: 0, speedFormatted: '', ...CLEAR_RETRY});
      schedule();
    }
  }

  async function remove(id) {
    const task = await taskById(id), entry = active.get(id);
    if (entry) { entry.deleted = true; entry.finished = true; Object.assign(entry.task, CLEAR_RETRY); entry.controller?.abort(); clearTimeout(entry.progressTimer); active.delete(id); }
    const saveId = entry?.saveId ?? task?.chromeDownloadId;
    if (typeof saveId === 'number') await chrome.downloads.cancel(saveId).catch(() => {});
    await entry?.instance?.destroy?.(true);
    await queueStorage.removeTask(id);
    await offscreen.removeTaskCache(task);
    meter.clear(id); schedule();
  }

  const profileBatch = createProfileBatch({
    admit, queueStorage, historyStorage, settingsStorage, active, taskById, patch, serial, pause, resume, remove, schedule,
    ensureOffscreen: offscreen.ensureOffscreen, fetchText, notify, signalQueueChange,
    getRoomRevision: () => roomRevision, waitForQueueRoom, waitForAdmission: () => admissionOperation
  });

  installMessageRouter(buildQueueRoutes({
    getReady: () => ready, active, windowManager, discovery, headerRules, offscreen, profileBatch,
    queueStorage, historyStorage, settingsStorage, admit, serial, pause, resume, remove, patch, schedule,
    getSchedulingPromise: () => schedulingPromise, fetchResource, fetchText, notify
  }));
  fileSaver.installDownloadListener();

  let previousPendingCount;
  queueStorage.subscribe?.(() => {
    const tasks = queueStorage.getSnapshot?.()?.tasks;
    if (!tasks) return;
    const count = tasks.filter(task => task.status === 'queued').length;
    if (previousPendingCount === undefined || count < previousPendingCount) signalQueueChange();
    previousPendingCount = count;
  });
  settingsStorage.subscribe(() => { signalQueueChange(); schedule(); });
  chrome.alarms?.onAlarm.addListener(alarm => { if (alarm.name === 'mediaflow-queue-retry') schedule(); });

  const ready = (async () => {
    await profileBatch.restorePausedState();
    let remoteRuns = [];
    if (useOffscreen && await chrome.offscreen.hasDocument?.()) {
      const snapshot = await chrome.runtime.sendMessage({type: 'mf-offscreen-command', command: 'snapshot'});
      remoteRuns = snapshot?.runs || [];
    }
    headerRules.adopt(remoteRuns.flatMap(run => run.ruleIds || []));
    await headerRules.sweepOrphanRules();
    for (const task of (await queueStorage.get()).tasks) {
      const run = remoteRuns.find(r => r.taskId === task.id);
      if (task.status === 'error' && !run && !profileBatch.pausedBatches.has(task.batchId)) {
        const codes = [...String(task.error || '').matchAll(/\bHTTP\s+(\d{3})\b/gi)];
        const status = task.errorStatus ?? (codes.length ? Number(codes.at(-1)[1]) : undefined);
        if ((status === 474 || Number(task.retryCount) >= 3) && transientError({code: task.errorCode, status})) {
          await patch(task.id, {status: 'queued', phase: 'waiting', errorStatus: status, nextRetryAt: Date.now(), downloadSpeed: 0, speedFormatted: '', ...CLEAR_RETRY});
          continue;
        }
      }
      if (run && task.status !== 'paused' && typeof task.chromeDownloadId !== 'number') {
        const restored = {...task, ...run.task};
        const recoveredState = run.progress?.retrying
          ? {status: 'retrying', retryAt: run.progress.retryAt, retryAttempt: run.progress.retryAttempt, retryMax: run.progress.retryMax, retryError: run.progress.retryError || ''}
          : {status: 'downloading', ...CLEAR_RETRY};
        Object.assign(restored, run.progress, recoveredState);
        const entry = {kind: restored.format === 'm3u8' ? 'm3u8' : 'mp4', phase: run.progress?.phase || 'downloading', task: restored, paused: false, subdir: restored.downloadSubdir || ''};
        entry.instance = remoteInstance(restored, entry); entry.instance.runId = run.runId; entry.instance.bytes = run.bytes;
        active.set(task.id, entry);
        await patch(task.id, {...run.task, ...run.progress, ...recoveredState});
        if (profileBatch.pausedBatches.has(restored.batchId)) {
          await patch(task.id, {batchPausedBy: restored.batchId});
          if (entry.phase === 'saving' && typeof task.chromeDownloadId !== 'number') await entry.instance.pauseSoft();
          await pause(task.id); continue;
        }
        if (run.state === 'ready') entry.instance.handle({runId: run.runId, event: 'ready', output: run.output});
        if (run.state === 'error') await failed(restored, entry, restoreError(run.error));
        continue;
      }
      if (typeof task.chromeDownloadId === 'number') {
        const [item] = await chrome.downloads.search({id: task.chromeDownloadId});
        if (item?.state === 'complete') { await recordCompletion(task); await queueStorage.removeTask(task.id); await offscreen.removeTaskCache(task); }
        else if (item?.state === 'in_progress') await patch(task.id, {status: item.paused ? 'paused' : 'downloading', ...CLEAR_RETRY});
        else await patch(task.id, {status: 'error', error: 'File save interrupted. Retry to save the video again.', chromeDownloadId: undefined, isFileDownloading: false, ...CLEAR_RETRY});
      } else if (isActiveStatus(task.status)) {
        await patch(task.id, {status: 'queued', isFileDownloading: false, downloadSpeed: 0, speedFormatted: '', ...CLEAR_RETRY});
      }
    }
    await profileBatch.recoverState();
    for (const run of remoteRuns) if (!await taskById(run.taskId)) await notify({type: 'mf-offscreen-command', command: 'drop', taskId: run.taskId});
    initialized = true;
    await schedule();
  })().catch(console.error);

  return {
    ready, active,
    pause: id => serial(id, () => pause(id)),
    resume: async id => { await serial(id, () => resume(id)); await (schedulingPromise || schedule()); },
    remove: id => serial(id, () => remove(id)),
    schedule
  };
}
