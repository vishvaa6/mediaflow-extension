import {needsSourceRefresh,httpError,retain474OnMissingSource} from './source-refresh.js';
import {exactRequestCondition} from './media-headers.js';
import {waitForData,networkError,retryAfterMs,transientError,withRetry} from './network.js';
import {assertMediaResponse} from './media-response.js';

// Streaming downloads commit the partial OPFS file before acknowledging a pause.
export class DirectDownloader {
  bytesReceived = 0;
  currentRun = null;
  pauseRequested = false;
  destroyed = false;
  activeRuleIds = [];
  constructor({saveFile, fetcher = fetch, storage = navigator.storage, networkTimeout = 60000, maxAttempts, retries, retryInterval, headerBridge, resolveSource, onSourceRefreshed} = {}) {
    this.saveFile = saveFile;
    // Native Window/Worker fetch requires its original global receiver.
    this.fetcher = (url, options) => fetcher.call(globalThis, url, options);
    this.storage = storage;
    this.networkTimeout = networkTimeout;
    this.maxAttempts = maxAttempts !== undefined
      ? Math.max(1, Math.floor(Number(maxAttempts) || 1))
      : retries !== undefined
        ? Math.max(1, Math.floor(Number(retries) || 0) + 1)
        : 4;
    this.retryInterval = retryInterval;
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
  async openResponse(url,headers,start,offset,attemptController = this.abortController) {
    await this.cleanupHeaderRules();
    this.check();
    await this.registerHeaderRules(url,headers);
    this.check();
    const requestHeaders = new Headers(headers);
    for (const key of ['Origin','Referer','Cookie']) requestHeaders.delete(key);
    if (offset) requestHeaders.set('Range',`bytes=${start}-`);
    const response = await this.waitForNetwork(this.fetcher(url,{headers:requestHeaders,credentials:'include',cache:'no-store',signal:attemptController.signal}),attemptController);
    if (!response.ok) { await response.body?.cancel(); throw Object.assign(httpError(response.status),{code:'HTTP',retryAfter:retryAfterMs(response.headers.get('Retry-After'))}); }
    let reader;
    try {
      reader = response.body?.getReader();
      if (!reader) throw Object.assign(Error('The server returned no readable video data'),{code:'NETWORK'});
      const prefix=[]; let prefixLength=0;
      // Read a bounded prefix before opening an OPFS writer. Some challenge
      // pages use application/octet-stream and arrive in multiple chunks.
      if (start === 0 || response.status !== 206) {
        while (prefixLength < 512) {
          const part=await this.waitForNetwork(reader.read(),attemptController);
          if (part.done) break;
          prefix.push(part.value); prefixLength+=part.value.length;
        }
        const sample=new Uint8Array(Math.min(prefixLength,1024));let position=0;
        for(const chunk of prefix){const length=Math.min(chunk.length,sample.length-position);sample.set(chunk.subarray(0,length),position);position+=length;if(position===sample.length)break;}
        assertMediaResponse(sample);
      }
      return {response,reader,prefix};
    } catch (error) {
      if (reader) await reader.cancel().catch(()=>{});
      else await response.body?.cancel().catch(()=>{});
      throw error;
    }
  }
  check() {
    if (this.pauseRequested || this.destroyed || this.abortController.signal.aborted) throw this.abortController.signal.reason || new DOMException('Paused','AbortError');
  }
  async run({url, fileName, headers = {}, opfsFileName, totalBytes = 0, onProgress, onComplete, onError, onFailure, downloadSubdir, format = 'mp4'}) {
    this.abortController = new AbortController();
    try {
      this.root = await this.storage.getDirectory();
      this.opfsFileName = opfsFileName;
      const handle = await this.root.getFileHandle(opfsFileName, {create:true});
      const initialCached = await handle.getFile();
      this.bytesReceived = initialCached.size;
      let verifiedFromStart = initialCached.size === 0;
      let refreshed = false;
      let refreshFailed = false;
      const attempts = this.maxAttempts;
      await withRetry(async () => {
        refreshFailed = false;
        const attemptController = new AbortController();
        const abortAttempt = () => attemptController.abort(this.abortController.signal.reason);
        this.abortController.signal.addEventListener('abort', abortAttempt, {once:true});
        let writer, reader;
        try {
          if (this.abortController.signal.aborted) abortAttempt();
          this.check();
          const cached = await handle.getFile();
          // The committed file is authoritative even if the worker died before
          // persisting its last queue progress update.
          const offset = cached.size;
          this.bytesReceived = offset;
          this.check();
          // Verify a small overlap before opening a writer when resuming from
          // prior cache or a renewed URL; in-run retries on the same URL resume
          // from the exact committed byte offset.
          let requestStart = verifiedFromStart ? offset : Math.max(0,offset-65536);
          let response, prefix;
          const open = async () => {const result=await this.openResponse(url,headers,requestStart,offset,attemptController);response=result.response;reader=result.reader;prefix=result.prefix;};
          try { await open(); }
          catch (error) {
            if (!needsSourceRefresh(error)) throw error;
            if (!this.resolveSource) {
              if (error.code === 'INVALID_MEDIA_RESPONSE') throw error;
              throw Object.assign(Error(`${error.message}. Open the original video page and retry. Cached data was kept.`),{code:error.code,status:error.status,retryAfter:error.retryAfter,needsSourceRefresh:true});
            }
            if (refreshed) {
              refreshFailed = true;
              throw Object.assign(Error(`${error.message}. Link refresh failed: the renewed media link was rejected. Cached data was kept; retry to continue.`),{code:error.code,status:error.status,retryAfter:error.retryAfter,needsSourceRefresh:true});
            }
            refreshed = true;
            try {
              const source = await this.waitForNetwork(this.resolveSource(attemptController.signal),attemptController);
              this.check();
              const refreshedSource = typeof source === 'string' ? {url:source} : source;
              if (!refreshedSource?.url || (refreshedSource.format && refreshedSource.format !== format)) throw Error('The original video format is unavailable');
              url = refreshedSource.url;
              headers = refreshedSource.headers || headers;
              verifiedFromStart = false;
              requestStart = Math.max(0,offset-65536);
              await open();
              await this.onSourceRefreshed?.({...refreshedSource,url,headers});
              this.check();
            } catch (refreshError) {
              refreshFailed = true;
              refreshError=retain474OnMissingSource(error,refreshError);
              throw Object.assign(Error(`${error.message}. Link refresh failed: ${refreshError.message}. Cached data was kept; retry to continue.`),{code:refreshError.code,status:refreshError.status,retryAfter:refreshError.retryAfter,needsSourceRefresh:true});
            }
          }
          if (this.pauseRequested || this.destroyed) { await reader?.cancel(); reader = null; return; }
          const range = response.headers.get('Content-Range') || '';
          if (response.status === 206) {
            const rangeStart = range.match(/^bytes\s+(\d+)-/i)?.[1];
            if (rangeStart === undefined || Number(rangeStart) !== requestStart) {
              await reader?.cancel(); reader = null;
              throw Error('Server returned an invalid resume range. Cached data was kept.');
            }
          } else if (offset) {
            await reader?.cancel(); reader = null;
            throw Error('The server did not honor the resume range. Cached data was kept; retry later.');
          }
          const rangeTotal = Number(range.match(/\/(\d+)$/)?.[1]) || 0;
          const length = Number(response.headers.get('Content-Length')) || 0;
          const total = rangeTotal || (length ? length+requestStart : 0);
          const expectedTotal = Number(totalBytes) || this.knownTotal || 0;
          if (offset && total && (total < offset || (expectedTotal && total !== expectedTotal))) {
            await reader?.cancel(); reader = null;
            throw Error('The refreshed video size changed. Cached data was kept to avoid corrupting the download.');
          }
          const read=()=>prefix.length ? Promise.resolve({done:false,value:prefix.shift()}) : this.waitForNetwork(reader.read(),attemptController);
          const overlap = requestStart < offset ? new Uint8Array(await cached.slice(requestStart,offset).arrayBuffer()) : new Uint8Array();
          let verified = 0, remainder;
          while (verified < overlap.length) {
            this.check();
            const {done,value} = await read();
            if (done) throw Error('The server returned incomplete resume data. Cached data was kept.');
            const count = Math.min(value.length,overlap.length-verified);
            for (let i=0;i<count;i++) if (value[i] !== overlap[verified+i]) throw Error('The refreshed video does not match the cached file. Cached data was kept.');
            verified += count;
            if (count < value.length) remainder = value.subarray(count);
          }
          this.check();
          verifiedFromStart = true;
          this.knownTotal = total || expectedTotal;
          writer = await handle.createWritable({keepExistingData:offset > 0});
          if (offset) await writer.seek(offset);
          onProgress?.({bytesReceived:offset, totalBytes:total, progress:total ? Math.min(90, offset / total * 90) : 0, isFileDownloading:false, phase:'downloading', retrying:false});
          while (!this.pauseRequested && !this.destroyed) {
            const {done, value} = remainder ? {done:false,value:remainder} : await read();
            remainder = undefined;
            if (done) break;
            if (this.knownTotal && this.bytesReceived+value.byteLength > this.knownTotal) throw Error('The server returned too much data. Cached progress was kept.');
            // Commit a chunk already read even when Pause arrives during the read.
            await writer.write(value);
            this.bytesReceived += value.byteLength;
            onProgress?.({bytesReceived:this.bytesReceived, totalBytes:total, progress:total ? Math.min(90, this.bytesReceived / total * 90) : 0, isFileDownloading:false, phase:'downloading', retrying:false});
          }
          await writer.close();
          writer = null;
          if (this.pauseRequested || this.destroyed) return;
          if (!this.bytesReceived) throw Object.assign(Error('The server returned an empty video. Retry when the video is available.'),{code:'NETWORK'});
          if (total && this.bytesReceived < total) throw Object.assign(Error('The connection ended before the complete file arrived. Resume to continue.'),{code:'NETWORK'});
        } catch (error) {
          // Writable abort discards every chunk since open; close preserves them.
          if (writer) { await writer.close().catch(() => {}); writer = null; }
          throw error;
        } finally {
          this.abortController.signal.removeEventListener('abort', abortAttempt);
          await reader?.cancel().catch(() => {});
          reader = null;
          await this.cleanupHeaderRules();
        }
      }, {
        attempts,
        signal: this.abortController.signal,
        baseDelay: this.retryInterval,
        shouldRetry: error => !refreshFailed && transientError(error) && !needsSourceRefresh(error),
        onRetry: (attempt, ms, error) => {
          const knownTotal = this.knownTotal || Number(totalBytes) || 0;
          onProgress?.({
            bytesReceived: this.bytesReceived,
            totalBytes: knownTotal,
            progress: knownTotal ? Math.min(90, this.bytesReceived / knownTotal * 90) : 0,
            isFileDownloading: false,
            phase: 'retrying',
            retrying: true,
            retryAt: Date.now() + ms,
            retryAttempt: attempt,
            retryMax: attempts,
            retryError: error.message
          });
        }
      });
      if (this.pauseRequested || this.destroyed) return;
      await this.finish({fileName, format, downloadSubdir, onProgress, onComplete});
    } catch (error) {
      if (!this.pauseRequested && !this.destroyed) {if(onFailure)onFailure(networkError(error));else onError?.(error?.message || String(error));}
    } finally {
      await this.cleanupHeaderRules();
      if (this.destroyed && this.removeOnDestroy) await this.root?.removeEntry(this.opfsFileName).catch(() => {});
    }
  }
  async waitForNetwork(promise, controller = this.abortController) {
    return waitForData(promise,controller,this.networkTimeout);
  }
  async finish({fileName, format, downloadSubdir, onProgress, onComplete}) {
    if (this.pauseRequested || this.destroyed) return;
    onProgress?.({bytesReceived:this.bytesReceived, progress:92, isFileDownloading:true, phase:'saving', retrying:false});
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
