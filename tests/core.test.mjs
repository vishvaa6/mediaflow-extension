import test from 'node:test';
import assert from 'node:assert/strict';
import {SpeedMeter,formatSpeed} from '../assets/js/speed.js';
import {crawlProfile,httpUrl} from '../assets/js/profile-scanner.js';
import {extractMedia,resolveMedia,chooseDefinition} from '../assets/js/media-resolver.js';
import {DirectDownloader} from '../assets/js/direct-downloader.js';
import {installQueueManager} from '../assets/js/queue-manager.js';
import {videoKey,downloadedRecord,sortQualities} from '../assets/js/video-details.js';
import {selectionView,changeSelection} from '../assets/js/profile-selection.js';

const sleep = ms => new Promise(resolve => setTimeout(resolve,ms));
async function until(fn) { for(let i=0;i<200;i++){if(await fn())return;await sleep(5);}throw Error('Condition timed out'); }
function event() { const listeners = new Set(); return {addListener:fn => listeners.add(fn),removeListener:fn => listeners.delete(fn),emit:(...args) => {for(const fn of listeners)fn(...args);},listeners}; }
function chromeMock() {
  const values = {}, changed = event(), localChanged = event();
  const local = {
    onChanged:localChanged,
    async get(keys){await sleep(1);return Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(key => [key,structuredClone(values[key])]).filter(([,v]) => v!==undefined));},
    async set(patch){await sleep(1);const changes={};for(const [key,value]of Object.entries(patch)){changes[key]={oldValue:values[key],newValue:structuredClone(value)};values[key]=structuredClone(value);}localChanged.emit(changes);changed.emit(changes,'local');}
  };
  return {runtime:{id:'unit-test',onMessage:event(),sendMessage:async()=>({ok:true})},storage:{local,onChanged:changed},offscreen:{hasDocument:async()=>true},
    downloads:{onChanged:event(),pause:async id=>{mock.paused.push(id);},resume:async id=>{mock.resumed.push(id);},cancel:async()=>{},search:async()=>[]},
    declarativeNetRequest:{updateSessionRules:async()=>{}},paused:[],resumed:[]};
}
let mock;
globalThis.chrome = mock = chromeMock();

test('speed stays numeric and formatted, and resets after pause or byte reset',()=>{
  const realNow=Date.now;let now=1000;Date.now=()=>now;
  try{
    const meter=new SpeedMeter();meter.update('x',0);now+=1000;
    assert.equal(meter.update('x',2048).speedFormatted,'2.0 KB/s');
    now+=1000;assert.equal(meter.update('x',2048).downloadSpeed,0);
    assert.equal(meter.update('x',100).downloadSpeed,0);
    assert.equal(meter.update('x',200,true).speedFormatted,'');
    assert.equal(formatSpeed(Infinity),'0 B/s');
  }finally{Date.now=realNow;}
});

test('creator scan follows all pages, starts at page one, and removes duplicates and foreign creators',async()=>{
  const seen=[],updates=[];
  const result=await crawlProfile('https://example.test/model/alex/videos?page=4',{
    fetchPage:async url=>{seen.push(url);return url;},
    parsePage:async url=>{
      const page=Number(new URL(url).searchParams.get('page')||1);
      return {profileName:'Alex',videos:[{id:'duplicate'},{id:String(page)}],nextPages:page<4?[`https://example.test/model/alex/videos?page=${page+1}`,'https://example.test/model/other/videos?page=2']:[]};
    },onProgress:async result=>updates.push(result.pagesScanned)
  });
  assert.equal(seen.length,4);assert.equal(new URL(seen[0]).search,'');
  assert.equal(result.pagesScanned,4);assert.equal(result.videos.length,5);assert.deepEqual(updates,[1,2,3,4]);
  assert.equal(httpUrl(null,'https://example.test/model/alex'),'');
  assert.equal(httpUrl('//cdn.test/a.jpg','https://example.test'),'https://cdn.test/a.jpg');
});

test('scan cancellation and page failures preserve progress without reporting a complete scan',async()=>{
  const controller=new AbortController();let count=0;
  await assert.rejects(crawlProfile('https://example.test/model/alex',{signal:controller.signal,fetchPage:async()=>'',parsePage:async()=>({videos:[],nextPages:['https://example.test/model/alex?page=2']}),onProgress:async()=>{count++;controller.abort();}}),{name:'AbortError'});
  assert.equal(count,1);
});

test('media resolver expands metadata APIs and chooses requested HLS quality with relative paths',async()=>{
  const html='var flashvars_123 = '+JSON.stringify({video_title:'Title with }; inside',mediaDefinitions:[{format:'mp4',videoUrl:'https://example.test/api/streams'},{format:'hls',quality:1080,videoUrl:'https://cdn.test/root/master.m3u8'}]})+';';
  assert.equal(extractMedia(html).title,'Title with }; inside');
  const fetcher=async url=>url.includes('/api/')?JSON.stringify([{videoUrl:'https://cdn.test/a.mp4',quality:720}]):'#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=100,RESOLUTION=1280x720\n../720/list.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=200,RESOLUTION=1920x1080\n1080/list.m3u8';
  assert.equal((await resolveMedia(html,'https://example.test/watch','mp4',fetcher)).url,'https://cdn.test/a.mp4');
  const resolved=await resolveMedia(html,'https://example.test/watch','1080',fetcher);
  assert.equal(resolved.url,'https://cdn.test/root/1080/list.m3u8');
  assert.equal(chooseDefinition([{quality:2160,videoUrl:'4k'},{quality:720,videoUrl:'720'}],'best').videoUrl,'4k');
  assert.equal(chooseDefinition([{quality:720,videoUrl:'720'}],'mp4'),undefined);
});

function memoryStorage(){
  const files=new Map();
  return {files,async getDirectory(){return {removeEntry:async name=>files.delete(name),getFileHandle:async(name)=>({getFile:async()=>new Blob([Uint8Array.from(files.get(name)||[])]),createWritable:async({keepExistingData}={})=>{
    let bytes=keepExistingData?[...(files.get(name)||[])]:[],position=0;
    return {seek:async n=>{position=n;},write:async chunk=>{for(const byte of chunk)bytes[position++]=byte;},close:async()=>{files.set(name,bytes);},abort:async()=>{}};
  }})};}};
}
test('direct pause commits bytes before resume, validates Range, and preserves exact file content',async()=>{
  const storage=memoryStorage(),ranges=[],saved=[];
  const downloader=new DirectDownloader({storage,saveFile:async()=>saved.push(true),fetcher:async(url,{headers})=>{
    ranges.push(headers.get('Range'));
    return ranges.length===1?new Response(new ReadableStream({start(c){c.enqueue(Uint8Array.of(1,2));c.enqueue(Uint8Array.of(3,4));c.close();}}),{headers:{'Content-Length':'4'}}):new Response(Uint8Array.of(1,2,3,4),{status:206,headers:{'Content-Range':'bytes 0-3/4','Content-Length':'4'}});
  }});
  const options={url:'https://example.test/a.mp4',fileName:'a',opfsFileName:'file',onProgress:p=>{if(p.bytesReceived===2&&!p.isFileDownloading)downloader.pauseRequested=true;}};
  await downloader.start(options);await downloader.pauseSoft();
  assert.deepEqual(storage.files.get('file'),[1,2]);assert.equal(saved.length,0);
  await downloader.start({...options,resumeFromByte:2,onProgress:()=>{}});
  assert.deepEqual(ranges,[null,'bytes=0-']);assert.deepEqual(storage.files.get('file'),[1,2,3,4]);assert.equal(saved.length,1);
});

test('servers ignoring Range retain the partial file without restarting the transfer',async()=>{
  const storage=memoryStorage();storage.files.set('file',[9,9]);
  let error;
  const downloader=new DirectDownloader({storage,saveFile:async()=>assert.fail('Must not save a mismatched response'),fetcher:async()=>new Response(Uint8Array.of(1,2,3),{headers:{'Content-Length':'3'}})});
  await downloader.start({url:'https://example.test/file.webm',opfsFileName:'file',fileName:'file',format:'webm',resumeFromByte:2,onError:e=>{error=e;}});
  assert.deepEqual(storage.files.get('file'),[9,9]);assert.match(error,/resume range.*Cached data was kept/);
});

test('a stalled direct request reports a timeout instead of staying stuck forever',async()=>{
  let error='';
  const downloader=new DirectDownloader({storage:memoryStorage(),networkTimeout:10,saveFile:async()=>{},fetcher:()=>new Promise(()=>{})});
  await downloader.start({url:'https://example.test/stalled.mp4',opfsFileName:'file',onError:message=>{error=message;}});
  assert.match(error,/timed out/);
});

test('storage serializes overlapping enqueues, updates and removals without losing tasks',async()=>{
  globalThis.chrome=mock=chromeMock();
  const {o:queue}=await import('../assets/js/downloadSettingsStorage.CsrP3JcJ.js');
  const ids=await Promise.all(Array.from({length:30},(_,i)=>queue.enqueue({url:`https://example.test/${i}.mp4`,format:'mp4'})));
  assert.equal((await queue.get()).tasks.length,30);
  await Promise.all(ids.map((id,i)=>i%2?queue.updateTask(id,{status:'paused'}):queue.removeTask(id)));
  assert.equal((await queue.get()).tasks.length,15);assert.ok((await queue.get()).tasks.every(task=>task.status==='paused'));
});

async function queueHarness(tasks,limit=1,initialHistory=[],nativeDownloads=[]){
  globalThis.chrome=mock=chromeMock();
  if(nativeDownloads.length)mock.downloads.search=async({id})=>nativeDownloads.filter(item=>item.id===id);
  let list=structuredClone(tasks);
  const engines=[];
  class Hls {
    constructor(cb){this.cb=cb;this.tsUrlList=['segment'];this.pauses=0;this.resumes=0;engines.push(this);}
    start(){this.started=true;}
    async pauseSoft(){await sleep(5);this.pauses++;}
    resume(){this.resumes++;}
    getBytesReceived(){return 123;}
    destroy(removeFile){this.cacheDeleted=removeFile;}
  }
  let nextId=100;
  const queueStorage={get:async()=>({tasks:structuredClone(list)}),enqueue:async value=>{const id=String(nextId++);list.push({...value,id,status:'queued',createdAt:Number(id),opfsCacheFileName:id});return id;},updateTask:async(id,value)=>{list=list.map(t=>t.id===id?{...t,...value}:t);},removeTask:async id=>{list=list.filter(t=>t.id!==id);}};
  const historyRecords=[...initialHistory],subscribers=[];
  const manager=installQueueManager({queueStorage,historyStorage:{get:async()=>({records:historyRecords.map(([fileName,url,pageUrl,metadata])=>({fileName,url,pageUrl,...metadata}))}),addRecord:async(...args)=>historyRecords.push(args)},settingsStorage:{get:async()=>({maxConcurrentTasks:limit}),subscribe:fn=>subscribers.push(fn)},HlsDownloader:Hls,registerBlob(){},bindBlob(){},clearBlob(){},formatFilename:n=>n,withSubdir:n=>n});
  await manager.ready;
  return {manager,engines,queueStorage,historyRecords,tasks:()=>list,setLimit:async value=>{limit=value;for(const fn of subscribers)fn();await manager.schedule();}};
}
const task=id=>({id,url:`https://example.test/${id}.m3u8`,format:'m3u8',status:'queued',createdAt:Number(id),opfsCacheFileName:id});
test('resuming a paused browser save waits behind the same global concurrency limit',async()=>{
  const h=await queueHarness([task('1'),task('2')]);
  h.engines[0].cb.onProgress({progress:95,bytesReceived:100,isFileDownloading:true,chromeDownloadId:42});
  await h.manager.pause('1');await until(()=>h.engines.length===2);
  await h.manager.resume('1');assert.deepEqual(mock.resumed,[]);
  assert.equal(h.tasks().find(task=>task.id==='1').status,'queued');
  h.engines[1].cb.onComplete();await until(()=>mock.resumed.includes(42));
  assert.equal(h.tasks().filter(task=>task.status==='downloading').length,1);await h.manager.remove('1');
});
test('a recovered paused save obeys capacity and an interrupted save releases its slot for retry',async()=>{
  const h=await queueHarness([{...task('1'),status:'paused',chromeDownloadId:42,cachedBytes:123,outputReady:true,outputExtension:'mp4',outputCacheFileName:'one.mp4'},task('2')],1,[],[{id:42,state:'in_progress',paused:true}]);
  await h.manager.resume('1');assert.deepEqual(mock.resumed,[]);
  h.engines[0].cb.onComplete();await until(()=>mock.resumed.includes(42));
  mock.downloads.onChanged.emit({id:42,state:{current:'interrupted'},error:{current:'NETWORK_FAILED'}});
  await until(()=>h.tasks().find(task=>task.id==='1')?.retryCount===1);
  assert.equal(h.manager.active.has('1'),false);
  const retry=h.tasks().find(task=>task.id==='1');assert.equal(retry.status,'queued');assert.equal(retry.outputReady,true);assert.equal(retry.outputCacheFileName,'one.mp4');
  await h.manager.remove('1');
});
test('simultaneous resumes and changing the concurrency limit cannot oversubscribe the queue',async()=>{
  const h=await queueHarness([task('1'),{...task('2'),status:'paused'},{...task('3'),status:'paused'}]);
  await Promise.all([h.manager.resume('2'),h.manager.resume('3')]);
  assert.equal(h.engines.length,1);assert.equal(h.tasks().filter(task=>task.status==='queued').length,2);
  await h.setLimit(2);await until(()=>h.engines.length===2);
  await h.setLimit(1);h.engines[0].cb.onComplete();await until(()=>h.tasks().length===2);
  await h.manager.schedule();assert.equal(h.engines.length,2);
  h.engines[1].cb.onComplete();await until(()=>h.engines.length===3);
  await h.manager.remove('3');
});
test('a transient timeout queues a bounded retry, retains identity, and frees a slot',async()=>{
  const h=await queueHarness([task('1'),task('2')]);
  h.engines[0].cb.onError(Object.assign(Error('signal timed out'),{code:'TIMEOUT'}));
  await until(()=>h.engines.length===2);
  const retry=h.tasks().find(task=>task.id==='1');
  assert.equal(retry.status,'queued');assert.equal(retry.retryCount,1);assert.ok(retry.nextRetryAt>Date.now());assert.equal(retry.opfsCacheFileName,'1');
  assert.equal(h.tasks().find(task=>task.id==='2').status,'downloading');
  await h.manager.pause('1');h.engines[1].cb.onComplete();await until(()=>h.tasks().length===1);
  await h.manager.schedule();assert.equal(h.engines.length,2);await h.manager.remove('1');
});
test('pause releases a slot; resume waits for capacity and reuses the paused engine',async()=>{
  const h=await queueHarness([task('1'),task('2')]);
  assert.equal(h.engines.length,1);
  await h.manager.pause('1');await until(()=>h.engines.length===2);
  await h.manager.resume('1');assert.equal(h.tasks().find(t=>t.id==='1').status,'queued');
  h.engines[1].cb.onComplete();
  await until(()=>h.engines[0].resumes===1);
  assert.equal(h.engines.length,2);assert.equal(h.tasks()[0].status,'downloading');
  await h.manager.remove('1');
});

test('rapid pause/resume commands serialize and saving uses browser download controls',async()=>{
  const h=await queueHarness([task('1')]);
  await Promise.all([h.manager.pause('1'),h.manager.resume('1'),h.manager.pause('1')]);
  assert.equal(h.engines[0].pauses,2);assert.equal(h.tasks()[0].status,'paused');
  await h.manager.resume('1');
  h.engines[0].cb.onProgress({progress:95,bytesReceived:100,isFileDownloading:true,chromeDownloadId:42});
  await h.manager.pause('1');await h.manager.resume('1');
  assert.deepEqual(mock.paused,[42]);assert.deepEqual(mock.resumed,[42]);assert.equal(h.engines[0].pauses,2);
  await h.manager.remove('1');
});

test('queued tasks can be paused before they start',async()=>{
  const h=await queueHarness([task('1'),task('2')]);
  await h.manager.pause('2');assert.equal(h.tasks()[1].status,'paused');
  h.engines[0].cb.onComplete();await sleep(20);assert.equal(h.engines.length,1);
  await h.manager.resume('2');await until(()=>h.engines.length===2);await h.manager.remove('2');
});

test('an unresumable browser save exports the cached video again',async()=>{
  const h=await queueHarness([task('1')]);
  h.engines[0].cb.onProgress({progress:95,bytesReceived:123,isFileDownloading:true,chromeDownloadId:42});
  await h.manager.pause('1');
  mock.downloads.resume=async()=>{throw Error('Download is not resumable');};
  mock.runtime.sendMessage=async message=>message.type==='OPFS_TO_BLOB_URL'?{ok:true,blobUrl:'blob:test-cache'}:{};
  mock.downloads.download=(options,callback)=>callback(43);
  mock.downloads.search=async()=>[{id:43,state:'in_progress'}];
  await h.manager.resume('1');
  await until(()=>h.tasks()[0]?.chromeDownloadId===43);
  assert.equal(h.tasks()[0].status,'downloading');
  mock.downloads.onChanged.emit({id:43,state:{current:'complete'}});
  await until(()=>h.tasks().length===0);
});

test('Retry keeps the original task ID and cache after a failed HLS download',async()=>{
  const h=await queueHarness([task('1')]);
  h.engines[0].cb.onError('Connection interrupted');
  await until(()=>h.tasks()[0]?.status==='error');
  await until(()=>h.engines[0].cacheDeleted===false);
  assert.equal((await command({type:'download-queue-retry',taskId:'1'})).success,true);
  await until(()=>h.engines.length===2);
  assert.equal(h.tasks()[0].id,'1');assert.equal(h.tasks()[0].opfsCacheFileName,'1');
  assert.equal(h.engines[0].cacheDeleted,false);
  await h.manager.remove('1');
});

test('queue Retry renews a Pornhub direct source in the same task and records the renewed URL',async()=>{
  const originalFetch=globalThis.fetch,storageDescriptor=Object.getOwnPropertyDescriptor(navigator,'storage');
  const storage=memoryStorage();storage.files.set('kept-cache',[1,2]);
  Object.defineProperty(navigator,'storage',{configurable:true,value:storage});
  const pageUrl='https://www.pornhub.org/view_video.php?viewkey=test';
  const html='var flashvars_123 = '+JSON.stringify({mediaDefinitions:[{format:'mp4',quality:720,videoUrl:'https://cdn.test/fresh.mp4'},{format:'hls',quality:720,videoUrl:'https://cdn.test/other.m3u8'}]})+';';
  const requests=[];
  globalThis.fetch=async(url,options)=>{
    requests.push(url);assert.equal(options.cache,'no-store');
    if(url===pageUrl)return new Response(html);
    if(url.includes('old'))return new Response('',{status:472});
    assert.equal(options.headers.get('Range'),'bytes=0-');
    return new Response(Uint8Array.of(1,2,3,4),{status:206,headers:{'Content-Range':'bytes 0-3/4'}});
  };
  try{
    const h=await queueHarness([{id:'kept-id',url:'https://cdn.test/old.mp4',pageUrl,quality:'720',format:'mp4',status:'error',cachedBytes:2,totalBytes:4,opfsCacheFileName:'kept-cache'}]);
    mock.runtime.sendMessage=async message=>message.type==='OPFS_TO_BLOB_URL'?{ok:true,blobUrl:'blob:test-cache'}:{};
    mock.downloads.download=(options,callback)=>callback(44);
    mock.downloads.search=async()=>[{id:44,state:'in_progress'}];
    await h.manager.resume('kept-id');
    await until(()=>h.tasks()[0]?.chromeDownloadId===44);
    assert.equal(h.tasks()[0].id,'kept-id');assert.equal(h.tasks()[0].opfsCacheFileName,'kept-cache');
    assert.equal(h.tasks()[0].url,'https://cdn.test/fresh.mp4');assert.deepEqual(storage.files.get('kept-cache'),[1,2,3,4]);
    assert.deepEqual(requests,['https://cdn.test/old.mp4',pageUrl,'https://cdn.test/fresh.mp4']);
    mock.downloads.onChanged.emit({id:44,state:{current:'complete'}});
    await until(()=>h.tasks().length===0);assert.equal(h.historyRecords[0][1],'https://cdn.test/fresh.mp4');
    assert.equal(h.historyRecords[0][2],pageUrl);
  }finally{
    globalThis.fetch=originalFetch;
    if(storageDescriptor)Object.defineProperty(navigator,'storage',storageDescriptor);else delete navigator.storage;
  }
});

function command(message){return new Promise(resolve=>{for(const listener of mock.runtime.onMessage.listeners)listener(message,{id:mock.runtime.id},resolve);});}
test('background scan persists all pages without a popup and Stop cancels a pending fetch',async()=>{
  const originalFetch=globalThis.fetch;
  const h=await queueHarness([]);
  globalThis.fetch=async url=>new Response(String(new URL(url).searchParams.get('page')||1));
  mock.runtime.sendMessage=async message=>{
    if(message.type==='profile-parse-html'){
      const page=Number(message.html);
      return {ok:true,result:{profileName:'Creator',videos:[{id:String(page)}],nextPages:page<3?[`https://example.test/model/creator/videos?page=${page+1}`]:[]}};
    }
    return {};
  };
  try{
    assert.equal((await command({type:'profile-scan-start',url:'https://example.test/model/creator/videos'})).success,true);
    await until(async()=>((await mock.storage.local.get('profileScanState')).profileScanState?.status==='complete'));
    const scan=(await mock.storage.local.get('profileScanState')).profileScanState;
    assert.equal(scan.pagesScanned,3);assert.equal(scan.videos.length,3);
    let aborted=false;
    globalThis.fetch=(url,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>{aborted=true;reject(signal.reason);},{once:true}));
    await command({type:'profile-scan-start',url:'https://example.test/model/creator/videos'});
    await sleep(20);
    await command({type:'profile-scan-stop'});
    await until(async()=>((await mock.storage.local.get('profileScanState')).profileScanState?.status==='stopped'));
    assert.equal(aborted,true);
  }finally{globalThis.fetch=originalFetch;}
});

test('Clear results waits for a late scanned page, resets saved results and selection, and preserves downloads and history',async()=>{
  const originalFetch=globalThis.fetch,h=await queueHarness([task('1')],1,[['Saved','stream','https://example.test/watch',{}]]);
  let releaseParse,enteredParse;
  const parsing=new Promise(resolve=>{enteredParse=resolve;});
  globalThis.fetch=async()=>new Response('page');
  mock.runtime.sendMessage=async message=>{
    if(message.type==='profile-parse-html'){enteredParse();return new Promise(resolve=>{releaseParse=resolve;});}
    return {};
  };
  try{
    await command({type:'profile-scan-start',url:'https://example.test/model/creator/videos'});
    await parsing;
    await command({type:'profile-selection-update',profileUrl:'https://example.test/model/creator/videos',action:{type:'range'}});
    const clearing=command({type:'profile-results-clear'});
    await sleep(5);
    releaseParse({ok:true,result:{profileName:'Late creator',videos:[{id:'late',url:'https://example.test/view_video.php?viewkey=late'}],nextPages:[]}});
    assert.equal((await clearing).success,true);
    const saved=await mock.storage.local.get(['profileScanState','profileSelectionState']);
    assert.equal(saved.profileScanState.status,'cleared');assert.deepEqual(saved.profileScanState.videos,[]);
    assert.equal(saved.profileScanState.profileName,'');assert.equal(saved.profileScanState.pagesScanned,0);
    assert.deepEqual(saved.profileSelectionState.keys,[]);assert.equal(saved.profileSelectionState.mode,'manual');
    assert.equal(h.tasks().length,1);assert.equal(h.tasks()[0].id,'1');assert.equal(h.engines[0].cacheDeleted,undefined);assert.equal(h.historyRecords.length,1);
  }finally{globalThis.fetch=originalFetch;await h.manager.remove('1');}
});

test('profile batch queues unresolved pages immediately and exposes per-task resolution errors only after a slot opens',async()=>{
  const originalFetch=globalThis.fetch;
  const h=await queueHarness([]);
  const html='var flashvars_123 = '+JSON.stringify({video_title:'Batch title',mediaDefinitions:[{format:'hls',quality:1080,videoUrl:'https://cdn.test/playlist.m3u8'}]})+';';
  globalThis.fetch=async url=>new Response(url.includes('missing')?'no video':url.includes('.m3u8')?'#EXTM3U\n#EXTINF:1,\nsegment.ts\n#EXT-X-ENDLIST':html);
  try{
    const response=await command({type:'profile-batch-start',profileName:'Creator',quality:'best',useChannelFolder:true,videos:[{title:'One',url:'https://example.test/one'},{title:'Missing',url:'https://example.test/missing'}]});
    assert.equal(response.success,true);
    await until(async()=>((await mock.storage.local.get('profileBatchState')).profileBatchState?.status==='complete'));
    const batch=(await mock.storage.local.get('profileBatchState')).profileBatchState;
    assert.equal(batch.enqueued,2);assert.equal(batch.failed,0);assert.equal(batch.processed,2);
    await until(()=>h.engines.length===1);
    assert.match(h.tasks()[0].fileName,/Creator\/One/);
    assert.equal(h.tasks()[1].url,'');assert.equal(h.tasks()[1].status,'queued');
    h.engines[0].cb.onComplete();
    await until(()=>h.tasks().some(task=>task.status==='error'));
    assert.match(h.tasks()[0].error,/No supported/);
    for(const task of h.tasks())await h.manager.remove(task.id);
  }finally{globalThis.fetch=originalFetch;}
});

test('quality sorting is globally ascending across MP4/HLS and leaves unknown quality last',()=>{
  const sorted=sortQualities([{quality:1080,format:'hls'},{quality:240,format:'mp4'},{quality:480,format:'mp4'},{quality:240,format:'hls'},{quality:'Auto',format:'mp4'}]);
  assert.deepEqual(sorted.map(video=>video.quality),[240,240,480,1080,'Auto']);
  assert.equal(sorted[0].format,'mp4');
});
test('download labels match stable video pages and never conflate different /videos/ pages',()=>{
  const records=[{pageUrl:'https://www.example.test/view_video.php?viewkey=one&ref=old',url:'old-signed-stream'}];
  assert.ok(downloadedRecord(records,'https://example.test/view_video.php?viewkey=one&ref=new','new-signed-stream'));
  assert.equal(downloadedRecord(records,'https://example.test/view_video.php?viewkey=two'),undefined);
  assert.notEqual(videoKey('https://example.test/videos/first-123'),videoKey('https://example.test/videos/second-456'));
  assert.equal(videoKey('https://example.test/video.abcd/old-slug'),videoKey('https://example.test/video.abcd/new-slug'));
});
test('history preserves legacy records and detailed completions; thumbnail preference persists',async()=>{
  globalThis.chrome=mock=chromeMock();
  const {s:history,t:settings}=await import('../assets/js/downloadSettingsStorage.CsrP3JcJ.js');
  await mock.storage.local.set({m3u8DownloadHistory:{records:[{id:'legacy',fileName:'old video',completedAt:1}]}});
  await history.addRecord('Creator/New video','stream','https://example.test/watch?id=1',{taskId:'completed',title:'New video',creator:'Creator',quality:'720',format:'mp4',thumbnail:'https://example.test/thumb.jpg',bytes:100,downloadId:42});
  const records=(await history.get()).records;
  assert.equal(records.length,2);assert.equal(records[1].id,'legacy');assert.equal(records[0].downloadId,42);assert.equal(records[0].title,'New video');assert.equal(records[0].bytes,100);
  for(let i=0;i<51;i++)await history.addRecord('Video '+i,'stream'+i,'https://example.test/watch?id='+i);
  assert.equal((await history.get()).records.length,53,'history must not silently discard downloads after 50 records');
  await settings.setShowThumbnails(false);assert.equal((await settings.get()).showThumbnails,false);
  await settings.setShowThumbnails(true);assert.equal((await settings.get()).showThumbnails,true);
});
test('completion records video metadata and browser download ID only after success',async()=>{
  const h=await queueHarness([{...task('1'),title:'Saved title',creator:'Creator',quality:'720',thumbnail:'https://example.test/thumb.jpg'}]);
  assert.equal(h.historyRecords.length,0);
  h.engines[0].cb.onProgress({progress:95,bytesReceived:123,isFileDownloading:true,chromeDownloadId:42});
  h.engines[0].cb.onComplete();await until(()=>h.historyRecords.length===1);
  assert.equal(h.historyRecords[0][3].title,'Saved title');assert.equal(h.historyRecords[0][3].downloadId,42);assert.equal(h.historyRecords[0][3].bytes,123);
});
test('Cancel aborts resolution, removes active and queued creator batch tasks, and preserves unrelated downloads',async()=>{
  const originalFetch=globalThis.fetch,h=await queueHarness([task('1')],2);
  let pending=false,aborted=false;
  const html='var flashvars_1 = '+JSON.stringify({mediaDefinitions:[{format:'hls',quality:720,videoUrl:'https://cdn.test/video.m3u8'}]})+';';
  globalThis.fetch=(url,{signal})=>{
    if(url.includes('pending')){pending=true;return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>{aborted=true;reject(signal.reason);},{once:true}));}
    return Promise.resolve(new Response(url.includes('.m3u8')?'#EXTM3U\n#EXTINF:1,\nseg.ts\n#EXT-X-ENDLIST':html));
  };
  try{
    const started=await command({type:'profile-batch-start',profileUrl:'https://example.test/model/alex/videos',profileName:'Alex',quality:'best',videos:[{title:'Pending',url:'https://example.test/pending'},{title:'One',url:'https://example.test/one'},{title:'Two',url:'https://example.test/two'}]});
    await until(()=>pending);await until(()=>h.tasks().filter(task=>task.batchId).length===3);
    const result=await command({type:'profile-batch-cancel',batchId:started.batchId,profileKey:'example.test/model/alex'});
    assert.equal(result.success,true);assert.equal(result.cancelled,3);assert.equal(aborted,true);
    assert.deepEqual(h.tasks().map(task=>task.id),['1']);assert.equal(h.engines[0].cacheDeleted,undefined);assert.equal(h.engines.length,1);assert.equal(h.historyRecords.length,0);
    assert.equal((await mock.storage.local.get('profileBatchState')).profileBatchState.status,'cancelled');
    await h.manager.remove('1');
  }finally{globalThis.fetch=originalFetch;}
});
test('Cancel fences an enqueue already in progress so no late batch download survives',async()=>{
  const originalFetch=globalThis.fetch,h=await queueHarness([]);
  let release,entered=false;
  const baseEnqueue=h.queueStorage.enqueue;
  h.queueStorage.enqueue=async value=>{entered=true;await new Promise(resolve=>{release=resolve;});return baseEnqueue(value);};
  const html='var flashvars_1 = '+JSON.stringify({mediaDefinitions:[{format:'hls',quality:720,videoUrl:'https://cdn.test/video.m3u8'}]})+';';
  globalThis.fetch=async url=>new Response(url.includes('.m3u8')?'#EXTM3U\n#EXTINF:1,\nseg.ts\n#EXT-X-ENDLIST':html);
  try{
    const started=await command({type:'profile-batch-start',profileUrl:'https://example.test/model/alex',profileName:'Alex',videos:[{title:'One',url:'https://example.test/one'}]});
    await until(()=>entered);
    const cancellation=command({type:'profile-batch-cancel',batchId:started.batchId,profileKey:'example.test/model/alex'});
    await sleep(10);release();
    assert.equal((await cancellation).success,true);assert.equal(h.tasks().length,0);assert.equal(h.engines.length,0);
  }finally{globalThis.fetch=originalFetch;}
});

test('Cancel also stops a browser file save after batch resolution is finished',async()=>{
  const h=await queueHarness([{...task('1'),batchId:'finished-batch',batchProfileKey:'example.test/model/alex'},task('2')],2);
  await mock.storage.local.set({profileBatchState:{id:'finished-batch',profileKey:'example.test/model/alex',status:'complete'}});
  h.engines[0].cb.onProgress({progress:95,bytesReceived:123,isFileDownloading:true,chromeDownloadId:42});
  const cancelled=[];mock.downloads.cancel=async id=>cancelled.push(id);
  const response=await command({type:'profile-batch-cancel',batchId:'finished-batch',profileKey:'example.test/model/alex'});
  assert.equal(response.success,true);assert.deepEqual(cancelled,[42]);assert.deepEqual(h.tasks().map(task=>task.id),['2']);assert.equal(h.historyRecords.length,0);
  await h.manager.remove('2');
});

test('profile batches skip downloaded pages before fetching, even when submitted with a new quality',async()=>{
  const originalFetch=globalThis.fetch;
  const h=await queueHarness([],1,[['Old video','expired-stream','https://www.example.test/view_video.php?viewkey=old&ref=history',{quality:'240'}]]);
  const requests=[];
  const html='var flashvars_1 = '+JSON.stringify({mediaDefinitions:[{format:'hls',quality:1080,videoUrl:'https://cdn.test/video.m3u8'}]})+';';
  globalThis.fetch=async url=>{requests.push(url);return new Response(url.includes('.m3u8')?'#EXTM3U\n#EXTINF:1,\nseg.ts\n#EXT-X-ENDLIST':html);};
  try {
    await command({type:'profile-batch-start',profileName:'Creator',quality:'1080',videos:[{title:'Old video',url:'https://example.test/view_video.php?viewkey=old&ref=profile'},{title:'New video',url:'https://example.test/view_video.php?viewkey=new'}]});
    await until(async()=>((await mock.storage.local.get('profileBatchState')).profileBatchState?.status==='complete'));
    const batch=(await mock.storage.local.get('profileBatchState')).profileBatchState;
    assert.equal(batch.skipped,1);assert.equal(batch.enqueued,1);assert.equal(batch.processed,2);assert.equal(batch.failed,0);
    assert.ok(requests.every(url=>!url.includes('viewkey=old')));
    assert.equal(h.tasks().length,1);assert.ok(h.tasks()[0].pageUrl.includes('viewkey=new'));
    for(const task of h.tasks())await h.manager.remove(task.id);
  } finally {globalThis.fetch=originalFetch;}
});

test('a completion during queued page resolution is rechecked before starting a transfer',async()=>{
  const originalFetch=globalThis.fetch,h=await queueHarness([]);
  const page='https://example.test/view_video.php?viewkey=race';
  const html='var flashvars_1 = '+JSON.stringify({mediaDefinitions:[{format:'hls',quality:720,videoUrl:'https://cdn.test/video.m3u8'}]})+';';
  globalThis.fetch=async url=>{
    if(url===page)h.historyRecords.push(['Finished elsewhere','another-stream',page,{}]);
    return new Response(url.includes('.m3u8')?'#EXTM3U\n#EXTINF:1,\nseg.ts\n#EXT-X-ENDLIST':html);
  };
  try {
    await command({type:'profile-batch-start',profileName:'Creator',videos:[{title:'Race video',url:page}]});
    await until(async()=>((await mock.storage.local.get('profileBatchState')).profileBatchState?.status==='complete'));
    const batch=(await mock.storage.local.get('profileBatchState')).profileBatchState;
    assert.equal(batch.enqueued,1);assert.equal(batch.processed,1);
    await until(()=>h.tasks().length===0);
    assert.equal(h.tasks().length,0);assert.equal(h.engines.length,0);
  } finally {globalThis.fetch=originalFetch;}
});

test('queued batch items that are already downloaded are removed before starting',async()=>{
  const page='https://example.test/view_video.php?viewkey=done';
  const h=await queueHarness([{...task('1'),batchId:'old-batch',pageUrl:page}],1,[['Done','different-signed-stream',page,{}]]);
  assert.equal(h.tasks().length,0);assert.equal(h.engines.length,0);
});

test('range selection includes both endpoints in listing order, skips history and supports reverse and single-video ranges',()=>{
  const videos=Array.from({length:8},(_,i)=>({id:String(i),url:`https://example.test/view_video.php?viewkey=${i}`}));
  const history=[{pageUrl:videos[3].url}],keys=videos.map(video=>videoKey(video.url));
  for(const [start,end,expected]of [[1,5,['1','2','4','5']],[5,1,['1','2','4','5']],[2,2,['2']]]){
    let selection=changeSelection(null,{type:'range'},videos,history);
    selection=changeSelection(selection,{type:'pick',key:keys[start]},videos,history);
    assert.equal(selectionView(videos,selection,history).complete,false);
    selection=changeSelection(selection,{type:'pick',key:keys[end]},videos,history);
    const restored=JSON.parse(JSON.stringify(selection));
    assert.deepEqual(selectionView(videos,restored,history).videos.map(video=>video.id),expected);
    assert.equal(selectionView(videos,restored,history).complete,true);
  }
});

test('range endpoints survive scanning additional pages without selecting outside the range',()=>{
  const videos=Array.from({length:10},(_,i)=>({id:String(i),url:`https://example.test/view_video.php?viewkey=${i}`}));
  const selection={mode:'range',start:videoKey(videos[2].url),end:videoKey(videos[7].url)};
  assert.equal(selectionView(videos.slice(0,5),selection).complete,false);
  assert.deepEqual(selectionView(videos,selection).videos.map(video=>video.id),['2','3','4','5','6','7']);
  const manual=changeSelection(selection,{type:'toggle',key:videoKey(videos[4].url)},videos);
  assert.deepEqual(selectionView(videos,manual).videos.map(video=>video.id),['2','3','5','6','7']);
  assert.equal(selectionView(videos,changeSelection(manual,{type:'clear'},videos)).videos.length,0);
  assert.equal(selectionView(videos,changeSelection(manual,{type:'new'},videos)).videos.length,10);
});

test('default selection remembers deselections while adding newly scanned videos',()=>{
  const videos=[{url:'https://example.test/view_video.php?viewkey=one'},{url:'https://example.test/view_video.php?viewkey=two'}];
  const selection=changeSelection(null,{type:'toggle',key:videoKey(videos[0].url)},videos.slice(0,1));
  assert.deepEqual(selectionView(videos,selection).videos,[videos[1]]);
});

test('shared webpage range mutations serialize and the background batches only that completed range',async()=>{
  const originalFetch=globalThis.fetch;
  const videos=Array.from({length:7},(_,i)=>({id:String(i),url:`https://example.test/view_video.php?viewkey=${i}`,title:'Video '+i}));
  const h=await queueHarness([],1,[['Downloaded','old',videos[3].url,{}]]);
  const profileUrl='https://example.test/model/creator/videos';
  const scan={profileUrl,profileName:'Creator',status:'scanning',videos,pagesScanned:3};
  await mock.storage.local.set({profileScanState:scan});
  await command({type:'profile-selection-update',profileUrl,action:{type:'range'}});
  await Promise.all([1,5].map(i=>command({type:'profile-selection-update',profileUrl,action:{type:'pick',key:videoKey(videos[i].url)},video:videos[i]})));
  const saved=(await mock.storage.local.get('profileSelectionState')).profileSelectionState;
  assert.equal(saved.start,videoKey(videos[1].url));assert.equal(saved.end,videoKey(videos[5].url));
  const early=await command({type:'profile-batch-selected',profileUrl,quality:'720'});
  assert.equal(early.success,false);assert.match(early.error,/Finish scanning/);
  await mock.storage.local.set({profileScanState:{...scan,status:'complete'}});
  const html='var flashvars_123 = '+JSON.stringify({mediaDefinitions:[{format:'hls',quality:720,videoUrl:'https://cdn.test/stream.m3u8'}]})+';';
  globalThis.fetch=async url=>new Response(url.includes('.m3u8')?'#EXTM3U\n#EXTINF:1,\nsegment.ts\n#EXT-X-ENDLIST':html);
  try{
    assert.equal((await command({type:'profile-batch-selected',profileUrl,quality:'720'})).success,true);
    await until(async()=>((await mock.storage.local.get('profileBatchState')).profileBatchState?.status==='complete'));
    assert.deepEqual(h.tasks().map(task=>task.pageUrl),[1,2,4,5].map(i=>videos[i].url));
    for(const task of h.tasks())await h.manager.remove(task.id);
    const other=await command({type:'profile-batch-selected',profileUrl:'https://example.test/model/other/videos'});
    assert.equal(other.success,false);
  }finally{globalThis.fetch=originalFetch;}
});
