import {crawlProfile} from './profile-scanner.js';
import {safeFilePart} from './media-resolver.js';
import {profileKey, downloadedRecord, videoKey} from './video-details.js';
import {changeSelection, selectionView} from './profile-selection.js';
import {mediaHeaders} from './media-headers.js';

const PAUSABLE_BATCH_STATUSES = ['queued', 'downloading', 'retrying'];

export function createProfileBatch({
  admit,
  queueStorage,
  historyStorage,
  settingsStorage,
  active,
  taskById,
  patch,
  serial,
  pause,
  resume,
  remove,
  schedule,
  ensureOffscreen,
  fetchText,
  notify,
  signalQueueChange,
  getRoomRevision,
  waitForQueueRoom,
  waitForAdmission
}) {
  const cancelledBatches = new Set();
  const pausedBatches = new Set();
  let scanController = null;
  let scanPromise;
  let clearingProfile = false;
  let selectionOperation = Promise.resolve();
  let batchRunning = false;
  let batchJob = null;
  let batchCancelling = false;
  let batchControlOperation = Promise.resolve();

  const controlBatch = fn => {
    const next = batchControlOperation.then(fn);
    batchControlOperation = next.catch(() => {});
    return next;
  };

  async function batchProfile(message, job, previous) {
    const signal = job.controller.signal;
    const batch = previous || {
      id: job.id,
      profileKey: job.profileKey,
      profileName: message.profileName,
      status: 'running',
      total: message.videos.length,
      processed: 0,
      enqueued: 0,
      skipped: 0,
      failed: 0,
      errors: [],
      currentTitle: ''
    };
    job.batch = batch;
    try {
      const settings = await settingsStorage.get();
      for (let index = batch.processed; index < message.videos.length; index++) {
        const video = message.videos[index];
        signal.throwIfAborted();
        while (pausedBatches.has(job.id)) {
          const revision = getRoomRevision();
          await waitForQueueRoom(signal, revision);
        }
        batch.currentTitle = video.title;
        batch.waitingForQueue = false;
        await chrome.storage.local.set({profileBatchState: batch});
        try {
          if (downloadedRecord((await historyStorage.get()).records || [], video.url, video.videoUrl)) {
            batch.skipped++;
            batch.processed++;
            continue;
          }
          if ((await queueStorage.get()).tasks.some(task => videoKey(task.pageUrl) === videoKey(video.url))) {
            batch.skipped++;
            batch.processed++;
            continue;
          }
          const creator = safeFilePart(message.profileName || 'Creator');
          const title = safeFilePart(video.title);
          const page = new URL(video.url);
          if (!/^https?:$/.test(page.protocol)) throw Error('Invalid video page URL');
          const task = {
            url: '',
            quality: message.quality,
            outputFormat: message.outputFormat || settings.outputFormat || 'mp4',
            fileName: message.useChannelFolder ? `${creator}/${title}` : `${creator} - ${title}`,
            title: video.title,
            creator: message.profileName,
            thumbnail: video.thumbnail,
            thumbnails: video.thumbnails,
            batchId: job.id,
            batchProfileKey: job.profileKey,
            pageUrl: page.href,
            headers: mediaHeaders({}, page.href)
          };
          while (true) {
            const revision = getRoomRevision();
            if (await admit(task, signal)) break;
            if (!batch.waitingForQueue && !pausedBatches.has(job.id)) {
              batch.waitingForQueue = true;
              await chrome.storage.local.set({profileBatchState: batch});
            }
            await waitForQueueRoom(signal, revision);
          }
          batch.waitingForQueue = false;
          batch.enqueued++;
        } catch (error) {
          if (signal.aborted) throw error;
          batch.failed++;
          batch.errors = [...batch.errors, {title: video.title, url: video.url, error: error.message}].slice(-100);
        }
        batch.processed++;
      }
      batch.status = 'complete';
    } catch (error) {
      batch.status = signal.aborted ? 'cancelling' : 'error';
      if (!signal.aborted) batch.error = error.message;
    } finally {
      if (signal.aborted) batch.status = 'cancelling';
      batch.waitingForQueue = false;
      await chrome.storage.local.set({profileBatchState: batch, profileBatchPlan: null});
      batchRunning = false;
      notify({type: 'profile-scan-keepalive', enabled: false, job: 'batch'});
    }
  }

  async function cancelProfileBatch(message) {
    batchCancelling = true;
    try {
      const saved = (await chrome.storage.local.get('profileBatchState')).profileBatchState;
      const key = message.profileKey || (message.batchId === saved?.id ? saved.profileKey : batchJob?.profileKey || saved?.profileKey);
      const targetId = message.batchId || (saved?.profileKey === key ? saved.id : undefined);
      const matches = task => Boolean(targetId) && task.batchId === targetId;
      const job = batchJob && batchJob.id === targetId ? batchJob : null;
      if (job) {
        cancelledBatches.add(job.id);
        job.controller.abort();
      }
      // Fence scheduling/completion before waiting for the resolving request to stop.
      for (const task of (await queueStorage.get()).tasks.filter(matches)) {
        cancelledBatches.add(task.batchId);
        const entry = active.get(task.id);
        if (entry) {
          entry.deleted = true;
          entry.controller?.abort();
        }
      }
      if (saved && saved.id === targetId) {
        await chrome.storage.local.set({profileBatchState: {...saved, status: 'cancelling'}});
      }
      await job?.promise;
      let cancelled = 0;
      for (const task of (await queueStorage.get()).tasks.filter(matches)) {
        await serial(task.id, () => remove(task.id));
        cancelled++;
      }
      const current = (await chrome.storage.local.get('profileBatchState')).profileBatchState;
      if (current && current.id === targetId) {
        await chrome.storage.local.set({profileBatchState: {...current, status: 'cancelled', cancelled, batchPaused: false}});
      }
      pausedBatches.delete(targetId);
      return {cancelled};
    } finally {
      batchCancelling = false;
    }
  }

  async function batchAction(message, action) {
    const saved = (await chrome.storage.local.get('profileBatchState')).profileBatchState;
    const id = message.batchId;
    if (!id || saved?.id !== id || ['cancelled', 'cancelling'].includes(saved.status)) {
      throw Error('Batch is no longer available.');
    }
    const batch = batchJob?.id === id && batchJob.batch ? batchJob.batch : saved;
    if (action === 'pause') {
      pausedBatches.add(id);
      batch.batchPaused = true;
      batch.waitingForQueue = false;
      await chrome.storage.local.set({profileBatchState: batch});
      await waitForAdmission();
      const errors = [];
      for (const task of (await queueStorage.get()).tasks.filter(t => t.batchId === id && PAUSABLE_BATCH_STATUSES.includes(t.status))) {
        // Source resolution runs inside the task's serial operation. Interrupt it
        // before joining that operation so a stalled request cannot block pause.
        const entry = active.get(task.id);
        if (entry && !entry.instance) {
          entry.paused = true;
          entry.controller?.abort();
        }
        try {
          await serial(task.id, async () => {
            const current = await taskById(task.id);
            if (!current || !PAUSABLE_BATCH_STATUSES.includes(current.status)) return;
            await patch(task.id, {batchPausedBy: id});
            try {
              await pause(task.id);
            } catch (error) {
              await patch(task.id, {batchPausedBy: undefined});
              throw error;
            }
          });
        } catch (error) {
          errors.push(error.message);
        }
      }
      await chrome.storage.local.set({profileBatchState: batch});
      if (errors.length) throw Error('Some downloads could not be paused: ' + errors[0]);
    } else if (action === 'resume') {
      for (const task of (await queueStorage.get()).tasks.filter(t => t.batchId === id && t.batchPausedBy === id)) {
        await serial(task.id, async () => {
          const current = await taskById(task.id);
          if (current?.batchPausedBy !== id) return;
          await patch(task.id, {
            batchPausedBy: undefined,
            ...(current.status === 'paused' ? {status: 'queued', error: undefined} : {})
          });
        });
      }
      batch.batchPaused = false;
      await chrome.storage.local.set({profileBatchState: batch});
      pausedBatches.delete(id);
      signalQueueChange();
      schedule();
    } else {
      if (pausedBatches.has(id)) throw Error('Resume the batch before retrying failed downloads.');
      let retried = 0;
      for (const task of (await queueStorage.get()).tasks.filter(t => t.batchId === id && t.status === 'error')) {
        await serial(task.id, async () => {
          if ((await taskById(task.id))?.status === 'error') {
            await resume(task.id);
            retried++;
          }
        });
      }
      return {retried};
    }
    return {};
  }

  async function scanProfile(url) {
    if (scanController) throw Error('A profile scan is already running');
    scanController = new AbortController();
    let scan = {status: 'scanning', profileUrl: url, videos: [], pagesScanned: 0, error: '', updatedAt: Date.now()};
    await chrome.storage.local.set({profileScanState: scan});
    try {
      await ensureOffscreen();
      await notify({type: 'profile-scan-keepalive', enabled: true});
      const result = await crawlProfile(url, {
        signal: scanController.signal,
        fetchPage: pageUrl => fetchText(pageUrl, {Referer: pageUrl}, scanController.signal),
        parsePage: async (html, pageUrl) => {
          const parsed = await chrome.runtime.sendMessage({type: 'profile-parse-html', html, pageUrl});
          if (!parsed?.ok) throw Error(parsed?.error || 'Unable to parse creator page');
          return parsed.result;
        },
        onProgress: async progress => {
          scan = {...scan, ...progress, updatedAt: Date.now()};
          await chrome.storage.local.set({profileScanState: scan});
        }
      });
      scan = {...scan, ...result, status: 'complete', updatedAt: Date.now()};
    } catch (error) {
      scan = {...scan, status: scanController.signal.aborted ? 'stopped' : 'error', error: error.message, updatedAt: Date.now()};
    } finally {
      scanController = null;
      await chrome.storage.local.set({profileScanState: scan});
      notify({type: 'profile-scan-keepalive', enabled: false});
    }
  }

  function startProfileScan(url) {
    if (scanController || clearingProfile) {
      return {success: false, error: clearingProfile ? 'Profile results are being cleared' : 'A profile scan is already running'};
    }
    scanPromise = scanProfile(url).catch(console.error);
    return {success: true};
  }

  function stopProfileScan() {
    scanController?.abort();
    return {success: true};
  }

  function updateSelection(message) {
    const next = selectionOperation.then(async () => {
      if (clearingProfile) throw Error('Profile results are being cleared');
      const url = new URL(message.profileUrl);
      if (!/^https?:$/.test(url.protocol)) throw Error('Invalid creator URL');
      const key = profileKey(url.href);
      const saved = await chrome.storage.local.get(['profileScanState', 'profileSelectionState']);
      const scan = saved.profileScanState;
      const previous = saved.profileSelectionState?.profileKey === key ? saved.profileSelectionState : null;
      const videos = profileKey(scan?.profileUrl) === key ? [...(scan.videos || [])] : [];
      if (message.video && !videos.some(video => videoKey(video.url) === videoKey(message.video.url))) {
        const videoUrl = new URL(message.video.url);
        if (videoUrl.origin !== url.origin) throw Error('Video must belong to this site');
        videos.push({...message.video, url: videoUrl.href});
      }
      const selection = {
        ...changeSelection(previous, message.action, videos, (await historyStorage.get()).records || []),
        profileKey: key,
        profileUrl: url.href,
        updatedAt: Date.now()
      };
      await chrome.storage.local.set({profileSelectionState: selection});
      return {selection};
    });
    selectionOperation = next.catch(() => {});
    return next;
  }

  async function clearProfileResults() {
    if (clearingProfile) throw Error('Profile results are already being cleared');
    clearingProfile = true;
    try {
      scanController?.abort();
      // Let the old scan and any selection writes finish before committing the
      // empty result, so an in-flight page cannot restore the cleared list.
      await scanPromise;
      await selectionOperation;
      const saved = await chrome.storage.local.get(['profileScanState', 'profileSelectionState']);
      const url = saved.profileScanState?.profileUrl || saved.profileSelectionState?.profileUrl;
      await chrome.storage.local.set({
        profileScanState: {status: 'cleared', profileUrl: '', profileName: '', profileAvatar: '', videos: [], pagesScanned: 0, error: '', updatedAt: Date.now()},
        profileSelectionState: url ? {profileKey: profileKey(url), profileUrl: url, mode: 'manual', keys: [], updatedAt: Date.now()} : null
      });
    } finally {
      clearingProfile = false;
    }
  }

  async function beginProfileBatch(message) {
    if (batchRunning || batchCancelling || pausedBatches.size) {
      throw Error('Resume or cancel the current batch before starting another.');
    }
    if (!Array.isArray(message.videos) || !message.videos.length) throw Error('Select at least one new video');
    batchRunning = true;
    batchJob = {
      id: `batch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      profileKey: profileKey(message.profileUrl, message.profileName),
      controller: new AbortController()
    };
    const initial = {
      id: batchJob.id,
      profileKey: batchJob.profileKey,
      profileName: message.profileName,
      status: 'running',
      total: message.videos.length,
      processed: 0,
      enqueued: 0,
      skipped: 0,
      failed: 0,
      errors: [],
      currentTitle: ''
    };
    const job = batchJob;
    const persisted = chrome.storage.local.set({profileBatchPlan: {id: job.id, message}, profileBatchState: initial});
    job.promise = persisted.then(() => batchProfile(message, job, initial)).catch(error => {
      batchRunning = false;
      console.error(error);
    });
    await persisted;
    return {batchId: job.id};
  }

  async function batchSelectedProfile(message) {
    await selectionOperation;
    const saved = await chrome.storage.local.get(['profileScanState', 'profileSelectionState']);
    const scan = saved.profileScanState;
    const key = profileKey(message.profileUrl);
    if (!scan || profileKey(scan.profileUrl) !== key || scan.status !== 'complete') {
      throw Error('Finish scanning all creator pages before downloading the selection');
    }
    const selection = saved.profileSelectionState?.profileKey === key ? saved.profileSelectionState : null;
    const view = selectionView(scan.videos || [], selection, (await historyStorage.get()).records || []);
    if (!view.complete) throw Error('Choose both range endpoints from this creator');
    const settings = await settingsStorage.get();
    return beginProfileBatch({
      ...message,
      videos: view.videos,
      profileName: scan.profileName,
      profileUrl: scan.profileUrl,
      useChannelFolder: settings.useChannelFolder !== false
    });
  }

  async function restorePausedState() {
    const persistedBatch = (await chrome.storage.local.get('profileBatchState')).profileBatchState;
    if (persistedBatch?.batchPaused) pausedBatches.add(persistedBatch.id);
  }

  async function recoverState() {
    const saved = (await chrome.storage.local.get('profileScanState')).profileScanState;
    if (saved?.status === 'scanning' && !scanController) {
      await chrome.storage.local.set({
        profileScanState: {...saved, status: 'stopped', error: 'Scan interrupted. Fetch Videos again to rescan all pages.'}
      });
    }
    const batchData = await chrome.storage.local.get(['profileBatchState', 'profileBatchPlan']);
    const savedBatch = batchData.profileBatchState;
    if (savedBatch?.status === 'cancelled' || savedBatch?.status === 'cancelling') {
      cancelledBatches.add(savedBatch.id);
      for (const task of (await queueStorage.get()).tasks.filter(task => task.batchId === savedBatch.id)) {
        await remove(task.id);
      }
      await chrome.storage.local.set({profileBatchState: {...savedBatch, status: 'cancelled'}, profileBatchPlan: null});
    }
    if (savedBatch?.status === 'running' && !batchRunning) {
      if (batchData.profileBatchPlan?.id === savedBatch.id && Array.isArray(batchData.profileBatchPlan.message?.videos)) {
        batchRunning = true;
        batchJob = {id: savedBatch.id, profileKey: savedBatch.profileKey, controller: new AbortController()};
        batchJob.promise = batchProfile(batchData.profileBatchPlan.message, batchJob, savedBatch).catch(console.error);
      } else {
        await chrome.storage.local.set({
          profileBatchState: {...savedBatch, status: 'error', error: 'Batch interrupted. Select remaining videos and start again.'}
        });
      }
    }
    if (savedBatch?.batchPaused && !['cancelled', 'cancelling'].includes(savedBatch.status)) {
      await batchAction({batchId: savedBatch.id}, 'pause');
    }
  }

  return {
    cancelledBatches,
    pausedBatches,
    controlBatch,
    batchProfile,
    cancelProfileBatch,
    batchAction,
    scanProfile,
    startProfileScan,
    stopProfileScan,
    updateSelection,
    clearProfileResults,
    beginProfileBatch,
    batchSelectedProfile,
    restorePausedState,
    recoverState
  };
}
