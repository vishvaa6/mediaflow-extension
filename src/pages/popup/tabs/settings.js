import {icon} from '../../../../assets/js/icons.js';
import {state} from '../state.js';
import {t, escapeHtml} from '../format.js';

export function renderSettingsTab() {
  return `<div class="view-heading"><div><h1>Settings</h1><p>Choose how your videos are saved. Changes save automatically.</p></div><span class="settings-version">v${escapeHtml(chrome.runtime.getManifest?.()?.version || '1.3.0')}</span></div>
    <div class="settings-group">
      <section class="settings-section" aria-labelledby="settings-downloads-title"><div class="settings-section-heading">${icon('download')}<h2 id="settings-downloads-title">Download behavior</h2></div>
        <div class="settings-panel">
          <div class="setting-card-row"><div class="setting-label-col"><label class="setting-title" for="output-format-select">Download format</label><span class="setting-desc">Prefer MP4. Other streams keep their playable original format.</span></div><select id="output-format-select" class="profile-quality-select" aria-label="Download format"><option value="mp4" ${state.outputFormat === 'mp4' ? 'selected' : ''}>MP4 preferred</option><option value="source" ${state.outputFormat === 'source' ? 'selected' : ''}>Original format</option></select></div>
          <div class="setting-card-row"><div class="setting-label-col"><span class="setting-title">${t('settingsMaxConcurrent')}</span><span class="setting-desc">0-12 simultaneous downloads. 0 holds the queue. Lower limits use less RAM; excess downloads keep their progress.</span></div><div class="concurrency-stepper"><button type="button" class="btn-stepper" id="btn-concurrency-minus" aria-label="Decrease queue concurrency" ${state.maxConcurrentTasks <= 0 ? 'disabled' : ''}>-</button><span class="concurrency-val">${state.maxConcurrentTasks}</span><button type="button" class="btn-stepper" id="btn-concurrency-plus" aria-label="Increase queue concurrency" ${state.maxConcurrentTasks >= 12 ? 'disabled' : ''}>+</button></div></div>
          <div class="setting-card-row setting-pending"><div class="setting-label-col"><label class="setting-title" for="settings-pending-limit">Queue limit</label><span class="setting-desc">Maximum videos waiting to download. 0 means unlimited. Profile batches wait for space; existing downloads are kept.</span></div><input type="number" class="modern-input" id="settings-pending-limit" min="0" max="10000" step="1" value="${state.maxPendingTasks}"></div>
        </div>
      </section>
      <section class="settings-section" aria-labelledby="settings-files-title"><div class="settings-section-heading">${icon('folder')}<h2 id="settings-files-title">Files and folders</h2></div>
        <div class="settings-panel">
          <div class="setting-card-row setting-destination"><div class="setting-label-col"><label class="setting-title" for="settings-subdir-input">${t('downloadSubdirLabel')}</label><span class="setting-desc">A subfolder inside your browser's Downloads folder.</span></div><input type="text" class="modern-input" id="settings-subdir-input" value="${escapeHtml(state.downloadSubdir)}" placeholder="MediaFlow/"></div>
          <div class="setting-card-row"><div class="setting-label-col"><span class="setting-title">Creator folders</span><span class="setting-desc">Keep each creator's videos together in a subfolder.</span></div><button type="button" class="modern-switch ${state.useChannelFolder ? 'checked' : ''}" id="toggle-channel-folder" role="switch" aria-checked="${state.useChannelFolder}" aria-label="Creator folders"><span class="modern-switch-thumb"></span></button></div>
          <div class="setting-card-row"><div class="setting-label-col"><span class="setting-title">Downloads folder</span><span class="setting-desc">Find files saved by your browser.</span></div><button type="button" class="btn-pill-action" id="btn-open-downloads-folder">${icon('folder')}Open folder</button></div>
        </div>
      </section>
      <section class="settings-section" aria-labelledby="settings-display-title"><div class="settings-section-heading">${icon('image')}<h2 id="settings-display-title">Display</h2></div>
        <div class="settings-panel"><div class="setting-card-row"><div class="setting-label-col"><span class="setting-title">Video thumbnails</span><span class="setting-desc">Show previews in downloads, your library and history.</span></div><button type="button" class="modern-switch ${state.showThumbnails ? 'checked' : ''}" id="toggle-thumbnails" role="switch" aria-checked="${state.showThumbnails}" aria-label="Show thumbnails"><span class="modern-switch-thumb"></span></button></div></div>
      </section>
    </div>`;
}
