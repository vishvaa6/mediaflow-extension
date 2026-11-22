import {icon} from '../../../../assets/js/icons.js';
import {state, thumbnailHtml} from '../state.js';
import {formatBytes, escapeHtml} from '../format.js';

const HISTORY_PAGE_SIZE = 30;

function formatHistoryDate(value) {
  try {
    return new Intl.DateTimeFormat(undefined, {dateStyle: 'medium', timeStyle: 'short'}).format(new Date(value));
  } catch {
    return 'Date unavailable';
  }
}

export function renderHistoryTab() {
  const query = state.historyQuery.trim().toLowerCase();
  const records = state.history
    .filter(record => !query || [record.title, record.fileName, record.creator, record.pageUrl].some(value => String(value || '').toLowerCase().includes(query)))
    .sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));
  const pageCount = Math.max(1, Math.ceil(records.length / HISTORY_PAGE_SIZE));
  state.historyPage = Math.min(state.historyPage, pageCount - 1);
  const visible = records.slice(state.historyPage * HISTORY_PAGE_SIZE, (state.historyPage + 1) * HISTORY_PAGE_SIZE);

  const emptyMarkup = query
    ? `<div class="history-empty">
        <div class="profile-empty-icon">${icon('search')}</div>
        <h2>No matching downloads</h2>
        <p>Try another title, creator, or filename, or clear your search filter.</p>
        <div class="empty-state-actions">
          <button type="button" class="btn-pill-action" id="btn-clear-history-search" data-empty-action="clear-history-search">Clear search</button>
        </div>
      </div>`
    : `<div class="history-empty">
        <div class="profile-empty-icon">${icon('history')}</div>
        <h2>No completed downloads yet</h2>
        <p>Completed downloads will appear here with quick actions to open the saved file or revisit its source page.</p>
        <div class="empty-state-actions">
          <button type="button" class="btn-pill-action" id="btn-history-empty-downloads" data-empty-action="downloads">${icon('download')} Browse downloads</button>
        </div>
      </div>`;

  return `<div class="view-heading"><div><h1>History</h1><p>${state.history.length} completed downloads · Saved on this browser</p></div><button type="button" class="btn-text-sm danger-text" id="btn-clear-history" ${state.history.length ? '' : 'disabled'}>${icon('trash-2')}Clear history</button></div>
    <section class="history-workspace" aria-label="Download history">
      <label class="search-field history-search-field">${icon('search')}<input id="history-search" type="search" aria-label="Search download history" placeholder="Search title, creator, or filename" value="${escapeHtml(state.historyQuery)}"></label>
      <div class="history-records">${visible.map(record => `<article class="history-record" data-history-id="${escapeHtml(record.id)}">
        ${state.showThumbnails ? `<div class="history-thumbnail">${thumbnailHtml({...record, id: 'history:' + record.id, url: record.pageUrl || record.url}, 'history-thumbnail-img')}</div>` : ''}
        <div class="history-record-details"><div class="history-record-heading"><div class="history-record-title" title="${escapeHtml(record.title || record.fileName)}">${escapeHtml(record.title || record.fileName || 'Video')}</div><span class="history-saved">${icon('check-check')}Saved</span></div>
        <div class="history-record-meta">${record.creator ? `<span>${escapeHtml(record.creator)}</span>` : ''}<time>${escapeHtml(formatHistoryDate(record.completedAt))}</time>${record.quality ? `<span>${escapeHtml(record.quality)}${/^\d+$/.test(String(record.quality)) ? 'p' : ''}</span>` : ''}${record.format ? `<span>${escapeHtml(String(record.format).toUpperCase())}</span>` : ''}${record.bytes > 0 ? `<span>${formatBytes(record.bytes)}</span>` : ''}</div>
        <div class="history-record-actions"><button type="button" class="btn-pill-action" data-history-action="show" data-id="${escapeHtml(record.id)}">${icon('folder')}Show file</button>${record.pageUrl ? `<button type="button" class="btn-pill-action" data-history-action="source" data-id="${escapeHtml(record.id)}">${icon('arrow-up-right')}Source</button>` : ''}<details class="history-file-details"><summary>File details</summary><p>${escapeHtml(record.fileName || 'File name unavailable')}</p></details><button type="button" class="btn-icon-btn history-remove" data-action="delete-history" data-id="${escapeHtml(record.id)}" title="Remove from history" aria-label="Remove from history">${icon('trash-2')}</button></div></div>
      </article>`).join('') || emptyMarkup}</div>
      ${records.length > HISTORY_PAGE_SIZE ? `<nav class="history-pagination" aria-label="History pages"><button type="button" class="btn-pill-action" id="history-prev" ${state.historyPage === 0 ? 'disabled' : ''}>${icon('chevron-left')}Previous</button><span>${state.historyPage * HISTORY_PAGE_SIZE + 1}–${Math.min((state.historyPage + 1) * HISTORY_PAGE_SIZE, records.length)} of ${records.length}</span><button type="button" class="btn-pill-action" id="history-next" ${state.historyPage + 1 >= pageCount ? 'disabled' : ''}>Next${icon('chevron-right')}</button></nav>` : ''}
    </section>`;
}
