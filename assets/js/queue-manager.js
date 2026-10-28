import {SpeedMeter} from './speed.js';
import {DirectDownloader} from './direct-downloader.js';
import {crawlProfile} from './profile-scanner.js';
import {resolveMedia, safeFilePart} from './media-resolver.js';
import {HlsDownloader as PersistentHlsDownloader, removeHlsCache} from './hls-downloader.js';
import {profileKey,downloadedRecord,videoKey} from './video-details.js';
import {changeSelection,selectionView} from './profile-selection.js';
import {mediaHeaders,exactRequestCondition} from './media-headers.js';
import {createMediaDiscovery} from './media-discovery.js';
import {isXPage} from './x-media.js';
import {isMissavPage} from './missav-media.js';
import {OffscreenDownload} from './offscreen-client.js';
import {fetchBytes,networkError,transientError,retryDelay,errorData,restoreError} from './network.js';
import {installWindowManager} from './window-manager.js';

export function installQueueManager({queueStorage, historyStorage, settingsStorage, HlsDownloader = PersistentHlsDownloader, registerBlob, bindBlob, clearBlob, formatFilename, withSubdir}) {
  const active = new Map(), operations = new Map(), meter = new SpeedMeter();
  const useOffscreen=HlsDownloader===PersistentHlsDownloader && !!chrome.offscreen?.createDocument;
  const windowManager=installWindowManager();
  const headerRuleIds=new Set();
  let retryTimer,schedulingPromise;
  const discovery=createMediaDiscovery();
  chrome.tabs?.onRemoved?.addListener(tabId=>discovery.remove(tabId));
  let scheduling = false, reschedule = false, initialized = false, offscreenPromise, scanController, batchRunning = false;
  let batchJob,batchCancelling=false;
  let scanPromise,clearingProfile=false;
  let selectionOperation = Promise.resolve();
  const cancelledBatches = new Set();
  const taskById = async id => (await queueStorage.get()).tasks.find(t => t.id === id);
  const patch = (id, value) => queueStorage.updateTask(id, value);
  const notify = message => chrome.runtime.sendMessage(message).catch(() => {});
  const remoteInstance=(task,entry)=>new OffscreenDownload({task:{...task,downloadSubdir:entry.subdir},ensureOffscreen,
    saveFile:options=>saveFile({...options,entry}),...callbacks(task,entry),
    onFailure:error=>failed(entry.task,entry,error).catch(console.error),
    onSourceRefreshed:async source=>{Object.assign(entry.task,source);entry.kind=source.format==='m3u8'?'m3u8':'mp4';await patch(task.id,source);}});
  async function addHeaders(url,headers={}){
    const parsed=new URL(url);if(!/^https?:$/.test(parsed.protocol))throw Error('Invalid request URL');
    const requestHeaders=Object.entries(headers || {}).filter(([key,value])=>/^(Origin|Referer|Cookie)$/i.test(key) && typeof value==='string' && value && !/[\r\n]/.test(value)).map(([header,value])=>({operation:'set',header,value}));
    if(!requestHeaders.length)return 0;
    let id;do{id=600000000+Math.floor(Math.random()*400000000);}while(headerRuleIds.has(id));
    await chrome.declarativeNetRequest.updateSessionRules({addRules:[{id,priority:1,action:{type:'modifyHeaders',requestHeaders},condition:exactRequestCondition(parsed.href)}]});
    headerRuleIds.add(id);return id;
  }
  async function releaseHeaders(id){if(!headerRuleIds.has(id))return;await chrome.declarativeNetRequest.updateSessionRules({removeRuleIds:[id]});headerRuleIds.delete(id);}
  const serial = (id, fn) => {
    const next = (operations.get(id) || Promise.resolve()).then(fn);
    const settled = next.catch(() => {});
    operations.set(id, settled);
    return next.finally(() => { if (operations.get(id) === settled) operations.delete(id); });
  };
  async function ensureOffscreen() {
    if (!offscreenPromise) offscreenPromise = (async () => {
      if (await chrome.offscreen.hasDocument?.()) return;
      try {
        await chrome.offscreen.createDocument({url:'src/pages/offscreen/index.html',reasons:['BLOBS','DOM_PARSER','WORKERS'],justification:'Run persistent video transfer/conversion workers, save cached files and parse creator listings'});
      } catch (error) { if (!/already exists|single offscreen/i.test(error.message)) throw error; }
    })().finally(() => { offscreenPromise = null; });
    return offscreenPromise;
  }
  async function removeCache(name) {
    if (name) try { await (await navigator.storage.getDirectory()).removeEntry(name); } catch {}
  }
  async function removeTaskCache(task) {
    if(task?.outputCacheFileName && task.outputCacheFileName!==task.opfsCacheFileName)await removeCache(task.outputCacheFileName);
    if (task?.format === 'm3u8') {
      try { await removeHlsCache(task.opfsCacheFileName); } catch {}
    } else await removeCache(task?.opfsCacheFileName);
  }
  async function saveFile({opfsFileName, fileName, format, downloadSubdir, onProgress, bytesReceived,entry}) {
    if (entry?.deleted) throw Error('Batch cancelled');
    await ensureOffscreen();
    const result = await chrome.runtime.sendMessage({type:'OPFS_TO_BLOB_URL',filename:opfsFileName,mimeType:format === 'webm' ? 'video/webm' : format === 'm3u8' ? 'video/MP2T' : 'video/mp4'});
    if (!result?.ok || !result.blobUrl) throw Error(result?.error || 'Could not open the cached video');
    const blobUrl = result.blobUrl;
    if(entry)entry.phase='saving';
    const name = withSubdir(formatFilename(fileName || 'video', format === 'm3u8' ? 'ts' : format || 'mp4'), downloadSubdir);
    let downloadId, done = false;
    try {
      if (entry?.deleted) throw Error('Batch cancelled');
      await new Promise((resolve,reject) => {
        const changed = delta => {
          if (delta.id !== downloadId) return;
          if (delta.state?.current === 'complete') finish();
          else if (delta.state?.current === 'interrupted') finish(Error(delta.error?.current || 'File save interrupted'));
        };
        const finish = error => {
          if (done) return;
          done = true;
          chrome.downloads.onChanged.removeListener(changed);
          error ? reject(error) : resolve();
        };
        chrome.downloads.onChanged.addListener(changed);
        registerBlob(blobUrl, name);
        chrome.downloads.download({url:blobUrl,filename:name,saveAs:false,conflictAction:'uniquify'}, async id => {
          if (chrome.runtime.lastError || typeof id !== 'number') { clearBlob(blobUrl); finish(Error(chrome.runtime.lastError?.message || 'Unable to save video')); return; }
          downloadId = id;
          bindBlob(id, blobUrl);
          if (entry?.deleted) { await chrome.downloads.cancel(id).catch(() => {}); finish(Error('Batch cancelled')); return; }
          onProgress?.({progress:95,bytesReceived,isFileDownloading:true,chromeDownloadId:id,savedFileName:name});
          // Cover a completion event arriving before the download callback.
          try {
            const [item] = await chrome.downloads.search({id});
            if (item?.state === 'complete') finish();
            else if (item?.state === 'interrupted') finish(Error(item.error || 'File save interrupted'));
          } catch (error) { finish(error); }
        });
      });
    } finally {
      await notify({type:'revoke-blob-url',blobUrl});
    }
  }
  const recordCompletion = (task,entry) => historyStorage.addRecord(entry?.savedFileName || task.savedFileName || task.fileName || 'video',task.url,task.pageUrl,{
    taskId:task.id,title:task.title || task.fileName,creator:task.creator,quality:task.quality,
    format:entry?.task?.outputExtension || task.outputExtension || task.format,thumbnail:task.thumbnail,thumbnails:task.thumbnails,
    bytes:entry?.task?.outputBytes || task.outputBytes || entry?.instance?.getBytesReceived?.() || task.fetchedBytes || task.cachedBytes,
    downloadId:entry?.saveId ?? task.chromeDownloadId
  });
  async function completed(task, entry) {
    if (active.get(task.id) !== entry || entry.deleted || entry.finished) return;
    entry.finished = true;
    active.delete(task.id);
    clearTimeout(entry.progressTimer);
    meter.clear(task.id);
    await recordCompletion(task,entry);
    await queueStorage.removeTask(task.id);
    await entry.instance?.destroy?.(true);
    if(useOffscreen && !(entry.instance instanceof OffscreenDownload))await notify({type:'mf-offscreen-command',command:'drop',taskId:task.id});
    await removeTaskCache(task);
    notify({type:'download-task-complete',taskId:task.id,fileName:task.fileName});
    schedule();
  }
  async function failed(task, entry, error) {
    if (active.get(task.id) !== entry || entry.deleted || entry.finished || entry.paused) return;
    entry.finished = true;
    active.delete(task.id);
    clearTimeout(entry.progressTimer);
    meter.clear(task.id);
    error=networkError(error);
    const current=await taskById(task.id),retryCount=Number(current?.retryCount)||0;
    const retry=transientError(error) && retryCount<3;
    await patch(task.id,{outputReady:entry.task.outputReady,outputCacheFileName:entry.task.outputCacheFileName,outputExtension:entry.task.outputExtension,outputBytes:entry.task.outputBytes,fallbackReason:entry.task.fallbackReason,
      status:retry?'queued':'error',phase:retry?'waiting':'error',error:error.message,errorCode:error.code || error.name,retryCount:retry?retryCount+1:retryCount,
      nextRetryAt:retry?Date.now()+retryDelay(retryCount+1,error.retryAfter):undefined,downloadSpeed:0,speedFormatted:'',isFileDownloading:false,chromeDownloadId:undefined,cachedBytes:entry.instance?.getBytesReceived?.() || task.cachedBytes});
    await entry.instance?.destroy?.(false);
    if(useOffscreen && !(entry.instance instanceof OffscreenDownload))await notify({type:'mf-offscreen-command',command:'drop',taskId:task.id});
    if(!retry)notify({type:'download-task-error',taskId:task.id,error:error.message});
    schedule();
  }
  function progress(task, entry, data) {
    if (active.get(task.id) !== entry || entry.deleted || entry.finished) return;
    const bytes = data.bytesReceived==null ? Number(entry.task.cachedBytes || task.cachedBytes)||0 : Number(data.bytesReceived)||0;
    if (!entry.progressSeeded) { meter.clear(task.id); meter.update(task.id,bytes); entry.progressSeeded = true; }
    if (data.isFileDownloading) entry.phase = 'saving';
    else if(data.phase)entry.phase=data.phase;
    if (typeof data.chromeDownloadId === 'number') {
      entry.saveId = data.chromeDownloadId;
      if (entry.paused) chrome.downloads.pause(entry.saveId).catch(error => failed(task,entry,error.message));
    }
    const value = {progress:Math.max(0,Number(data.progress) || 0),finishNum:data.finishNum || 0,targetSegment:data.targetSegment || (entry.kind === 'm3u8' ? 0 : 1),
      errorNum:data.errorNum || 0,fetchedBytes:bytes,cachedBytes:bytes,isFileDownloading:!!data.isFileDownloading,
      ...meter.update(task.id,bytes,entry.paused || data.isFileDownloading)};
    if (typeof data.chromeDownloadId === 'number') value.chromeDownloadId = data.chromeDownloadId;
    if (data.totalBytes > 0) value.totalBytes = data.totalBytes;
    if (data.outputExtension) value.outputExtension = data.outputExtension;
    if(data.outputBytes>0)value.outputBytes=data.outputBytes;
    if(data.phase)value.phase=data.phase;
    if(data.fallbackReason)value.fallbackReason=data.fallbackReason;
    if(data.outputCacheFileName){value.outputCacheFileName=data.outputCacheFileName;value.outputReady=!!data.isFileDownloading || data.phase==='saving';}
    const critical=typeof data.chromeDownloadId==='number' || data.outputCacheFileName && value.outputReady || data.phase && data.phase!==entry.task.phase;
    Object.assign(entry.task,value);
    if(critical){entry.latestProgress=null;clearTimeout(entry.progressTimer);entry.progressTimer=null;return patch(task.id,value);}
    if (data.savedFileName) { entry.savedFileName=data.savedFileName;value.savedFileName=data.savedFileName; }
    // Serialize/coalesce disk writes; rapid network chunks must not flood storage.
    entry.latestProgress = {...entry.latestProgress,...value};
    if (!entry.progressTimer) entry.progressTimer = setTimeout(() => {
      entry.progressTimer = null;
      if (active.get(task.id) !== entry || entry.finished) return;
      const latest = entry.latestProgress;
      entry.latestProgress = null;
      patch(task.id,latest).catch(console.error);
    },200);
  }
  function callbacks(task, entry) {
    return {onProgress:data => progress(task,entry,data),onComplete:() => completed(task,entry).catch(console.error),onError:error => failed(task,entry,error).catch(console.error)};
  }
  async function start(task) {
    if (active.has(task.id)) return;
    const fresh = await taskById(task.id);
    if (fresh?.status !== 'queued' || cancelledBatches.has(fresh.batchId)) return;
    if (fresh.batchId && downloadedRecord((await historyStorage.get()).records || [],fresh.pageUrl,fresh.url)) {
      await queueStorage.removeTask(fresh.id);
      await removeTaskCache(fresh);
      return;
    }
    const kind = fresh.format === 'm3u8' || /\.m3u8(?:[?#]|$)/i.test(fresh.url) ? 'm3u8' : 'mp4';
    const entry = {kind,phase:'starting',paused:false,task:fresh,controller:new AbortController()};
    active.set(task.id,entry);
    try {
      const settings = await settingsStorage.get();
      if(entry.deleted || cancelledBatches.has(fresh.batchId))return;
      entry.subdir = settings.downloadSubdir || '';
      const cb = callbacks(fresh,entry);
      const saveForTask = options => saveFile({...options,entry});
      if(fresh.outputReady && fresh.outputCacheFileName){await exportCachedSave(fresh,entry);return;}
      if(useOffscreen){
        entry.instance=remoteInstance(fresh,entry);
        await patch(task.id,{status:'downloading',phase:fresh.url?'downloading':'resolving',startedAt:fresh.startedAt || Date.now(),nextRetryAt:undefined,error:undefined,downloadSpeed:0,isFileDownloading:false});
        if(entry.deleted || entry.paused)return;
        await entry.instance.start();return;
      }
      if(!fresh.url){
        const fetchForTask=(url,headers)=>fetchText(url,headers,entry.controller.signal);
        const media=await resolveMedia(await fetchForTask(fresh.pageUrl,{Referer:fresh.pageUrl}),fresh.pageUrl,fresh.quality,fetchForTask,{preferMp4:fresh.outputFormat==='mp4'});
        entry.controller.signal.throwIfAborted();
        if(downloadedRecord((await historyStorage.get()).records || [],fresh.pageUrl,media.url)){active.delete(task.id);await queueStorage.removeTask(task.id);schedule();return;}
        Object.assign(fresh,media);entry.kind=media.format==='m3u8'?'m3u8':'mp4';await patch(fresh.id,media);
      }
      const resolveSource = fresh.pageUrl ? async signal => {
        const fetchFresh = (url,headers) => fetchText(url,headers,signal);
        const html=isXPage(fresh.pageUrl)?'':await fetchFresh(fresh.pageUrl,{Referer:fresh.pageUrl});
        const media = await resolveMedia(html,fresh.pageUrl,fresh.quality,fetchFresh,
          {format:kind === 'm3u8' ? 'm3u8' : fresh.format || 'mp4',strictQuality:true});
        return {...media,headers:mediaHeaders(media.headers || fresh.headers,fresh.pageUrl)};
      } : undefined;
      entry.instance = entry.kind === 'm3u8' ? new HlsDownloader({maxConcurrent:4,retryInterval:1000,timeout:60000,saveFile:saveForTask,
        resolveSource,...cb}) : new DirectDownloader({saveFile:saveForTask,resolveSource,onSourceRefreshed:async source => {
          if (entry.deleted) return;
          const update = {url:source.url,headers:source.headers};
          Object.assign(entry.task,update);
          await patch(task.id,update);
        }});
      await patch(task.id,{status:'downloading',startedAt:Date.now(),error:undefined,downloadSpeed:0,speedFormatted:'0 B/s',isFileDownloading:false,chromeDownloadId:undefined});
      if(entry.deleted || cancelledBatches.has(fresh.batchId))return;
      entry.phase = 'fetching';
      meter.update(task.id,kind === 'mp4' ? fresh.cachedBytes || 0 : 0);
      const running = entry.kind === 'm3u8'
        ? entry.instance.start(fresh.url,{outputFormat:fresh.outputFormat || 'source',fileName:fresh.fileName || 'video',headers:fresh.headers,quality:fresh.quality,opfsFileName:fresh.opfsCacheFileName,downloadSubdir:entry.subdir})
        : entry.instance.start({...fresh,...cb,resumeFromByte:fresh.cachedBytes || 0,opfsFileName:fresh.opfsCacheFileName,downloadSubdir:entry.subdir});
      Promise.resolve(running).catch(error => failed(fresh,entry,error.message));
    } catch (error) { await failed(fresh,entry,error); }
  }
  function schedule(){
    reschedule=true;
    if(!initialized)return Promise.resolve();
    if(schedulingPromise)return schedulingPromise;
    schedulingPromise=drainQueue().finally(()=>{schedulingPromise=null;if(reschedule)schedule();});
    return schedulingPromise;
  }
  async function drainQueue() {
    reschedule = true;
    if (scheduling || !initialized) return;
    scheduling = true;
    try {
      while (reschedule) {
        reschedule = false;
        const limit = Math.max(1,Math.min(20,Math.floor(Number((await settingsStorage.get()).maxConcurrentTasks) || 6)));
        const tasks = (await queueStorage.get()).tasks;
        for (const task of tasks.filter(t => t.status === 'queued').sort((a,b) => a.createdAt-b.createdAt)) {
          if (cancelledBatches.has(task.batchId)) continue;
          if(task.nextRetryAt>Date.now())continue;
          const recovered = tasks.filter(t => t.status === 'downloading' && !active.has(t.id)).length;
          if (recovered + [...active.values()].filter(e => !e.paused && !e.finished).length >= limit) break;
          await serial(task.id,() => active.get(task.id)?.paused || typeof task.chromeDownloadId==='number' ? resumeNow(task.id) : start(task));
        }
      }
    } catch (error) { console.error('[queue] schedule',error); }
    finally {
      scheduling = false;clearTimeout(retryTimer);
      const waiting=(await queueStorage.get()).tasks.filter(task=>task.status==='queued' && task.nextRetryAt>Date.now());
      if(waiting.length){const when=Math.min(...waiting.map(task=>task.nextRetryAt));retryTimer=setTimeout(()=>schedule(),Math.max(1,when-Date.now()));retryTimer.unref?.();chrome.alarms?.create('mediaflow-queue-retry',{when});}
      else chrome.alarms?.clear('mediaflow-queue-retry');
    }
  }
  async function pause(id) {
    const task = await taskById(id);
    if (!task) throw Error('Task not found');
    if (task.status === 'paused') return;
    if (!['queued','downloading','error'].includes(task.status)) throw Error('Task cannot be paused');
    const entry = active.get(id);
    if (entry) {
      entry.paused = true;
      if (entry.progressTimer) { clearTimeout(entry.progressTimer); entry.progressTimer = null; }
      if (entry.phase === 'saving') {
        const saveId = entry.saveId ?? task.chromeDownloadId;
        if (typeof saveId === 'number') {
          try { await chrome.downloads.pause(saveId); }
          catch (error) { entry.paused = false; throw error; }
        }
      } else {entry.controller?.abort();await entry.instance?.pauseSoft();}
      entry.latestProgress = null;
    } else if (typeof task.chromeDownloadId === 'number') await chrome.downloads.pause(task.chromeDownloadId);
    if (await taskById(id)) await patch(id,{status:'paused',cachedBytes:entry?.instance?.getBytesReceived?.() ?? task.cachedBytes,downloadSpeed:0,speedFormatted:''});
    meter.clear(id);
    schedule();
  }
  async function exportCachedSave(task, previous) {
    // Some browsers cannot resume an interrupted blob download. Save the same
    // committed cache again instead of leaving the task permanently paused.
    const entry = {kind:task.format === 'm3u8' ? 'm3u8' : 'mp4',phase:'saving',paused:false,task,
      instance:{getBytesReceived:() => task.cachedBytes || task.fetchedBytes || 0,destroy:async()=>{}}};
    if (previous) { previous.finished = true; clearTimeout(previous.progressTimer); }
    active.set(task.id,entry);
    const oldId = previous?.saveId ?? task.chromeDownloadId;
    if (typeof oldId === 'number') await chrome.downloads.cancel(oldId).catch(() => {});
    await previous?.instance?.destroy?.(false);
    await patch(task.id,{status:'downloading',isFileDownloading:true,chromeDownloadId:undefined,error:undefined,downloadSpeed:0,speedFormatted:''});
    const settings = await settingsStorage.get();
    saveFile({opfsFileName:task.outputCacheFileName || task.opfsCacheFileName,fileName:task.fileName,format:task.outputExtension === 'mp4' ? 'mp4' : task.format,downloadSubdir:settings.downloadSubdir || '',entry,
      bytesReceived:entry.instance.getBytesReceived(),onProgress:data => progress(task,entry,data)})
      .then(() => completed(task,entry),error => failed(task,entry,error.message)).catch(console.error);
  }
  async function resume(id) {
    const task=await taskById(id);if(!task)throw Error('Task not found');
    if(task.status==='downloading')return;
    await patch(id,{status:'queued',error:undefined,retryCount:0,nextRetryAt:undefined});
    schedule();
  }
  async function resumeNow(id) {
    const task = await taskById(id);
    if (!task) throw Error('Task not found');
    let entry = active.get(id);
    if (task.status !== 'queued') return;
    const limit = Math.max(1,Math.min(20,Math.floor(Number((await settingsStorage.get()).maxConcurrentTasks) || 6)));
    const occupied = [...active.values()].filter(e => !e.paused && !e.finished).length + (await queueStorage.get()).tasks.filter(t => t.status === 'downloading' && !active.has(t.id)).length;
    if (occupied >= limit) {
      // Leave cached paused engines intact; scheduler resumes these when a slot opens.
      await patch(id,{status:'queued',error:undefined});
      schedule();
      return;
    }
    if (entry?.phase === 'saving' || typeof task.chromeDownloadId === 'number') {
      if(!entry){entry={kind:task.format==='m3u8'?'m3u8':'mp4',phase:'saving',task,paused:true,recoveredSave:true,instance:{getBytesReceived:()=>task.cachedBytes || 0}};active.set(id,entry);}
      const saveId = entry?.saveId ?? task.chromeDownloadId;
      if (entry) entry.paused = false;
      try { if (typeof saveId === 'number') await chrome.downloads.resume(saveId); }
      catch (error) {
        if (!task.opfsCacheFileName) { if (entry) entry.paused = true; throw error; }
        await exportCachedSave(task,entry);
        return;
      }
      await patch(id,{status:'downloading',error:undefined});
      return;
    }
    if(entry && !entry.instance){active.delete(id);await start(task);return;}
    if (entry) {
      entry.paused = false;
      entry.finished = false;
      entry.progressSeeded = false;
      meter.clear(id);
      await patch(id,{status:'downloading',error:undefined,downloadSpeed:0,speedFormatted:'0 B/s'});
      if (entry.instance instanceof OffscreenDownload || entry.kind === 'm3u8' && (entry.instance.persistent || entry.instance.tsUrlList?.length)) Promise.resolve(entry.instance.resume()).catch(error => failed(task,entry,error));
      else if (entry.kind === 'mp4') {
        entry.instance.start({...task,...callbacks(task,entry),resumeFromByte:entry.instance.getBytesReceived(),opfsFileName:task.opfsCacheFileName,downloadSubdir:entry.subdir}).catch(error => failed(task,entry,error.message));
      } else {
        active.delete(id);
        await entry.instance.destroy(false);
        await patch(id,{status:'queued'});
        schedule();
      }
    } else {
      await patch(id,{status:'queued',error:undefined,isFileDownloading:false,chromeDownloadId:undefined,downloadSpeed:0,speedFormatted:''});
      schedule();
    }
  }
  async function remove(id) {
    const task = await taskById(id);
    const entry = active.get(id);
    if (entry) { entry.deleted = true; entry.finished = true;entry.controller?.abort();clearTimeout(entry.progressTimer); active.delete(id); }
    const saveId = entry?.saveId ?? task?.chromeDownloadId;
    if (typeof saveId === 'number') await chrome.downloads.cancel(saveId).catch(() => {});
    await entry?.instance?.destroy?.(true);
    await queueStorage.removeTask(id);
    await removeTaskCache(task);
    meter.clear(id);
    schedule();
  }
  async function fetchResource(url, headers = {}, image = false, signal) {
    const parsed = new URL(url);
    if (!/^https?:$/.test(parsed.protocol)) throw Error('Invalid URL');
    if(useOffscreen){
      await ensureOffscreen();const id=crypto.randomUUID();
      const abort=()=>notify({type:'mf-fetch-cancel',id});signal?.throwIfAborted();signal?.addEventListener('abort',abort,{once:true});
      try{const result=await chrome.runtime.sendMessage({type:'mf-fetch-resource',id,url:parsed.href,headers,image});signal?.throwIfAborted();if(!result?.ok)throw restoreError(result?.error || {message:'The request failed'});return image?result.dataUrl:result.text;}
      finally{signal?.removeEventListener('abort',abort);}
    }
    const requestHeaders = new Headers(headers), rules = [];
    for (const key of ['Origin','Referer','Cookie']) {
      if (requestHeaders.has(key)) { rules.push({operation:'set',header:key,value:requestHeaders.get(key)}); requestHeaders.delete(key); }
    }
    const ruleId = Math.ceil(Math.random()*100000000);
    try {
      if (rules.length) await chrome.declarativeNetRequest.updateSessionRules({addRules:[{id:ruleId,priority:1,action:{type:'modifyHeaders',requestHeaders:rules},condition:exactRequestCondition(parsed.href)}]});
      const response = await fetchBytes(parsed.href,{headers:requestHeaders,signal,maxBytes:image?5*1024*1024:16*1024*1024});
      if (!image) return new TextDecoder().decode(response.data);
      const mime = (response.headers.get('Content-Type') || '').split(';')[0];
      if (!/^image\/(jpeg|png|webp|gif|avif)$/i.test(mime)) throw Error('The thumbnail URL did not return an image');
      const bytes = response.data;
      if (bytes.length > 5*1024*1024) throw Error('Thumbnail is too large');
      let binary = '';
      for (let i=0;i<bytes.length;i+=8192) binary += String.fromCharCode(...bytes.subarray(i,i+8192));
      return `data:${mime};base64,${btoa(binary)}`;
    } finally { if (rules.length) await chrome.declarativeNetRequest.updateSessionRules({removeRuleIds:[ruleId]}).catch(() => {}); }
  }
  const fetchText = (url,headers,signal) => fetchResource(url,headers,false,signal);
  async function batchProfile(message,job) {
    const signal=job.controller.signal;
    const fetchForBatch=(url,headers) => fetchText(url,headers,signal);
    let batch = {id:job.id,profileKey:job.profileKey,profileName:message.profileName,status:'running',total:message.videos.length,processed:0,enqueued:0,skipped:0,failed:0,errors:[],currentTitle:''};
    try {
      const settings=await settingsStorage.get();
      for (const video of message.videos) {
        signal.throwIfAborted();
        batch.currentTitle = video.title;
        await chrome.storage.local.set({profileBatchState:batch});
        try {
          if (downloadedRecord((await historyStorage.get()).records || [],video.url,video.videoUrl)) {
            batch.skipped++;batch.processed++;continue;
          }
          if((await queueStorage.get()).tasks.some(task=>videoKey(task.pageUrl)===videoKey(video.url))){
            batch.skipped++;batch.processed++;continue;
          }
          const creator = safeFilePart(message.profileName || 'Creator');
          const title = safeFilePart(video.title);
          const page=new URL(video.url);if(!/^https?:$/.test(page.protocol))throw Error('Invalid video page URL');
          await queueStorage.enqueue({url:'',quality:message.quality,outputFormat:message.outputFormat || settings.outputFormat || 'mp4',fileName:message.useChannelFolder ? `${creator}/${title}` : `${creator} - ${title}`,
            title:video.title,creator:message.profileName,thumbnail:video.thumbnail,thumbnails:video.thumbnails,
            batchId:job.id,batchProfileKey:job.profileKey,pageUrl:page.href,headers:mediaHeaders({},page.href)});
          batch.enqueued++;
          schedule();
        } catch (error) {
          if (signal.aborted) throw error;
          batch.failed++;
          batch.errors = [...batch.errors,{title:video.title,url:video.url,error:error.message}].slice(-100);
        }
        batch.processed++;
      }
      batch.status = 'complete';
    } catch (error) { batch.status = signal.aborted ? 'cancelling' : 'error'; if (!signal.aborted) batch.error = error.message; }
    finally {
      batchRunning = false;
      if (signal.aborted) batch.status='cancelling';
      await chrome.storage.local.set({profileBatchState:batch});
      notify({type:'profile-scan-keepalive',enabled:false,job:'batch'});
    }
  }
  async function cancelProfileBatch(message) {
    batchCancelling=true;
    try {
    const saved=(await chrome.storage.local.get('profileBatchState')).profileBatchState;
    const key=message.profileKey || (message.batchId===saved?.id ? saved.profileKey : batchJob?.profileKey || saved?.profileKey);
    const matches=task => !!task.batchId && (task.batchId===message.batchId || (key && task.batchProfileKey===key));
    const job=batchJob && (batchJob.id===message.batchId || batchJob.profileKey===key) ? batchJob : null;
    if (job) { cancelledBatches.add(job.id); job.controller.abort(); }
    // Fence scheduling/completion before waiting for the resolving request to stop.
    for (const task of (await queueStorage.get()).tasks.filter(matches)) {
      cancelledBatches.add(task.batchId);
      const entry=active.get(task.id); if(entry){entry.deleted=true;entry.controller?.abort();}
    }
    if (saved && (saved.id===message.batchId || saved.profileKey===key)) await chrome.storage.local.set({profileBatchState:{...saved,status:'cancelling'}});
    await job?.promise;
    let cancelled=0;
    for (const task of (await queueStorage.get()).tasks.filter(matches)) { await serial(task.id,() => remove(task.id)); cancelled++; }
    const current=(await chrome.storage.local.get('profileBatchState')).profileBatchState;
    if (current && (current.id===message.batchId || current.profileKey===key)) await chrome.storage.local.set({profileBatchState:{...current,status:'cancelled',cancelled}});
    return {cancelled};
    } finally {batchCancelling=false;}
  }
  async function scanProfile(url) {
    if (scanController) throw Error('A profile scan is already running');
    scanController = new AbortController();
    let scan = {status:'scanning',profileUrl:url,videos:[],pagesScanned:0,error:'',updatedAt:Date.now()};
    await chrome.storage.local.set({profileScanState:scan});
    try {
      await ensureOffscreen();
      await notify({type:'profile-scan-keepalive',enabled:true});
      const result = await crawlProfile(url,{signal:scanController.signal,fetchPage:url => fetchText(url,{Referer:url},scanController.signal),
        parsePage:async (html,pageUrl) => {
          const parsed = await chrome.runtime.sendMessage({type:'profile-parse-html',html,pageUrl});
          if (!parsed?.ok) throw Error(parsed?.error || 'Unable to parse creator page');
          return parsed.result;
        },onProgress:async result => { scan = {...scan,...result,updatedAt:Date.now()}; await chrome.storage.local.set({profileScanState:scan}); }});
      scan = {...scan,...result,status:'complete',updatedAt:Date.now()};
    } catch (error) { scan = {...scan,status:scanController.signal.aborted ? 'stopped' : 'error',error:error.message,updatedAt:Date.now()}; }
    finally {
      scanController = null;
      await chrome.storage.local.set({profileScanState:scan});
      notify({type:'profile-scan-keepalive',enabled:false});
    }
  }
  function updateSelection(message) {
    const next = selectionOperation.then(async () => {
      if(clearingProfile)throw Error('Profile results are being cleared');
      const url = new URL(message.profileUrl);
      if (!/^https?:$/.test(url.protocol)) throw Error('Invalid creator URL');
      const key = profileKey(url.href);
      const saved = await chrome.storage.local.get(['profileScanState','profileSelectionState']);
      const scan = saved.profileScanState;
      const previous = saved.profileSelectionState?.profileKey === key ? saved.profileSelectionState : null;
      const videos = profileKey(scan?.profileUrl) === key ? [...(scan.videos || [])] : [];
      if (message.video && !videos.some(video => videoKey(video.url) === videoKey(message.video.url))) {
        const videoUrl = new URL(message.video.url);
        if (videoUrl.origin !== url.origin) throw Error('Video must belong to this site');
        videos.push({...message.video,url:videoUrl.href});
      }
      const selection = {...changeSelection(previous,message.action,videos,(await historyStorage.get()).records || []),profileKey:key,profileUrl:url.href,updatedAt:Date.now()};
      await chrome.storage.local.set({profileSelectionState:selection});
      return {selection};
    });
    selectionOperation = next.catch(() => {});
    return next;
  }
  async function clearProfileResults() {
    if(clearingProfile)throw Error('Profile results are already being cleared');
    clearingProfile=true;
    try {
      scanController?.abort();
      // Let the old scan and any selection writes finish before committing the
      // empty result, so an in-flight page cannot restore the cleared list.
      await scanPromise;
      await selectionOperation;
      const saved=await chrome.storage.local.get(['profileScanState','profileSelectionState']);
      const url=saved.profileScanState?.profileUrl || saved.profileSelectionState?.profileUrl;
      await chrome.storage.local.set({
        profileScanState:{status:'cleared',profileUrl:'',profileName:'',profileAvatar:'',videos:[],pagesScanned:0,error:'',updatedAt:Date.now()},
        profileSelectionState:url ? {profileKey:profileKey(url),profileUrl:url,mode:'manual',keys:[],updatedAt:Date.now()} : null
      });
    } finally {clearingProfile=false;}
  }
  function beginProfileBatch(message) {
    if (batchRunning || batchCancelling) throw Error('A batch is already running');
    if (!Array.isArray(message.videos) || !message.videos.length) throw Error('Select at least one new video');
    batchRunning=true;
    batchJob={id:`batch-${Date.now()}-${Math.random().toString(36).slice(2,8)}`,profileKey:profileKey(message.profileUrl,message.profileName),controller:new AbortController()};
    batchJob.promise=batchProfile(message,batchJob).catch(console.error);
    return {batchId:batchJob.id};
  }
  async function batchSelectedProfile(message) {
    await selectionOperation;
    const saved = await chrome.storage.local.get(['profileScanState','profileSelectionState']);
    const scan = saved.profileScanState, key = profileKey(message.profileUrl);
    if (!scan || profileKey(scan.profileUrl) !== key || scan.status !== 'complete') throw Error('Finish scanning all creator pages before downloading the selection');
    const selection = saved.profileSelectionState?.profileKey === key ? saved.profileSelectionState : null;
    const view = selectionView(scan.videos || [],selection,(await historyStorage.get()).records || []);
    if (!view.complete) throw Error('Choose both range endpoints from this creator');
    const settings = await settingsStorage.get();
    return beginProfileBatch({...message,videos:view.videos,profileName:scan.profileName,profileUrl:scan.profileUrl,useChannelFolder:settings.useChannelFolder !== false});
  }
  chrome.runtime.onMessage.addListener((message,sender,respond) => {
    if (sender.id && sender.id !== chrome.runtime.id) return false;
    let operation;
    const id = message.taskId;
    switch (message.type) {
      case 'mediaflow-source-tab': operation=windowManager.source(message.windowId);break;
      case 'mf-run-event':
        if(sender.tab || !sender.url?.startsWith(chrome.runtime.getURL('src/pages/offscreen/')))return false;
        ready.then(()=>active.get(id)?.instance?.handle?.(message)).catch(console.error);respond({success:true});return false;
      case 'mf-run-rpc':
      case 'mf-header-add':
      case 'mf-header-release':
        if(sender.tab || !sender.url?.startsWith(chrome.runtime.getURL('src/pages/offscreen/')))return false;
        operation=ready.then(async()=>{
          if(message.type==='mf-header-add')return {result:await addHeaders(message.url,message.headers)};
          if(message.type==='mf-header-release'){await releaseHeaders(message.id);return {};}
          const entry=active.get(id);if(!entry || entry.instance?.runId!==message.runId || entry.deleted)throw Error('This download is no longer active');
          if(message.method==='source'){
            const source=message.params;
            if(downloadedRecord((await historyStorage.get()).records || [],entry.task.pageUrl,source.url)){
              serial(id,()=>remove(id)).catch(console.error);return {result:{skip:true}};
            }
            Object.assign(entry.task,source);entry.kind=source.format==='m3u8'?'m3u8':'mp4';await patch(id,source);return {result:{skip:false}};
          }
          if(message.method==='headers')return {result:await addHeaders(message.params.url,message.params.headers)};
          if(message.method==='release-headers'){await releaseHeaders(message.params.id);return {};}
          throw Error('Unknown worker operation');
        });break;
      case 'media-detection-report':
        discovery.report(message,sender);
        if(sender.tab?.id!=null)notify({type:'media-detection-updated',tabId:sender.tab.id});
        respond({success:true});return false;
      case 'media-detection-snapshot': operation=(async()=>{
        const tab=chrome.tabs?.get ? await chrome.tabs.get(message.tabId) : null;
        const pageUrl=tab?.url || message.pageUrl;
        return {videoInfos:discovery.snapshot(message.tabId,pageUrl),pageUrl,...(isXPage(pageUrl)?{site:'x'}:isMissavPage(pageUrl)?{site:'missav'}:{})};
      })();break;
      case 'download-queue-enqueue':
      case 'm3u8-download-start':
      case 'mp4-download-start':
        operation = (async () => {
          const url = new URL(message.url);
          if (!/^https?:$/.test(url.protocol)) throw Error('Invalid video URL');
          const format = message.format === 'hls' || message.format === 'm3u8' || /\.m3u8(?:[?#]|$)/i.test(url.href) ? 'm3u8' : message.format === 'webm' ? 'webm' : 'mp4';
          const settings=await settingsStorage.get();
          const taskId = await queueStorage.enqueue({...message,url:url.href,format,outputFormat:message.outputFormat || settings.outputFormat || 'mp4'});
          schedule(); return {id:taskId};
        })(); break;
      case 'download-queue-pause': operation = serial(id,() => pause(id)); break;
      case 'download-queue-resume': operation = serial(id,() => resume(id)).then(()=>schedulingPromise || schedule()); break;
      case 'download-queue-retry': operation = serial(id,() => resume(id)).then(()=>schedulingPromise || schedule()); break;
      case 'download-queue-delete':
      case 'download-queue-cancel': operation = serial(id,() => remove(id)); break;
      case 'download-queue-clear-queued':
      case 'download-queue-clear-errors': operation = (async () => {
        const status = message.type.endsWith('queued') ? 'queued' : 'error';
        for (const task of (await queueStorage.get()).tasks.filter(t => t.status === status)) await serial(task.id,() => remove(task.id));
      })(); break;
      case 'download-queue-snapshot': operation = queueStorage.get().then(state => ({state})); break;
      case 'download-history-remove': operation=historyStorage.removeRecord(message.recordId); break;
      case 'download-history-clear': operation=historyStorage.clearAll(); break;
      case 'm3u8-download-cancel':
      case 'mp4-download-cancel': operation = (async () => {
        const kind = message.type.startsWith('m3u8') ? 'm3u8' : 'mp4';
        for (const task of (await queueStorage.get()).tasks.filter(task => (task.format === 'm3u8' ? 'm3u8' : 'mp4') === kind)) await serial(task.id,() => remove(task.id));
      })(); break;
      case 'open-download-item': operation = (async () => {
        let items = typeof message.downloadId==='number' ? await chrome.downloads.search({id:message.downloadId}) : [];
        if (!items.length && message.url) items=await chrome.downloads.search({url:message.url});
        if (!items.length && message.fileName) items = await chrome.downloads.search({query:[message.fileName]});
        if (!items.length) throw Error('Download not found');
        await chrome.downloads.show(items[0].id);
      })(); break;
      case 'open-video-page': operation=(async()=>{ const url=new URL(message.url); if(!/^https?:$/.test(url.protocol))throw Error('Invalid video page');await chrome.tabs.create({url:url.href}); })(); break;
      case 'open-downloads-folder': chrome.downloads.showDefaultFolder(); respond({success:true}); return false;
      case 'ext-fetch-text': fetchText(message.url,message.headers).then(text => respond({ok:true,text}),error => respond({ok:false,error:error.message})); return true;
      case 'ext-fetch-image': fetchResource(message.url,{Referer:message.pageUrl || message.url},true).then(dataUrl => respond({ok:true,dataUrl}),error => respond({ok:false,error:error.message})); return true;
      case 'ext-fetch-video-metadata': operation=(async()=>{await ensureOffscreen();const result=await chrome.runtime.sendMessage({type:'video-parse-metadata',html:await fetchText(message.url,{Referer:message.url}),pageUrl:message.url});if(!result?.ok)throw Error(result?.error || 'Unable to read video thumbnail');return result.metadata;})(); break;
      case 'profile-scan-start':
        if (scanController || clearingProfile) { respond({success:false,error:clearingProfile?'Profile results are being cleared':'A profile scan is already running'}); return false; }
        scanPromise=scanProfile(message.url).catch(console.error); respond({success:true}); return false;
      case 'profile-scan-stop': scanController?.abort(); respond({success:true}); return false;
      case 'profile-results-clear': operation=clearProfileResults(); break;
      case 'profile-selection-update': operation=updateSelection(message); break;
      case 'profile-batch-selected': operation=batchSelectedProfile(message); break;
      case 'profile-batch-start':
        operation=Promise.resolve().then(() => beginProfileBatch(message)); break;
      case 'profile-batch-cancel': operation=cancelProfileBatch(message); break;
      default: return false;
    }
    operation.then(result => respond({success:true,...result}),error => respond({success:false,error:error.message,detail:errorData(error)}));
    return true;
  });
  // Restore saves after a worker restart, including paused browser downloads.
  chrome.downloads.onChanged.addListener(async delta => {
    for (const task of (await queueStorage.get()).tasks) {
      if (task.chromeDownloadId !== delta.id || active.has(task.id) && !active.get(task.id).recoveredSave) continue;
      const entry=active.get(task.id);
      if (delta.state?.current === 'complete') {
        if(entry){await completed(task,entry);continue;}
        await recordCompletion(task);
        if(useOffscreen)await notify({type:'mf-offscreen-command',command:'drop',taskId:task.id});
        await queueStorage.removeTask(task.id); await removeTaskCache(task); schedule();
      } else if (delta.state?.current === 'interrupted') {
        const recovered=entry || {kind:task.format==='m3u8'?'m3u8':'mp4',phase:'saving',paused:false,task,instance:{getBytesReceived:()=>task.cachedBytes || 0}};
        if(!entry)active.set(task.id,recovered);
        await failed(task,recovered,Error(delta.error?.current || 'File save interrupted'));
      }
      else if (delta.paused) await patch(task.id,{status:delta.paused.current ? 'paused' : 'downloading'});
    }
  });
  settingsStorage.subscribe(() => schedule());
  chrome.alarms?.onAlarm.addListener(alarm=>{if(alarm.name==='mediaflow-queue-retry')schedule();});
  const ready = (async () => {
    let remoteRuns=[];
    if(useOffscreen && await chrome.offscreen.hasDocument?.()){
      const snapshot=await chrome.runtime.sendMessage({type:'mf-offscreen-command',command:'snapshot'});remoteRuns=snapshot?.runs || [];
    }
    const ownedRules=new Set(remoteRuns.flatMap(run=>run.ruleIds || []));
    for(const id of ownedRules)headerRuleIds.add(id);
    if(useOffscreen){const rules=await chrome.declarativeNetRequest.getSessionRules();const orphaned=rules.filter(rule=>rule.id>=600000000 && rule.id<1000000000 && !ownedRules.has(rule.id)).map(rule=>rule.id);if(orphaned.length)await chrome.declarativeNetRequest.updateSessionRules({removeRuleIds:orphaned});}
    for (const task of (await queueStorage.get()).tasks) {
      const run=remoteRuns.find(run=>run.taskId===task.id);
      if(run && task.status!=='paused' && typeof task.chromeDownloadId!=='number'){
        const restored={...task,...run.task};
        const entry={kind:restored.format==='m3u8'?'m3u8':'mp4',phase:run.progress?.phase || 'downloading',task:restored,paused:false,subdir:restored.downloadSubdir || ''};
        entry.instance=remoteInstance(restored,entry);entry.instance.runId=run.runId;entry.instance.bytes=run.bytes;active.set(task.id,entry);
        await patch(task.id,{...run.task,...run.progress,status:'downloading'});
        if(run.state==='ready')entry.instance.handle({runId:run.runId,event:'ready',output:run.output});
        if(run.state==='error')await failed(restored,entry,restoreError(run.error));
        continue;
      }
      if (typeof task.chromeDownloadId === 'number') {
        const [item] = await chrome.downloads.search({id:task.chromeDownloadId});
        if (item?.state === 'complete') { await recordCompletion(task); await queueStorage.removeTask(task.id); await removeTaskCache(task); }
        else if (item?.state === 'in_progress') await patch(task.id,{status:item.paused ? 'paused' : 'downloading'});
        else await patch(task.id,{status:'error',error:'File save interrupted. Retry to save the video again.',chromeDownloadId:undefined,isFileDownloading:false});
      } else if (task.status === 'downloading') await patch(task.id,{status:'queued',isFileDownloading:false,downloadSpeed:0,speedFormatted:''});
    }
    const saved = (await chrome.storage.local.get('profileScanState')).profileScanState;
    if (saved?.status === 'scanning' && !scanController) await chrome.storage.local.set({profileScanState:{...saved,status:'stopped',error:'Scan interrupted. Fetch Videos again to rescan all pages.'}});
    const savedBatch = (await chrome.storage.local.get('profileBatchState')).profileBatchState;
    if (savedBatch?.status==='cancelled' || savedBatch?.status==='cancelling') {
      cancelledBatches.add(savedBatch.id);
      for(const task of (await queueStorage.get()).tasks.filter(task => task.batchId && (task.batchId===savedBatch.id || task.batchProfileKey===savedBatch.profileKey)))await remove(task.id);
      await chrome.storage.local.set({profileBatchState:{...savedBatch,status:'cancelled'}});
    }
    if (savedBatch?.status === 'running' && !batchRunning) await chrome.storage.local.set({profileBatchState:{...savedBatch,status:'error',error:'Batch interrupted. Select remaining videos and start again.'}});
    for(const run of remoteRuns)if(!await taskById(run.taskId))await notify({type:'mf-offscreen-command',command:'drop',taskId:run.taskId});
    initialized = true;
    await schedule();
  })().catch(console.error);
  return {ready,active,pause:id => serial(id,() => pause(id)),resume:async id => {await serial(id,() => resume(id));await (schedulingPromise || schedule());},remove:id => serial(id,() => remove(id)),schedule};
}
