const CLEAR_RETRY = {retryAt: undefined, retryAttempt: undefined, retryMax: undefined, retryError: undefined};

export function createFileSaver({
  ensureOffscreen,
  registerBlob,
  bindBlob,
  clearBlob,
  formatFilename,
  withSubdir,
  notify,
  queueStorage,
  settingsStorage,
  active,
  useOffscreen = false,
  needsMp4Rebuild,
  patch,
  progress,
  completed,
  failed,
  recordCompletion,
  removeTaskCache,
  schedule
}) {
  async function saveFile({opfsFileName, fileName, format, downloadSubdir, onProgress, bytesReceived, entry}) {
    if (entry?.deleted) throw Error('Batch cancelled');
    await ensureOffscreen();
    const mimeType = format === 'webm' ? 'video/webm' : format === 'm3u8' ? 'video/MP2T' : 'video/mp4';
    const result = await chrome.runtime.sendMessage({type: 'OPFS_TO_BLOB_URL', filename: opfsFileName, mimeType});
    if (!result?.ok || !result.blobUrl) throw Error(result?.error || 'Could not open the cached video');
    const blobUrl = result.blobUrl;
    let downloadId, done = false, changed = null;
    try {
      if (entry) entry.phase = 'saving';
      const name = withSubdir(formatFilename(fileName || 'video', format === 'm3u8' ? 'ts' : format || 'mp4'), downloadSubdir);
      if (entry?.deleted) throw Error('Batch cancelled');
      await new Promise((resolve, reject) => {
        const finish = error => {
          if (done) return;
          done = true;
          error ? reject(error) : resolve();
        };
        changed = delta => {
          if (delta.id !== downloadId) return;
          if (delta.state?.current === 'complete') finish();
          else if (delta.state?.current === 'interrupted') finish(Error(delta.error?.current || 'File save interrupted'));
        };
        chrome.downloads.onChanged.addListener(changed);
        registerBlob?.(blobUrl, name);
        chrome.downloads.download({url: blobUrl, filename: name, saveAs: false, conflictAction: 'uniquify'}, async id => {
          if (chrome.runtime.lastError || typeof id !== 'number') {
            finish(Error(chrome.runtime.lastError?.message || 'Unable to save video'));
            return;
          }
          downloadId = id;
          bindBlob?.(id, blobUrl);
          if (entry?.deleted) {
            await chrome.downloads.cancel(id).catch(() => {});
            finish(Error('Batch cancelled'));
            return;
          }
          onProgress?.({progress: 95, bytesReceived, isFileDownloading: true, chromeDownloadId: id, savedFileName: name});
          // Cover a completion event arriving before the download callback.
          try {
            const [item] = await chrome.downloads.search({id});
            if (item?.state === 'complete') finish();
            else if (item?.state === 'interrupted') finish(Error(item.error || 'File save interrupted'));
          } catch (error) {
            finish(error);
          }
        });
      });
    } finally {
      if (changed) chrome.downloads.onChanged.removeListener(changed);
      try {
        clearBlob?.(blobUrl);
      } finally {
        await notify({type: 'revoke-blob-url', blobUrl});
      }
    }
  }

  async function exportCachedSave(task, previous) {
    // Some browsers cannot resume an interrupted blob download. Save the same
    // committed cache again instead of leaving the task permanently paused.
    if (needsMp4Rebuild?.(task)) {
      const oldId = previous?.saveId ?? task.chromeDownloadId;
      if (typeof oldId === 'number') await chrome.downloads.cancel(oldId).catch(() => {});
      if (previous) { previous.finished = true; clearTimeout(previous.progressTimer); await previous.instance?.destroy?.(false); }
      active.delete(task.id);
      await patch(task.id, {status: 'queued', outputReady: false, chromeDownloadId: undefined, isFileDownloading: false, ...CLEAR_RETRY});
      schedule();
      return;
    }
    const entry = {
      kind: task.format === 'm3u8' ? 'm3u8' : 'mp4',
      phase: 'saving',
      paused: false,
      task,
      instance: {getBytesReceived: () => task.cachedBytes || task.fetchedBytes || 0, destroy: async () => {}}
    };
    if (previous) { previous.finished = true; clearTimeout(previous.progressTimer); }
    active.set(task.id, entry);
    const oldId = previous?.saveId ?? task.chromeDownloadId;
    if (typeof oldId === 'number') await chrome.downloads.cancel(oldId).catch(() => {});
    await previous?.instance?.destroy?.(false);
    Object.assign(entry.task, {status: 'downloading', ...CLEAR_RETRY});
    await patch(task.id, {status: 'downloading', isFileDownloading: true, chromeDownloadId: undefined, error: undefined, needsSourceRefresh: undefined, downloadSpeed: 0, speedFormatted: '', ...CLEAR_RETRY});
    const settings = await settingsStorage.get();
    saveFile({
      opfsFileName: task.outputCacheFileName || task.opfsCacheFileName,
      fileName: task.fileName,
      format: task.outputExtension === 'mp4' ? 'mp4' : task.format,
      downloadSubdir: settings.downloadSubdir || '',
      entry,
      bytesReceived: entry.instance.getBytesReceived(),
      onProgress: data => progress(task, entry, data)
    }).then(() => completed(task, entry), error => failed(task, entry, error.message)).catch(console.error);
  }

  // Restore saves after a worker restart, including paused browser downloads.
  async function handleDownloadChange(delta) {
    if (!queueStorage) return;
    for (const task of (await queueStorage.get()).tasks) {
      if (task.chromeDownloadId !== delta.id || (active.has(task.id) && !active.get(task.id).recoveredSave)) continue;
      const entry = active.get(task.id);
      if (delta.state?.current === 'complete') {
        if (entry) { await completed(task, entry); continue; }
        await recordCompletion(task);
        if (useOffscreen) await notify({type: 'mf-offscreen-command', command: 'drop', taskId: task.id});
        await queueStorage.removeTask(task.id);
        await removeTaskCache(task);
        schedule();
      } else if (delta.state?.current === 'interrupted') {
        const recovered = entry || {
          kind: task.format === 'm3u8' ? 'm3u8' : 'mp4',
          phase: 'saving',
          paused: false,
          task,
          instance: {getBytesReceived: () => task.cachedBytes || 0}
        };
        if (!entry) active.set(task.id, recovered);
        await failed(task, recovered, Error(delta.error?.current || 'File save interrupted'));
      } else if (delta.paused) {
        await patch(task.id, {
          status: delta.paused.current ? (task.queueLimited ? 'queued' : 'paused') : 'downloading',
          ...(delta.paused.current ? CLEAR_RETRY : {})
        });
      }
    }
  }

  function installDownloadListener() {
    chrome.downloads?.onChanged?.addListener(handleDownloadChange);
    return handleDownloadChange;
  }

  return {saveFile, exportCachedSave, handleDownloadChange, installDownloadListener};
}
