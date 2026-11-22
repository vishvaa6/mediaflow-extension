import {is91PornPage} from '../../../assets/js/porn91-media.js';
import {icon} from '../../../assets/js/icons.js';
import {createPopupSurface} from '../../../assets/js/popup-surface.js';
import {normalizeQueueLimit, normalizePendingLimit} from '../../../assets/js/queue-limits.js';
import {createLiquidWorkspace} from '../../../assets/js/liquid-workspace.js';
import {queueStorage, historyStorage, settingsStorage} from '../../../assets/js/storage.js';
import {
  state,
  isManagedPage,
  setRenderHandler,
  mergeDetectedVideos,
  refreshMediaDetection,
  applySavedSelection,
  applyProfileScan,
  scanProfile,
  updateProfileSelection,
  bindThumbnailFallbacks,
  updateDownloadedLabels,
  updateBatchControls,
  applyProfileBatch,
  taskStructureKey,
  getLastTaskStructureKey,
  markTasksRendered,
  seedRenderedProgressMarkup,
  stopRetryTimer,
  applyTasks
} from './state.js';
import {t, decodeHtmlEntities, escapeHtml} from './format.js';
import {renderVideoQueueTab} from './tabs/queue.js';
import {renderProfileTab} from './tabs/profile.js';
import {renderHistoryTab} from './tabs/history.js';
import {renderSettingsTab} from './tabs/settings.js';
import {bindEvents} from './events.js';

const popupSurface = createPopupSurface();
const liquidWorkspace = createLiquidWorkspace();

function renderTabContent() {
  if (state.activeTab === 'video') return renderVideoQueueTab();
  if (state.activeTab === 'profile') return renderProfileTab();
  if (state.activeTab === 'settings') return renderSettingsTab();
  if (state.activeTab === 'history') return renderHistoryTab();
  return '';
}

function render({resetProfileScroll = false} = {}) {
  markTasksRendered();
  const container = document.querySelector('#app-container');
  if (!container) return;

  const oldScroller = document.querySelector('.popup-scroll');
  if (oldScroller?.dataset.view) state.viewScroll[oldScroller.dataset.view] = oldScroller.scrollTop;
  if (resetProfileScroll) {
    state.profileListScroll = 0;
    state.profileDetailsCollapsed = false;
  } else if (document.querySelector('.profile-video-grid')) {
    state.profileListScroll = document.querySelector('.profile-video-grid').scrollTop;
  }

  const focused = document.activeElement;
  const focusId = focused?.id;
  const focusVideoId = focused?.dataset?.videoId;
  const selection = focused?.selectionStart;

  container.innerHTML = `
    <div class="App">
      <!-- Toasts Container -->
      <div class="toast-container-modern" role="status" aria-live="polite" aria-atomic="true">
        ${state.toasts.map(toast => `
          <div class="toast-item-modern ${toast.type}">
            <span>${icon(toast.type === 'success' ? 'check' : toast.type === 'error' ? 'triangle-alert' : 'info')}</span>
            <span>${escapeHtml(toast.text)}</span>
          </div>
        `).join('')}
      </div>

      <!-- Header -->
      <div class="popup-header-bar">
        <div class="popup-header-left">
          <img src="/icon-34.png" class="popup-header-logo" alt="Logo" />
          <div class="popup-header-titles">
            <span class="popup-header-title">MediaFlow</span>
            <span class="popup-header-status" title="${escapeHtml(state.activeDomain || 'No source tab')}"><span class="popup-header-dot"></span>${escapeHtml(state.activeDomain || 'Ready')}</span>
          </div>
        </div>

        <div class="popup-header-actions">
        ${popupSurface.surface === 'popup' || popupSurface.surface === 'overlay' ? `<button type="button" class="btn-icon-btn" id="btn-open-browser-tab" title="Open full view in a browser tab" aria-label="Open full view in a browser tab">${icon('arrow-up-right')}</button>` : ''}
        ${popupSurface.surface === 'overlay' ? `<button type="button" class="btn-icon-btn" id="btn-close-overlay" title="Close MediaFlow" aria-label="Close MediaFlow">${icon('x')}</button>` : ''}
        <select class="popup-lang-select" id="popup-lang-selector" aria-label="Interface language">
          <option value="en">English</option>
          <option value="zh_CN">简体中文</option>
          <option value="es">Español</option>
          <option value="hi">हिन्दी</option>
          <option value="ar">العربية</option>
        </select>
        </div>
      </div>

      <!-- Primary navigation -->
      <nav class="popup-tabs-bar" aria-label="MediaFlow views">
        <button type="button" class="popup-tab-btn ${state.activeTab === 'video' ? 'active' : ''}" id="tab-video" data-tab="video" aria-pressed="${state.activeTab === 'video'}">
          ${icon('download')} ${t('tabVideoQueue')}
          <span class="tab-badge">${state.tasks.length}</span>
        </button>
        <button type="button" class="popup-tab-btn ${state.activeTab === 'profile' ? 'active' : ''}" id="tab-profile" data-tab="profile" aria-pressed="${state.activeTab === 'profile'}">
          ${icon('user')} ${t('tabProfileVideos')}
          ${state.profileVideos.length ? `<span class="tab-badge">${state.profileVideos.length}</span>` : ''}
        </button>
        <button type="button" class="popup-tab-btn ${state.activeTab === 'settings' ? 'active' : ''}" id="tab-settings" data-tab="settings" aria-pressed="${state.activeTab === 'settings'}">
          ${icon('settings')} ${t('tabSettings')}
        </button>
        <button type="button" class="popup-tab-btn ${state.activeTab === 'history' ? 'active' : ''}" id="tab-history" data-tab="history" aria-pressed="${state.activeTab === 'history'}">${icon('history')} History <span class="tab-badge" data-role="history-count">${state.history.length}</span></button>
      </nav>

      <!-- Tab Content Area -->
      <div class="popup-scroll tab-${state.activeTab}" data-view="${state.activeTab === 'video' ? 'video-' + state.downloadView : state.activeTab}" tabindex="0" role="region" aria-label="${state.activeTab === 'video' ? 'Downloads' : state.activeTab === 'profile' ? 'Library' : state.activeTab === 'settings' ? 'Settings' : 'History'} content">
        ${renderTabContent()}
      </div>
      ${popupSurface.surface === 'popup' || popupSurface.surface === 'overlay' ? `<button type="button" class="popup-resize-handle ${popupSurface.surface === 'overlay' ? 'overlay-resize-handle' : ''}" id="btn-resize-popup" aria-label="Resize MediaFlow. Drag the corner or use arrow keys; press Home to reset." title="Resize MediaFlow">${icon('maximize-2')}</button>` : ''}
    </div>
  `;

  seedRenderedProgressMarkup();
  bindEvents(container.querySelector('.App'));
  liquidWorkspace.bind();
  popupSurface.bindResize(document.getElementById('btn-resize-popup'));
  bindThumbnailFallbacks();
  if (state.activeTab === 'profile') updateProfileSelection();
  updateBatchControls();

  const scroller = document.querySelector('.popup-scroll');
  if (scroller) scroller.scrollTop = state.activeTab === 'profile' ? 0 : state.viewScroll[scroller.dataset.view] || 0;
  const profileGrid = document.querySelector('.profile-video-grid');
  if (profileGrid) profileGrid.scrollTop = state.profileListScroll;

  const nextFocus = focusId
    ? document.getElementById(focusId)
    : focusVideoId
      ? [...document.querySelectorAll('.profile-video-checkbox')].find(node => node.dataset.videoId === focusVideoId)
      : null;
  if (nextFocus) {
    nextFocus.focus({preventScroll: true});
    if (typeof selection === 'number') nextFocus.setSelectionRange?.(selection, selection);
  }
}

setRenderHandler(render);

function applySettingsSnapshot(settings) {
  if (!settings) return;
  state.downloadSubdir = settings.downloadSubdir || '';
  state.useChannelFolder = settings.useChannelFolder !== false;
  state.maxConcurrentTasks = normalizeQueueLimit(settings.maxConcurrentTasks);
  state.maxPendingTasks = normalizePendingLimit(settings.maxPendingTasks);
  state.outputFormat = settings.outputFormat || 'mp4';
  state.showThumbnails = settings.showThumbnails !== false;
}

async function attachSourceTab(activeTab) {
  if (!activeTab) {
    render();
    return;
  }

  if (state.activeBrowserTabId !== activeTab.id || state.activePageUrl !== activeTab.url) {
    state.detectedVideos = [];
    state.hasSiteDetection = false;
    state.videoThumbnail = '';
    state.videoThumbnails = [];
    state.detectionError = '';
    state.detectionStatus = '';
  }
  state.activePageUrl = activeTab.url || '';
  state.activeBrowserTabId = activeTab.id;
  state.activePageTitle = decodeHtmlEntities(activeTab.title || '');
  state.customFilename = decodeHtmlEntities(activeTab.title || '');

  try {
    const urlObj = new URL(state.activePageUrl);
    state.activeDomain = urlObj.hostname.replace(/^www\./, '');
  } catch {}

  if (!isManagedPage(state.activePageUrl) && !is91PornPage(state.activePageUrl)) {
    chrome.tabs.sendMessage(activeTab.id, {command: 'get_video_info'}, res => {
      if (state.activeBrowserTabId !== activeTab.id || state.activePageUrl !== activeTab.url) return;
      if (!chrome.runtime.lastError && res && res.videoInfos?.length) {
        mergeDetectedVideos(res.videoInfos, true);
        state.videoThumbnail = res.thumbnail || res.videoInfos.find(video => video.thumbnail)?.thumbnail || state.videoThumbnail;
        state.videoThumbnails = res.thumbnails || [];
        if (res.pageTitle) {
          const decoded = decodeHtmlEntities(res.pageTitle);
          state.activePageTitle = decoded;
          state.customFilename = decoded;
        }
      }
      render();
    });
  }

  refreshMediaDetection();
  chrome.tabs.sendMessage(activeTab.id, {command: 'get_video_metadata'}, async metadata => {
    const error = chrome.runtime.lastError;
    if (state.activeBrowserTabId !== activeTab.id || state.activePageUrl !== activeTab.url) return;
    if (isManagedPage(state.activePageUrl)) return;
    if (error || !metadata?.thumbnail) {
      try {
        metadata = await chrome.runtime.sendMessage({type: 'ext-fetch-video-metadata', url: state.activePageUrl});
      } catch {
        return;
      }
    }
    if (metadata?.thumbnail) {
      state.videoThumbnail = metadata.thumbnail;
      state.videoThumbnails = metadata.thumbnails || [metadata.thumbnail];
      if (state.activeTab === 'video') render();
    }
  });

  if (
    /\/model\/|\/pornstar\/|\/channels\/|\/users\/|\/profiles\//i.test(state.activePageUrl) ||
    /xvideos\.com\/(profiles|channels|models)/i.test(state.activePageUrl) ||
    /xhamster\.com\/(users|creators|channels)/i.test(state.activePageUrl)
  ) {
    if (!state.profileVideos.length && !state.isScanningProfile && state.profileScanStatus !== 'cleared') {
      scanProfile(state.activePageUrl);
    }
  }
}

async function init() {
  await popupSurface.ready;
  document.title = t('popupTitle');
  window.addEventListener('pagehide', stopRetryTimer);

  chrome.runtime.onMessage?.addListener(message => {
    if (message.type === 'media-detection-updated' && message.tabId === state.activeBrowserTabId) {
      refreshMediaDetection();
    }
    if (message.type === 'mediaflow-source-changed' && chrome.tabs.get) {
      if (message.tabId == null) {
        state.detectedVideos = [];
        state.activeBrowserTabId = null;
        state.activeDomain = '';
        state.activePageUrl = '';
        render();
      } else {
        chrome.tabs.get(message.tabId).then(attachSourceTab).catch(() => {
          state.detectedVideos = [];
          render();
        });
      }
    }
    return false;
  });

  applySettingsSnapshot(await settingsStorage.get());

  settingsStorage.subscribe(() => {
    const snapshot = settingsStorage.getSnapshot();
    if (snapshot) {
      applySettingsSnapshot(snapshot);
      render();
    }
  });

  const queueState = await queueStorage.get();
  if (queueState?.tasks) state.tasks = queueState.tasks;

  queueStorage.subscribe(() => {
    const qs = queueStorage.getSnapshot();
    if (qs?.tasks) applyTasks(qs.tasks);
  });

  // Direct storage listener + polling fallback so progress always updates live
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.profileScanState) applyProfileScan(changes.profileScanState.newValue);
    if (area === 'local' && changes.profileSelectionState) applySavedSelection(changes.profileSelectionState.newValue);
    if (area === 'local' && changes.profileBatchState) applyProfileBatch(changes.profileBatchState.newValue);
  });

  setInterval(async () => {
    try {
      const result = await chrome.storage.local.get('downloadQueueState');
      const tasks = result?.downloadQueueState?.tasks || [];
      if (
        tasks.some(task => task.status === 'downloading' || task.status === 'retrying' || task.status === 'queued') ||
        taskStructureKey(tasks) !== getLastTaskStructureKey()
      ) {
        applyTasks(tasks);
      }
    } catch {}
  }, 2000);

  const hist = await historyStorage.get();
  if (hist?.records) state.history = hist.records;

  historyStorage.subscribe(() => {
    const hs = historyStorage.getSnapshot();
    if (hs?.records) {
      state.history = hs.records;
      updateBatchControls();
      updateProfileSelection();
      document.querySelectorAll('[data-role="history-count"]').forEach(node => { node.textContent = state.history.length; });
      if (state.activeTab === 'video' || state.activeTab === 'history') render();
      else updateDownloadedLabels();
    }
  });

  const savedProfile = await chrome.storage.local.get(['profileScanState', 'profileSelectionState']);
  state.profileSelection = savedProfile.profileSelectionState || null;
  applyProfileScan(savedProfile.profileScanState);
  applyProfileBatch((await chrome.storage.local.get('profileBatchState')).profileBatchState);

  let source;
  let sourceWindowId;
  try { sourceWindowId = (await chrome.windows?.getCurrent?.())?.id; } catch {}
  try { source = await chrome.runtime.sendMessage({type: 'mediaflow-source-tab', windowId: sourceWindowId}); } catch {}
  if (source?.tab) await attachSourceTab(source.tab);
  else chrome.tabs.query({active: true, windowType: 'normal'}, tabs => attachSourceTab(tabs[0]));

  render();
}

init();

if (popupSurface.surface === 'popup' && chrome.action?.setPopup) {
  chrome.tabs.query({active: true, currentWindow: true}, tabs => {
    if (tabs?.[0]?.id != null) chrome.action.setPopup({tabId: tabs[0].id, popup: ''}).catch(() => {});
  });
}
