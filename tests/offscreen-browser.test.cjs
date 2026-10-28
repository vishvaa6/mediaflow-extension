const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const {spawnSync}=require('node:child_process');
const runtime=process.env.CODEX_NODE_MODULES || 'C:/Users/vishv/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const {chromium}=require(path.join(runtime,'playwright'));
const root=path.resolve(__dirname,'..'),out=path.join(root,'test-results','offscreen');
fs.mkdirSync(out,{recursive:true});
function command(executable,args){const result=spawnSync(executable,args,{encoding:'utf8',windowsHide:true});if(result.error)throw result.error;assert.equal(result.status,0,result.stderr);return result.stdout;}
command('ffmpeg',['-y','-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc=size=160x90:rate=10','-f','lavfi','-i','sine=frequency=440:sample_rate=44100','-t','2','-c:v','libx264','-pix_fmt','yuv420p','-g','10','-c:a','aac','-f','hls','-hls_time','1','-hls_playlist_type','vod','-hls_segment_filename',path.join(out,'segment-%d.ts'),path.join(out,'fixture.m3u8')]);
command('ffmpeg',['-y','-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc=size=160x90:rate=10','-t','1','-c:v','libvpx-vp9','-pix_fmt','yuv420p',path.join(out,'fixture.webm')]);
command('ffmpeg',['-y','-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc=size=160x90:rate=10','-t','1','-c:v','mpeg2video','-pix_fmt','yuv420p','-f','mpegts',path.join(out,'original.ts')]);
const playlist=fs.readFileSync(path.join(out,'fixture.m3u8'),'utf8');
const requests=new Map(),held=new Set(),saved=[],rules=new Map();
let hold=true,holdFive=true,expireFive=false,failNextSave=false,background,offscreen,browser,context,origin,maxActive=0;
const values={'download-settings':{maxConcurrentTasks:2,outputFormat:'mp4'}};
const count=url=>requests.set(url,(requests.get(url)||0)+1);
const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost');
  res.setHeader('Cache-Control','no-store');
  if(url.pathname==='/background-test'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Background fixture</title>');return;}
  if(/^\/watch\/\d+$/.test(url.pathname)){
    count(url.pathname);const id=url.pathname.split('/').pop();
    if(id==='3' && requests.get(url.pathname)===1){res.writeHead(503,{'Retry-After':'1'});res.end('Temporary fixture outage');return;}
    res.setHeader('Content-Type','text/html');res.end('var flashvars_1 = '+JSON.stringify({video_title:'Neutral fixture '+id,mediaDefinitions:[{format:'hls',quality:90,videoUrl:`/media/${id}/fixture.m3u8${id==='5'?'?token='+(expireFive?'fresh':'old'):''}`}]})+';');return;
  }
  const media=url.pathname.match(/^\/media\/(\d+)\/(fixture\.m3u8|repeat\.m3u8|segment-\d+\.ts)$/);
  if(media){
    count(url.pathname);
    if(media[1]==='5' && expireFive && url.searchParams.get('token')!=='fresh'){res.writeHead(472);res.end();return;}
    if(media[2]==='repeat.m3u8'){const entries=playlist.split('\n').filter(line=>line.startsWith('#EXTINF:') || line.startsWith('segment-')).join('\n');res.end('#EXTM3U\n'+entries+'\n#EXT-X-DISCONTINUITY\n'+entries+'\n#EXT-X-ENDLIST');return;}
    if(media[2]==='fixture.m3u8'){res.setHeader('Content-Type','application/vnd.apple.mpegurl');res.end(media[1]==='5'?playlist.replace(/(segment-\d+\.ts)/g,'$1?token='+url.searchParams.get('token')):playlist);return;}
    const send=()=>{res.setHeader('Content-Type','video/mp2t');res.end(fs.readFileSync(path.join(out,media[2])));};
    if(hold || media[1]==='5' && media[2]==='segment-1.ts' && holdFive){const job={res,send,id:media[1],token:url.searchParams.get('token')};held.add(job);res.on('close',()=>held.delete(job));}else send();return;
  }
  if(url.pathname==='/original.webm'){count(url.pathname);res.setHeader('Content-Type','video/webm');res.end(fs.readFileSync(path.join(out,'fixture.webm')));return;}
  if(url.pathname==='/original.m3u8'){res.end('#EXTM3U\n#EXTINF:1,\noriginal.ts\n#EXT-X-ENDLIST');return;}
  if(url.pathname==='/original.ts'){res.setHeader('Content-Type','video/mp2t');res.end(fs.readFileSync(path.join(out,'original.ts')));return;}
  const file=path.resolve(root,'.'+decodeURIComponent(url.pathname));
  if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
  try{res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(fs.readFileSync(file));}catch{res.writeHead(404);res.end();}
});
async function dispatch(page,message,sender){
  if(!page || page.isClosed())return undefined;
  return page.evaluate(({message,sender})=>new Promise(resolve=>{
    let async=false,answered=false;
    const respond=value=>{if(!answered){answered=true;resolve(value);}};
    for(const listener of window.runtimeListeners){if(listener(message,sender,respond)===true)async=true;}
    if(!async && !answered)resolve(undefined);
  }),{message,sender});
}
async function until(fn,label){const deadline=Date.now()+30000;while(Date.now()<deadline){if(await fn())return;await new Promise(resolve=>setTimeout(resolve,25));}throw Error('Timed out: '+label);}
async function createBackground(){
  background=await context.newPage();background.on('pageerror',error=>console.error('Background:',error));
  await background.goto(origin+'/background-test');
  await background.evaluate(async()=>{
    const {installQueueManager}=await import('/assets/js/queue-manager.js');
    const {queueStorage,historyStorage,settingsStorage}=await import('/assets/js/storage.js');
    window.manager=installQueueManager({queueStorage,historyStorage,settingsStorage,registerBlob(){},bindBlob(){},clearBlob(){},formatFilename:(name,format)=>name+'.'+format,withSubdir:(name,dir)=>dir?dir+'/'+name:name});
    await manager.ready;
  });
}
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin=`http://127.0.0.1:${server.address().port}`;
  browser=await chromium.launch({executablePath:process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  context=await browser.newContext();
  await context.exposeBinding('testGet',async(source,keys)=>Object.fromEntries((Array.isArray(keys)?keys:[keys]).filter(key=>values[key]!==undefined).map(key=>[key,structuredClone(values[key])])));
  await context.exposeBinding('testSet',async(source,patch)=>{
    const changes={};for(const [key,value]of Object.entries(patch)){changes[key]={oldValue:values[key],newValue:value};values[key]=structuredClone(value);}
    maxActive=Math.max(maxActive,values.downloadQueueState?.tasks.filter(task=>task.status==='downloading').length || 0);
    await Promise.all(context.pages().filter(page=>!page.isClosed()).map(page=>page.evaluate(changes=>{for(const fn of window.localChanges)fn(changes);for(const fn of window.storageChanges)fn(changes,'local');},changes).catch(()=>{})));
  });
  await context.exposeBinding('testHasOffscreen',()=>!!offscreen && !offscreen.isClosed());
  await context.exposeBinding('testCreateOffscreen',async()=>{offscreen=await context.newPage();offscreen.on('pageerror',error=>console.error('Offscreen:',error));await offscreen.goto(origin+'/src/pages/offscreen/index.html');});
  await context.exposeBinding('testRules',async(source,change)=>{if(!change)return [...rules.values()];for(const rule of change.addRules || [])rules.set(rule.id,rule);for(const id of change.removeRuleIds || [])rules.delete(id);});
  await context.exposeBinding('testRuntime',async(source,message)=>{
    const toOffscreen=['mf-offscreen-command','mf-fetch-resource','mf-fetch-cancel','OPFS_TO_BLOB_URL','revoke-blob-url','profile-parse-html','video-parse-metadata','profile-scan-keepalive'].includes(message.type);
    return dispatch(toOffscreen?offscreen:background,message,{id:'fixture',url:source.page.url()});
  });
  await context.exposeBinding('testSave',async(source,options)=>{
    const bytes=await offscreen.evaluate(async url=>[...new Uint8Array(await (await fetch(url)).arrayBuffer())],options.url);
    const id=saved.length+1,file=path.join(out,'saved-'+id+path.extname(options.filename));fs.writeFileSync(file,Buffer.from(bytes));
    const fail=failNextSave;failNextSave=false;saved.push({id,file,filename:options.filename,bytes:bytes.length,fail});return {id,fail};
  });
  await context.addInitScript(({origin})=>{
    window.runtimeListeners=[];window.storageChanges=[];window.localChanges=[];
    const ev=list=>({addListener:fn=>list.push(fn),removeListener:fn=>{const i=list.indexOf(fn);if(i>=0)list.splice(i,1);}});
    const downloadListeners=[],nativeDownloads=new Map();
    window.chrome={runtime:{id:'fixture',getURL:path=>origin+'/'+path,onMessage:ev(runtimeListeners),sendMessage:message=>testRuntime(message)},
      storage:{local:{get:keys=>testGet(keys),set:patch=>testSet(patch),onChanged:ev(localChanges)},onChanged:ev(storageChanges)},
      offscreen:{hasDocument:()=>testHasOffscreen(),createDocument:()=>testCreateOffscreen()},
      declarativeNetRequest:{getSessionRules:()=>testRules(),updateSessionRules:change=>testRules(change)},
      downloads:{onChanged:ev(downloadListeners),download(options,callback){testSave(options).then(({id,fail})=>{
        nativeDownloads.set(id,{id,state:'in_progress',paused:false});callback(id);
        setTimeout(()=>{nativeDownloads.set(id,{id,state:fail?'interrupted':'complete',error:fail?'FILE_ACCESS_DENIED':undefined});for(const fn of downloadListeners)fn({id,state:{current:fail?'interrupted':'complete'},...(fail?{error:{current:'FILE_ACCESS_DENIED'}}:{})});},50);
      });},search:async({id})=>nativeDownloads.has(id)?[nativeDownloads.get(id)]:[],pause:async id=>{nativeDownloads.get(id).paused=true;},resume:async id=>{nativeDownloads.get(id).paused=false;},cancel:async()=>{}}};
  },{origin});
  await createBackground();
  const videos=Array.from({length:4},(_,i)=>({title:'Neutral '+i,url:origin+'/watch/'+i}));
  const result=await dispatch(background,{type:'profile-batch-start',profileName:'Fixture',profileUrl:origin+'/model/fixture',quality:'best',videos},{id:'fixture'});
  assert.equal(result.success,true);
  await until(()=>new Set([...held].map(job=>job.id)).size===2,'two active transfers');
  assert.equal(values.downloadQueueState.tasks.length,4);assert.equal(values.downloadQueueState.tasks.filter(task=>task.status==='queued').length,2);
  assert.equal(requests.has('/watch/2'),false,'queued pages must not resolve early');
  const duplicate=await dispatch(background,{type:'profile-batch-start',profileName:'Fixture',profileUrl:origin+'/model/fixture',quality:'best',videos},{id:'fixture'});
  assert.equal(duplicate.success,true);await until(()=>values.profileBatchState.status==='complete','duplicate batch');assert.equal(values.downloadQueueState.tasks.length,4);
  // Terminate the coordinator while real offscreen workers have requests open.
  await background.close();await createBackground();
  assert.equal(values.downloadQueueState.tasks.filter(task=>task.status==='downloading').length,2);
  hold=false;for(const job of held)job.send();held.clear();
  await until(()=>values.m3u8DownloadHistory?.records.length===4 && values.downloadQueueState.tasks.length===0,'all MP4 completions');
  assert.equal(maxActive,2);assert.equal(values.downloadQueueState.tasks.length,0);
  for(const entry of saved){
    assert.equal(path.extname(entry.filename),'.mp4');
    assert.equal(values.m3u8DownloadHistory.records.find(record=>record.downloadId===entry.id).bytes,entry.bytes,'history must record the actual saved output size');
    const metadata=JSON.parse(command('ffprobe',['-v','error','-show_entries','format=duration:stream=codec_name,codec_type','-of','json',entry.file]));
    assert.ok(metadata.streams.some(stream=>stream.codec_type==='video' && stream.codec_name==='h264'));
    assert.ok(metadata.streams.some(stream=>stream.codec_type==='audio' && stream.codec_name==='aac'));
    assert.ok(Math.abs(Number(metadata.format.duration)-2)<.3,metadata.format.duration);
  }
  assert.equal(requests.get('/watch/0'),1,'worker recovery must not resolve the same task again');
  assert.equal(requests.get('/watch/3'),2,'a transient profile-page failure must retry automatically');
  const renewed=await dispatch(background,{type:'download-queue-enqueue',url:origin+'/media/5/fixture.m3u8?token=old',pageUrl:origin+'/watch/5',format:'m3u8',fileName:'Renewed HLS'},{id:'fixture'});
  await until(()=>values.downloadQueueState.tasks.find(task=>task.id===renewed.id)?.finishNum===1,'committed HLS segment');
  await dispatch(background,{type:'download-queue-pause',taskId:renewed.id},{id:'fixture'});
  expireFive=true;
  await dispatch(background,{type:'download-queue-resume',taskId:renewed.id},{id:'fixture'});
  await until(()=>[...held].some(job=>job.id==='5' && job.token==='fresh'),'fresh HLS source after 472');
  await dispatch(background,{type:'download-queue-pause',taskId:renewed.id},{id:'fixture'});
  assert.match(values.downloadQueueState.tasks.find(task=>task.id===renewed.id).url,/token=old/,'the checkpoint URL must remain stable after HLS renewal');
  holdFive=false;
  await dispatch(background,{type:'download-queue-resume',taskId:renewed.id},{id:'fixture'});
  await until(()=>values.m3u8DownloadHistory.records.length===5,'HLS renewal followed by a new worker');
  assert.equal(requests.get('/media/5/segment-0.ts'),1,'renewal and worker replacement must retain committed segments');
  failNextSave=true;
  const failed=await dispatch(background,{type:'download-queue-enqueue',url:origin+'/original.webm',format:'webm',fileName:'Original',pageUrl:origin+'/watch/webm'},{id:'fixture'});
  await until(()=>values.downloadQueueState.tasks.some(task=>task.status==='error'),'failed browser save');
  const failedTask=values.downloadQueueState.tasks.find(task=>task.id===failed.id);
  assert.equal(failedTask.outputReady,true);assert.match(failedTask.fallbackReason,/WebM/);
  const before=requests.get('/original.webm');
  assert.equal((await dispatch(background,{type:'download-queue-retry',taskId:failed.id},{id:'fixture'})).success,true);
  await until(()=>values.m3u8DownloadHistory.records.length===6,'cached save retry');
  assert.equal(requests.get('/original.webm'),before,'save retry must not download the video again');
  const last=saved.at(-1);assert.equal(path.extname(last.filename),'.webm');
  assert.deepEqual(fs.readFileSync(last.file),fs.readFileSync(path.join(out,'fixture.webm')));
  await dispatch(background,{type:'download-queue-enqueue',url:origin+'/media/6/repeat.m3u8',format:'m3u8',fileName:'Discontinuous timeline'},{id:'fixture'});
  await until(()=>values.m3u8DownloadHistory.records.length===7,'MP4 with timeline discontinuity');
  assert.equal(path.extname(saved.at(-1).filename),'.mp4');
  const repeated=JSON.parse(command('ffprobe',['-v','error','-show_entries','format=duration:stream=codec_type','-of','json',saved.at(-1).file]));
  assert.ok(Math.abs(Number(repeated.format.duration)-4)<.3,repeated.format.duration);
  assert.equal(repeated.streams.filter(stream=>['video','audio'].includes(stream.codec_type)).length,2);
  await dispatch(background,{type:'download-queue-enqueue',url:origin+'/original.m3u8',format:'m3u8',fileName:'Original codec'},{id:'fixture'});
  await until(()=>values.m3u8DownloadHistory.records.length===8 && values.downloadQueueState.tasks.length===0,'unsupported codec original TS fallback');
  assert.equal(path.extname(saved.at(-1).filename),'.ts');assert.equal(values.m3u8DownloadHistory.records[0].format,'ts');
  assert.deepEqual(fs.readFileSync(saved.at(-1).file),fs.readFileSync(path.join(out,'original.ts')));
  const original=JSON.parse(command('ffprobe',['-v','error','-show_entries','stream=codec_name','-of','json',saved.at(-1).file]));
  assert.ok(original.streams.some(stream=>stream.codec_name==='mpeg2video'));
  await until(()=>rules.size===0,'request header cleanup');
  console.log('PASS: real offscreen workers; deferred profile resolution; concurrency=2; coordinator restart adoption; 503 retry; HLS renewal across worker replacement; H.264/AAC MP4 and discontinuity duration verified by ffprobe; playable WebM/TS fallback; failed-save retry from cache; header cleanup.');
})().catch(error=>{console.error(error);console.error(JSON.stringify({queue:values.downloadQueueState,requests:[...requests],saved},null,2));process.exitCode=1;}).finally(async()=>{
  await browser?.close();for(const job of held)job.res.destroy();await new Promise(resolve=>server.close(resolve));
});
