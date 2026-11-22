import {videoKey} from '../../../assets/js/video-details.js';
import {mediaHeaders} from '../../../assets/js/media-headers.js';
import {settingsStorage} from '../../../assets/js/storage.js';
import {
  state,
  pendingTaskActions,
  requestRender,
  showToast,
  applyTasks,
  refreshMediaDetection,
  profileVideoDownloaded,
  currentProfileSelection,
  selectProfileVideos,
  scanProfile,
  currentBatchProfileKey,
  updateBatchControls,
  batchDownloadProfileVideos
} from './state.js';
import {t, cleanFileName, normalizeFormat} from './format.js';

async function updateOutputFormat(value) {
  const previous = state.outputFormat;
  state.outputFormat = value === 'source' ? 'source' : 'mp4';
  try {
    await settingsStorage.setOutputFormat(state.outputFormat);
  } catch (error) {
    state.outputFormat = previous;
    requestRender();
    showToast(error.message, 'error');
  }
}

function handleTaskAction(btn) {
  const action = btn.getAttribute('data-action');
  const taskId = btn.getAttribute('data-id');
  if (!action || !taskId) return;

  if (action === 'open-source') {
    const task = state.tasks.find(item => item.id === taskId);
    if (!task?.pageUrl) return;
    chrome.runtime.sendMessage({type: 'open-video-page', url: task.pageUrl}, response => {
      const error = chrome.runtime.lastError;
      if (error || !response?.success) {
        showToast(error?.message || response?.error || 'Unable to open source page', 'error');
      }
    });
    return;
  }

  if (pendingTaskActions.has(taskId)) return;
  const type = {
    pause: 'download-queue-pause',
    resume: 'download-queue-resume',
    delete: 'download-queue-delete',
    retry: 'download-queue-retry'
  }[action];
  if (!type) return;

  pendingTaskActions.add(taskId);
  btn.disabled = true;
  const task = state.tasks.find(item => item.id === taskId);
  chrome.runtime.sendMessage({type, taskId, ...(action === 'retry' ? {task} : {})}, response => {
    const error = chrome.runtime.lastError;
    pendingTaskActions.delete(taskId);
    if (error || !response?.success) {
      showToast(error?.message || response?.error || 'Action failed', 'error');
    } else {
      chrome.runtime.sendMessage({type: 'download-queue-snapshot'}, result => {
        if (!chrome.runtime.lastError && result?.state?.tasks) applyTasks(result.state.tasks);
      });
    }
    if (btn.isConnected) btn.disabled = false;
  });
}

function enqueueDetectedVideo(btn) {
  const idx = Number(btn.getAttribute('data-download-index'));
  const video = state.detectedVideos[idx];
  if (!video) return;

  const title = (video.site === 'x' || video.site === 'missav') && (!state.customFilename || state.customFilename === state.activePageTitle)
    ? video.title || state.activePageTitle || 'video'
    : state.customFilename || video.title || state.activePageTitle || 'video';
  const cleanTitle = cleanFileName(title, state.useChannelFolder);
  const normalizedFmt = normalizeFormat(video.format, video.videoUrl);
  const qualStr = Array.isArray(video.quality) ? String(video.quality[0]) : String(video.quality || 'Auto');

  chrome.runtime.sendMessage(
    {
      type: 'download-queue-enqueue',
      url: video.videoUrl,
      fileName: cleanTitle,
      format: normalizedFmt,
      outputFormat: state.outputFormat,
      quality: qualStr,
      pageUrl: video.pageUrl || state.activePageUrl,
      title: video.title || state.activePageTitle || title,
      thumbnail: video.thumbnail || state.videoThumbnail,
      thumbnails: video.thumbnails || state.videoThumbnails,
      headers: mediaHeaders(video.headers, state.activePageUrl)
    },
    res => {
      if (res && res.success) showToast(t('toastEnqueued'), 'success');
      else showToast(res?.error || 'Failed to enqueue', 'error');
    }
  );
}

function bindChromeEvents(app) {
  app.querySelectorAll('button[title]').forEach(button => {
    if (!button.hasAttribute('aria-label') && !button.textContent.trim()) {
      button.setAttribute('aria-label', button.title);
    }
  });

  app.addEventListener('click', async event => {
    const closeBtn = event.target.closest('#btn-close-overlay');
    if (closeBtn) {
      window.parent.postMessage({type: 'mediaflow-overlay-close'}, '*');
      return;
    }

    const openTabBtn = event.target.closest('#btn-open-browser-tab');
    if (openTabBtn) {
      try {
        await chrome.tabs.create({url: chrome.runtime.getURL('src/pages/popup/index.html?surface=tab'), active: true});
      } catch (error) {
        showToast(error.message, 'error');
      }
      return;
    }

    const tabBtn = event.target.closest('.popup-tab-btn[data-tab]');
    if (tabBtn) {
      const tab = tabBtn.getAttribute('data-tab');
      if (tab) {
        state.activeTab = tab;
        requestRender();
      }
    }
  });
}

function bindVideoQueueEvents(scroll) {
  scroll.addEventListener('click', event => {
    const viewBtn = event.target.closest('[data-download-view]');
    if (viewBtn) {
      state.downloadView = viewBtn.dataset.downloadView;
      requestRender();
      return;
    }

    if (event.target.closest('#btn-refresh-detection')) {
      refreshMediaDetection(true);
      return;
    }

    const downloadBtn = event.target.closest('.btn-download-action');
    if (downloadBtn) {
      enqueueDetectedVideo(downloadBtn);
      return;
    }

    if (event.target.closest('#btn-clear-queued')) {
      chrome.runtime.sendMessage({type: 'download-queue-clear-queued'});
      return;
    }

    if (event.target.closest('#btn-clear-errors')) {
      chrome.runtime.sendMessage({type: 'download-queue-clear-errors'});
      return;
    }

    if (event.target.closest('#queue-prev')) {
      state.queuePage -= 1;
      requestRender();
      document.querySelector('.queue-section')?.scrollIntoView({block: 'start'});
      return;
    }

    if (event.target.closest('#queue-next')) {
      state.queuePage += 1;
      requestRender();
      document.querySelector('.queue-section')?.scrollIntoView({block: 'start'});
      return;
    }

    if (event.target.closest('#btn-view-history')) {
      state.activeTab = 'history';
      requestRender();
      return;
    }

    const emptyAction = event.target.closest('[data-empty-action]');
    if (emptyAction) {
      const target = emptyAction.dataset.emptyAction;
      if (target === 'detected') {
        state.downloadView = 'detected';
        requestRender();
      } else if (target === 'profile') {
        state.activeTab = 'profile';
        requestRender();
      }
      return;
    }

    const actionBtn = event.target.closest('[data-action][data-id]');
    if (actionBtn) {
      handleTaskAction(actionBtn);
    }
  });

  scroll.addEventListener('input', event => {
    if (event.target.matches('#filename-editor-input')) {
      state.customFilename = event.target.value;
    }
  });

  scroll.addEventListener('change', async event => {
    if (event.target.matches('[data-output-format]')) {
      await updateOutputFormat(event.target.value);
      return;
    }
    if (event.target.matches('[data-queue-limit]')) {
      state.maxConcurrentTasks = await settingsStorage.setMaxConcurrentTasks(event.target.value);
      requestRender();
    }
  });
}

function bindProfileEvents(scroll) {
  const profileGrid = scroll.querySelector('.profile-video-grid');
  const libraryDetails = scroll.querySelector('#profile-library-details');
  const showLibraryDetails = scroll.querySelector('#btn-show-library-details');

  function setLibraryDetailsCollapsed(collapsed) {
    if (!libraryDetails || !showLibraryDetails || state.profileDetailsCollapsed === collapsed) return;
    if (collapsed && libraryDetails.contains(document.activeElement)) return;
    state.profileDetailsCollapsed = collapsed;
    libraryDetails.classList.toggle('is-collapsed', collapsed);
    libraryDetails.setAttribute('aria-hidden', String(collapsed));
    libraryDetails.inert = collapsed;
    showLibraryDetails.hidden = !collapsed;
    if (!collapsed && document.activeElement === showLibraryDetails) profileGrid?.focus({preventScroll: true});
  }

  profileGrid?.addEventListener('scroll', () => {
    if (profileGrid.scrollTop <= 1) setLibraryDetailsCollapsed(false);
    else if (profileGrid.scrollTop > 48) setLibraryDetailsCollapsed(true);
  }, {passive: true});

  scroll.addEventListener('wheel', event => {
    const grid = scroll.querySelector('.profile-video-grid');
    if (!grid || !event.deltaY || event.ctrlKey || grid.contains(event.target) || event.target.closest?.('select,textarea,[contenteditable="true"]')) return;
    for (let node = event.target; node && node !== scroll; node = node.parentElement) {
      if (node.scrollHeight > node.clientHeight && /^(auto|scroll)$/.test(getComputedStyle(node).overflowY)) return;
    }
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? grid.clientHeight : 1);
    if (delta < 0 && grid.scrollTop <= 0 || delta > 0 && grid.scrollTop + grid.clientHeight >= grid.scrollHeight - 1) return;
    grid.scrollTop += delta;
    event.preventDefault();
  }, {passive: false});

  scroll.querySelector('#profile-source-details')?.addEventListener('toggle', event => {
    if (event.target.isConnected) state.profileSourceOpen = event.target.open;
  });

  scroll.addEventListener('click', async event => {
    if (event.target.closest('#btn-show-library-details')) {
      setLibraryDetailsCollapsed(false);
      return;
    }

    if (event.target.closest('#btn-clear-profile-results')) {
      if (state.isClearingProfile) return;
      state.isClearingProfile = true;
      requestRender();
      try {
        const response = await chrome.runtime.sendMessage({type: 'profile-results-clear'});
        if (!response?.success) throw Error(response?.error || 'Unable to clear profile results');
      } catch (error) {
        showToast(error.message, 'error');
      } finally {
        state.isClearingProfile = false;
        requestRender();
      }
      return;
    }

    if (event.target.closest('#btn-cancel-profile-batch')) {
      if (state.isCancellingBatch) return;
      state.isCancellingBatch = true;
      updateBatchControls();
      try {
        const response = await chrome.runtime.sendMessage({
          type: 'profile-batch-cancel',
          batchId: state.profileBatchId,
          profileKey: currentBatchProfileKey()
        });
        if (!response?.success) throw Error(response?.error || 'Unable to cancel batch');
      } catch (error) {
        state.isCancellingBatch = false;
        updateBatchControls();
        showToast(error.message, 'error');
      }
      return;
    }

    if (event.target.closest('#btn-pause-profile-batch') || event.target.closest('#btn-retry-profile-batch')) {
      if (state.batchControlPending) return;
      const action = event.target.closest('#btn-pause-profile-batch')
        ? (state.profileBatch?.batchPaused ? 'resume' : 'pause')
        : 'retry-failed';
      state.batchControlPending = true;
      updateBatchControls();
      try {
        const response = await chrome.runtime.sendMessage({type: 'profile-batch-' + action, batchId: state.profileBatchId});
        if (!response?.success) throw Error(response?.error || 'Unable to update batch');
      } catch (error) {
        showToast(error.message, 'error');
      } finally {
        state.batchControlPending = false;
        updateBatchControls();
      }
      return;
    }

    if (event.target.closest('#btn-stop-profile-scan')) {
      chrome.runtime.sendMessage({type: 'profile-scan-stop'});
      return;
    }

    if (event.target.closest('#profile-grid-prev')) {
      state.profileGridPage -= 1;
      requestRender({resetProfileScroll: true});
      return;
    }

    if (event.target.closest('#profile-grid-next')) {
      state.profileGridPage += 1;
      requestRender({resetProfileScroll: true});
      return;
    }

    if (event.target.closest('#btn-fetch-profile-videos')) {
      const url = scroll.querySelector('#profile-url-input')?.value.trim();
      if (url) scanProfile(url);
      return;
    }

    if (event.target.closest('#btn-profile-select-all')) {
      selectProfileVideos({type: 'new'});
      return;
    }

    if (event.target.closest('#btn-profile-clear-selection')) {
      selectProfileVideos({type: 'clear'});
      return;
    }

    if (event.target.closest('#btn-profile-range')) {
      selectProfileVideos({type: 'range'});
      return;
    }

    if (event.target.closest('#btn-batch-download')) {
      batchDownloadProfileVideos();
      return;
    }

    const card = event.target.closest('.profile-video-card');
    if (card) {
      if (event.target.tagName === 'INPUT' || state.isBatchEnqueuing) return;
      const id = card.getAttribute('data-video-id');
      if (!id) return;
      const video = state.profileVideos.find(item => item.id === id);
      if (state.selectionPending || profileVideoDownloaded(video) && !(currentProfileSelection()?.mode === 'range' && !currentProfileSelection().end)) {
        return;
      }
      selectProfileVideos({type: 'pick', key: videoKey(video.url)}, video);
    }
  });

  scroll.addEventListener('change', async event => {
    const checkbox = event.target.closest('.profile-video-checkbox');
    if (checkbox) {
      const id = checkbox.getAttribute('data-video-id');
      if (!id || state.isBatchEnqueuing || state.selectionPending) return;
      const video = state.profileVideos.find(item => item.id === id);
      if (profileVideoDownloaded(video) && !(currentProfileSelection()?.mode === 'range' && !currentProfileSelection().end)) {
        checkbox.checked = false;
        return;
      }
      selectProfileVideos({type: 'pick', key: videoKey(video.url)}, video);
      return;
    }

    if (event.target.matches('#profile-quality-select')) {
      state.profileQuality = event.target.value;
      return;
    }

    if (event.target.matches('[data-output-format]')) {
      await updateOutputFormat(event.target.value);
    }
  });

  scroll.addEventListener('input', event => {
    if (event.target.matches('#profile-url-input')) {
      state.profileInputUrl = event.target.value;
      return;
    }
    if (event.target.matches('#profile-filter-input')) {
      state.profileSearchQuery = event.target.value;
      state.profileGridPage = 0;
      requestRender({resetProfileScroll: true});
    }
  });

  scroll.addEventListener('keydown', event => {
    if (event.key === 'Enter' && event.target.matches('#profile-url-input')) {
      const url = event.target.value.trim();
      if (url) scanProfile(url);
    }
  });
}

function bindHistoryEvents(scroll) {
  scroll.addEventListener('click', async event => {
    if (event.target.closest('#btn-clear-history')) {
      chrome.runtime.sendMessage({type: 'download-history-clear'}, response => {
        if (chrome.runtime.lastError || !response?.success) {
          showToast(chrome.runtime.lastError?.message || response?.error || 'Unable to clear history', 'error');
        }
      });
      return;
    }

    if (event.target.closest('#history-prev')) {
      state.historyPage -= 1;
      requestRender();
      return;
    }

    if (event.target.closest('#history-next')) {
      state.historyPage += 1;
      requestRender();
      return;
    }

    const emptyAction = event.target.closest('[data-empty-action]');
    if (emptyAction) {
      const action = emptyAction.dataset.emptyAction;
      if (action === 'clear-history-search') {
        state.historyQuery = '';
        state.historyPage = 0;
        requestRender();
      } else if (action === 'downloads') {
        state.activeTab = 'video';
        state.downloadView = 'detected';
        requestRender();
      }
      return;
    }

    const historyBtn = event.target.closest('[data-history-action]');
    if (historyBtn) {
      const record = state.history.find(item => item.id === historyBtn.dataset.id);
      if (!record) return;
      try {
        const message = historyBtn.dataset.historyAction === 'source'
          ? {type: 'open-video-page', url: record.pageUrl}
          : {type: 'open-download-item', downloadId: record.downloadId, url: record.url, fileName: record.fileName};
        const response = await chrome.runtime.sendMessage(message);
        if (!response?.success) throw Error(response?.error || 'Unable to open download');
      } catch (error) {
        showToast(error.message, 'error');
      }
      return;
    }

    const deleteBtn = event.target.closest('[data-action="delete-history"][data-id]');
    if (deleteBtn) {
      const recordId = deleteBtn.getAttribute('data-id');
      chrome.runtime.sendMessage({type: 'download-history-remove', recordId}, response => {
        if (chrome.runtime.lastError || !response?.success) {
          showToast(chrome.runtime.lastError?.message || response?.error || 'Unable to remove history', 'error');
        }
      });
    }
  });

  scroll.addEventListener('input', event => {
    if (event.target.matches('#history-search')) {
      state.historyQuery = event.target.value;
      state.historyPage = 0;
      requestRender();
    }
  });
}

function bindSettingsEvents(scroll) {
  scroll.addEventListener('click', async event => {
    if (event.target.closest('#btn-concurrency-minus')) {
      if (state.maxConcurrentTasks > 0) {
        state.maxConcurrentTasks -= 1;
        await settingsStorage.setMaxConcurrentTasks(state.maxConcurrentTasks);
        requestRender();
      }
      return;
    }

    if (event.target.closest('#btn-concurrency-plus')) {
      if (state.maxConcurrentTasks < 12) {
        state.maxConcurrentTasks += 1;
        await settingsStorage.setMaxConcurrentTasks(state.maxConcurrentTasks);
        requestRender();
      }
      return;
    }

    if (event.target.closest('#toggle-channel-folder, #tog-channel-folder')) {
      state.useChannelFolder = !state.useChannelFolder;
      await settingsStorage.setUseChannelFolder(state.useChannelFolder);
      requestRender();
      return;
    }

    if (event.target.closest('#toggle-thumbnails')) {
      try {
        await settingsStorage.setShowThumbnails(!state.showThumbnails);
      } catch (error) {
        showToast(error.message, 'error');
      }
      return;
    }

    if (event.target.closest('#btn-open-downloads-folder')) {
      chrome.runtime.sendMessage({type: 'open-downloads-folder'});
    }
  });

  scroll.addEventListener('change', async event => {
    if (event.target.matches('#output-format-select')) {
      await updateOutputFormat(event.target.value);
      return;
    }

    if (event.target.matches('#settings-pending-limit')) {
      try {
        state.maxPendingTasks = await settingsStorage.setMaxPendingTasks(event.target.value);
        requestRender();
      } catch (error) {
        showToast(error.message, 'error');
      }
      return;
    }

    if (event.target.matches('#settings-subdir-input')) {
      state.downloadSubdir = await settingsStorage.setDownloadSubdir(event.target.value);
    }
  });
}

export function bindEvents(app = document.querySelector('#app-container .App')) {
  if (!app) return;
  bindChromeEvents(app);
  const scroll = app.querySelector('.popup-scroll');
  if (!scroll) return;
  if (state.activeTab === 'video') bindVideoQueueEvents(scroll);
  else if (state.activeTab === 'profile') bindProfileEvents(scroll);
  else if (state.activeTab === 'history') bindHistoryEvents(scroll);
  else if (state.activeTab === 'settings') bindSettingsEvents(scroll);
}
