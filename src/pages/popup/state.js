import {createDownloadedLookup, sortQualities, profileKey, videoKey} from '../../../assets/js/video-details.js';
import {selectionView, changeSelection, rangeHint} from '../../../assets/js/profile-selection.js';
import {isXPage} from '../../../assets/js/x-media.js';
import {isMissavPage} from '../../../assets/js/missav-media.js';
import {icon} from '../../../assets/js/icons.js';
import {batchProgress} from '../../../assets/js/batch-progress.js';
import {escapeHtml, taskStatusLabel, taskProgressNumsHtml} from './format.js';

export const isManagedPage = value => isXPage(value) || isMissavPage(value);

export const queuePageSize = 30;
export const pendingTaskActions = new Set();
export const thumbnailCache = new Map();

export const state = {
  activeTab: 'video', // 'video' | 'profile' | 'settings' | 'history'
  downloadView: 'detected',
  activePageUrl: '',
  activeBrowserTabId: null,
  activePageTitle: '',
  activeDomain: '',
  detectedVideos: [],
  hasSiteDetection: false,
  detectionError: '',
  detectionStatus: '',
  videoThumbnail: '',
  videoThumbnails: [],
  showThumbnails: true,
  historyQuery: '',
  historyPage: 0,
  profileBatchId: '',
  profileBatchKey: '',
  profileBatchStatus: '',
  profileBatch: null,
  batchControlPending: false,
  isCancellingBatch: false,
  customFilename: '',
  downloadSubdir: '',
  useChannelFolder: true,
  maxConcurrentTasks: 6,
  maxPendingTasks: 0,
  outputFormat: 'mp4',
  profileSourceOpen: false,
  profileListScroll: 0,
  profileDetailsCollapsed: false,
  profileSearchQuery: '',
  viewScroll: {},
  tasks: [],
  queuePage: 0,
  history: [],
  // Profile state
  profileName: '',
  profileUrl: '',
  profileAvatar: '',
  profileVideos: [],
  selectedIds: new Set(),
  profileSelection: null,
  selectionPending: 0,
  profileQuality: 'best',
  isScanningProfile: false,
  isClearingProfile: false,
  profileInputUrl: '',
  profilePagesScanned: 0,
  profileScanError: '',
  profileGridPage: 0,
  profileScanStatus: '',
  isBatchEnqueuing: false,
  batchProgress: '',
  // Toasts
  toasts: []
};

let renderHandler = () => {};
export function setRenderHandler(fn) {
  renderHandler = typeof fn === 'function' ? fn : () => {};
}

export function requestRender(options) {
  renderHandler(options);
}

export function showToast(text, type = 'info') {
  const id = Date.now() + Math.random().toString(36).slice(2, 6);
  state.toasts.push({id, text, type});
  requestRender();
  setTimeout(() => {
    state.toasts = state.toasts.filter(toast => toast.id !== id);
    requestRender();
  }, 4000);
}

export function mergeDetectedVideos(videos, fromSite = false, renderChanges = true) {
  if (!Array.isArray(videos) || !videos.length) return;
  if (fromSite) state.hasSiteDetection = true;
  if (!fromSite && state.hasSiteDetection) {
    videos = videos.filter(video => state.detectedVideos.some(current => current.videoUrl === video.videoUrl));
  }
  if (!videos.length) return;
  const map = new Map((fromSite ? [] : state.detectedVideos).map(video => [video.videoUrl, video]));
  for (const video of videos) {
    if (!video?.videoUrl || !/^https?:/.test(video.videoUrl)) continue;
    const old = map.get(video.videoUrl);
    map.set(video.videoUrl, old ? {
      ...video,
      ...old,
      headers: old.headers || video.headers,
      quality: old.quality === 'Auto' ? video.quality : old.quality
    } : video);
  }
  const values = [...map.values()];
  const next = values.some(video => video.site === 'x' || video.site === 'missav')
    ? [...new Set(values.map(video => video.pageUrl))].flatMap(pageUrl => sortQualities(values.filter(video => video.pageUrl === pageUrl)))
    : sortQualities(values);
  if (JSON.stringify(next) !== JSON.stringify(state.detectedVideos)) {
    state.detectedVideos = next;
    if (renderChanges && state.activeTab === 'video') requestRender();
  }
}

export function applyDetectionSnapshot(result) {
  if (result?.site === 'x' || result?.site === 'missav') {
    if (result.site === 'x' ? !isXPage(result.pageUrl) : !isMissavPage(result.pageUrl)) return;
    const before = JSON.stringify([
      state.activePageUrl,
      state.activePageTitle,
      state.customFilename,
      state.videoThumbnail,
      state.videoThumbnails,
      state.detectionError,
      state.detectionStatus,
      state.detectedVideos
    ]);
    const pageChanged = state.activePageUrl !== result.pageUrl;
    state.activePageUrl = result.pageUrl;
    if (pageChanged || result.pageTitle) {
      const title = result.pageTitle || result.videoInfos?.[0]?.title || 'Video';
      if (pageChanged || !state.customFilename || state.customFilename === state.activePageTitle) {
        state.customFilename = title;
      }
      state.activePageTitle = title;
    }
    state.videoThumbnail = result.thumbnail || result.videoInfos?.[0]?.thumbnail || '';
    state.videoThumbnails = result.thumbnails || result.videoInfos?.[0]?.thumbnails || [];
    state.detectionError = result.detectionError || '';
    state.detectionStatus = result.detectionStatus || '';
    state.detectedVideos = [];
    state.hasSiteDetection = true;
    mergeDetectedVideos(result.videoInfos, true, false);
    const after = JSON.stringify([
      state.activePageUrl,
      state.activePageTitle,
      state.customFilename,
      state.videoThumbnail,
      state.videoThumbnails,
      state.detectionError,
      state.detectionStatus,
      state.detectedVideos
    ]);
    if (state.activeTab === 'video' && before !== after) requestRender();
  } else {
    mergeDetectedVideos(result?.videoInfos);
  }
}

let detectionRequest = 0;
export async function refreshMediaDetection(force = false) {
  if (state.activeBrowserTabId == null) return;
  const request = ++detectionRequest;
  let receivedSiteSnapshot = false;
  chrome.tabs.sendMessage(state.activeBrowserTabId, {command: 'get_generic_video_info', refresh: force}, result => {
    if (request !== detectionRequest) return;
    if (!chrome.runtime.lastError) {
      receivedSiteSnapshot = result?.site === 'x' || result?.site === 'missav';
      applyDetectionSnapshot(result);
    }
  });
  try {
    const result = await chrome.runtime.sendMessage({
      type: 'media-detection-snapshot',
      tabId: state.activeBrowserTabId,
      pageUrl: state.activePageUrl
    });
    if (request !== detectionRequest || receivedSiteSnapshot || (result?.site === 'x' || result?.site === 'missav') && result.pageUrl !== state.activePageUrl) {
      return;
    }
    applyDetectionSnapshot(result);
  } catch {}
}

// ---- Downloaded history & profile selection helpers ----
let historyIndex;
let historyIndexSource;
export function isDownloaded(pageUrl, streamUrl) {
  if (historyIndexSource !== state.history) {
    historyIndexSource = state.history;
    historyIndex = createDownloadedLookup(state.history);
  }
  return historyIndex(pageUrl, streamUrl);
}

export function profileVideoDownloaded(video) {
  return !!video && isDownloaded(video.url, video.videoUrl);
}

export function currentProfileSelection() {
  return state.profileSelection?.profileKey === profileKey(state.profileUrl) ? state.profileSelection : null;
}

let selectionCache;
export function profileSelectionView() {
  const selection = currentProfileSelection();
  if (
    !selectionCache ||
    selectionCache.videos !== state.profileVideos ||
    selectionCache.selection !== selection ||
    selectionCache.history !== state.history
  ) {
    selectionCache = {
      videos: state.profileVideos,
      selection,
      history: state.history,
      view: selectionView(state.profileVideos, selection, state.history)
    };
  }
  return selectionCache.view;
}

export function syncSelectedIds() {
  state.selectedIds = new Set(profileSelectionView().videos.map(video => video.id));
}

export function applySavedSelection(selection) {
  state.profileSelection = selection || null;
  updateProfileSelection();
}

export async function selectProfileVideos(action, video) {
  const key = profileKey(state.profileUrl);
  state.selectionPending++;
  state.profileSelection = {
    ...changeSelection(currentProfileSelection(), action, state.profileVideos, state.history),
    profileKey: key,
    profileUrl: state.profileUrl
  };
  updateProfileSelection();
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'profile-selection-update',
      profileUrl: state.profileUrl,
      action,
      video
    });
    if (!response?.success) throw Error(response?.error || 'Unable to save selection');
    if (response.selection) applySavedSelection(response.selection);
  } catch (error) {
    showToast(error.message, 'error');
  } finally {
    state.selectionPending--;
    updateProfileSelection();
  }
}

export function applyProfileScan(scan) {
  if (!scan) return;
  if (scan.status === 'cleared') {
    for (const video of state.profileVideos) thumbnailCache.delete(video.id);
  }
  const same = scan.profileUrl === state.profileUrl;
  state.profileName = scan.profileName || '';
  state.profileAvatar = scan.profileAvatar || '';
  state.profileUrl = scan.profileUrl || '';
  state.profileInputUrl ||= state.profileUrl;
  state.profileVideos = scan.videos || [];
  syncSelectedIds();
  state.profilePagesScanned = scan.pagesScanned || 0;
  state.profileScanError = scan.error || '';
  state.profileScanStatus = scan.status || '';
  state.isScanningProfile = scan.status === 'scanning';
  if (scan.status === 'complete') state.profileSourceOpen = false;
  if (!same) {
    state.profileGridPage = 0;
    state.profileSearchQuery = '';
  }
  if (state.activeTab === 'profile') requestRender({resetProfileScroll: !same});
}

export async function scanProfile(value) {
  if (state.isScanningProfile || state.isBatchEnqueuing || state.isClearingProfile) return;
  try {
    const url = new URL(value || state.activePageUrl);
    if (!/^https?:$/.test(url.protocol)) throw Error('Enter a valid http or https profile URL');
    state.profileInputUrl = url.href;
    state.isScanningProfile = true;
    state.profileScanError = '';
    requestRender();
    const response = await chrome.runtime.sendMessage({type: 'profile-scan-start', url: url.href});
    if (!response?.success) throw Error(response?.error || 'Could not start profile scan');
  } catch (error) {
    state.isScanningProfile = false;
    showToast(error.message, 'error');
  }
}

export function currentBatchProfileKey() {
  return state.profileUrl ? profileKey(state.profileUrl, state.profileName) : state.profileBatchKey;
}

export function profileBatchTasks() {
  return state.profileBatchKey === currentBatchProfileKey()
    ? state.tasks.filter(task => task.batchId === state.profileBatchId)
    : [];
}

export function profileSelectionNote() {
  const query = state.profileSearchQuery.trim().toLocaleLowerCase();
  const hidden = query
    ? state.profileVideos.filter(video => state.selectedIds.has(video.id) && !String(video.title || '').toLocaleLowerCase().includes(query)).length
    : 0;
  return hidden
    ? hidden + ' selected outside this search'
    : (state.outputFormat === 'mp4' ? 'MP4 preferred' : 'Original format') + ' · ' + (profileBatchTasks().length ? profileBatchTasks().length + ' in queue' : 'Ready to download');
}

export function updateProfileFooterNote() {
  const note = document.querySelector('[data-role="profile-selection-note"]');
  if (note) note.textContent = profileSelectionNote();
}

export function updateProfileSelection() {
  syncSelectedIds();
  updateProfileFooterNote();
  const selection = currentProfileSelection();
  const view = profileSelectionView();
  const picking = selection?.mode === 'range' && !selection.end;
  for (const card of document.querySelectorAll('.profile-video-card')) {
    const selected = state.selectedIds.has(card.dataset.videoId);
    card.classList.toggle('selected', selected);
    const checkbox = card.querySelector('input');
    checkbox.checked = selected;
    const video = state.profileVideos.find(item => item.id === card.dataset.videoId);
    checkbox.disabled = state.isBatchEnqueuing || !!state.selectionPending || !picking && profileVideoDownloaded(video);
    const tick = card.querySelector('.profile-selection-tick');
    if (tick) tick.hidden = !selected;
    const boundary = card.querySelector('.profile-range-boundary');
    boundary.textContent = selection?.mode === 'range'
      ? [selection.start === videoKey(video?.url) ? 'Start' : '', selection.end === videoKey(video?.url) ? 'End' : ''].filter(Boolean).join(' / ')
      : '';
    boundary.hidden = !boundary.textContent;
  }
  const count = document.querySelector('[data-role="profile-selection-count"]');
  if (count) count.textContent = state.selectedIds.size + ' / ' + state.profileVideos.length + ' selected';
  const button = document.querySelector('#btn-batch-download');
  if (button) {
    button.innerHTML = icon('download') + ' Download (' + state.selectedIds.size + ')';
    button.disabled = !state.selectedIds.size || state.isBatchEnqueuing || state.isScanningProfile || !view.complete || !!state.selectionPending;
  }
  const range = document.querySelector('#btn-profile-range');
  if (range) {
    range.disabled = state.isBatchEnqueuing || !!state.selectionPending;
    range.setAttribute('aria-pressed', String(picking));
  }
  const hint = document.querySelector('[data-role="profile-range-hint"]');
  if (hint) {
    hint.textContent = rangeHint(selection, view);
    hint.hidden = selection?.mode !== 'range';
  }
  const newCount = state.profileVideos.filter(video => !profileVideoDownloaded(video)).length;
  const selectNew = document.querySelector('#btn-profile-select-all');
  if (selectNew) selectNew.disabled = state.isBatchEnqueuing || !newCount;
  const stats = document.querySelector('.profile-stats-text');
  if (stats && state.profileVideos.length) {
    stats.textContent = `${state.profileVideos.length} videos · ${newCount} new · ${state.profileVideos.length - newCount} downloaded`;
  }
  const downloaded = state.profileVideos.length - newCount;
  document.querySelectorAll('[data-role="library-downloaded"]').forEach(node => { node.textContent = downloaded; });
  document.querySelectorAll('[data-role="library-remaining"]').forEach(node => { node.textContent = newCount; });
  const progress = document.querySelector('[data-role="library-progress"]');
  if (progress) {
    const percent = state.profileVideos.length ? Math.round(downloaded / state.profileVideos.length * 100) : 0;
    progress.style.setProperty('--library-progress', `${percent}%`);
    progress.setAttribute('aria-valuenow', String(percent));
  }
}

export function currentVideoThumbnail() {
  const video = state.detectedVideos[0];
  return {
    id: 'current',
    url: video?.pageUrl || state.activePageUrl,
    title: video?.title || state.activePageTitle,
    thumbnail: video?.thumbnail || state.videoThumbnail,
    thumbnails: video?.thumbnails || state.videoThumbnails
  };
}

export function thumbnailHtml(video, className) {
  if (!state.showThumbnails) return '';
  const url = thumbnailCache.get(video.id) || video.thumbnail || video.thumbnails?.[0];
  return url
    ? `<img src="${escapeHtml(url)}" data-thumbnail-id="${escapeHtml(video.id)}" class="${className}" loading="lazy" decoding="async" referrerpolicy="no-referrer" alt="${escapeHtml(video.title || '')}" />`
    : '<span class="thumbnail-placeholder">Thumbnail unavailable</span>';
}

export function downloadedLabel(pageUrl, streamUrl = '') {
  const downloaded = isDownloaded(pageUrl, streamUrl);
  return `<span class="download-state-label ${downloaded ? 'already-downloaded' : 'not-downloaded'}" data-downloaded-page="${escapeHtml(pageUrl)}" data-downloaded-stream="${escapeHtml(streamUrl)}">${icon(downloaded ? 'check-check' : 'circle')}${downloaded ? 'Downloaded' : 'Not downloaded'}</span>`;
}

export function updateDownloadedLabels() {
  document.querySelectorAll('[data-downloaded-page]').forEach(label => {
    const downloaded = isDownloaded(label.dataset.downloadedPage, label.dataset.downloadedStream);
    label.hidden = false;
    label.classList.toggle('already-downloaded', downloaded);
    label.classList.toggle('not-downloaded', !downloaded);
    label.innerHTML = icon(downloaded ? 'check-check' : 'circle') + (downloaded ? 'Downloaded' : 'Not downloaded');
  });
}

export function bindThumbnailFallbacks() {
  if (!state.showThumbnails) return;
  const images = document.querySelectorAll('img[data-thumbnail-id]');
  if (!images.length) return;
  const items = new Map(state.profileVideos.map(video => [String(video.id), video]));
  for (const record of state.history) {
    items.set('history:' + record.id, {...record, id: 'history:' + record.id, url: record.pageUrl || record.url});
  }
  items.set('current', currentVideoThumbnail());
  images.forEach(img => {
    const video = items.get(img.dataset.thumbnailId);
    if (!video) return;
    const candidates = [...new Set([video.thumbnail, ...(video.thumbnails || [])].filter(Boolean))];
    let index = Math.max(0, candidates.indexOf(img.getAttribute('src')));
    let fetching = false;
    img.addEventListener('load', () => {
      img.classList.add('loaded');
      thumbnailCache.set(video.id, img.getAttribute('src'));
    });
    img.addEventListener('error', async () => {
      if (fetching || !state.showThumbnails || !img.isConnected) return;
      if (++index < candidates.length) {
        img.src = candidates[index];
        return;
      }
      fetching = true;
      for (const url of candidates) {
        try {
          const response = await chrome.runtime.sendMessage({type: 'ext-fetch-image', url, pageUrl: video.url});
          if (!state.showThumbnails || !img.isConnected) return;
          if (response?.ok && response.dataUrl) {
            thumbnailCache.set(video.id, response.dataUrl);
            img.src = response.dataUrl;
            return;
          }
        } catch {}
      }
      img.hidden = true;
      img.parentElement?.classList.add('thumbnail-unavailable');
    });
  });
}

export function updateBatchControls() {
  updateProfileFooterNote();
  const batch = state.profileBatch;
  const summary = batchProgress(batch, state.tasks, state.history);
  if (summary) {
    state.batchProgress = summary.text;
    const progress = document.querySelector('[data-role="batch-progress"]');
    if (progress) {
      progress.textContent = summary.text;
      progress.title = summary.text;
    }
  }
  const here = batch?.profileKey === currentBatchProfileKey();
  const controllable = here && !['cancelled', 'cancelling'].includes(batch.status);
  const pauseButton = document.querySelector('#btn-pause-profile-batch');
  if (pauseButton) {
    pauseButton.hidden = !controllable || !(batch.batchPaused || summary?.counts.remaining || summary?.counts.waiting || summary?.counts.active);
    pauseButton.disabled = state.batchControlPending;
    pauseButton.textContent = batch.batchPaused ? 'Resume batch' : 'Pause batch';
  }
  const retryButton = document.querySelector('#btn-retry-profile-batch');
  if (retryButton) {
    retryButton.hidden = !controllable || !summary?.counts.failed;
    retryButton.disabled = state.batchControlPending || !!batch.batchPaused;
  }
  const button = document.querySelector('#btn-cancel-profile-batch');
  if (!button) return;
  const count = profileBatchTasks().length;
  const running = state.isBatchEnqueuing && state.profileBatchKey === currentBatchProfileKey();
  button.hidden = !(count || running || state.isCancellingBatch);
  button.disabled = state.isCancellingBatch || state.batchControlPending;
  button.textContent = state.isCancellingBatch ? 'Cancelling…' : `Cancel batch${count ? ' (' + count + ')' : ''}`;
}

export function applyProfileBatch(batch) {
  if (!batch) return;
  const wasRunning = state.isBatchEnqueuing;
  state.profileBatchId = batch.id || '';
  state.profileBatchKey = batch.profileKey || '';
  state.profileBatchStatus = batch.status;
  state.profileBatch = batch;
  state.isCancellingBatch = batch.status === 'cancelling';
  state.isBatchEnqueuing = batch.status === 'running' || batch.status === 'cancelling' || !!batch.batchPaused;
  state.batchProgress = batchProgress(batch, state.tasks, state.history)?.text || '';
  if (wasRunning && !state.isBatchEnqueuing) {
    showToast(state.batchProgress, batch.failed || batch.error ? 'warning' : 'success');
  } else if (state.activeTab === 'profile') {
    const progress = document.querySelector('[data-role="batch-progress"]');
    if (wasRunning === state.isBatchEnqueuing && progress) progress.textContent = state.batchProgress;
    else requestRender();
  }
  updateBatchControls();
}

export async function batchDownloadProfileVideos() {
  if (state.isBatchEnqueuing || state.isScanningProfile || state.selectionPending || !profileSelectionView().complete) return;
  const videos = state.profileVideos.filter(video => state.selectedIds.has(video.id) && !profileVideoDownloaded(video));
  if (!videos.length) {
    showToast('Select at least one new video. Downloaded videos are skipped.', 'info');
    return;
  }
  state.isBatchEnqueuing = true;
  state.batchProgress = 'Starting batch…';
  requestRender();
  try {
    const response = await chrome.runtime.sendMessage({
      type: 'profile-batch-start',
      videos,
      quality: state.profileQuality,
      outputFormat: state.outputFormat,
      profileName: state.profileName,
      profileUrl: state.profileUrl,
      useChannelFolder: state.useChannelFolder
    });
    if (!response?.success) throw Error(response?.error || 'Could not start batch');
    state.profileBatchId = response.batchId || state.profileBatchId;
  } catch (error) {
    state.isBatchEnqueuing = false;
    showToast(error.message, 'error');
  }
}

// ---- Queue state, in-place patching & live retry countdown ----
export function visibleQueueTasks(tasks = state.tasks) {
  const pages = Math.max(1, Math.ceil(tasks.length / queuePageSize));
  state.queuePage = Math.min(Math.max(0, state.queuePage), pages - 1);
  return tasks.slice(state.queuePage * queuePageSize, (state.queuePage + 1) * queuePageSize);
}

export function taskStructureKey(tasks) {
  tasks = tasks || [];
  const counts = {downloading: 0, retrying: 0, queued: 0, error: 0};
  const urls = new Set();
  const batch = [];
  for (const task of tasks) {
    if (task.status in counts) counts[task.status]++;
    if (task.status !== 'error' && task.url) urls.add(task.url);
    if (task.batchId && task.batchId === state.profileBatchId) batch.push([task.id, task.status]);
  }
  const visible = visibleQueueTasks(tasks).map(task => [
    task.id,
    task.status,
    task.phase,
    !!task.isFileDownloading,
    task.error,
    task.errorStatus,
    task.errorCode,
    !!task.needsSourceRefresh,
    task.pageUrl,
    task.retryError,
    task.fallbackReason,
    task.outputExtension,
    task.outputFormat,
    task.outputReady,
    task.fileName,
    task.nextRetryAt,
    task.retryCount
  ]);
  return JSON.stringify([
    tasks.length,
    state.queuePage,
    counts,
    visible,
    batch,
    state.detectedVideos.map(video => urls.has(video.videoUrl))
  ]);
}

let lastTaskStructureKey = '';
let lastTaskSnapshot = '';
const progressMarkup = new WeakMap();
let retryCountdownTimer = null;

export function getLastTaskStructureKey() {
  return lastTaskStructureKey;
}

export function hasActiveRetryCountdown(tasks = state.tasks, now = Date.now()) {
  return (tasks || []).some(task => task.status === 'retrying' && Number(task.retryAt) > now);
}

export function stopRetryTimer() {
  if (retryCountdownTimer !== null) {
    clearInterval(retryCountdownTimer);
    retryCountdownTimer = null;
  }
}

export function patchRetryingStatuses(now = Date.now()) {
  const hasRetrying = state.tasks.some(task => task.status === 'retrying');
  if (!hasRetrying) {
    stopRetryTimer();
    return;
  }
  if (state.activeTab === 'video' && state.downloadView === 'queue') {
    const list = document.querySelector('.queue-items-list');
    if (list) {
      const cards = new Map([...list.querySelectorAll('[data-task-id]')].map(card => [card.dataset.taskId, card]));
      for (const task of visibleQueueTasks(state.tasks)) {
        if (task.status !== 'retrying') continue;
        const card = cards.get(String(task.id));
        const st = card?.querySelector('[data-role="status"]');
        const label = taskStatusLabel(task, now);
        if (st && st.textContent !== label) st.textContent = label;
      }
    }
  }
  if (!hasActiveRetryCountdown(state.tasks, now)) {
    stopRetryTimer();
  }
}

export function syncRetryTimer(now = Date.now()) {
  if (hasActiveRetryCountdown(state.tasks, now)) {
    if (retryCountdownTimer === null) {
      retryCountdownTimer = setInterval(() => patchRetryingStatuses(Date.now()), 1000);
    }
  } else {
    stopRetryTimer();
  }
}

export function markTasksRendered() {
  lastTaskStructureKey = taskStructureKey(state.tasks);
  syncRetryTimer();
}

export function seedRenderedProgressMarkup() {
  if (state.activeTab !== 'video' || state.downloadView !== 'queue') return;
  const list = document.querySelector('.queue-items-list');
  if (!list) return;
  const cards = new Map([...list.querySelectorAll('[data-task-id]')].map(card => [card.dataset.taskId, card]));
  for (const task of visibleQueueTasks(state.tasks)) {
    const nums = cards.get(String(task.id))?.querySelector('[data-role="nums"]');
    if (nums) progressMarkup.set(nums, taskProgressNumsHtml(task));
  }
}

export function applyTasks(tasks) {
  state.tasks = tasks || [];
  syncRetryTimer();
  const key = taskStructureKey(state.tasks);
  const visible = visibleQueueTasks(state.tasks);
  const snapshot = key + '|' + JSON.stringify(visible) + '|' + visible.map(task => taskStatusLabel(task)).join('|');
  if (snapshot === lastTaskSnapshot) return;
  lastTaskSnapshot = snapshot;
  const list = document.querySelector('.queue-items-list');
  if (state.activeTab !== 'video') {
    const badge = document.querySelector('[data-tab="video"] .tab-badge');
    if (badge) badge.textContent = state.tasks.length;
    updateBatchControls();
    return;
  }
  if (state.downloadView === 'detected' && key === lastTaskStructureKey) {
    const count = document.querySelector('[data-role="queue-count"]');
    if (count) count.textContent = state.tasks.length;
    return;
  }
  if (key !== lastTaskStructureKey || !list) {
    lastTaskStructureKey = key;
    requestRender();
    return;
  }
  const cards = new Map([...list.querySelectorAll('[data-task-id]')].map(card => [card.dataset.taskId, card]));
  for (const task of visible) {
    const card = cards.get(String(task.id));
    if (!card) {
      requestRender();
      return;
    }
    const progress = Math.max(0, Math.min(100, Math.round(task.progress || 0)));
    const bar = card.querySelector('[data-role="bar"]');
    if (bar && bar.style.width !== `${progress}%`) bar.style.width = `${progress}%`;
    const track = card.querySelector('[role="progressbar"]');
    if (track) track.setAttribute('aria-valuenow', String(progress));
    const nums = card.querySelector('[data-role="nums"]');
    if (nums) {
      const html = taskProgressNumsHtml(task);
      if (progressMarkup.get(nums) !== html) {
        nums.innerHTML = html;
        progressMarkup.set(nums, html);
      }
    }
    const st = card.querySelector('[data-role="status"]');
    const label = taskStatusLabel(task);
    if (st && st.textContent !== label) st.textContent = label;
  }
}
