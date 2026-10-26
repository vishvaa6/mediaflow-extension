export const StorageType = {Local:'local',Sync:'sync',Managed:'managed',Session:'session'};
export function createStorage(key, defaults, options = {}) {
  const area = options.storageType || 'local';
  const serialize = options.serialization?.serialize || (value => value);
  const deserialize = options.serialization?.deserialize || (value => value);
  let snapshot = defaults, chain = Promise.resolve(), listeners = [], revision = 0;
  const publish = () => listeners.forEach(fn => fn());
  const get = async () => deserialize((await chrome.storage[area].get([key]))[key]) ?? structuredClone(defaults);
  get().then(value => { if (!revision) { snapshot=value; publish(); } }).catch(console.error);
  if (options.liveUpdate) chrome.storage[area].onChanged.addListener(changes => {
    if (!changes[key]) return;
    revision++; snapshot=deserialize(changes[key].newValue) ?? structuredClone(defaults); publish();
  });
  return {
    get,getSnapshot:() => snapshot,
    subscribe(fn) { listeners.push(fn); return () => { listeners=listeners.filter(listener => listener!==fn); }; },
    set(value) {
      const run = async () => { const current=await get(); const next=typeof value==='function' ? await value(current) : value; await chrome.storage[area].set({[key]:serialize(next)}); revision++;snapshot=next;publish(); };
      const result=chain.then(run,run); chain=result.catch(() => {}); return result;
    }
  };
}
const history = createStorage('m3u8DownloadHistory',{records:[]},{storageType:'local',liveUpdate:true});
export const historyStorage = {...history,
  async addRecord(fileName,url,pageUrl,metadata = {}) {
    const record={id:metadata.taskId || `${Date.now()}-${Math.random().toString(36).slice(2,8)}`,fileName,url,pageUrl:pageUrl?.trim() || undefined,completedAt:Date.now(),
      title:metadata.title || fileName,creator:metadata.creator || '',quality:metadata.quality,format:metadata.format,
      thumbnail:metadata.thumbnail || '',thumbnails:metadata.thumbnails || [],bytes:metadata.bytes,downloadId:metadata.downloadId};
    await history.set(current => ({records:[record,...(current.records || []).filter(old => old.id!==record.id)]}));
  },
  async removeRecord(id) { await history.set(current => ({records:current.records.filter(record => record.id!==id)})); },
  async clearAll() { await history.set({records:[]}); }
};
const queue=createStorage('downloadQueueState',{tasks:[]},{storageType:'local',liveUpdate:true});
export const queueStorage={...queue,
  async enqueue(value) {
    const id=`${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
    const url=String(value.url || '').trim(),raw=String(value.format || '').toLowerCase();
    const hls=raw==='hls'||raw==='m3u8'||/\.m3u8(?:[?#]|$)|\/hls\//i.test(url);
    const format=hls?'m3u8':raw==='webm'?'webm':'mp4';
    const task={id,url,format,fileName:value.fileName || '',quality:value.quality,pageUrl:value.pageUrl,headers:value.headers,
      title:value.title || value.fileName || '',thumbnail:value.thumbnail || '',thumbnails:value.thumbnails || [],creator:value.creator || '',
      batchId:value.batchId,batchProfileKey:value.batchProfileKey,
      status:'queued',createdAt:Date.now(),progress:0,finishNum:0,targetSegment:hls?0:1,errorNum:0,
      opfsCacheFileName:`vd-ext-${id.replace(/[^a-zA-Z0-9_-]/g,'_')}.${hls?'ts':format}`};
    await queue.set(current => ({tasks:[...current.tasks,task]}));return id;
  },
  async updateTask(id,patch) { await queue.set(current => ({tasks:current.tasks.map(task => task.id===id ? {...task,...patch} : task)})); },
  async removeTask(id) { await queue.set(current => ({tasks:current.tasks.filter(task => task.id!==id)})); },
  async clearQueued() { await queue.set(current => ({tasks:current.tasks.filter(task => task.status!=='queued')})); },
  async clearErrors() { await queue.set(current => ({tasks:current.tasks.filter(task => task.status!=='error')})); }
};
export function sanitizeSubdir(value) {
  const clean=String(value || '').replace(/\\/g,'/').replace(/[\x00-\x1f\x7f:*?"<>|]/g,'').split('/').map(part => part.trim()).filter(part => part && part!=='.' && part!=='..').join('/');
  if(clean.length<=200)return clean;const truncated=clean.slice(0,200),last=truncated.lastIndexOf('/');return last>0?truncated.slice(0,last):truncated;
}
export const withSubdir=(name,subdir) => sanitizeSubdir(subdir) ? `${sanitizeSubdir(subdir)}/${name}` : name;
const defaults={downloadSubdir:'',useChannelFolder:true,maxConcurrentTasks:6,showThumbnails:true};
const settings=createStorage('download-settings',defaults,{storageType:'local',liveUpdate:true});
export const settingsStorage={...settings,
  async setDownloadSubdir(value) { const next=sanitizeSubdir(value);await settings.set(old => ({...defaults,...old,downloadSubdir:next}));return next; },
  async setUseChannelFolder(value) { const next=!!value;await settings.set(old => ({...defaults,...old,useChannelFolder:next}));return next; },
  async setMaxConcurrentTasks(value) { const next=Math.max(1,Math.min(20,Math.floor(Number(value)||6)));await settings.set(old => ({...defaults,...old,maxConcurrentTasks:next}));return next; },
  async getMaxConcurrentTasks() { return Number((await settings.get()).maxConcurrentTasks)||6; },
  async setShowThumbnails(value) { const next=!!value;await settings.set(old => ({...defaults,...old,showThumbnails:next}));return next; }
};
export const getUseChannelFolder=value => value?.useChannelFolder!==false;
export const getDownloadSubdir=async () => sanitizeSubdir((await settingsStorage.get()).downloadSubdir);
