import {parseProfileDocument} from '../../../assets/js/profile-scanner.js';
import {getVideoMetadata} from '../../../assets/js/video-details.js';
import {installOffscreenDownloads} from '../../../assets/js/offscreen-downloads.js';

installOffscreenDownloads();
let keepaliveTimer;
const keepaliveJobs = new Set();

chrome.runtime.onMessage.addListener((message,sender,respond) => {
  if (sender.id && sender.id !== chrome.runtime.id) return false;
  if (message.type==='video-parse-metadata') {
    try { respond({ok:true,metadata:getVideoMetadata(new DOMParser().parseFromString(message.html,'text/html'),message.pageUrl)}); }
    catch(error){respond({ok:false,error:error.message});}
    return false;
  }
  if (message.type === 'profile-parse-html') {
    try { respond({ok:true,result:parseProfileDocument(new DOMParser().parseFromString(message.html,'text/html'),message.pageUrl)}); }
    catch(error){respond({ok:false,error:error.message});}
    return false;
  }
  if (message.type === 'profile-scan-keepalive') {
    const job = message.job || 'scan';
    if (message.enabled) keepaliveJobs.add(job); else keepaliveJobs.delete(job);
    clearInterval(keepaliveTimer);
    if (keepaliveJobs.size) keepaliveTimer = setInterval(() => chrome.runtime.sendMessage({type:'profile-scan-ping'}).catch(() => {}),20000);
    return false;
  }
  if (message.type === 'revoke-blob-url') { URL.revokeObjectURL(message.blobUrl); return false; }
  if (message.type === 'OPFS_TO_BLOB_URL') {
    (async()=>{
      try {
        const root=await navigator.storage.getDirectory();
        const file=await (await root.getFileHandle(message.filename)).getFile();
        const blob=new Blob([file],{type:message.mimeType || file.type || 'application/octet-stream'});
        respond({ok:true,blobUrl:URL.createObjectURL(blob)});
      } catch(error) { respond({ok:false,error:error?.message || String(error)}); }
    })();
    return true;
  }
  return false;
});
