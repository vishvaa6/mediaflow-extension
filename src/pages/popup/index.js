import {formatSpeed} from '../../../assets/js/speed.js';
import {downloadedRecord,sortQualities,profileKey,videoKey} from '../../../assets/js/video-details.js';
import {selectionView,changeSelection,rangeHint} from '../../../assets/js/profile-selection.js';
import {mediaHeaders} from '../../../assets/js/media-headers.js';
import {
  i as sanitizeSubdir,
  o as queueStorage,
  r as getUseChannelFolder,
  s as historyStorage,
  t as settingsStorage
} from "../../../assets/js/downloadSettingsStorage.CsrP3JcJ.js";

// Localization helper
function t(key, substitutions) {
  try {
    const msg = chrome.i18n.getMessage(key, substitutions);
    if (msg) return msg;
  } catch (e) {}

  const fallbacks = {
    popupHeaderTitle: "MediaFlow Pro",
    tabVideoQueue: "Video & Queue",
    tabProfileVideos: "Profile Videos",
    tabSettings: "Settings",
    popupQualityLabel: "Quality",
    popupTypeLabel: "Type",
    popupActionDownload: "Download",
    popupActionDownloading: "Downloading…",
    popupActionQueued: "Queued…",
    popupActionPaused: "Paused",
    popupFilenameLabel: "Filename",
    popupFilenamePlaceholder: "Leave empty to auto-generate",
    downloadSubdirLabel: "Download Subdirectory",
    downloadSubdirPlaceholder: "MediaFlow/",
    channelFolderLabel: "Treat / as a folder",
    channelFolderHint: "Organize downloads into creator/profile folders",
    queueTitle: "Download Queue",
    queueMetaDownloading: "$1 downloading",
    queueMetaQueued: "$1 queued",
    queueMetaPaused: "$1 paused",
    queueActionClearQueued: "Clear Queued",
    queueActionClearErrors: "Clear Errors",
    historyTitle: "Download History ($1)",
    historyActionClear: "Clear All",
    profileTabTitle: "Creator Profile Batch Downloader",
    profileTabDesc: "Batch download all videos from a specific creator or model profile",
    profileInputPlaceholder: "Paste creator / model profile URL...",
    profileAnalyzeBtn: "Fetch Videos",
    profileAnalyzing: "Scanning...",
    profileSelectAll: "Select All",
    profileDeselectAll: "Clear",
    profileSelectedCount: "$1 selected",
    profileQualityLabel: "Preferred Quality",
    profileFolderLabel: "Save in creator folder",
    profileDownloadSelected: "Batch Download ($1)",
    profileNoVideosFound: "No profile videos detected yet. Navigate to a creator profile page or paste the URL above.",
    profileBatchSuccess: "Enqueued $1 profile videos!",
    settingsMaxConcurrent: "Queue Concurrency Limit",
    settingsMaxConcurrentHint: "Number of simultaneous active downloads (Default: 6). Higher values increase concurrency but use more bandwidth.",
    toastDownloadComplete: "Download completed: $1",
    toastDownloadFailed: "Download failed: $1",
    toastEnqueued: "Added to download queue",
    toastTaskDeleted: "Task removed from queue"
  };

  let str = fallbacks[key] || key;
  if (substitutions) {
    const subs = Array.isArray(substitutions) ? substitutions : [substitutions];
    subs.forEach((sub, idx) => {
      str = str.replace(new RegExp(`\\$${idx + 1}`, 'g'), String(sub));
    });
  }
  return str;
}

// Format bytes
function formatBytes(bytes) {
  if (!Number.isFinite(Number(bytes)) || bytes <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(sizes.length-1,Math.max(0,Math.floor(Math.log(bytes) / Math.log(k))));
  return (bytes / Math.pow(k, i)).toFixed(1) + ' ' + sizes[i];
}

// Decode HTML entities
function decodeHtmlEntities(str) {
  if (!str) return '';
  return str
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/-quot;/g, '')
    .replace(/&#(\d+);/g, (match, dec) => String.fromCharCode(dec));
}

// Sanitize filename helper (safe for Windows, macOS, Linux)
function cleanFileName(str, useFolder = true) {
  if (!str) return 'video';
  let s = decodeHtmlEntities(String(str)).trim();
  s = s.replace(/\.(mp4|m4v|webm|mkv|mov|ts|m3u8)$/i, '');
  
  const parts = s.split(/[\/\\]+/).map(part => {
    let p = part
      .replace(/[<>:"|?*~#%&{}+\x00-\x1F]/g, ' ')
      .replace(/[.\s]+$/g, '')
      .replace(/^[.\s]+/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    return p.length > 90 ? p.slice(0, 90).trim() : p;
  }).filter(Boolean);

  if (!parts.length) return 'video';
  return useFolder ? parts.join('/') : parts.join(' - ');
}

// Normalize format based on URL and format string
function normalizeFormat(format, url) {
  const fmt = String(format || '').toLowerCase().trim();
  const u = String(url || '').toLowerCase();
  if (fmt === 'm3u8' || fmt === 'hls' || u.includes('.m3u8') || u.includes('/hls/')) {
    return 'm3u8';
  }
  if (fmt === 'webm' || u.includes('.webm')) {
    return 'webm';
  }
  return 'mp4';
}

// App State
const state = {
  activeTab: 'video', // 'video' | 'profile' | 'settings'
  activePageUrl: '',
  activeBrowserTabId:null,
  activePageTitle: '',
  activeDomain: '',
  detectedVideos: [],
  hasSiteDetection:false,
  videoThumbnail:'',videoThumbnails:[],showThumbnails:true,
  historyQuery:'',historyPage:0,
  profileBatchId:'',profileBatchKey:'',profileBatchStatus:'',isCancellingBatch:false,
  customFilename: '',
  downloadSubdir: '',
  useChannelFolder: true,
  maxConcurrentTasks: 6,
  tasks: [],
  history: [],
  // Profile state
  profileName: '',
  profileUrl: '',
  profileAvatar: '',
  profileVideos: [],
  selectedIds: new Set(),
  profileSelection:null,
  selectionPending:0,
  profileQuality: 'best',
  isScanningProfile: false,
  isClearingProfile:false,
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

// Toast manager
function showToast(text, type = 'info') {
  const id = Date.now() + Math.random().toString(36).slice(2, 6);
  state.toasts.push({ id, text, type });
  render();
  setTimeout(() => {
    state.toasts = state.toasts.filter(t => t.id !== id);
    render();
  }, 4000);
}

const thumbnailCache = new Map();
function mergeDetectedVideos(videos,fromSite=false) {
  if(!Array.isArray(videos) || !videos.length)return;
  if(fromSite)state.hasSiteDetection=true;
  if(!fromSite && state.hasSiteDetection)videos=videos.filter(video=>state.detectedVideos.some(current=>current.videoUrl===video.videoUrl));
  if(!videos.length)return;
  const map=new Map((fromSite ? [] : state.detectedVideos).map(video=>[video.videoUrl,video]));
  for(const video of videos){
    if(!video?.videoUrl || !/^https?:/.test(video.videoUrl))continue;
    const old=map.get(video.videoUrl);
    map.set(video.videoUrl,old ? {...video,...old,headers:old.headers || video.headers,quality:old.quality==='Auto'?video.quality:old.quality} : video);
  }
  const next=sortQualities([...map.values()]);
  if(JSON.stringify(next)!==JSON.stringify(state.detectedVideos)){state.detectedVideos=next;if(state.activeTab==='video')render();}
}
async function refreshMediaDetection() {
  if(state.activeBrowserTabId==null)return;
  chrome.tabs.sendMessage(state.activeBrowserTabId,{command:'get_generic_video_info'},result=>{
    if(!chrome.runtime.lastError)mergeDetectedVideos(result?.videoInfos);
  });
  try{const result=await chrome.runtime.sendMessage({type:'media-detection-snapshot',tabId:state.activeBrowserTabId,pageUrl:state.activePageUrl});mergeDetectedVideos(result?.videoInfos);}catch{}
}
const pendingTaskActions = new Set();
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
}
function profileVideoDownloaded(video) {return !!video && !!downloadedRecord(state.history,video.url,video.videoUrl);}
function currentProfileSelection() {return state.profileSelection?.profileKey === profileKey(state.profileUrl) ? state.profileSelection : null;}
function profileSelectionView() {return selectionView(state.profileVideos,currentProfileSelection(),state.history);}
function syncSelectedIds() {state.selectedIds=new Set(profileSelectionView().videos.map(video => video.id));}
function applySavedSelection(selection) {state.profileSelection=selection || null;updateProfileSelection();}
async function selectProfileVideos(action,video) {
  const key=profileKey(state.profileUrl);
  state.selectionPending++;
  state.profileSelection={...changeSelection(currentProfileSelection(),action,state.profileVideos,state.history),profileKey:key,profileUrl:state.profileUrl};
  updateProfileSelection();
  try {
    const response=await chrome.runtime.sendMessage({type:'profile-selection-update',profileUrl:state.profileUrl,action,video});
    if(!response?.success)throw Error(response?.error || 'Unable to save selection');
    if(response.selection)applySavedSelection(response.selection);
  }catch(error){showToast(error.message,'error');}
  finally{state.selectionPending--;updateProfileSelection();}
}
function applyProfileScan(scan) {
  if (!scan) return;
  if(scan.status==='cleared')for(const video of state.profileVideos)thumbnailCache.delete(video.id);
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
  if (!same) state.profileGridPage = 0;
  if (state.activeTab === 'profile') render();
}
async function scanProfile(value) {
  if (state.isScanningProfile || state.isBatchEnqueuing || state.isClearingProfile) return;
  try {
    const url = new URL(value || state.activePageUrl);
    if (!/^https?:$/.test(url.protocol)) throw Error('Enter a valid http or https profile URL');
    state.profileInputUrl = url.href;
    state.isScanningProfile = true;
    state.profileScanError = '';
    render();
    const response = await chrome.runtime.sendMessage({type:'profile-scan-start',url:url.href});
    if (!response?.success) throw Error(response?.error || 'Could not start profile scan');
  } catch (error) {
    state.isScanningProfile = false;
    showToast(error.message,'error');
  }
}
function updateProfileSelection() {
  syncSelectedIds();
  const selection=currentProfileSelection(),view=profileSelectionView();
  const picking=selection?.mode==='range' && !selection.end;
  for (const card of document.querySelectorAll('.profile-video-card')) {
    const selected = state.selectedIds.has(card.dataset.videoId);
    card.classList.toggle('selected', selected);
    const checkbox=card.querySelector('input');
    checkbox.checked = selected;
    const video=state.profileVideos.find(video => video.id===card.dataset.videoId);
    checkbox.disabled=state.isBatchEnqueuing || !!state.selectionPending || !picking && profileVideoDownloaded(video);
    card.querySelector('.profile-selection-tick').hidden=!selected;
    const boundary=card.querySelector('.profile-range-boundary');
    boundary.textContent=selection?.mode==='range' ? [selection.start===videoKey(video?.url)?'Start':'',selection.end===videoKey(video?.url)?'End':''].filter(Boolean).join(' / ') : '';
    boundary.hidden=!boundary.textContent;
  }
  const count = document.querySelector('[data-role="profile-selection-count"]');
  if (count) count.textContent = state.selectedIds.size + ' / ' + state.profileVideos.length + ' selected';
  const button = document.querySelector('#btn-batch-download');
  if (button) { button.textContent = '⬇ Batch Download (' + state.selectedIds.size + ')'; button.disabled = !state.selectedIds.size || state.isBatchEnqueuing || state.isScanningProfile || !view.complete || !!state.selectionPending; }
  const range=document.querySelector('#btn-profile-range');
  if(range){range.disabled=state.isBatchEnqueuing || !!state.selectionPending;range.setAttribute('aria-pressed',String(picking));}
  const hint=document.querySelector('[data-role="profile-range-hint"]');
  if(hint)hint.textContent=rangeHint(selection,view);
  const newCount=state.profileVideos.filter(video => !profileVideoDownloaded(video)).length;
  const selectNew=document.querySelector('#btn-profile-select-all');
  if(selectNew)selectNew.disabled=state.isBatchEnqueuing || !newCount;
  const stats=document.querySelector('.profile-stats-text');
  if(stats && state.profileVideos.length)stats.textContent=`${state.profileVideos.length} videos · ${newCount} new · ${state.profileVideos.length-newCount} already downloaded`;
}
function bindThumbnailFallbacks() {
  if(!state.showThumbnails)return;
  const items=[...state.profileVideos,...state.history.map(record => ({...record,id:'history:'+record.id,url:record.pageUrl || record.url})),currentVideoThumbnail()];
  document.querySelectorAll('img[data-thumbnail-id]').forEach(img => {
    const video = items.find(video => video.id === img.dataset.thumbnailId);
    if (!video) return;
    const candidates = [...new Set([video.thumbnail, ...(video.thumbnails || [])].filter(Boolean))];
    let index = Math.max(0,candidates.indexOf(img.getAttribute('src')));
    let fetching = false;
    img.addEventListener('load', () => { img.classList.add('loaded'); thumbnailCache.set(video.id,img.getAttribute('src')); });
    img.addEventListener('error', async () => {
      if (fetching || !state.showThumbnails || !img.isConnected) return;
      if (++index < candidates.length) { img.src = candidates[index]; return; }
      fetching = true;
      for (const url of candidates) {
        try {
          const response = await chrome.runtime.sendMessage({type:'ext-fetch-image',url,pageUrl:video.url});
          if(!state.showThumbnails || !img.isConnected)return;
          if (response?.ok && response.dataUrl) { thumbnailCache.set(video.id,response.dataUrl); img.src=response.dataUrl; return; }
        } catch {}
      }
      img.hidden = true;
      img.parentElement?.classList.add('thumbnail-unavailable');
    });
  });
}
function currentVideoThumbnail(){return {id:'current',url:state.activePageUrl,title:state.activePageTitle,thumbnail:state.videoThumbnail,thumbnails:state.videoThumbnails};}
function thumbnailHtml(video,className) {
  if(!state.showThumbnails)return '';
  const url=thumbnailCache.get(video.id) || video.thumbnail || video.thumbnails?.[0];
  return url ? `<img src="${escapeHtml(url)}" data-thumbnail-id="${escapeHtml(video.id)}" class="${className}" loading="lazy" decoding="async" referrerpolicy="no-referrer" alt="${escapeHtml(video.title || '')}" />` : '<span class="thumbnail-placeholder">Thumbnail unavailable</span>';
}
function downloadedLabel(pageUrl,streamUrl='') {
  return `<span class="already-downloaded" data-downloaded-page="${escapeHtml(pageUrl)}" data-downloaded-stream="${escapeHtml(streamUrl)}" ${downloadedRecord(state.history,pageUrl,streamUrl)?'':'hidden'}>✓ Already downloaded</span>`;
}
function updateDownloadedLabels() {
  document.querySelectorAll('[data-downloaded-page]').forEach(label => {label.hidden=!downloadedRecord(state.history,label.dataset.downloadedPage,label.dataset.downloadedStream);});
}
function currentBatchProfileKey(){return state.profileUrl?profileKey(state.profileUrl,state.profileName):state.profileBatchKey;}
function profileBatchTasks(){const key=currentBatchProfileKey();return state.tasks.filter(task => task.batchId && (task.batchProfileKey===key || (state.profileBatchKey===key && task.batchId===state.profileBatchId)));}
function updateBatchControls(){
  const button=document.querySelector('#btn-cancel-profile-batch');
  if(!button)return;
  const count=profileBatchTasks().length;
  const running=state.isBatchEnqueuing && state.profileBatchKey===currentBatchProfileKey();
  button.hidden=!(count || running || state.isCancellingBatch);
  button.disabled=state.isCancellingBatch;
  button.textContent=state.isCancellingBatch?'Cancelling…':`Cancel batch & downloads${count ? ' ('+count+')' : ''}`;
}

function applyProfileBatch(batch) {
  if (!batch) return;
  const wasRunning = state.isBatchEnqueuing;
  state.profileBatchId=batch.id || '';
  state.profileBatchKey=batch.profileKey || '';
  state.profileBatchStatus=batch.status;
  state.isCancellingBatch=batch.status==='cancelling';
  state.isBatchEnqueuing = batch.status === 'running' || batch.status==='cancelling';
  state.batchProgress = batch.status === 'running'
    ? 'Resolving ' + (batch.processed+1) + ' / ' + batch.total + ': ' + (batch.currentTitle || '')
    : batch.status==='cancelling'?'Cancelling batch and its downloads…':batch.status==='cancelled'?'Batch cancelled · '+(batch.cancelled || 0)+' pending downloads removed'
    : batch.enqueued + ' queued' + (batch.skipped ? ' · '+batch.skipped+' already downloaded, skipped' : '') + ' · ' + batch.failed + ' failed' + (batch.error ? ' · ' + batch.error : '');
  if (wasRunning && !state.isBatchEnqueuing) showToast(state.batchProgress,batch.failed || batch.error ? 'warning' : 'success');
  else if (state.activeTab === 'profile') {
    const progress = document.querySelector('[data-role="batch-progress"]');
    if (wasRunning === state.isBatchEnqueuing && progress) progress.textContent = state.batchProgress;
    else render();
  }
  updateBatchControls();
}
async function batchDownloadProfileVideos() {
  if (state.isBatchEnqueuing || state.isScanningProfile || state.selectionPending || !profileSelectionView().complete) return;
  const videos = state.profileVideos.filter(video => state.selectedIds.has(video.id) && !profileVideoDownloaded(video));
  if (!videos.length) { showToast('Select at least one new video. Downloaded videos are skipped.','info'); return; }
  state.isBatchEnqueuing = true;
  state.batchProgress = 'Starting batch…';
  render();
  try {
    const response = await chrome.runtime.sendMessage({type:'profile-batch-start',videos,quality:state.profileQuality,profileName:state.profileName,profileUrl:state.profileUrl,useChannelFolder:state.useChannelFolder});
    if (!response?.success) throw Error(response?.error || 'Could not start batch');
    state.profileBatchId=response.batchId || state.profileBatchId;
  } catch (error) { state.isBatchEnqueuing = false; showToast(error.message,'error'); }
}

// Main Render Function
// ---- Live progress helpers ----
function taskStatusLabel(task) {
  if (task.status === 'paused' || task.status === 'queued' || task.status === 'error') return task.status;
  if (task.isFileDownloading) return 'Saving…';
  if (task.status === 'downloading' && !(task.progress > 0)) return 'Starting…';
  return task.status;
}

function taskProgressNumsHtml(task) {
  const progress = Math.min(100, Math.round(task.progress || 0));
  const isDownloading = task.status === 'downloading';
  const spd = task.downloadSpeed ?? task.speed ?? 0;
  const speed = task.speedFormatted || (typeof spd === 'string' ? spd : formatSpeed(Number(spd)));
  const bytes = task.fetchedBytes || task.cachedBytes || 0;
  return `
    <span>${progress}%</span>
    ${task.targetSegment > 1 ? `<span>(${task.finishNum || 0}/${task.targetSegment})</span>` : ''}
    ${bytes > 0 ? `<span>${formatBytes(bytes)}</span>` : ''}
    ${isDownloading && !task.isFileDownloading && speed ? `<span class="task-speed-badge">⚡ ${escapeHtml(speed)}</span>` : ''}
  `;
}

// Signature of things that require a full re-render (task set / status changes)
function taskStructureKey(tasks) {
  return (tasks || []).map(t => `${t.id}:${t.status}:${!!t.isFileDownloading}:${t.error || ''}`).join('|');
}
let lastTaskStructureKey = '';

// Apply new task list: patch progress in place when possible, else full render
function applyTasks(tasks) {
  state.tasks = tasks || [];
  const key = taskStructureKey(state.tasks);
  const list = document.querySelector('.queue-items-list');
  if (state.activeTab !== 'video') {
    const badge = document.querySelector('[data-tab="video"] .tab-badge');
    if (badge) badge.textContent = state.tasks.length;
    updateBatchControls();
    return;
  }
  if (key !== lastTaskStructureKey || !list) {
    lastTaskStructureKey = key;
    render();
    return;
  }
  for (const task of state.tasks) {
    const card = [...list.querySelectorAll('[data-task-id]')].find(card => card.dataset.taskId === String(task.id));
    if (!card) { render(); return; }
    const progress = Math.min(100, Math.round(task.progress || 0));
    const bar = card.querySelector('[data-role="bar"]');
    if (bar) bar.style.width = `${progress}%`;
    const nums = card.querySelector('[data-role="nums"]');
    if (nums) nums.innerHTML = taskProgressNumsHtml(task);
    const st = card.querySelector('[data-role="status"]');
    if (st) st.textContent = taskStatusLabel(task);
  }
}

function render() {
  lastTaskStructureKey = taskStructureKey(state.tasks);
  const container = document.querySelector('#app-container');
  if (!container) return;

  const scroll = document.querySelector('.popup-scroll')?.scrollTop || 0;
  const focused = document.activeElement;
  const focusId = focused?.id;
  const selection = focused?.selectionStart;
  container.innerHTML = `
    <div class="App">
      <!-- Toasts Container -->
      <div class="toast-container-modern">
        ${state.toasts.map(toast => `
          <div class="toast-item-modern ${toast.type}">
            <span>${toast.type === 'success' ? '✓' : toast.type === 'error' ? '✕' : 'ℹ'}</span>
            <span>${escapeHtml(toast.text)}</span>
          </div>
        `).join('')}
      </div>

      <!-- Header -->
      <div class="popup-header-bar">
        <div class="popup-header-left">
          <img src="/icon-34.png" class="popup-header-logo" alt="Logo" />
          <div class="popup-header-titles">
            <div class="popup-header-title-row">
              <span class="popup-header-title">MediaFlow Pro</span>
              <span class="popup-header-badge">v${escapeHtml(chrome.runtime.getManifest?.()?.version || '1.0.0')}</span>
            </div>
            <span class="popup-header-status">
              <span class="popup-header-dot"></span>
              ${state.activeDomain ? state.activeDomain : 'Active'}
            </span>
          </div>
        </div>

        <select class="popup-lang-select" id="popup-lang-selector">
          <option value="en">English</option>
          <option value="zh_CN">简体中文</option>
          <option value="es">Español</option>
          <option value="hi">हिन्दी</option>
          <option value="ar">العربية</option>
        </select>
      </div>

      <!-- Navigation Tabs -->
      <div class="popup-tabs-bar">
        <button class="popup-tab-btn ${state.activeTab === 'video' ? 'active' : ''}" data-tab="video">
          📥 ${t('tabVideoQueue')}
          ${state.tasks.length ? `<span class="tab-badge">${state.tasks.length}</span>` : ''}
        </button>
        <button class="popup-tab-btn ${state.activeTab === 'profile' ? 'active' : ''}" data-tab="profile">
          👤 ${t('tabProfileVideos')}
          ${state.profileVideos.length ? `<span class="tab-badge">${state.profileVideos.length}</span>` : ''}
        </button>
        <button class="popup-tab-btn ${state.activeTab === 'settings' ? 'active' : ''}" data-tab="settings">
          ⚙️ ${t('tabSettings')}
        </button>
        <button class="popup-tab-btn ${state.activeTab === 'history' ? 'active' : ''}" data-tab="history">📂 History <span class="tab-badge" data-role="history-count">${state.history.length}</span></button>
      </div>

      <!-- Tab Content Area -->
      <div class="popup-scroll">
        ${renderTabContent()}
      </div>
    </div>
  `;

  bindEvents();
  bindThumbnailFallbacks();
  updateProfileSelection();
  updateBatchControls();
  const scroller = document.querySelector('.popup-scroll');
  if (scroller) scroller.scrollTop = scroll;
  const nextFocus = focusId && document.getElementById(focusId);
  if (nextFocus) { nextFocus.focus({preventScroll:true}); if (typeof selection === 'number') nextFocus.setSelectionRange?.(selection, selection); }
}

// Render Content by Tab
function renderTabContent() {
  if (state.activeTab === 'video') return renderVideoQueueTab();
  if (state.activeTab === 'profile') return renderProfileTab();
  if (state.activeTab === 'settings') return renderSettingsTab();
  if (state.activeTab === 'history') return renderHistoryTab();
  return '';
}

// TAB 1: Video & Queue View
function renderVideoQueueTab() {
  const downloadingCount = state.tasks.filter(t => t.status === 'downloading').length;
  const queuedCount = state.tasks.filter(t => t.status === 'queued').length;
  const erroredCount = state.tasks.filter(t => t.status === 'error').length;

  return `
    <!-- Current Video Detection -->
    <button class="btn-pill-action" id="btn-refresh-detection">Refresh video detection</button>
    ${state.detectedVideos.length ? `
      <div class="video-detected-box">
        <div class="section-title">🎬 Current Video Detected</div>
        ${state.showThumbnails?`<div class="current-video-thumbnail">${thumbnailHtml(currentVideoThumbnail(),'current-thumbnail-img')}</div>`:''}
        ${downloadedLabel(state.activePageUrl,state.detectedVideos[0]?.videoUrl)}
        <div class="video-detected-title" title="${escapeHtml(state.customFilename || state.activePageTitle)}">
          ${escapeHtml(state.customFilename || state.activePageTitle || 'Video detected')}
        </div>
        <div class="video-detected-filename-row">
          <input type="text" class="filename-input" id="filename-editor-input" 
                 value="${escapeHtml(state.customFilename)}" placeholder="${t('popupFilenamePlaceholder')}" />
        </div>
        <div class="qualities-list">
          ${state.detectedVideos.map((video, idx) => {
            const isAlreadyQueued = state.tasks.some(task => task.url === video.videoUrl && task.status !== 'error');
            const qualDisplay = Array.isArray(video.quality) ? video.quality[0] : (video.quality || 'Auto');
            const fmtDisplay = normalizeFormat(video.format, video.videoUrl);

            return `
              <div class="quality-row">
                <div class="quality-info">
                  <span class="quality-badge">${escapeHtml(qualDisplay)}</span>
                  <span class="format-badge">${escapeHtml(fmtDisplay)}</span>
                </div>
                <button class="btn-download-action" data-download-index="${idx}" ${isAlreadyQueued ? 'disabled' : ''}>
                  ${isAlreadyQueued ? '✓ In Queue' : `⬇ ${t('popupActionDownload')}`}
                </button>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    ` : `
      <div class="card-section">
        <div class="empty-state-box">
          <div class="empty-state-icon">🎥</div>
          <div class="empty-state-text">
            Start video playback, then refresh detection. HTML5 MP4/WebM, HLS and supported embedded players can be detected. DRM-protected streams are not supported.
          </div>
        </div>
      </div>
    `}

    <!-- Download Queue Section -->
    <div class="card-section">
      <div class="section-header-row">
        <div class="section-title">
          <span>⚡</span>
          <span>${t('queueTitle')}</span>
          <span style="font-size:11px;font-weight:500;color:var(--text-muted);margin-left:4px;">
            (${downloadingCount} active / ${queuedCount} queued)
          </span>
        </div>
        <div class="queue-header-actions">
          ${queuedCount > 0 ? `<button class="btn-text-sm" id="btn-clear-queued">${t('queueActionClearQueued')}</button>` : ''}
          ${erroredCount > 0 ? `<button class="btn-text-sm" id="btn-clear-errors" style="color:var(--accent-rose);font-weight:600;">Clear ${erroredCount} Errors</button>` : ''}
        </div>
      </div>

      ${state.tasks.length ? `
        <div class="queue-items-list">
          ${state.tasks.map(task => {
            const isDownloading = task.status === 'downloading';
            const isPaused = task.status === 'paused';
            const isError = task.status === 'error';
            const progress = Math.min(100, Math.round(task.progress || 0));

            return `
              <div class="task-card-modern status-${escapeHtml(task.status)}" data-task-id="${escapeHtml(task.id)}">
                <div class="task-row-top">
                  <span class="task-title" title="${escapeHtml(task.fileName)}">${escapeHtml(cleanFileName(task.fileName, false) || 'video')}</span>
                  <span class="task-status-pill ${escapeHtml(task.status)}" data-role="status">
                    ${escapeHtml(taskStatusLabel(task))}
                  </span>
                </div>

                <div class="task-meta-row">
                  <div class="task-progress-nums" data-role="nums">
                    ${taskProgressNumsHtml(task)}
                  </div>
                  <div class="task-actions">
                    ${isDownloading || task.status === 'queued' ? `
                      <button class="btn-icon-btn" data-action="pause" data-id="${escapeHtml(task.id)}" title="Pause">⏸</button>
                    ` : isPaused ? `
                      <button class="btn-icon-btn" data-action="resume" data-id="${escapeHtml(task.id)}" title="Resume">▶</button>
                    ` : isError ? `
                      <button class="btn-icon-btn" data-action="retry" data-id="${escapeHtml(task.id)}" title="Retry" style="color:#38bdf8;">🔄</button>
                    ` : ''}
                    <button class="btn-icon-btn" data-action="delete" data-id="${escapeHtml(task.id)}" title="Remove">✕</button>
                  </div>
                </div>

                ${isError ? `
                  <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;background:rgba(244,63,94,0.12);border:1px solid rgba(244,63,94,0.3);border-radius:6px;padding:6px 10px;margin-top:6px;">
                    <span style="color:#fb7185;font-size:11px;font-weight:500;word-break:break-word;flex:1;">
                      ⚠️ ${escapeHtml(task.error || 'Download interrupted or connection dropped')}
                    </span>
                    <button class="btn-text-sm" data-action="retry" data-id="${escapeHtml(task.id)}" style="color:#38bdf8;font-size:11px;font-weight:600;padding:3px 8px;background:rgba(56,189,248,0.18);border:1px solid rgba(56,189,248,0.35);border-radius:4px;cursor:pointer;white-space:nowrap;">
                      🔄 Retry
                    </button>
                  </div>
                ` : ''}

                <div class="task-progress-bar-bg">
                  <div class="task-progress-bar-fill" data-role="bar" style="width: ${progress}%;"></div>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      ` : `
        <div style="text-align:center;padding:12px;color:var(--text-dim);font-size:11px;">
          Download queue is empty
        </div>
      `}
    </div>

    ${state.history.length?'<button class="btn-pill-action history-shortcut" id="btn-view-history">View download history ('+state.history.length+')</button>':''}
  `;
}

// TAB 2: Profile Videos View
function renderProfileTab() {
  const selectedCount = state.selectedIds.size;
  const totalCount = state.profileVideos.length;
  const newCount=state.profileVideos.filter(video => !profileVideoDownloaded(video)).length;
  const pageSize = 60;
  const pageCount = Math.max(1,Math.ceil(totalCount / pageSize));
  state.profileGridPage = Math.min(state.profileGridPage,pageCount-1);
  const visibleVideos = state.profileVideos.slice(state.profileGridPage*pageSize,(state.profileGridPage+1)*pageSize);

  return `
    <!-- Creator Profile Header Banner -->
    <div class="profile-banner">
      <div class="profile-avatar-circle">
        ${state.showThumbnails && state.profileAvatar ? `<img src="${escapeHtml(state.profileAvatar)}" class="profile-avatar-img" referrerpolicy="no-referrer" />` : (state.profileName ? escapeHtml(state.profileName.charAt(0).toUpperCase()) : '👤')}
      </div>
      <div class="profile-info">
        <div class="profile-name-text">${escapeHtml(state.profileName || 'Creator Profile')}</div>
        <div class="profile-stats-text">
          ${totalCount ? `${totalCount} videos · ${newCount} new · ${totalCount-newCount} already downloaded` : 'Enter a creator/model profile URL to scan'}
        </div>
      </div>
    </div>

    <!-- Profile URL / Search Bar -->
    <div class="profile-search-row">
      <input type="text" class="profile-search-input" id="profile-url-input" 
             value="${escapeHtml(state.profileInputUrl || state.profileUrl || '')}" placeholder="${t('profileInputPlaceholder')}" />
      <button class="btn-fetch-profile" id="btn-fetch-profile-videos" ${state.isScanningProfile || state.isBatchEnqueuing || state.isClearingProfile ? 'disabled' : ''}>
        ${state.isScanningProfile ? `⏳ ${t('profileAnalyzing')}` : `🔍 ${t('profileAnalyzeBtn')}`}
      </button>
      <button class="btn-pill-action" id="btn-clear-profile-results" ${state.isClearingProfile || !(totalCount || state.isScanningProfile || state.profileName || state.profileScanError)?'disabled':''}>${state.isClearingProfile?'Clearing…':'Clear results'}</button>
    </div>

    <div class="profile-scan-status" role="status">
      ${state.isScanningProfile ? 'Scanning every linked videos page… ' : state.profileScanStatus === 'complete' ? 'Scan complete. ' : ''}
      ${state.profilePagesScanned ? state.profilePagesScanned + ' pages scanned · ' + totalCount + ' unique videos' : ''}
      ${state.isScanningProfile ? '<button class="btn-text-sm" id="btn-stop-profile-scan">Stop scan</button>' : ''}
      ${state.profileScanError ? '<div class="profile-scan-error">' + escapeHtml(state.profileScanError) + ' — Showing videos found so far.</div>' : ''}
    </div>
    <button class="btn-cancel-batch" id="btn-cancel-profile-batch" hidden>Cancel batch & downloads</button>
    ${state.batchProgress ? `
      <div class="card-section" style="border-color:var(--primary);background:rgba(99,102,241,0.1);">
        <div style="display:flex;align-items:center;gap:10px;">
          <div style="font-size:16px;">⏳</div>
          <div data-role="batch-progress" style="font-size:12px;font-weight:600;color:#fff;">${escapeHtml(state.batchProgress || 'Enqueuing videos...')}</div>
        </div>
      </div>
    ` : ''}

    <!-- Batch Control Bar -->
    ${totalCount > 0 ? `
      <div class="profile-batch-bar">
        <div class="profile-batch-left">
          <button class="btn-pill-action" id="btn-profile-select-all" ${newCount===0 || state.isBatchEnqueuing?'disabled':''}>Select new</button>
          <button class="btn-pill-action" id="btn-profile-range" aria-pressed="false">Select range</button>
          <button class="btn-pill-action" id="btn-profile-clear-selection">Clear</button>
          <span data-role="profile-selection-count" style="font-size:11px;color:var(--text-muted);font-weight:600;">
            ${selectedCount} / ${totalCount} selected
          </span>
        </div>

        <div class="profile-batch-actions" style="display:flex;align-items:center;gap:6px;">
          <select class="profile-quality-select" id="profile-quality-select">
            <option value="240" ${state.profileQuality === '240' ? 'selected' : ''}>240p</option>
            <option value="480" ${state.profileQuality === '480' ? 'selected' : ''}>480p</option>
            <option value="720" ${state.profileQuality === '720' ? 'selected' : ''}>720p</option>
            <option value="1080" ${state.profileQuality === '1080' ? 'selected' : ''}>1080p</option>
            <option value="best" ${state.profileQuality === 'best' ? 'selected' : ''}>Best available</option>
            <option value="mp4" ${state.profileQuality === 'mp4' ? 'selected' : ''}>MP4 only</option>
          </select>

          <button class="btn-batch-download" id="btn-batch-download" ${selectedCount === 0 || state.isBatchEnqueuing || state.isScanningProfile ? 'disabled' : ''}>
            ⬇ Batch Download (${selectedCount})
          </button>
        </div>
      </div>

      <div class="profile-range-hint" data-role="profile-range-hint" role="status">${escapeHtml(rangeHint(currentProfileSelection(),profileSelectionView()))}</div>

      <!-- Video Grid -->
      <div class="profile-grid-pagination">
        <button class="btn-pill-action" id="profile-grid-prev" ${state.profileGridPage === 0 ? 'disabled' : ''}>Previous</button>
        <span>Showing ${state.profileGridPage*pageSize+1}–${Math.min((state.profileGridPage+1)*pageSize,totalCount)} of ${totalCount}</span>
        <button class="btn-pill-action" id="profile-grid-next" ${state.profileGridPage+1 >= pageCount ? 'disabled' : ''}>Next</button>
      </div>
      <div class="profile-video-grid ${state.showThumbnails?'':'thumbnails-hidden'}">
        ${visibleVideos.map(video => {
          const isSelected = state.selectedIds.has(video.id);
          return `
            <div class="profile-video-card ${isSelected ? 'selected' : ''}" data-video-id="${escapeHtml(video.id)}">
              <input type="checkbox" class="profile-video-checkbox" data-video-id="${escapeHtml(video.id)}" ${isSelected ? 'checked' : ''} ${state.isBatchEnqueuing || profileVideoDownloaded(video) ? 'disabled' : ''} />
              ${state.showThumbnails?`<div class="profile-thumb-wrapper">
                ${thumbnailHtml(video,'profile-thumb-img')}
                ${video.duration ? `<span class="profile-duration-badge">${escapeHtml(video.duration)}</span>` : ''}
              </div>`:''}
              <div class="profile-video-details">
                <div class="profile-video-title" title="${escapeHtml(video.title)}">${escapeHtml(video.title)}</div>
                <div class="profile-selection-labels"><span class="profile-selection-tick" ${isSelected?'':'hidden'}>✓ Selected</span><span class="profile-range-boundary" hidden></span></div>
                ${downloadedLabel(video.url)}
                <div class="profile-video-meta">
                  ${video.views ? `<span>👁 ${escapeHtml(video.views)}</span>` : ''}
                  <span>${escapeHtml(video.id)}</span>
                </div>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    ` : `
      <div class="card-section">
        <div class="empty-state-box">
          <div class="empty-state-icon">👤</div>
          <div class="empty-state-text">
            ${t('profileNoVideosFound')}
          </div>
        </div>
      </div>
    `}
  `;
}

function renderHistoryTab() {
  const query=state.historyQuery.trim().toLowerCase();
  const records=state.history.filter(record => !query || [record.title,record.fileName,record.creator,record.pageUrl].some(value => String(value || '').toLowerCase().includes(query)))
    .sort((a,b) => (b.completedAt || 0)-(a.completedAt || 0));
  const pageSize=30,pageCount=Math.max(1,Math.ceil(records.length/pageSize));
  state.historyPage=Math.min(state.historyPage,pageCount-1);
  const visible=records.slice(state.historyPage*pageSize,(state.historyPage+1)*pageSize);
  const date=value => {try{return new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short'}).format(new Date(value));}catch{return 'Date unavailable';}};
  return `<div class="card-section"><div class="section-header-row"><div class="section-title">Download history (${state.history.length})</div><button class="btn-text-sm" id="btn-clear-history" ${state.history.length?'':'disabled'}>Clear history</button></div>
    <input class="modern-input" id="history-search" type="search" placeholder="Search title, creator, or filename" value="${escapeHtml(state.historyQuery)}" />
    <div class="history-records">${visible.map(record => `<article class="history-record" data-history-id="${escapeHtml(record.id)}">
      ${state.showThumbnails?`<div class="history-thumbnail">${thumbnailHtml({...record,id:'history:'+record.id,url:record.pageUrl || record.url},'history-thumbnail-img')}</div>`:''}
      <div class="history-record-details"><div class="history-record-title" title="${escapeHtml(record.fileName)}">${escapeHtml(record.title || record.fileName || 'Video')}</div>
      <div class="history-record-meta">${record.creator?`<span>${escapeHtml(record.creator)}</span>`:''}<time>${escapeHtml(date(record.completedAt))}</time>${record.quality?`<span>${escapeHtml(record.quality)}${/^\d+$/.test(String(record.quality))?'p':''}</span>`:''}${record.format?`<span>${escapeHtml(String(record.format).toUpperCase())}</span>`:''}${record.bytes>0?`<span>${formatBytes(record.bytes)}</span>`:''}</div>
      <div class="history-file-name">${escapeHtml(record.fileName || '')}</div><div class="history-record-actions"><button class="btn-pill-action" data-history-action="show" data-id="${escapeHtml(record.id)}">Show file</button>${record.pageUrl?`<button class="btn-pill-action" data-history-action="source" data-id="${escapeHtml(record.id)}">Open video</button>`:''}<button class="btn-icon-btn" data-action="delete-history" data-id="${escapeHtml(record.id)}" title="Remove from history">✕</button></div></div>
    </article>`).join('') || `<div class="empty-state-box">${query?'No downloads match your search.':'Completed downloads will appear here.'}</div>`}</div>
    <div class="profile-grid-pagination"><button class="btn-pill-action" id="history-prev" ${state.historyPage===0?'disabled':''}>Previous</button><span>${records.length?state.historyPage*pageSize+1:0}–${Math.min((state.historyPage+1)*pageSize,records.length)} of ${records.length}</span><button class="btn-pill-action" id="history-next" ${state.historyPage+1>=pageCount?'disabled':''}>Next</button></div></div>`;
}

// TAB 3: Settings View
function renderSettingsTab() {
  return `
    <div class="settings-group">
      <div class="setting-card"><div class="setting-card-row"><div class="setting-label-col"><span class="setting-title">Show thumbnails</span><span class="setting-desc">Show video previews in detection, profiles, and history</span></div><button type="button" class="modern-switch ${state.showThumbnails?'checked':''}" id="toggle-thumbnails" role="switch" aria-checked="${state.showThumbnails}" aria-label="Show thumbnails"><span class="modern-switch-thumb"></span></button></div></div>
      <!-- Concurrency Setting -->
      <div class="setting-card">
        <div class="setting-card-row">
          <div class="setting-label-col">
            <span class="setting-title">${t('settingsMaxConcurrent')}</span>
            <span class="setting-desc">${t('settingsMaxConcurrentHint')}</span>
          </div>
          <div class="concurrency-stepper">
            <button class="btn-stepper" id="btn-concurrency-minus" ${state.maxConcurrentTasks <= 1 ? 'disabled' : ''}>-</button>
            <span class="concurrency-val">${state.maxConcurrentTasks}</span>
            <button class="btn-stepper" id="btn-concurrency-plus" ${state.maxConcurrentTasks >= 12 ? 'disabled' : ''}>+</button>
          </div>
        </div>
      </div>

      <!-- Subdirectory Setting -->
      <div class="setting-card">
        <span class="setting-title">${t('downloadSubdirLabel')}</span>
        <span class="setting-desc">Subfolder inside your browser Downloads directory</span>
        <input type="text" class="modern-input" id="settings-subdir-input" 
               value="${escapeHtml(state.downloadSubdir)}" placeholder="MediaFlow/" />
      </div>

      <!-- Channel Folder Toggle -->
      <div class="setting-card">
        <div class="setting-card-row">
          <div class="setting-label-col">
            <span class="setting-title">${t('channelFolderLabel')}</span>
            <span class="setting-desc">${t('channelFolderHint')}</span>
          </div>
          <div class="modern-switch ${state.useChannelFolder ? 'checked' : ''}" id="toggle-channel-folder">
            <div class="modern-switch-thumb"></div>
          </div>
        </div>
      </div>

      <!-- Downloads Folder Action -->
      <div class="setting-card">
        <div class="setting-card-row">
          <div class="setting-label-col">
            <span class="setting-title">Downloads Folder</span>
            <span class="setting-desc">Open Chrome's default downloads location</span>
          </div>
          <button class="btn-pill-action" id="btn-open-downloads-folder" style="padding:6px 12px;">📂 Open Folder</button>
        </div>
      </div>
    </div>
  `;
}

// Bind DOM Events
function bindEvents() {
  document.querySelector('#btn-clear-profile-results')?.addEventListener('click',async()=>{
    if(state.isClearingProfile)return;
    state.isClearingProfile=true;render();
    try{
      const response=await chrome.runtime.sendMessage({type:'profile-results-clear'});
      if(!response?.success)throw Error(response?.error || 'Unable to clear profile results');
    }catch(error){showToast(error.message,'error');}
    finally{state.isClearingProfile=false;render();}
  });
  document.querySelector('#btn-refresh-detection')?.addEventListener('click',refreshMediaDetection);
  document.querySelector('#btn-cancel-profile-batch')?.addEventListener('click',async()=>{
    if(state.isCancellingBatch)return;
    state.isCancellingBatch=true;updateBatchControls();
    try {
      const response=await chrome.runtime.sendMessage({type:'profile-batch-cancel',batchId:state.profileBatchId,profileKey:currentBatchProfileKey()});
      if(!response?.success)throw Error(response?.error || 'Unable to cancel batch');
    } catch(error){state.isCancellingBatch=false;updateBatchControls();showToast(error.message,'error');}
  });
  document.querySelector('#toggle-thumbnails')?.addEventListener('click',async()=>{
    try{await settingsStorage.setShowThumbnails(!state.showThumbnails);}catch(error){showToast(error.message,'error');}
  });
  document.querySelector('#btn-view-history')?.addEventListener('click',()=>{state.activeTab='history';render();});
  document.querySelector('#history-search')?.addEventListener('input',event=>{state.historyQuery=event.target.value;state.historyPage=0;render();});
  document.querySelector('#history-prev')?.addEventListener('click',()=>{state.historyPage--;render();});
  document.querySelector('#history-next')?.addEventListener('click',()=>{state.historyPage++;render();});
  document.querySelectorAll('[data-history-action]').forEach(button=>button.addEventListener('click',async()=>{
    const record=state.history.find(record=>record.id===button.dataset.id);if(!record)return;
    try{
      const response=await chrome.runtime.sendMessage(button.dataset.historyAction==='source'?{type:'open-video-page',url:record.pageUrl}:{type:'open-download-item',downloadId:record.downloadId,url:record.url,fileName:record.fileName});
      if(!response?.success)throw Error(response?.error || 'Unable to open download');
    }catch(error){showToast(error.message,'error');}
  }));
  document.querySelectorAll('.popup-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.getAttribute('data-tab');
      if (tab) {
        state.activeTab = tab;
        render();
      }
    });
  });

  const fnInput = document.querySelector('#filename-editor-input');
  if (fnInput) {
    fnInput.addEventListener('input', e => {
      state.customFilename = e.target.value;
    });
  }

  // Download Single Video Button
  document.querySelectorAll('.btn-download-action').forEach(btn => {
    btn.addEventListener('click', async () => {
      const idx = Number(btn.getAttribute('data-download-index'));
      const video = state.detectedVideos[idx];
      if (!video) return;

      const title = state.customFilename || state.activePageTitle || 'video';
      const cleanTitle = cleanFileName(title, state.useChannelFolder);
      const normalizedFmt = normalizeFormat(video.format, video.videoUrl);
      const qualStr = Array.isArray(video.quality) ? String(video.quality[0]) : String(video.quality || 'Auto');

      chrome.runtime.sendMessage(
        {
          type: 'download-queue-enqueue',
          url: video.videoUrl,
          fileName: cleanTitle,
          format: normalizedFmt,
          quality: qualStr,
          pageUrl: state.activePageUrl,
          title:state.activePageTitle || title,thumbnail:state.videoThumbnail,thumbnails:state.videoThumbnails,
          headers: mediaHeaders(video.headers,state.activePageUrl)
        },
        res => {
          if (res && res.success) {
            showToast(t('toastEnqueued'), 'success');
          } else {
            showToast(res?.error || 'Failed to enqueue', 'error');
          }
        }
      );
    });
  });

  // Task Actions (Pause, Resume, Retry, Delete)
  document.querySelectorAll('.btn-icon-btn, .btn-text-sm[data-action="retry"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.getAttribute('data-action');
      const taskId = btn.getAttribute('data-id');
      if (!action || !taskId) return;

      if (pendingTaskActions.has(taskId)) return;
      if (action === 'delete-history') { chrome.runtime.sendMessage({type:'download-history-remove',recordId:taskId},response=>{if(chrome.runtime.lastError || !response?.success)showToast(chrome.runtime.lastError?.message || response?.error || 'Unable to remove history','error');}); return; }
      pendingTaskActions.add(taskId);
      btn.disabled = true;
      const type = {'pause':'download-queue-pause','resume':'download-queue-resume','delete':'download-queue-delete','retry':'download-queue-retry'}[action];
      const task = state.tasks.find(task => task.id === taskId);
      chrome.runtime.sendMessage({type,taskId,...action === 'retry' ? {task} : {}}, response => {
        const error = chrome.runtime.lastError;
        pendingTaskActions.delete(taskId);
        if (error || !response?.success) showToast(error?.message || response?.error || 'Action failed', 'error');
        else chrome.runtime.sendMessage({type:'download-queue-snapshot'}, result => { if (!chrome.runtime.lastError && result?.state?.tasks) applyTasks(result.state.tasks); });
        if (btn.isConnected) btn.disabled = false;
      });

    });
  });

  // Clear Queued & Clear Errors
  const clearQueuedBtn = document.querySelector('#btn-clear-queued');
  if (clearQueuedBtn) {
    clearQueuedBtn.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'download-queue-clear-queued' });
    });
  }

  const clearErrorsBtn = document.querySelector('#btn-clear-errors');
  if (clearErrorsBtn) {
    clearErrorsBtn.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'download-queue-clear-errors' });
    });
  }

  // Clear History
  const clearHistoryBtn = document.querySelector('#btn-clear-history');
  if (clearHistoryBtn) {
    clearHistoryBtn.addEventListener('click', () => {
      chrome.runtime.sendMessage({type:'download-history-clear'},response=>{if(chrome.runtime.lastError || !response?.success)showToast(chrome.runtime.lastError?.message || response?.error || 'Unable to clear history','error');});
    });
  }

  document.querySelector('#btn-stop-profile-scan')?.addEventListener('click', () => chrome.runtime.sendMessage({type:'profile-scan-stop'}));
  document.querySelector('#profile-grid-prev')?.addEventListener('click', () => { state.profileGridPage--; render(); });
  document.querySelector('#profile-grid-next')?.addEventListener('click', () => { state.profileGridPage++; render(); });
  // Profile URL Input & Fetch
  const fetchProfileBtn = document.querySelector('#btn-fetch-profile-videos');
  const profileUrlInput = document.querySelector('#profile-url-input');
  if (fetchProfileBtn && profileUrlInput) {
    profileUrlInput.addEventListener('input', () => { state.profileInputUrl = profileUrlInput.value; });
    fetchProfileBtn.addEventListener('click', () => {
      const url = profileUrlInput.value.trim();
      if (url) scanProfile(url);
    });
    profileUrlInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        const url = profileUrlInput.value.trim();
        if (url) scanProfile(url);
      }
    });
  }

  // Profile Video Card Selection
  document.querySelectorAll('.profile-video-card').forEach(card => {
    card.addEventListener('click', e => {
      if (e.target.tagName === 'INPUT' || state.isBatchEnqueuing) return;
      const id = card.getAttribute('data-video-id');
      if (!id) return;
      const video=state.profileVideos.find(video => video.id===id);
      if(state.selectionPending || profileVideoDownloaded(video) && !(currentProfileSelection()?.mode==='range' && !currentProfileSelection().end))return;
      selectProfileVideos({type:'pick',key:videoKey(video.url)},video);
    });
  });

  document.querySelectorAll('.profile-video-checkbox').forEach(cb => {
    cb.addEventListener('change', () => {
      const id = cb.getAttribute('data-video-id');
      if (!id || state.isBatchEnqueuing || state.selectionPending) return;
      const video=state.profileVideos.find(video => video.id===id);
      if(profileVideoDownloaded(video) && !(currentProfileSelection()?.mode==='range' && !currentProfileSelection().end)){cb.checked=false;return;}
      selectProfileVideos({type:'pick',key:videoKey(video.url)},video);
    });
  });

  // Profile Select All & Clear
  const selectAllBtn = document.querySelector('#btn-profile-select-all');
  if (selectAllBtn) {
    selectAllBtn.addEventListener('click', () => {
      selectProfileVideos({type:'new'});
    });
  }

  const clearSelBtn = document.querySelector('#btn-profile-clear-selection');
  if (clearSelBtn) {
    clearSelBtn.addEventListener('click', () => {
      selectProfileVideos({type:'clear'});
    });
  }
  document.querySelector('#btn-profile-range')?.addEventListener('click',()=>selectProfileVideos({type:'range'}));

  const qualSel = document.querySelector('#profile-quality-select');
  if (qualSel) {
    qualSel.addEventListener('change', e => {
      state.profileQuality = e.target.value;
    });
  }

  const batchBtn = document.querySelector('#btn-batch-download');
  if (batchBtn) {
    batchBtn.addEventListener('click', () => {
      batchDownloadProfileVideos();
    });
  }

  // Settings: Concurrency Stepper
  const minusBtn = document.querySelector('#btn-concurrency-minus');
  const plusBtn = document.querySelector('#btn-concurrency-plus');
  if (minusBtn && plusBtn) {
    minusBtn.addEventListener('click', async () => {
      if (state.maxConcurrentTasks > 1) {
        state.maxConcurrentTasks -= 1;
        await settingsStorage.setMaxConcurrentTasks(state.maxConcurrentTasks);
        render();
      }
    });
    plusBtn.addEventListener('click', async () => {
      if (state.maxConcurrentTasks < 12) {
        state.maxConcurrentTasks += 1;
        await settingsStorage.setMaxConcurrentTasks(state.maxConcurrentTasks);
        render();
      }
    });
  }

  // Settings: Subdirectory
  const subdirInput = document.querySelector('#settings-subdir-input');
  if (subdirInput) {
    subdirInput.addEventListener('change', async e => {
      state.downloadSubdir = await settingsStorage.setDownloadSubdir(e.target.value);
    });
  }

  // Settings: Channel Folder Switch
  const channelToggle = document.querySelector('#toggle-channel-folder, #tog-channel-folder');
  if (channelToggle) {
    channelToggle.addEventListener('click', async () => {
      state.useChannelFolder = !state.useChannelFolder;
      await settingsStorage.setUseChannelFolder(state.useChannelFolder);
      render();
    });
  }

  // Settings: Open Downloads Folder
  const openFolderBtn = document.querySelector('#btn-open-downloads-folder');
  if (openFolderBtn) {
    openFolderBtn.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'open-downloads-folder' });
    });
  }
}

// Initialize Application
async function init() {
  document.title = t('popupTitle');
  chrome.runtime.onMessage?.addListener(message=>{
    if(message.type==='media-detection-updated' && message.tabId===state.activeBrowserTabId)refreshMediaDetection();
    return false;
  });

  const settings = await settingsStorage.get();
  if (settings) {
    state.downloadSubdir = settings.downloadSubdir || '';
    state.useChannelFolder = settings.useChannelFolder !== false;
    state.maxConcurrentTasks = settings.maxConcurrentTasks || 6;
    state.showThumbnails=settings.showThumbnails!==false;
  }

  settingsStorage.subscribe(() => {
    const s = settingsStorage.getSnapshot();
    if (s) {
      state.downloadSubdir = s.downloadSubdir || '';
      state.useChannelFolder = s.useChannelFolder !== false;
      state.maxConcurrentTasks = s.maxConcurrentTasks || 6;
      state.showThumbnails=s.showThumbnails!==false;
      render();
    }
  });

  const queueState = await queueStorage.get();
  if (queueState?.tasks) {
    state.tasks = queueState.tasks;
  }

  queueStorage.subscribe(() => {
    const qs = queueStorage.getSnapshot();
    if (qs?.tasks) applyTasks(qs.tasks);
  });

  // Direct storage listener + polling fallback so progress always updates live
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.downloadQueueState?.newValue) {
      applyTasks(changes.downloadQueueState.newValue.tasks || []);
    }
    if (area === 'local' && changes.profileScanState) applyProfileScan(changes.profileScanState.newValue);
    if (area === 'local' && changes.profileSelectionState) applySavedSelection(changes.profileSelectionState.newValue);
    if (area === 'local' && changes.profileBatchState) applyProfileBatch(changes.profileBatchState.newValue);
  });
  setInterval(async () => {
    try {
      const r = await chrome.storage.local.get('downloadQueueState');
      const tasks = r?.downloadQueueState?.tasks || [];
      if (tasks.some(t => t.status === 'downloading' || t.status === 'queued') ||
          taskStructureKey(tasks) !== lastTaskStructureKey) {
        applyTasks(tasks);
      }
    } catch (e) {}
  }, 800);

  const hist = await historyStorage.get();
  if (hist?.records) {
    state.history = hist.records;
  }

  historyStorage.subscribe(() => {
    const hs = historyStorage.getSnapshot();
    if (hs?.records) {
      state.history = hs.records;
      updateProfileSelection();
      document.querySelectorAll('[data-role="history-count"]').forEach(node=>{node.textContent=state.history.length;});
      if (state.activeTab === 'video' || state.activeTab==='history') render();
      else updateDownloadedLabels();
    }
  });

  const savedProfile = await chrome.storage.local.get(['profileScanState','profileSelectionState']);
  state.profileSelection=savedProfile.profileSelectionState || null;
  applyProfileScan(savedProfile.profileScanState);
  applyProfileBatch((await chrome.storage.local.get('profileBatchState')).profileBatchState);

  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    const activeTab = tabs[0];
    if (!activeTab) {
      render();
      return;
    }

    state.activePageUrl = activeTab.url || '';
    state.activeBrowserTabId=activeTab.id;
    state.activePageTitle = decodeHtmlEntities(activeTab.title || '');
    state.customFilename = decodeHtmlEntities(activeTab.title || '');

    try {
      const urlObj = new URL(state.activePageUrl);
      state.activeDomain = urlObj.hostname.replace(/^www\./, '');
    } catch (e) {}

    chrome.tabs.sendMessage(activeTab.id, { command: 'get_video_info' }, res => {
      if (!chrome.runtime.lastError && res && res.videoInfos?.length) {
        mergeDetectedVideos(res.videoInfos,true);
        state.videoThumbnail=res.thumbnail || res.videoInfos.find(video=>video.thumbnail)?.thumbnail || state.videoThumbnail;
        state.videoThumbnails=res.thumbnails || [];
        if (res.pageTitle) {
          const decoded = decodeHtmlEntities(res.pageTitle);
          state.activePageTitle = decoded;
          state.customFilename = decoded;
        }
      }
      render();
    });
    refreshMediaDetection();
    chrome.tabs.sendMessage(activeTab.id,{command:'get_video_metadata'},async metadata=>{
      const error=chrome.runtime.lastError;
      if(error || !metadata?.thumbnail){
        try{metadata=await chrome.runtime.sendMessage({type:'ext-fetch-video-metadata',url:state.activePageUrl});}catch{return;}
      }
      if(metadata?.thumbnail){state.videoThumbnail=metadata.thumbnail;state.videoThumbnails=metadata.thumbnails || [metadata.thumbnail];if(state.activeTab==='video')render();}
    });

    if (
      /\/model\/|\/pornstar\/|\/channels\/|\/users\/|\/profiles\//i.test(state.activePageUrl) ||
      /xvideos\.com\/(profiles|channels|models)/i.test(state.activePageUrl) ||
      /xhamster\.com\/(users|creators|channels)/i.test(state.activePageUrl)
    ) {
      if (!state.profileVideos.length && !state.isScanningProfile && state.profileScanStatus!=='cleared') scanProfile(state.activePageUrl);
    }
  });

  render();
}

// Run
init();
