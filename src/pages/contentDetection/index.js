import(chrome.runtime.getURL('assets/js/media-detection.js')).then(module => module.installMediaDetection()).catch(error => console.warn('MediaFlow detection:',error));
import(chrome.runtime.getURL('assets/js/download-badges.js')).then(module=>module.installDownloadBadges()).catch(error=>console.warn('MediaFlow status:',error));
