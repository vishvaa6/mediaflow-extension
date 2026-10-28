import {needsSourceRefresh,httpError} from './source-refresh.js';
import {exactRequestCondition} from './media-headers.js';
import {waitForData,networkError,retryAfterMs} from './network.js';

// Streaming downloads commit the partial OPFS file before acknowledging a pause.
export class DirectDownloader {
  bytesReceived = 0;
  currentRun = null;
  pauseRequested = false;
  destroyed = false;
  activeRuleIds = [];
  constructor({saveFile, fetcher = fetch, storage = navigator.storage, networkTimeout = 60000, headerBridge, resolveSource, onSourceRefreshed} = {}) {
    this.saveFile = saveFile;
    // Native Window/Worker fetch requires its original global receiver.
    this.fetcher = (url, options) => fetcher.call(globalThis, url, options);
    this.storage = storage;
    this.networkTimeout = networkTimeout;
    this.resolveSource = resolveSource;
    this.onSourceRefreshed = onSourceRefreshed;
    this.headerBridge=headerBridge;
  }
  getBytesReceived() { return this.bytesReceived; }
  start(options) {
    this.pauseRequested = false;
    this.destroyed = false;
    const run = this.run(options);
    this.currentRun = run;
    return run.finally(() => { if (this.currentRun === run) this.currentRun = null; });
  }
  async openResponse(url,headers,start,offset) {
    await this.cleanupHeaderRules();
    this.check();
    await this.registerHeaderRules(url,headers);
    this.check();
    const requestHeaders = new Headers(headers);
    for (const key of ['Origin','Referer','Cookie']) requestHeaders.delete(key);
    if (offset) requestHeaders.set('Range',`bytes=${start}-`);
    const response = await this.waitForNetwork(this.fetcher(url,{headers:requestHeaders,credentials:'include',cache:'no-store',signal:this.abortController.signal}));
    if (!response.ok) { await response.body?.cancel(); throw Object.assign(httpError(response.status),{code:'HTTP',retryAfter:retryAfterMs(response.headers.get('Retry-After'))}); }
    return response;
  }
  check() {
    if (this.pauseRequested || this.destroyed || this.abortController.signal.aborted) throw this.abortController.signal.reason || new DOMException('Paused','AbortError');
  }
  async run({url, fileName, headers = {}, opfsFileName, totalBytes = 0, onProgress, onComplete, onError, onFailure, downloadSubdir, format = 'mp4'}) {
    let writer, reader;
    this.abortController = new AbortController();
    try {
      this.root = await this.storage.getDirectory();
      this.opfsFileName = opfsFileName;
      const handle = await this.root.getFileHandle(opfsFileName, {create:true});
      const cached = await handle.getFile();
      // The committed file is authoritative even if the worker died before
      // persisting its last queue progress update.
      const offset = cached.size;
      this.bytesReceived = offset;
      this.check();
      // Verify a small overlap before opening a writer. Signed URL renewal can
      // return another encoding even with the same quality label.
      const requestStart = Math.max(0,offset-65536);
      let response;
      try { response = await this.openResponse(url,headers,requestStart,offset); }
      catch (error) {
        if (!needsSourceRefresh(error)) throw error;
        if (!this.resolveSource) throw Error(`${error.message}. Open the original video page and retry. Cached data was kept.`);
        try {
          const source = await this.waitForNetwork(this.resolveSource(this.abortController.signal));
          this.check();
          const refreshed = typeof source === 'string' ? {url:source} : source;
          if (!refreshed?.url || (refreshed.format && refreshed.format !== format)) throw Error('The original video format is unavailable');
          url = refreshed.url;
          headers = refreshed.headers || headers;
          await this.onSourceRefreshed?.({...refreshed,url,headers});
          this.check();
          response = await this.openResponse(url,headers,requestStart,offset);
        } catch (refreshError) {
          throw Object.assign(Error(`${error.message}. Link refresh failed: ${refreshError.message}. Cached data was kept; retry to continue.`),{code:refreshError.code,status:refreshError.status,retryAfter:refreshError.retryAfter});
        }
      }
      if (this.pauseRequested || this.destroyed) { await response.body?.cancel(); return; }
      const range = response.headers.get('Content-Range') || '';
      if (response.status === 206) {
        const rangeStart = range.match(/^bytes\s+(\d+)-/i)?.[1];
        if (rangeStart === undefined || Number(rangeStart) !== requestStart) {
          await response.body?.cancel();
          throw Error('Server returned an invalid resume range. Cached data was kept.');
        }
      } else if (offset) {
        await response.body?.cancel();
        throw Error('The server did not honor the resume range. Cached data was kept; retry later.');
      }
      const rangeTotal = Number(range.match(/\/(\d+)$/)?.[1]) || 0;
      const length = Number(response.headers.get('Content-Length')) || 0;
      const total = rangeTotal || (length ? length+requestStart : 0);
      const expectedTotal = Number(totalBytes) || this.knownTotal || 0;
      if (offset && total && (total < offset || (expectedTotal && total !== expectedTotal))) {
        await response.body?.cancel();
        throw Error('The refreshed video size changed. Cached data was kept to avoid corrupting the download.');
      }
      reader = response.body?.getReader();
      if (!reader) throw Error('The server returned no readable video data');
      const overlap = new Uint8Array(await cached.slice(requestStart,offset).arrayBuffer());
      let verified = 0, remainder;
      while (verified < overlap.length) {
        this.check();
        const {done,value} = await this.waitForNetwork(reader.read());
        if (done) throw Error('The server returned incomplete resume data. Cached data was kept.');
        const count = Math.min(value.length,overlap.length-verified);
        for (let i=0;i<count;i++) if (value[i] !== overlap[verified+i]) throw Error('The refreshed video does not match the cached file. Cached data was kept.');
        verified += count;
        if (count < value.length) remainder = value.subarray(count);
      }
      this.check();
      this.knownTotal = total || expectedTotal;
      writer = await handle.createWritable({keepExistingData:offset > 0});
      if (offset) await writer.seek(offset);
      onProgress?.({bytesReceived:offset, totalBytes:total, progress:total ? offset / total * 90 : 0, isFileDownloading:false});
      while (!this.pauseRequested && !this.destroyed) {
        const {done, value} = remainder ? {done:false,value:remainder} : await this.waitForNetwork(reader.read());
        remainder = undefined;
        if (done) break;
        if (this.knownTotal && this.bytesReceived+value.byteLength > this.knownTotal) throw Error('The server returned too much data. Cached progress was kept.');
        // Commit a chunk already read even when Pause arrives during the read.
        await writer.write(value);
        this.bytesReceived += value.byteLength;
        onProgress?.({bytesReceived:this.bytesReceived, totalBytes:total, progress:total ? Math.min(90, this.bytesReceived / total * 90) : 0, isFileDownloading:false});
      }
      await writer.close();
      writer = null;
      if (this.pauseRequested || this.destroyed) return;
      if (total && this.bytesReceived < total) throw Object.assign(Error('The connection ended before the complete file arrived. Resume to continue.'),{code:'NETWORK'});
      await this.finish({fileName, format, downloadSubdir, onProgress, onComplete});
    } catch (error) {
      // Writable abort discards every chunk since open; close preserves them.
      if (writer) { await writer.close().catch(() => {}); writer = null; }
      if (!this.pauseRequested && !this.destroyed) {if(onFailure)onFailure(networkError(error));else onError?.(error?.message || String(error));}
    } finally {
      await reader?.cancel().catch(() => {});
      await this.cleanupHeaderRules();
      if (this.destroyed && this.removeOnDestroy) await this.root?.removeEntry(this.opfsFileName).catch(() => {});
    }
  }
  async waitForNetwork(promise) {
    return waitForData(promise,this.abortController,this.networkTimeout);
  }
  async finish({fileName, format, downloadSubdir, onProgress, onComplete}) {
    if (this.pauseRequested || this.destroyed) return;
    onProgress?.({bytesReceived:this.bytesReceived, progress:92, isFileDownloading:true});
    await this.saveFile({opfsFileName:this.opfsFileName, fileName, format, downloadSubdir, onProgress, bytesReceived:this.bytesReceived});
    if (!this.destroyed) onComplete?.({fileName});
  }
  async pauseSoft() {
    this.pauseRequested = true;
    this.abortController?.abort();
    await this.currentRun?.catch(() => {});
  }
  async destroy(removeFile = true) {
    this.destroyed = true;
    this.removeOnDestroy = removeFile;
    this.abortController?.abort();
    await this.currentRun?.catch(() => {});
    if (removeFile && this.opfsFileName) await this.root?.removeEntry(this.opfsFileName).catch(() => {});
  }
  async registerHeaderRules(url, headers) {
    if(this.headerBridge){const id=await this.headerBridge.add(url,headers);if(id)this.activeRuleIds.push(id);return;}
    const requestHeaders = Object.entries(headers).filter(([key, value]) => /^(Origin|Referer|Cookie)$/i.test(key) && typeof value === 'string' && value)
      .map(([header,value]) => ({operation:'set',header,value}));
    if (!requestHeaders.length) return;
    const id = Math.ceil(Math.random() * 100000000);
    await chrome.declarativeNetRequest.updateSessionRules({addRules:[{id,priority:1,action:{type:'modifyHeaders',requestHeaders},condition:exactRequestCondition(url)}]});
    this.activeRuleIds.push(id);
  }
  async cleanupHeaderRules() {
    const removeRuleIds = this.activeRuleIds.splice(0);
    if(this.headerBridge){await Promise.all(removeRuleIds.map(id=>this.headerBridge.remove(id).catch(()=>{})));return;}
    if (removeRuleIds.length) await chrome.declarativeNetRequest.updateSessionRules({removeRuleIds}).catch(() => {});
  }
}
