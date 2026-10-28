import {parsePlaylist, chooseVariant, compatiblePlaylists, encryptionIV} from './hls-playlist.js';
import {needsSourceRefresh,httpError} from './source-refresh.js';
import {exactRequestCondition} from './media-headers.js';
import {fetchBytes} from './network.js';
import {remuxToMp4} from './mp4-output.js';

const checkpointName = base => `${base}.hls.json`;
export async function removeHlsCache(base, storage = navigator.storage) {
  if (!base) return;
  const root = await storage.getDirectory();
  for await (const [name] of root.entries()) {
    if (name === base || name === base+'.converted.mp4' || name === checkpointName(base) || name.startsWith(`${base}.hls-`)) await root.removeEntry(name);
  }
}

// Each segment is an atomic OPFS file. The durable manifest is written BEFORE
// network work starts, so a new worker can rediscover committed segments even
// when the old worker died before its last progress notification.
export class HlsDownloader {
  persistent = true;
  bytesReceived = 0;
  completed = new Set();
  activeRuleIds = new Set();
  constructor({saveFile,fetcher = fetch,storage = navigator.storage,cryptoApi = globalThis.crypto,maxConcurrent = 4,timeout = 60000,retryInterval = 500,resourceRetries=2,headerBridge,transmuxerFactory,resolveSource,...callbacks} = {}) {
    this.saveFile = saveFile;
    this.fetcher = (url, options) => fetcher.call(globalThis,url,options);
    this.storage = storage;
    this.cryptoApi = cryptoApi;
    this.maxConcurrent = Math.max(1,Math.min(6,maxConcurrent));
    this.timeout = timeout;
    this.retryInterval = retryInterval;
    this.resourceRetries=resourceRetries;
    this.headerBridge=headerBridge;
    this.transmuxerFactory=transmuxerFactory;
    this.resolveSource = resolveSource;
    this.callbacks = callbacks;
  }
  getBytesReceived() { return this.bytesReceived; }
  start(url, options) {
    this.url = url;
    this.options = options;
    this.pauseRequested = false;
    this.destroyed = false;
    this.controller = new AbortController();
    this.completed = new Set();
    this.keyPromises = new Map();
    this.refreshPromise = null;
    this.urlGeneration = 0;
    this.sourceResolved = false;
    this.refreshAttempted = false;
    const running = this.run();
    this.currentRun = running;
    return running.finally(() => { if (this.currentRun === running) this.currentRun = null; });
  }
  resume() { return this.start(this.url,this.options); }
  stopped() { return this.pauseRequested || this.destroyed || this.controller.signal.aborted; }
  check() { if (this.stopped()) throw this.controller.signal.reason || new DOMException('Paused','AbortError'); }
  async readFile(name) { return (await this.root.getFileHandle(name)).getFile(); }
  async writeFile(name,data) {
    const handle = await this.root.getFileHandle(name,{create:true});
    const writer = await handle.createWritable();
    try { await writer.write(data); await writer.close(); }
    catch (error) { await writer.abort().catch(() => {}); throw error; }
  }
  async saveManifest() { await this.writeFile(checkpointName(this.options.opfsFileName),JSON.stringify(this.manifest)); }
  async request(url,range) {
    this.check();
    const headers = new Headers(this.options.headers || {}), requestHeaders = [];
    for (const name of ['Origin','Referer','Cookie']) {
      if (headers.has(name)) { requestHeaders.push({operation:'set',header:name,value:headers.get(name)}); headers.delete(name); }
    }
    if (range) headers.set('Range',`bytes=${range.start}-${range.start+range.length-1}`);
    let ruleId = requestHeaders.length ? Math.ceil(Math.random()*100000000) : 0;
    try {
      if (ruleId) {
        if(this.headerBridge)ruleId=await this.headerBridge.add(url,this.options.headers || {});
        else await chrome.declarativeNetRequest.updateSessionRules({addRules:[{id:ruleId,priority:1,action:{type:'modifyHeaders',requestHeaders},condition:exactRequestCondition(url)}]});
        this.activeRuleIds.add(ruleId);
      }
      const response = await fetchBytes(url,{headers,fetcher:this.fetcher,signal:this.controller.signal,timeout:this.timeout});
      if (range) {
        const match = response.headers.get('Content-Range')?.match(/^bytes\s+(\d+)-(\d+)\//i);
        if (response.status !== 206 || !match || Number(match[1]) !== range.start || Number(match[2]) !== range.start+range.length-1) {
          await response.body?.cancel(); throw Error('The server did not honor the HLS segment byte range; cached progress is retained');
        }
      }
      // Consume the body while timeout and header rules still apply.
      const data = response.data;
      this.check();
      if (range && data.length !== range.length) throw Error('Incomplete HLS byte-range segment');
      return {data,url:response.url || url};
    } finally {
      if (ruleId) {
        if(this.headerBridge)await this.headerBridge.remove(ruleId).catch(()=>{});
        else await chrome.declarativeNetRequest.updateSessionRules({removeRuleIds:[ruleId]}).catch(() => {});
        this.activeRuleIds.delete(ruleId);
      }
    }
  }
  async loadPlaylist(url) {
    for (let depth=0;depth<6;depth++) {
      const response = await this.request(url);
      const parsed = parsePlaylist(new TextDecoder().decode(response.data),response.url);
      if (!parsed.variants) return {...parsed,playlistUrl:response.url};
      const chosen = chooseVariant(parsed.variants,this.options.quality);
      if (chosen.audio && parsed.audioGroups.includes(chosen.audio)) throw Error('This HLS stream uses a separate audio track, which is not supported');
      url = chosen.url;
    }
    throw Error('Too many nested HLS playlists');
  }
  async renewSource() {
    this.sourceResolved = true;
    const result = await this.resolveSource(this.controller.signal);
    this.check();
    const source = typeof result === 'string' ? {url:result} : result;
    if (!source?.url || (source.format && source.format !== 'm3u8')) throw Error('The original HLS format is unavailable; cached segments were kept');
    if (source.headers) this.options = {...this.options,headers:source.headers};
    return source.url;
  }
  async prepare() {
    const base = this.options.opfsFileName;
    this.root = await this.storage.getDirectory();
    let previous;
    try { previous = JSON.parse(await (await this.readFile(checkpointName(base))).text()); }
    catch (error) { if (error.name !== 'NotFoundError') throw Error('HLS checkpoint is unreadable; cached files were preserved'); }
    if (previous) {
      if (previous.version !== 1 || !Array.isArray(previous.units) || previous.sourceUrl !== this.url) throw Error('HLS checkpoint does not match this download; cached files were preserved');
      this.manifest = previous;
    } else {
      let source = this.url, playlist;
      try { playlist = await this.loadPlaylist(source); }
      catch (error) {
        if (this.stopped() || !needsSourceRefresh(error) || !this.resolveSource) throw error;
        source = await this.renewSource();
        playlist = await this.loadPlaylist(source);
      }
      let keyIndex = 0;
      const keys = new Map();
      const units = playlist.units.map((unit,index) => {
        if (unit.key && !keys.has(unit.key.url)) keys.set(unit.key.url,`${base}.hls-key-${keyIndex++}`);
        return {...unit,cacheName:`${base}.hls-seg-${String(index).padStart(7,'0')}`,
          key:unit.key ? {...unit.key,cacheName:keys.get(unit.key.url)} : null};
      });
      this.manifest = {version:1,sourceUrl:this.url,refreshSourceUrl:source,playlistUrl:playlist.playlistUrl,outputExtension:playlist.outputExtension,units,createdAt:Date.now()};
      await this.saveManifest();
    }
    this.bytesReceived = 0;
    for (let i=0;i<this.manifest.units.length;i++) {
      this.check();
      try {
        const file = await this.readFile(this.manifest.units[i].cacheName);
        if (file.size > 0) { this.completed.add(i); this.bytesReceived += file.size; }
      } catch (error) { if (error.name !== 'NotFoundError') throw error; }
    }
    this.tsUrlList = this.manifest.units.map(unit => unit.url);
    this.report();
  }
  report(extra = {}) {
    const total = this.manifest?.units.filter(unit => !unit.isMap).length || 0;
    const done = this.manifest?.units.reduce((count,unit,i) => count+(!unit.isMap && this.completed.has(i) ? 1 : 0),0) || 0;
    this.callbacks.onProgress?.({bytesReceived:this.bytesReceived,finishNum:done,targetSegment:total,errorNum:0,
      progress:total ? done/total*90 : 0,isFileDownloading:false,outputExtension:this.manifest?.outputExtension,...extra});
  }
  async refreshUrls(generation) {
    if (generation !== this.urlGeneration) return;
    if (!this.refreshPromise) this.refreshPromise = (async () => {
      if (this.refreshAttempted) throw Error('The media link was rejected after refresh. Cached segments were kept; open the original video page and retry.');
      this.refreshAttempted = true;
      let source = this.manifest.refreshSourceUrl || this.manifest.sourceUrl, playlist;
      try { playlist = await this.loadPlaylist(source); }
      catch (error) {
        if (this.stopped() || !needsSourceRefresh(error) || !this.resolveSource || this.sourceResolved) throw error;
      }
      // A playlist can still return 200 while all of its signed segment URLs
      // have expired. Refresh through the page in that case too.
      const unchanged = playlist && playlist.units.every((unit,i) => unit.url === this.manifest.units[i]?.url && unit.key?.url === this.manifest.units[i]?.key?.url);
      if ((!playlist || unchanged) && this.resolveSource && !this.sourceResolved) {
        source = await this.renewSource();
        playlist = await this.loadPlaylist(source);
      }
      if (!compatiblePlaylists(this.manifest.units,playlist.units)) throw Error('The video playlist changed. Cached segments were preserved; the download will not restart');
      this.manifest.units = this.manifest.units.map((unit,i) => ({...unit,url:playlist.units[i].url,key:unit.key ? {...unit.key,...playlist.units[i].key} : null}));
      this.manifest.playlistUrl = playlist.playlistUrl;
      this.manifest.refreshSourceUrl = source;
      await this.saveManifest();
      this.urlGeneration++;
    })().finally(() => { this.refreshPromise = null; });
    return this.refreshPromise;
  }
  async keyFor(key) {
    if (!this.keyPromises.has(key.cacheName)) this.keyPromises.set(key.cacheName,(async () => {
      let data;
      try { data = new Uint8Array(await (await this.readFile(key.cacheName)).arrayBuffer()); }
      catch (error) { if (error.name !== 'NotFoundError') throw error; }
      if (!data || data.length !== 16) {
        data = (await this.request(key.url)).data;
        if (data.length !== 16) throw Error('Invalid HLS AES-128 key');
        await this.writeFile(key.cacheName,data);
      }
      return this.cryptoApi.subtle.importKey('raw',data,'AES-CBC',false,['decrypt']);
    })().catch(error => { this.keyPromises.delete(key.cacheName); throw error; }));
    return this.keyPromises.get(key.cacheName);
  }
  async downloadUnit(index) {
    let renewed=false;
    for (let attempt=0;attempt<=this.resourceRetries;attempt++) {
      this.check();
      const generation = this.urlGeneration;
      try {
        const unit = this.manifest.units[index];
        let data = (await this.request(unit.url,unit.range)).data;
        if (unit.key) {
          try { data = new Uint8Array(await this.cryptoApi.subtle.decrypt({name:'AES-CBC',iv:encryptionIV(unit.key.iv,unit.sequence)},await this.keyFor(unit.key),data)); }
          catch (error) {
            if (error.name === 'OperationError') {
              this.keyPromises.delete(unit.key.cacheName);
              await this.root.removeEntry(unit.key.cacheName).catch(() => {});
            }
            throw error;
          }
        }
        if (!data.length) throw Error('Empty HLS segment');
        this.check();
        await this.writeFile(unit.cacheName,data);
        // Closing the segment, rather than a popup storage update, is the commit.
        this.completed.add(index);
        this.bytesReceived += data.length;
        this.report();
        return;
      } catch (error) {
        if (this.stopped()) throw error;
        // Link renewal has its own single attempt; transient retries are owned
        // by the queue and may be disabled here without disabling renewal.
        if(needsSourceRefresh(error)){
          if(renewed)throw Object.assign(Error('The media link was rejected after refresh. Cached segments were kept; open the original video page and retry.'),{status:error.status,code:'HTTP'});
          renewed=true;await this.refreshUrls(generation);attempt--;continue;
        }
        if(attempt===this.resourceRetries)throw error;
        await new Promise(resolve => { const timer=setTimeout(done,this.retryInterval); const signal=this.controller.signal; function done(){clearTimeout(timer);signal.removeEventListener('abort',done);resolve();} signal.addEventListener('abort',done,{once:true}); });
      }
    }
  }
  async assemble() {
    const output = this.options.opfsFileName;
    if(this.options.outputFormat==='mp4' && this.manifest.outputExtension==='ts' && this.transmuxerFactory){
      const converted=output+'.converted.mp4';
      if(this.manifest.convertedBytes && this.manifest.converterVersion===1){
        try {if((await this.readFile(converted)).size===this.manifest.convertedBytes){this.outputFile=converted;return;}}catch{}
      }
      this.report({phase:'converting',progress:90});
      try {
        const size=await remuxToMp4({root:this.root,units:this.manifest.units,output:converted,transmuxerFactory:this.transmuxerFactory,check:()=>this.check(),onProgress:fraction=>this.report({phase:'converting',progress:90+fraction*3})});
        this.check();this.outputFile=converted;this.manifest.convertedBytes=size;this.manifest.converterVersion=1;await this.saveManifest();return;
      }catch(error){
        this.check();
        if(error.code!=='CONVERSION_UNSUPPORTED')throw error;
        this.fallbackReason='MP4 conversion is unavailable for this stream; saving the original TS format.';
        this.report({fallbackReason:this.fallbackReason});
      }
    }
    if (this.manifest.outputBytes > 0) {
      try { if ((await this.readFile(output)).size === this.manifest.outputBytes) return; }
      catch (error) { if (error.name !== 'NotFoundError') throw error; }
    }
    const writer = await (await this.root.getFileHandle(output,{create:true})).createWritable();
    let length = 0;
    try {
      for (const unit of this.manifest.units) {
        this.check();
        const file = await this.readFile(unit.cacheName);
        // Pipe one file at a time; never load the whole video into RAM.
        const reader = file.stream().getReader();
        try {
          while (true) {
            this.check();
            const {done,value} = await reader.read();
            if (done) break;
            await writer.write(value); length += value.length;
          }
        } finally { await reader.cancel().catch(() => {}); }
      }
      this.check();
      await writer.close();
    } catch (error) { await writer.abort().catch(() => {}); throw error; }
    this.manifest.outputBytes = length;
    await this.saveManifest();
  }
  async run() {
    try {
      if (!this.options?.opfsFileName) throw Error('HLS cache filename is required');
      await this.prepare();
      const pending = this.manifest.units.map((_,i) => i).filter(i => !this.completed.has(i));
      let next = 0, failure;
      const worker = async () => {
        while (next<pending.length && !this.stopped() && !failure) {
          const index = pending[next++];
          try { await this.downloadUnit(index); }
          catch (error) { failure ||= error; this.controller.abort(error); }
        }
      };
      await Promise.all(Array.from({length:Math.min(this.maxConcurrent,pending.length)},worker));
      if (failure) throw failure;
      this.check();
      await this.assemble();
      this.check();
      const outputExtension = this.outputFile ? 'mp4' : this.manifest.outputExtension;
      const outputBytes=this.outputFile?this.manifest.convertedBytes:this.manifest.outputBytes;
      this.report({isFileDownloading:true,progress:94,phase:'saving',outputExtension,outputBytes,outputCacheFileName:this.outputFile || this.options.opfsFileName,fallbackReason:this.fallbackReason});
      await this.saveFile({opfsFileName:this.outputFile || this.options.opfsFileName,fileName:this.options.fileName,format:outputExtension === 'mp4' ? 'mp4' : 'm3u8',
        downloadSubdir:this.options.downloadSubdir,bytesReceived:outputBytes,onProgress:data => this.report(data)});
      if (!this.destroyed) this.callbacks.onComplete?.({fileName:this.options.fileName});
    } catch (error) {
      if (!this.pauseRequested && !this.destroyed) {
        if(this.callbacks.onFailure)this.callbacks.onFailure(error);
        else this.callbacks.onError?.(`${error.message || String(error)}${needsSourceRefresh(error) ? '. Cached segments were kept; open the original video page and retry.' : ''}`);
      }
    }
  }
  async pauseSoft() {
    this.pauseRequested = true;
    this.controller?.abort();
    await this.currentRun?.catch(() => {});
    this.report();
  }
  async destroy(removeFile = true) {
    this.destroyed = true;
    this.controller?.abort();
    await this.currentRun?.catch(() => {});
    if (removeFile && this.options?.opfsFileName) await removeHlsCache(this.options.opfsFileName,this.storage);
  }
}
