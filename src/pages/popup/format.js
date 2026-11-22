import {formatSpeed} from '../../../assets/js/speed.js';
import {icon} from '../../../assets/js/icons.js';

const FALLBACK_MESSAGES = {
  popupHeaderTitle: 'MediaFlow Pro',
  popupTitle: 'MediaFlow',
  tabVideoQueue: 'Downloads',
  tabProfileVideos: 'Library',
  tabSettings: 'Settings',
  popupQualityLabel: 'Quality',
  popupTypeLabel: 'Type',
  popupActionDownload: 'Download',
  popupActionDownloading: 'Downloading…',
  popupActionQueued: 'Queued…',
  popupActionPaused: 'Paused',
  popupFilenameLabel: 'Filename',
  popupFilenamePlaceholder: 'Leave empty to auto-generate',
  downloadSubdirLabel: 'Download Subdirectory',
  downloadSubdirPlaceholder: 'MediaFlow/',
  channelFolderLabel: 'Treat / as a folder',
  channelFolderHint: 'Organize downloads into creator/profile folders',
  queueTitle: 'Download Queue',
  queueMetaDownloading: '$1 downloading',
  queueMetaQueued: '$1 queued',
  queueMetaPaused: '$1 paused',
  queueActionClearQueued: 'Clear Queued',
  queueActionClearErrors: 'Clear Errors',
  historyTitle: 'Download History ($1)',
  historyActionClear: 'Clear All',
  profileTabTitle: 'Creator Profile Batch Downloader',
  profileTabDesc: 'Batch download all videos from a specific creator or model profile',
  profileInputPlaceholder: 'Paste creator / model profile URL...',
  profileAnalyzeBtn: 'Fetch Videos',
  profileAnalyzing: 'Scanning...',
  profileSelectAll: 'Select All',
  profileDeselectAll: 'Clear',
  profileSelectedCount: '$1 selected',
  profileQualityLabel: 'Preferred Quality',
  profileFolderLabel: 'Save in creator folder',
  profileDownloadSelected: 'Batch Download ($1)',
  profileNoVideosFound: 'No profile videos detected yet. Navigate to a creator profile page or paste the URL above.',
  profileBatchSuccess: 'Enqueued $1 profile videos!',
  settingsMaxConcurrent: 'Download limit',
  settingsMaxConcurrentHint: 'Use 0-12 simultaneous downloads. 0 holds the queue. Lower limits use less RAM.',
  toastDownloadComplete: 'Download completed: $1',
  toastDownloadFailed: 'Download failed: $1',
  toastEnqueued: 'Added to download queue',
  toastTaskDeleted: 'Task removed from queue'
};

const SOURCE_REFRESH_ERROR_RE = /open the (?:original )?video page|open the post|\b474\b|expired(?:\s+(?:link|url|token|media|signed))?|link(?:\s+has)?\s+expired|link refresh failed|source refresh/i;

export function t(key, substitutions) {
  try {
    const msg = chrome.i18n.getMessage(key, substitutions);
    if (msg) return msg;
  } catch {}

  let str = FALLBACK_MESSAGES[key] || key;
  if (substitutions) {
    const subs = Array.isArray(substitutions) ? substitutions : [substitutions];
    subs.forEach((sub, idx) => {
      str = str.replace(new RegExp(`\\$${idx + 1}`, 'g'), String(sub));
    });
  }
  return str;
}

export function formatBytes(bytes) {
  if (!Number.isFinite(Number(bytes)) || bytes <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(sizes.length - 1, Math.max(0, Math.floor(Math.log(bytes) / Math.log(k))));
  return (bytes / Math.pow(k, i)).toFixed(1) + ' ' + sizes[i];
}

export function decodeHtmlEntities(str) {
  if (!str) return '';
  return str
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/-quot;/g, '')
    .replace(/&#(\d+);/g, (_match, dec) => String.fromCharCode(dec));
}

export function cleanFileName(str, useFolder = true) {
  if (!str) return 'video';
  let s = decodeHtmlEntities(String(str)).trim();
  s = s.replace(/\.(mp4|m4v|webm|mkv|mov|ts|m3u8)$/i, '');

  const parts = s.split(/[\/\\]+/).map(part => {
    const p = part
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

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]));
}

export function normalizeFormat(format, url) {
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

export function isSourceRefreshError(task) {
  if (!task) return false;
  if (task.needsSourceRefresh) return true;
  if (Number(task.errorStatus) === 474 || task.errorCode === 'INVALID_MEDIA_RESPONSE') return true;
  return SOURCE_REFRESH_ERROR_RE.test(String(task.error || ''));
}

export function hasOpenablePageUrl(task) {
  if (!task?.pageUrl) return false;
  try {
    const parsed = new URL(String(task.pageUrl));
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

export function taskStatusLabel(task, now = Date.now()) {
  if (task.status === 'retrying') {
    const attempt = Number(task.retryAttempt);
    const max = Number(task.retryMax);
    const attemptText = Number.isFinite(attempt) && attempt > 0
      ? (Number.isFinite(max) && max > 0 ? ` (attempt ${attempt}/${max})` : ` (attempt ${attempt})`)
      : '';
    const retryAt = Number(task.retryAt);
    if (Number.isFinite(retryAt) && retryAt > now) {
      const seconds = Math.max(1, Math.ceil((retryAt - now) / 1000));
      return `Retrying in ${seconds}s${attemptText}`;
    }
    return `Retrying…${attemptText}`;
  }
  if (task.status === 'downloading' && task.phase === 'downloading-mp4') return 'Downloading + MP4';
  if (task.status === 'queued' && task.nextRetryAt > now) return `Retry ${task.retryCount} · waiting`;
  if (task.status === 'paused' || task.status === 'queued' || task.status === 'error') return task.status;
  if (task.phase === 'resolving') return 'Resolving source…';
  if (task.phase === 'converting') return 'Creating MP4…';
  if (task.isFileDownloading) return 'Saving…';
  if (task.status === 'downloading' && !(task.progress > 0)) return 'Starting…';
  return task.status;
}

export function taskProgressNumsHtml(task) {
  const progress = Math.max(0, Math.min(100, Math.round(task.progress || 0)));
  const isDownloading = task.status === 'downloading';
  const spd = task.downloadSpeed ?? task.speed ?? 0;
  const speed = task.speedFormatted || (typeof spd === 'string' ? spd : formatSpeed(Number(spd)));
  const bytes = task.fetchedBytes || task.cachedBytes || 0;
  return `
    <span class="task-progress-percent">${progress}%</span>
    ${task.targetSegment > 1 ? `<span>${task.finishNum || 0}/${task.targetSegment} segments</span>` : ''}
    ${bytes > 0 ? `<span>${formatBytes(bytes)}</span>` : ''}
    ${isDownloading && !task.isFileDownloading && speed ? `<span class="task-speed-badge">${icon('zap')} ${escapeHtml(speed)}</span>` : ''}
  `;
}
