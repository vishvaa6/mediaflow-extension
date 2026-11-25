import {icon} from '../../../../assets/js/icons.js';
import {isXPage} from '../../../../assets/js/x-media.js';
import {isMissavPage} from '../../../../assets/js/missav-media.js';
import {
  state,
  queuePageSize,
  visibleQueueTasks,
  currentVideoThumbnail,
  thumbnailHtml,
  downloadedLabel
} from '../state.js';
import {
  t,
  cleanFileName,
  escapeHtml,
  normalizeFormat,
  isSourceRefreshError,
  hasOpenablePageUrl,
  taskStatusLabel,
  taskProgressNumsHtml
} from '../format.js';

export function outputFormatControl(id, label = 'Save as') {
  return `<label class="profile-quality-label output-format-control" for="${id}"><span>${label}</span><select id="${id}" class="profile-quality-select" data-output-format aria-label="${label}" title="Fast MP4 keeps video quality and converts compatible HLS during download. Unsupported codecs keep their original format."><option value="mp4" ${state.outputFormat === 'mp4' ? 'selected' : ''}>MP4 (fast)</option><option value="source" ${state.outputFormat === 'source' ? 'selected' : ''}>Original format</option></select></label>`;
}

export function queueLimitControl() {
  return `<label class="profile-quality-label" for="queue-limit"><span>Download limit</span><select id="queue-limit" class="profile-quality-select" data-queue-limit aria-label="Download limit" title="Simultaneous downloads. 0 holds the queue; lower limits use less RAM.">${Array.from({length: 13}, (_, n) => `<option value="${n}" ${state.maxConcurrentTasks === n ? 'selected' : ''}>${n === 0 ? '0 — Hold' : n}</option>`).join('')}</select></label>`;
}

function renderTaskCard(task) {
  const isDownloading = task.status === 'downloading';
  const isRetrying = task.status === 'retrying';
  const isActive = isDownloading || isRetrying;
  const isPaused = task.status === 'paused';
  const isError = task.status === 'error';
  const canOpenSource = isError && isSourceRefreshError(task) && hasOpenablePageUrl(task);
  const progress = Math.max(0, Math.min(100, Math.round(task.progress || 0)));
  const removeLabel = isActive ? 'Cancel download' : 'Remove from queue';
  const formatLabel = (
    task.outputReady
      ? task.outputExtension || task.format
      : task.outputFormat === 'mp4'
        ? 'MP4 preferred'
        : task.format === 'pending'
          ? 'Source'
          : task.format || 'Source'
  ).toUpperCase();

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
        <span class="task-output-format">${escapeHtml(formatLabel)}</span>
        <div class="task-actions">
          ${isActive || task.status === 'queued' ? `
            <button type="button" class="btn-icon-btn" data-action="pause" data-id="${escapeHtml(task.id)}" title="Pause download" aria-label="Pause download">${icon('pause')}</button>
            ${task.status === 'queued' && task.nextRetryAt > Date.now() ? `<button type="button" class="btn-icon-btn" data-action="retry" data-id="${escapeHtml(task.id)}" title="Retry now" aria-label="Retry now">${icon('rotate-cw')}</button>` : ''}
          ` : isPaused ? `
            <button type="button" class="btn-icon-btn" data-action="resume" data-id="${escapeHtml(task.id)}" title="Resume download" aria-label="Resume download">${icon('play')}</button>
          ` : isError ? `
            <button type="button" class="btn-icon-btn" data-action="retry" data-id="${escapeHtml(task.id)}" title="Retry download" aria-label="Retry download" style="color:var(--primary);">${icon('rotate-cw')}</button>
          ` : ''}
          <button type="button" class="btn-icon-btn" data-action="delete" data-id="${escapeHtml(task.id)}" title="${removeLabel}" aria-label="${removeLabel}">${icon('x')}</button>
        </div>
      </div>

      ${isError ? `
        <div class="task-error" role="alert">
          <span class="task-error-message">
            ${icon('triangle-alert')}
            <span>${escapeHtml(task.error || 'Download interrupted or connection dropped')}</span>
          </span>
          <div class="task-error-actions">
            ${canOpenSource ? `
              <button type="button" class="btn-error-primary" data-action="open-source" data-id="${escapeHtml(task.id)}">
                ${icon('arrow-up-right')} Open source page
              </button>
              <button type="button" class="btn-pill-action btn-error-secondary" data-action="retry" data-id="${escapeHtml(task.id)}">
                ${icon('rotate-cw')} Retry
              </button>
            ` : `
              <button type="button" class="btn-error-primary" data-action="retry" data-id="${escapeHtml(task.id)}">
                ${icon('rotate-cw')} Retry
              </button>
            `}
          </div>
        </div>
      ` : ''}
      ${isRetrying && task.retryError ? `<div class="task-recovery-note task-retry-note" role="status">${icon('rotate-cw')}<span>${escapeHtml(task.retryError)}</span></div>` : ''}
      ${task.nextRetryAt > Date.now() ? `<div class="task-recovery-note" role="status">${icon('rotate-cw')}Connection or server issue. Retry ${task.retryCount} is scheduled; cached progress is retained.</div>` : ''}
      ${task.fallbackReason ? `<div class="task-recovery-note">${icon('info')}${escapeHtml(task.fallbackReason)}</div>` : ''}

      <div class="task-progress-bar-bg" role="progressbar" aria-label="Download progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progress}">
        <div class="task-progress-bar-fill" data-role="bar" style="width: ${progress}%;"></div>
      </div>
    </div>
  `;
}

function renderDetectedView(queuedUrls) {
  return `
    ${isXPage(state.activePageUrl) && !state.detectedVideos.length ? '<p class="profile-scan-status">Scroll a video into view on X. Visible videos are detected automatically.</p>' : ''}
    ${isMissavPage(state.activePageUrl) && !state.detectedVideos.length ? '<p class="profile-scan-status">Visible MissAV videos are detected automatically. Scroll a video card or the player into view.</p>' : ''}
    ${state.detectionStatus ? `<p class="profile-scan-status" role="status">${escapeHtml(state.detectionStatus)}</p>` : ''}
    ${state.detectionError ? `<p class="profile-scan-status" role="status">${escapeHtml(state.detectionError)}</p>` : ''}
    ${state.detectedVideos.length ? `
      <div class="video-detected-box">
        <div class="section-header-row"><div class="section-title">${icon('video')} ${isXPage(state.activePageUrl) ? 'Visible X videos' : isMissavPage(state.activePageUrl) ? 'Visible MissAV videos' : 'Detected video'}</div><span class="section-caption">${state.detectedVideos.length} quality options</span></div>
        <div class="detected-media-summary">
        ${state.showThumbnails ? `<div class="current-video-thumbnail">${thumbnailHtml(currentVideoThumbnail(), 'current-thumbnail-img')}</div>` : ''}
        <div class="detected-media-copy">${downloadedLabel(state.detectedVideos[0]?.pageUrl || state.activePageUrl, state.detectedVideos[0]?.videoUrl)}
        <div class="video-detected-title" title="${escapeHtml(state.customFilename || state.activePageTitle)}">
          ${escapeHtml(state.customFilename || state.activePageTitle || 'Video detected')}
        </div>
        </div></div>
        <label class="video-detected-filename-row"><span>File name</span>
          <input type="text" class="filename-input" id="filename-editor-input"
                 value="${escapeHtml(state.customFilename)}" placeholder="${t('popupFilenamePlaceholder')}" />
        </label>
        <div class="download-format-options">${outputFormatControl('download-output-format')}<p class="download-format-hint">${state.outputFormat === 'mp4' ? 'Compatible HLS converts during download without losing quality. WebM and unsupported codecs keep their original format.' : 'Save the original format without conversion.'}</p></div>
        <div class="qualities-list">
          ${state.detectedVideos.map((video, idx) => {
            const isAlreadyQueued = queuedUrls.has(video.videoUrl);
            const qualDisplay = Array.isArray(video.quality) ? video.quality[0] : (video.quality || 'Auto');
            const fmtDisplay = normalizeFormat(video.format, video.videoUrl);
            const heading = (video.site === 'x' || video.site === 'missav') && (!idx || state.detectedVideos[idx - 1].pageUrl !== video.pageUrl)
              ? `<div class="x-video-heading" data-video-page="${escapeHtml(video.pageUrl)}" ${video.site === 'x' ? `data-x-video-page="${escapeHtml(video.pageUrl)}"` : ''}><span title="${escapeHtml(video.title)}">${escapeHtml(video.title || 'Video')}</span>${downloadedLabel(video.pageUrl, video.videoUrl)}</div>`
              : '';

            return `
              ${heading}
              <div class="quality-row">
                <div class="quality-info">
                  <span class="quality-badge">${escapeHtml(qualDisplay)}</span>
                  <span class="format-badge">${escapeHtml(fmtDisplay)}</span>
                </div>
                <button type="button" class="btn-download-action" data-download-index="${idx}" ${isAlreadyQueued ? 'disabled' : ''}>
                  ${isAlreadyQueued ? icon('check') + ' In Queue' : icon('download') + ' ' + t('popupActionDownload') + (state.outputFormat === 'mp4' ? ' ' + (fmtDisplay === 'webm' ? 'WebM' : 'MP4') : '')}
                </button>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    ` : `
      <div class="card-section">
        <div class="empty-state-box">
          <div class="empty-state-icon">${icon('video')}</div>
          <div class="empty-state-text">
            Start video playback, then refresh detection. HTML5 MP4/WebM, HLS and supported embedded players can be detected. DRM-protected streams are not supported.
          </div>
        </div>
      </div>
    `}
  `;
}

export function renderVideoQueueTab() {
  const activeCount = state.tasks.filter(task => task.status === 'downloading' || task.status === 'retrying').length;
  const queuedCount = state.tasks.filter(task => task.status === 'queued').length;
  const erroredCount = state.tasks.filter(task => task.status === 'error').length;
  const visibleTasks = visibleQueueTasks();
  const start = state.queuePage * queuePageSize;
  const queuedUrls = new Set(state.tasks.filter(task => task.status !== 'error').map(task => task.url));

  return `
    <!-- Current Video Detection -->
    <div class="view-heading"><div><h1>Downloads</h1><p>${state.downloadView === 'detected' ? 'Choose a video from your current tab.' : 'Keep track of your downloads.'}</p></div>${state.downloadView === 'detected' ? `<button type="button" class="btn-pill-action" id="btn-refresh-detection">${icon('rotate-cw')}Refresh detection</button>` : ''}</div>
    <nav class="download-switcher" aria-label="Download views">
      <button type="button" data-download-view="detected" aria-pressed="${state.downloadView === 'detected'}">${icon('video')} Detected videos <span>${state.detectedVideos.length}</span></button>
      <button type="button" data-download-view="queue" aria-pressed="${state.downloadView === 'queue'}">${icon('list-video')} Download queue <span data-role="queue-count">${state.tasks.length}</span></button>
    </nav>
    <div class="downloads-workspace">
    ${state.downloadView === 'detected' ? renderDetectedView(queuedUrls) : ''}
    ${state.downloadView === 'queue' ? `
    <!-- Download Queue Section -->
    <section class="card-section queue-section" aria-label="Download queue">
      <div class="section-header-row">
        <div class="section-title">
          ${icon('list-video')}
          <span>${t('queueTitle')}</span>
          <span class="queue-summary">${activeCount} active · ${queuedCount} waiting${erroredCount ? ' · ' + erroredCount + ' need attention' : ''}</span>
        </div>
        <div class="queue-header-actions">
          ${queueLimitControl()}
          ${queuedCount > 0 ? `<button type="button" class="btn-text-sm" id="btn-clear-queued">${t('queueActionClearQueued')}</button>` : ''}
          ${erroredCount > 0 ? `<button type="button" class="btn-text-sm" id="btn-clear-errors" style="color:var(--accent-rose);font-weight:600;">Clear ${erroredCount} Errors</button>` : ''}
        </div>
      </div>

      ${state.tasks.length ? `
        ${state.tasks.length > queuePageSize ? `<nav class="queue-pagination" aria-label="Download queue pages"><button type="button" class="btn-page" id="queue-prev" aria-label="Previous downloads" title="Previous downloads" ${state.queuePage === 0 ? 'disabled' : ''}>${icon('chevron-left')}</button><span>Showing ${start + 1}–${Math.min(start + queuePageSize, state.tasks.length)} of ${state.tasks.length}</span><button type="button" class="btn-page" id="queue-next" aria-label="Next downloads" title="Next downloads" ${start + queuePageSize >= state.tasks.length ? 'disabled' : ''}>${icon('chevron-right')}</button></nav>` : ''}
        <div class="queue-items-list">
          ${visibleTasks.map(renderTaskCard).join('')}
        </div>
      ` : `
        <div class="queue-empty">
          <div class="queue-empty-icon">${icon('list-video')}</div>
          <div class="queue-empty-copy">
            <strong>No downloads in queue</strong>
            <span>Pick a video from your current tab or batch-select videos in your creator library to start downloading.</span>
          </div>
          <div class="empty-state-actions">
            <button type="button" class="btn-pill-action" id="btn-queue-empty-detected" data-empty-action="detected">${icon('video')} Detected videos</button>
            <button type="button" class="btn-pill-action" id="btn-queue-empty-library" data-empty-action="profile">${icon('user')} Open library</button>
          </div>
        </div>
      `}
    </section>` : ''}
    </div>

    ${state.downloadView === 'queue' && state.history.length ? '<button type="button" class="btn-pill-action history-shortcut" id="btn-view-history">View download history (' + state.history.length + ')</button>' : ''}
  `;
}
