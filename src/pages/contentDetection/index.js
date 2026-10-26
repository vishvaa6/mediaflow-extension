import(chrome.runtime.getURL('assets/js/media-detection.js')).then(module => module.installMediaDetection()).catch(error => console.warn('MediaFlow detection:',error));
