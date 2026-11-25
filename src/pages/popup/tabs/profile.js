import {icon} from '../../../../assets/js/icons.js';
import {rangeHint} from '../../../../assets/js/profile-selection.js';
import {
  state,
  profileVideoDownloaded,
  currentProfileSelection,
  profileSelectionView,
  profileSelectionNote,
  thumbnailHtml,
  downloadedLabel
} from '../state.js';
import {escapeHtml} from '../format.js';
import {outputFormatControl} from './queue.js';

export const PROFILE_PAGE_SIZE = 60;

export function filterProfileVideos(videos = state.profileVideos, query = state.profileSearchQuery) {
  const normalized = String(query || '').trim().toLocaleLowerCase();
  if (!normalized) return videos;
  return videos.filter(video => String(video.title || '').toLocaleLowerCase().includes(normalized));
}

function renderProfileVideoCard(video) {
  const selected = state.selectedIds.has(video.id);
  return `<div class="profile-video-card ${selected ? 'selected' : ''}" data-video-id="${escapeHtml(video.id)}">
    <input type="checkbox" class="profile-video-checkbox" aria-label="Select ${escapeHtml(video.title)}" data-video-id="${escapeHtml(video.id)}" ${selected ? 'checked' : ''} ${state.isBatchEnqueuing || profileVideoDownloaded(video) ? 'disabled' : ''}>
    ${state.showThumbnails ? `<div class="profile-thumb-wrapper">${thumbnailHtml(video, 'profile-thumb-img')}${video.duration ? `<span class="profile-duration-badge">${escapeHtml(video.duration)}</span>` : ''}</div>` : ''}
    <div class="profile-video-details"><div class="profile-video-title" title="${escapeHtml(video.title)}">${escapeHtml(video.title)}</div>
      <div class="profile-video-footer">${downloadedLabel(video.url)}<span class="profile-range-boundary" hidden></span>${video.views ? `<span class="profile-video-views">${icon('eye')}${escapeHtml(video.views)}</span>` : ''}</div>
    </div>
  </div>`;
}

export function renderProfileTab() {
  const selectedCount = state.selectedIds.size;
  const totalCount = state.profileVideos.length;
  if (!totalCount) state.profileDetailsCollapsed = false;
  const newCount = state.profileVideos.filter(video => !profileVideoDownloaded(video)).length;
  const query = state.profileSearchQuery.trim().toLocaleLowerCase();
  const matches = filterProfileVideos(state.profileVideos, query);
  const pageCount = Math.max(1, Math.ceil(matches.length / PROFILE_PAGE_SIZE));
  state.profileGridPage = Math.min(state.profileGridPage, pageCount - 1);
  const visibleVideos = matches.slice(state.profileGridPage * PROFILE_PAGE_SIZE, (state.profileGridPage + 1) * PROFILE_PAGE_SIZE);
  const sourceOpen = state.profileSourceOpen || !totalCount || !!state.profileScanError;
  const rangeActive = currentProfileSelection()?.mode === 'range';
  const progressPercent = totalCount ? Math.round((totalCount - newCount) / totalCount * 100) : 0;

  return `<section class="profile-workspace" aria-label="Creator video library">
    <div class="profile-library-details ${state.profileDetailsCollapsed ? 'is-collapsed' : ''}" id="profile-library-details" aria-hidden="${state.profileDetailsCollapsed}" ${state.profileDetailsCollapsed ? 'inert' : ''}>
    <div class="profile-library-details-content">
    <details class="profile-source-panel" id="profile-source-details" ${sourceOpen ? 'open' : ''}>
      <summary class="profile-source-summary" id="profile-source-summary">
        <span class="profile-creator">
          <span class="profile-avatar-circle">${state.showThumbnails && state.profileAvatar ? `<img src="${escapeHtml(state.profileAvatar)}" class="profile-avatar-img" alt="" referrerpolicy="no-referrer">` : icon('user')}</span>
          <span class="profile-info"><span class="profile-name-text">${escapeHtml(state.profileName || 'Creator library')}</span>
          <span class="profile-stats-text">${totalCount ? `${totalCount} videos · ${newCount} new · ${totalCount - newCount} downloaded` : 'Add a creator profile to load videos'}</span></span>
        </span>
        <span class="profile-source-meta"><span class="profile-source-affordance">Source ${icon('chevron-down')}</span></span>
      </summary>
      <div class="profile-source-content">
        <span class="profile-scan-status" role="status">${state.isScanningProfile ? 'Scanning…' : state.profilePagesScanned ? state.profilePagesScanned + ' pages scanned' : 'Choose a creator profile'}</span>
        <div class="profile-search-row">
          <input type="url" class="profile-search-input" id="profile-url-input" value="${escapeHtml(state.profileInputUrl || state.profileUrl || '')}" aria-label="Creator profile URL" placeholder="Paste a creator profile URL">
          <button type="button" class="btn-fetch-profile" id="btn-fetch-profile-videos" ${state.isScanningProfile || state.isBatchEnqueuing || state.isClearingProfile ? 'disabled' : ''}>${icon(state.isScanningProfile ? 'loader-circle' : 'search')}${state.isScanningProfile ? 'Scanning…' : 'Fetch videos'}</button>
          <button type="button" class="btn-pill-action" id="btn-clear-profile-results" ${state.isClearingProfile || !(totalCount || state.isScanningProfile || state.profileName || state.profileScanError) ? 'disabled' : ''}>${state.isClearingProfile ? 'Clearing…' : 'Clear results'}</button>
        </div>
        ${state.profileScanError ? `<p class="profile-scan-error" role="alert">${escapeHtml(state.profileScanError)} — Videos found so far are retained.</p>` : '<p class="profile-source-help">All linked pages are scanned. Completed downloads are excluded from new selections.</p>'}
      </div>
    </details>
    ${state.isScanningProfile ? '<div class="profile-notice" role="status"><span>Loading videos from linked pages…</span><button type="button" class="btn-text-sm" id="btn-stop-profile-scan">Stop scan</button></div>' : ''}
    ${state.batchProgress ? `<div class="profile-batch-panel ${state.profileBatchStatus === 'error' ? 'notice-error' : ''}"><div class="profile-notice" role="status"><span data-role="batch-progress" title="${escapeHtml(state.batchProgress)}">${escapeHtml(state.batchProgress)}</span></div><div class="profile-batch-actions"><button type="button" class="btn-pill-action" id="btn-pause-profile-batch" hidden>Pause batch</button><button type="button" class="btn-pill-action" id="btn-retry-profile-batch" hidden>Retry failed</button></div></div>` : ''}
    ${totalCount ? `
      <div class="library-overview" aria-label="Library download progress">
        <div class="library-overview-copy"><span class="library-eyebrow">YOUR COLLECTION</span><strong>Download progress</strong><span>Based on videos found in this library</span></div>
        <div class="library-overview-stats"><div><strong data-role="library-downloaded">${totalCount - newCount}</strong><span>Downloaded</span></div><div><strong data-role="library-remaining">${newCount}</strong><span>To download</span></div></div>
        <div class="library-progress" data-role="library-progress" role="progressbar" aria-label="Library videos downloaded" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${progressPercent}" style="--library-progress:${progressPercent}%"><span></span></div>
      </div>` : ''}
    </div></div>
    ${totalCount ? `
      <div class="profile-selection-toolbar" aria-label="Video selection tools">
        <div class="profile-selection-actions"><button type="button" class="btn-pill-action profile-details-toggle" id="btn-show-library-details" aria-controls="profile-library-details" aria-expanded="false" ${state.profileDetailsCollapsed ? '' : 'hidden'}>Details</button><button type="button" class="btn-pill-action" id="btn-profile-select-all" ${!newCount || state.isBatchEnqueuing ? 'disabled' : ''}>Select new</button><button type="button" class="btn-pill-action" id="btn-profile-range" aria-pressed="false">Select range</button><button type="button" class="btn-pill-action" id="btn-profile-clear-selection">Clear</button></div>
        <div class="profile-download-options"><label class="profile-quality-label"><span>Quality</span><select class="profile-quality-select" id="profile-quality-select" aria-label="Download quality">${[['best', 'Best available'], ['1080', '1080p'], ['720', '720p'], ['480', '480p'], ['240', '240p']].map(([value, label]) => `<option value="${value}" ${state.profileQuality === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label>${outputFormatControl('profile-output-format')}</div>
      </div>
      <p class="profile-range-hint" data-role="profile-range-hint" role="status" ${rangeActive ? '' : 'hidden'}>${escapeHtml(rangeHint(currentProfileSelection(), profileSelectionView()))}</p>
      <div class="profile-results-heading"><label class="search-field profile-filter">${icon('search')}<input type="search" id="profile-filter-input" value="${escapeHtml(state.profileSearchQuery)}" aria-label="Search loaded profile videos" placeholder="Search loaded videos"></label><nav class="profile-grid-pagination" aria-label="Profile video pages"><button type="button" class="btn-page" id="profile-grid-prev" aria-label="Previous videos" title="Previous videos" ${state.profileGridPage === 0 ? 'disabled' : ''}>${icon('chevron-left')}</button><span>${matches.length ? 'Showing ' + (state.profileGridPage * PROFILE_PAGE_SIZE + 1) + '–' + Math.min((state.profileGridPage + 1) * PROFILE_PAGE_SIZE, matches.length) + ' of ' + matches.length : 'No matches'}</span><button type="button" class="btn-page" id="profile-grid-next" aria-label="Next videos" title="Next videos" ${state.profileGridPage + 1 >= pageCount ? 'disabled' : ''}>${icon('chevron-right')}</button></nav></div>
      <div class="profile-video-grid ${state.showThumbnails ? '' : 'thumbnails-hidden'}" aria-label="Loaded profile videos" tabindex="0">
        ${visibleVideos.map(renderProfileVideoCard).join('') || '<div class="profile-filter-empty">' + icon('search') + '<strong>No matching videos</strong><span>Try another title. Your library selection is unchanged.</span></div>'}
      </div>
    ` : `<div class="profile-empty-state"><div class="profile-empty-icon">${icon('list-video')}</div><h2>${state.isScanningProfile ? 'Loading your library' : 'Your creator library'}</h2><p>${state.isScanningProfile ? 'Videos will appear here as pages are scanned.' : 'Paste a creator profile above and fetch its videos to start selecting.'}</p></div>`}
    <footer class="profile-download-bar">
      <div class="profile-selection-summary"><strong data-role="profile-selection-count">${selectedCount} / ${totalCount} selected</strong><span data-role="profile-selection-note" title="${query ? 'Search hides videos without changing your selection.' : ''}">${escapeHtml(profileSelectionNote())}</span></div>
      <div class="profile-download-actions"><button type="button" class="btn-cancel-batch" id="btn-cancel-profile-batch" title="Cancel this batch and its pending downloads" hidden>Cancel batch</button>${totalCount ? `<button type="button" class="btn-batch-download" id="btn-batch-download" ${!selectedCount || state.isBatchEnqueuing || state.isScanningProfile ? 'disabled' : ''}>${icon('download')} Download (${selectedCount})</button>` : ''}</div>
    </footer>
  </section>`;
}
