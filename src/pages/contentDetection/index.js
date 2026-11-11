(() => {
  const start=(path,install,label)=>Promise.resolve()
    .then(()=>import(chrome.runtime.getURL(path)))
    .then(module=>module[install]())
    .catch(error=>{
      if (/extension context invalidated/i.test(error?.message || '')) document.dispatchEvent(new Event('mediaflow:context-invalidated'));
      else console.warn(`MediaFlow ${label}:`,error);
    });
  start('assets/js/media-detection.js','installMediaDetection','detection');
  start('assets/js/download-badges.js','installDownloadBadges','status');
})();
