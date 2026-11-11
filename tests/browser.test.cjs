const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const runtime = process.env.CODEX_NODE_MODULES || 'C:/Users/vishv/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const {chromium} = require(path.join(runtime,'playwright'));
const root = path.resolve(__dirname,'..');
const server = http.createServer((req,res) => {
  const requested = new URL(req.url,'http://localhost').pathname;
  const genericPlayers={
    '/generic-frame':'<video width="260" height="130" preload="none" src="/generic-frame.mp4"></video>',
    '/generic-test':'<video width="260" height="130" preload="none" src="/generic-top.webm"></video><div id="hls-player"><video width="260" height="130" preload="none" src="/generic-master.m3u8"></video></div><iframe src="/generic-frame" width="300" height="170"></iframe>',
    '/generic-blob':'<video width="260" height="130" preload="none" src="blob:unusable"></video><script type="application/ld+json">{"@type":"VideoObject","contentUrl":"/generic-full.mp4","height":720}</script>'
  };
  const videos=genericPlayers[requested];
  if(videos){
    res.setHeader('Content-Type','text/html');res.setHeader('Content-Security-Policy',"style-src 'self'");
    res.end(`<!doctype html><title>Generic video</title><link rel="stylesheet" href="/assets/css/player-download.css">${videos}<script type="module">import {installMediaDetection} from "/assets/js/media-detection.js";installMediaDetection();</script>`);return;
  }
  if(requested==='/mgp-toolbar-test'){
    res.setHeader('Content-Type','text/html');
    res.end(`<!doctype html><title>Player toolbar</title><link rel="stylesheet" href="/assets/css/player-download.css">
      <style>.mgp_player{position:relative;background:#15151a;width:100%;height:280px}.mgp_videoElement{width:100%;height:100%}
      .mgp_controlsBar{display:flex;align-items:center;justify-content:flex-end;position:absolute;inset:auto 8px 8px;height:32px;gap:5px;transition:opacity .16s}
      .mgp_controlsBar.controls-hidden{opacity:0}
      .mgp_controlsBar>button{height:30px}</style>
      <div class="mgp_player"><video class="mgp_videoElement" preload="none" src="blob:unusable"></video></div>
      <video id="preview-other" width="140" height="80" preload="none" src="/preview.mp4"></video>
      <template id="toolbar-template"><div class="mgp_controlsBar"><button id="autoplay-toggle" aria-label="Autoplay" aria-pressed="true">Auto</button><button class="mgp_nextBtn">Next</button><button>Settings</button></div></template>
      <script>var flashvars_1={"mediaDefinitions":[{"format":"mp4","quality":480,"videoUrl":"/toolbar-480p.mp4"},{"format":"mp4","quality":720,"videoUrl":"/toolbar-720p.mp4"}]};
      document.addEventListener('click',event=>{if(event.target.id==='autoplay-toggle')event.target.setAttribute('aria-pressed',String(event.target.getAttribute('aria-pressed')!=='true'));});</script>
      <script type="module">import {installMediaDetection} from "/assets/js/media-detection.js";installMediaDetection();</script>`);return;
  }
  if (requested === '/thumb.png') { res.setHeader('Content-Type','image/svg+xml');res.end(fs.readFileSync(path.join(root,'tests/fixtures/library-thumb.svg')));return; }
  const file = path.resolve(root,'.'+decodeURIComponent(requested));
  if (!file.startsWith(root+path.sep)) { res.writeHead(403);res.end();return; }
  try { res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.png')?'image/png':'text/html');res.end(fs.readFileSync(file)); }
  catch { res.writeHead(404);res.end(); }
});
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${server.address().port}`;
  const browser=await chromium.launch({executablePath:process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  try {
    const page=await browser.newPage({viewport:{width:480,height:600}});
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.addInitScript(({origin})=>{
      const onChanged=[],localChanged=[];
      const qualities=[{quality:1080,format:'m3u8'},{quality:240,format:'mp4'},{quality:720,format:'mp4'},{quality:480,format:'m3u8'},{quality:240,format:'m3u8'},{quality:1080,format:'mp4'},{quality:480,format:'mp4'},{quality:720,format:'m3u8'}].map(video=>({...video,videoUrl:'https://cdn.test/'+video.quality+'.'+video.format,headers:{Origin:'https://javplayer.cc',Referer:'https://javplayer.cc/'}}));
      const values={downloadQueueState:{tasks:[{id:'download-1',fileName:'Test download',status:'downloading',progress:20,downloadSpeed:'2.0 MB/s'}]},
        m3u8DownloadHistory:{records:[{id:'h-current',title:'Current downloaded video',fileName:'Creator/Current video.mp4',creator:'Test Creator',pageUrl:'https://www.example.test/view_video.php?viewkey=current&from=old',url:'old-signed-url',quality:'720',format:'mp4',bytes:1024,completedAt:Date.now()-10000,downloadId:77,thumbnail:origin+'/thumb.png'},
          {id:'h-profile',title:'Profile downloaded video',fileName:'Creator/Profile video.ts',pageUrl:'https://example.test/view_video.php?viewkey=0&from=profile',url:'other-signed-url',quality:'1080',format:'ts',completedAt:Date.now()-20000,thumbnail:origin+'/thumb.png'}]},
        profileScanState:{status:'complete',profileName:'Test Creator',profileUrl:'https://example.test/model/creator/videos',pagesScanned:4,
          videos:Array.from({length:125},(_,i)=>({id:'video-'+i,url:'https://example.test/view_video.php?viewkey='+i,title:i===0?'A title " ><img id="injected" src=x>':'Test video '+i,thumbnail:origin+(i===0?'/missing.png':'/thumb.png'),thumbnails:[origin+'/thumb.png'],duration:'1:23'}))}};
      const local={onChanged:{addListener:fn=>localChanged.push(fn)},async get(keys){return Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(key=>[key,structuredClone(values[key])]).filter(([,v])=>v!==undefined));},async set(patch){const changes={};for(const [key,value]of Object.entries(patch)){changes[key]={newValue:structuredClone(value)};values[key]=structuredClone(value);}for(const fn of localChanged)fn(changes);for(const fn of onChanged)fn(changes,'local');}};
      window.sentMessages=[];
      window.runtimeListeners=[];
      window.handleHistoryMessage=message=>{
        if(message.type==='download-history-remove')local.set({m3u8DownloadHistory:{records:values.m3u8DownloadHistory.records.filter(record=>record.id!==message.recordId)}});
        if(message.type==='download-history-clear')local.set({m3u8DownloadHistory:{records:[]}});
      };
      window.chrome={i18n:{getMessage:()=>''},storage:{local,onChanged:{addListener:fn=>onChanged.push(fn)}},runtime:{id:'test',onMessage:{addListener:fn=>runtimeListeners.push(fn)},sendMessage(message,callback){sentMessages.push(message);handleHistoryMessage(message);if(message.type==='profile-batch-cancel'){local.set({downloadQueueState:{tasks:values.downloadQueueState.tasks.filter(task=>!task.batchId)}});local.set({profileBatchState:{...values.profileBatchState,status:'cancelled',cancelled:2}});}const result=message.type==='download-queue-snapshot'?{success:true,state:values.downloadQueueState}:{success:true};callback?.(result);return Promise.resolve(result);}},tabs:{query:(query,cb)=>cb([{id:1,url:'https://example.test/view_video.php?viewkey=current',title:'Example page'}]),sendMessage:(id,message,cb)=>cb(message.command==='get_video_info'?{pageTitle:'Current video',videoInfos:qualities,thumbnail:origin+'/thumb.png',thumbnails:[origin+'/thumb.png']}:{thumbnail:origin+'/thumb.png',thumbnails:[origin+'/thumb.png']})}};
      window.testStorage=local;
      window.createdBrowserTabs=[];window.browserWindowMutations=[];
      chrome.runtime.getURL=path=>origin+'/'+path;
      chrome.windows={getCurrent:async()=>({id:77,type:'normal',state:'normal',width:1320,height:930,left:0,top:0}),create:async options=>browserWindowMutations.push({type:'create',options}),update:async(id,options)=>browserWindowMutations.push({type:'resize',id,options})};
      chrome.tabs.create=async options=>{createdBrowserTabs.push(options);return {id:99,...options};};
      values.mediaflowPopupSize=JSON.parse(localStorage.getItem('testPopupSize') || 'null');
      const originalSet=local.set;local.set=async patch=>{if(patch.mediaflowPopupSize)localStorage.setItem('testPopupSize',JSON.stringify(patch.mediaflowPopupSize));await originalSet(patch);};
    },{origin});
    await page.goto(origin+'/src/pages/popup/index.html');
    await page.locator('[data-download-view="queue"]').click();
    await page.waitForSelector('.task-speed-badge');
    await page.evaluate(async()=>{window.savedQueue=(await testStorage.get('downloadQueueState')).downloadQueueState;await testStorage.set({downloadQueueState:{tasks:[{id:'retry-474',fileName:'Interrupted download',status:'queued',phase:'waiting',error:'HTTP 474: unable to fetch video',retryCount:7,nextRetryAt:Date.now()+60000,cachedBytes:1024}]}});});
    await page.waitForSelector('[data-task-id="retry-474"] [aria-label="Retry now"]');
    assert.match(await page.locator('[data-task-id="retry-474"] [data-role="status"]').innerText(),/Retry 7 · waiting/i);
    assert.match(await page.locator('[data-task-id="retry-474"] .task-recovery-note').innerText(),/cached progress is retained/i);
    await page.locator('[data-task-id="retry-474"] [aria-label="Retry now"]').click();
    assert.equal(await page.evaluate(()=>sentMessages.some(message=>message.type==='download-queue-retry' && message.taskId==='retry-474')),true);
    await page.evaluate(()=>testStorage.set({downloadQueueState:savedQueue}));
    assert.equal(await page.locator('#queue-limit option').count(),13);
    await page.locator('#queue-limit').selectOption('0');
    await page.waitForFunction(()=>document.querySelector('#queue-limit')?.value==='0');
    assert.equal(await page.evaluate(async()=>(await testStorage.get('download-settings'))['download-settings'].maxConcurrentTasks),0);
    await page.locator('[data-tab="settings"]').click();
    for(const width of [480,900]){
      await page.setViewportSize({width,height:850});
      const layout=await page.locator('.setting-pending').evaluate(row=>{const label=row.querySelector('.setting-label-col').getBoundingClientRect(),input=row.querySelector('input').getBoundingClientRect();return {label:label.width,input:input.width,separated:label.right<=input.left,height:row.getBoundingClientRect().height};});
      assert.ok(layout.label>=170 && layout.input<=100 && layout.separated && layout.height<150,'queue setting must fit without overlapping or squeezing its label');
    }
    await page.setViewportSize({width:1100,height:850});
    assert.equal(await page.locator('#settings-pending-limit').inputValue(),'0');
    await page.locator('#settings-pending-limit').fill('25');
    await page.locator('#settings-pending-limit').blur();
    await page.waitForFunction(async()=>(await testStorage.get('download-settings'))['download-settings'].maxPendingTasks===25);
    assert.equal(await page.locator('.concurrency-val').innerText(),'0');
    assert.equal(await page.locator('#btn-concurrency-minus').isDisabled(),true);
    await page.locator('#btn-concurrency-plus').click();
    await page.waitForFunction(()=>document.querySelector('.concurrency-val')?.textContent==='1');
    await page.evaluate(async()=>{const {settingsStorage}=await import('/assets/js/storage.js');await settingsStorage.setMaxConcurrentTasks(20);});
    await page.waitForFunction(()=>document.querySelector('.concurrency-val')?.textContent==='12');
    assert.equal(await page.locator('#btn-concurrency-plus').isDisabled(),true);
    await page.locator('[data-tab="video"]').click();await page.locator('[data-download-view="queue"]').click();assert.equal(await page.locator('#queue-limit').inputValue(),'12');
    await page.locator('[data-download-view="detected"]').click();
    assert.equal(await page.locator('#download-output-format').inputValue(),'mp4');
    assert.match(await page.locator('.btn-download-action').first().innerText(),/Download MP4/);
    assert.deepEqual(await page.locator('.qualities-list .quality-badge').allTextContents(),['240','240','480','480','720','720','1080','1080']);
    await page.evaluate(async()=>{
      const original=chrome.runtime.sendMessage;
      chrome.runtime.sendMessage=(message,callback)=>{
        if(message.type!=='media-detection-snapshot')return original(message,callback);
        const result={success:true,videoInfos:[{videoUrl:'https://ads.test/preview.mp4',quality:'Auto',format:'mp4'}]};callback?.(result);return Promise.resolve(result);
      };
      for(const listener of runtimeListeners)listener({type:'media-detection-updated',tabId:1});
      await new Promise(resolve=>setTimeout(resolve,10));chrome.runtime.sendMessage=original;
    });
    assert.equal(await page.locator('.qualities-list .quality-badge').count(),8,'known-site results must exclude unrelated preloaded/advertising resources');
    await page.waitForFunction(()=>document.querySelector('.current-thumbnail-img')?.naturalWidth>0);
    assert.equal(await page.locator('.video-detected-box .already-downloaded:visible').count(),1);
    await page.locator('[data-download-view="queue"]').click();
    assert.match(await page.locator('.task-speed-badge').innerText(),/2.0 MB\/s/);
    await page.evaluate(()=>testStorage.set({downloadQueueState:{tasks:[{id:'download-1',fileName:'Test download',status:'downloading',progress:30,downloadSpeed:4096}]}}));
    await page.waitForFunction(()=>document.querySelector('.task-speed-badge')?.textContent.includes('4.0 KB/s'));
    await page.evaluate(async()=>{
      window.originalQueueProgress=document.querySelector('[data-role="nums"]').firstElementChild;
      const queue=(await testStorage.get('downloadQueueState')).downloadQueueState;
      await testStorage.set({downloadQueueState:queue});
    });
    await page.waitForTimeout(250);
    assert.equal(await page.evaluate(()=>window.originalQueueProgress===document.querySelector('[data-role="nums"]').firstElementChild),true,'duplicate queue updates must not rebuild progress nodes');
    await page.locator('[data-tab="profile"]').click();
    assert.equal(await page.locator('.profile-video-card').count(),60);
    assert.equal(await page.locator('.profile-video-card .already-downloaded:visible').count(),1);
    assert.equal(await page.locator('.profile-video-checkbox').first().isChecked(),false);
    assert.equal(await page.locator('.profile-video-checkbox').first().isDisabled(),true);
    assert.match(await page.locator('[data-role="profile-selection-count"]').innerText(),/124 \/ 125 selected/);
    // Incremental pages select new items, preserve manual deselection, and exclude old videos.
    await page.locator('.profile-video-checkbox').nth(1).uncheck();
    await page.evaluate(async()=>{const scan=(await testStorage.get('profileScanState')).profileScanState;await testStorage.set({profileScanState:{...scan,videos:[...scan.videos,{id:'old-again',url:'https://example.test/view_video.php?viewkey=0&ref=another-page',title:'Already downloaded again'},{id:'new-page-video',url:'https://example.test/view_video.php?viewkey=new-page',title:'New page video'}]}});});
    assert.match(await page.locator('[data-role="profile-selection-count"]').innerText(),/124 \/ 127 selected/);
    assert.equal(await page.locator('.profile-video-checkbox').nth(1).isChecked(),false);
    await page.evaluate(async()=>{const scan=(await testStorage.get('profileScanState')).profileScanState;await testStorage.set({profileScanState:{...scan,videos:scan.videos.slice(0,125)}});});
    await page.locator('#btn-profile-select-all').click();
    assert.equal(await page.locator('.profile-video-checkbox').first().isChecked(),false);
    assert.match(await page.locator('[data-role="profile-selection-count"]').innerText(),/124 \/ 125 selected/);
    assert.equal(await page.locator('#injected').count(),0);
    await page.locator('.profile-thumb-img').first().waitFor();
    await page.waitForFunction(()=>document.querySelector('.profile-thumb-img')?.naturalWidth>0);
    await page.evaluate(()=>{window.originalImage=document.querySelector('.profile-thumb-img');});
    assert.equal(await page.locator('#profile-source-details').getAttribute('open'),null,'loaded libraries collapse source setup');
    await page.locator('#profile-source-summary').press('Enter');
    assert.match(await page.locator('.profile-source-content .profile-scan-status').innerText(),/4 pages scanned/);
    await page.locator('#profile-url-input').fill('https://example.test/model/new-creator');
    await page.evaluate(()=>testStorage.set({downloadQueueState:{tasks:[{id:'download-1',fileName:'Test download',status:'paused',progress:30}]}}));
    assert.equal(await page.evaluate(()=>window.originalImage===document.querySelector('.profile-thumb-img')),true);
    assert.equal(await page.locator('#profile-url-input').inputValue(),'https://example.test/model/new-creator');
    await page.locator('.profile-video-checkbox').nth(1).uncheck();
    assert.equal(await page.evaluate(()=>window.originalImage===document.querySelector('.profile-thumb-img')),true);
    assert.match(await page.locator('[data-role="profile-selection-count"]').innerText(),/123 \/ 125 selected/);
    await page.locator('#profile-grid-next').click();
    assert.match(await page.locator('.profile-grid-pagination').innerText(),/61–120 of 125/);
    assert.equal(await page.locator('#profile-url-input').inputValue(),'https://example.test/model/new-creator');
    const parsed=await page.evaluate(async()=>{
      const {parseProfileDocument,crawlProfile}=await import('/assets/js/profile-scanner.js');
      const {getVideoMetadata}=await import('/assets/js/video-details.js');
      const fixture=`<h1 class="profileUserName">Alex &amp; Team</h1><li class="videoBox"><a href="/view_video.php?viewkey=one"><img data-src="//cdn.test/thumb.jpg" src="/blank.gif" alt="Title &quot;one&quot;"></a><span class="title"><a href="/view_video.php?viewkey=one">Title one</a></span></li><li class="videoBox"><a href="/view_video.php?viewkey=two"><img src="../two.jpg" alt="Second"></a></li><div class="pagination"><a href="?page=2">2</a><a href="/model/alex/videos?page=3" rel="next">Next</a><a href="/model/other/videos?page=2">2</a></div>`;
      const doc=new DOMParser().parseFromString(fixture,'text/html');
      const result=parseProfileDocument(doc,'https://example.test/model/alex/videos');
      const numeric=await crawlProfile('https://example.test/model/123?page=4',{fetchPage:async()=>'',parsePage:async(_,url)=>({profileUrl:url,videos:[],nextPages:[]})});
      const metadata=getVideoMetadata(new DOMParser().parseFromString('<video poster="/poster.jpg"></video><meta property="og:image" content="//cdn.test/og.jpg"><script type="application/ld+json">{"@type":"VideoObject","thumbnailUrl":"../structured.jpg"}</script>','text/html'),'https://example.test/watch/video');
      return {result,numeric,metadata};
    });
    assert.equal(parsed.result.videos.length,2);
    assert.equal(parsed.result.videos[0].thumbnail,'https://cdn.test/thumb.jpg');
    assert.equal(parsed.result.videos[1].thumbnail,'https://example.test/model/two.jpg');
    assert.equal(parsed.result.nextPages.length,2);
    assert.equal(parsed.numeric.profileUrl,'https://example.test/model/123');
    assert.equal(parsed.metadata.thumbnail,'https://example.test/poster.jpg');assert.equal(parsed.metadata.thumbnails.length,3);
    fs.mkdirSync(path.join(root,'test-results'),{recursive:true});
    await page.screenshot({path:path.join(root,'test-results/profile-popup.png'),fullPage:true});
    await page.locator('[data-tab="history"]').click();
    assert.equal(await page.locator('.history-record').count(),2);
    assert.match(await page.locator('.history-record-meta').first().innerText(),/720p/);
    await page.screenshot({path:path.join(root,'test-results/history-popup.png'),fullPage:true});
    await page.locator('#history-search').fill('Current downloaded');
    assert.equal(await page.locator('.history-record').count(),1);
    await page.locator('[data-history-action="show"]').click();
    await page.locator('[data-history-action="source"]').click();
    assert.equal(await page.evaluate(()=>sentMessages.find(message=>message.type==='open-download-item')?.downloadId),77);
    assert.equal(await page.evaluate(()=>sentMessages.some(message=>message.type==='open-video-page')),true);
    await page.locator('[data-tab="settings"]').click();
    await page.locator('#toggle-thumbnails').click();
    await page.waitForFunction(()=>document.querySelector('#toggle-thumbnails')?.getAttribute('aria-checked')==='false');
    assert.equal(await page.evaluate(async()=>(await testStorage.get('download-settings'))['download-settings'].showThumbnails),false);
    await page.locator('[data-tab="video"]').click();await page.locator('[data-download-view="detected"]').click();assert.equal(await page.locator('.current-thumbnail-img').count(),0);
    await page.locator('[data-tab="profile"]').click();assert.equal(await page.locator('.profile-thumb-img').count(),0);
    await page.locator('[data-tab="history"]').click();assert.equal(await page.locator('.history-thumbnail-img').count(),0);
    await page.locator('[data-tab="settings"]').click();await page.locator('#toggle-thumbnails').click();
    await page.waitForFunction(()=>document.querySelector('#toggle-thumbnails')?.getAttribute('aria-checked')==='true');
    await page.locator('[data-tab="video"]').click();await page.waitForFunction(()=>document.querySelector('.current-thumbnail-img')?.naturalWidth>0);
    await page.screenshot({path:path.join(root,'test-results/single-video-popup.png'),fullPage:true});
    await page.evaluate(()=>testStorage.set({profileBatchState:{id:'test-batch',profileKey:'example.test/model/creator',status:'running',enqueued:2,failed:0,processed:2,total:3,currentTitle:'Pending'},downloadQueueState:{tasks:[{id:'unrelated',status:'queued',fileName:'Single video'},{id:'batch-active',status:'downloading',fileName:'Batch one',batchId:'test-batch',batchProfileKey:'example.test/model/creator'},{id:'batch-queued',status:'queued',fileName:'Batch two',batchId:'test-batch',batchProfileKey:'example.test/model/creator'}]}}));
    await page.locator('[data-tab="profile"]').click();
    assert.match(await page.locator('#btn-cancel-profile-batch').innerText(),/\(2\)/);
    await page.locator('#btn-cancel-profile-batch').click();
    await page.waitForFunction(()=>document.querySelector('[data-role="batch-progress"]')?.textContent.includes('Batch cancelled'));
    assert.equal(await page.evaluate(()=>sentMessages.some(message=>message.type==='profile-batch-cancel' && message.batchId==='test-batch')),true);
    assert.equal(await page.evaluate(async()=>(await testStorage.get('downloadQueueState')).downloadQueueState.tasks.length),1);
    await page.locator('[data-tab="history"]').click();
    await page.locator('[data-action="delete-history"]').click();
    await page.waitForFunction(()=>document.querySelectorAll('.history-record').length===0);
    await page.locator('[data-tab="video"]').click();
    assert.equal(await page.locator('.video-detected-box .already-downloaded:visible').count(),0);
    await page.locator('[data-tab="history"]').click();
    await page.locator('#btn-clear-history').click();
    await page.waitForFunction(()=>document.querySelector('[data-role="history-count"]')?.textContent==='0');
    await page.locator('[data-tab="video"]').click();
    await page.locator('#download-output-format').selectOption('source');
    await page.waitForFunction(()=>document.querySelector('.btn-download-action')?.textContent.trim()==='Download');
    await page.locator('.btn-download-action').first().click();
    assert.equal(await page.evaluate(()=>sentMessages.find(message=>message.type==='download-queue-enqueue')?.outputFormat),'source');
    await page.locator('[data-tab="profile"]').click();
    assert.equal(await page.locator('#profile-output-format').inputValue(),'source','format choice must follow navigation');
    await page.locator('#profile-output-format').selectOption('mp4');
    await page.waitForFunction(()=>document.querySelector('#profile-output-format')?.value==='mp4');
    await page.locator('[data-tab="video"]').click();
    assert.equal(await page.locator('#download-output-format').inputValue(),'mp4');
    await page.locator('.btn-download-action').first().click();
    assert.equal(await page.evaluate(()=>sentMessages.filter(message=>message.type==='download-queue-enqueue').at(-1)?.outputFormat),'mp4');
    assert.deepEqual(await page.evaluate(()=>sentMessages.find(message=>message.type==='download-queue-enqueue')?.headers),{Origin:'https://javplayer.cc',Referer:'https://javplayer.cc/'});
    const generic=await page.evaluate(async()=>{
      const {detectDocumentMedia}=await import('/assets/js/media-detection.js');
      const doc=new DOMParser().parseFromString('<title>Example</title><video src="blob:example"></video><source src="/video.webm" type="video/webm"><script type="application/ld+json">{"@type":"VideoObject","contentUrl":"https://cdn.test/file.mp4"}</script>','text/html');
      return detectDocumentMedia(doc,'https://site.test/watch',{getEntriesByType:()=>[{name:'https://cdn.test/720p/list.m3u8?token=fresh'},{name:'https://cdn.test/segment.ts'}]});
    });
    assert.deepEqual(generic.videoInfos.map(video=>video.format),['webm','mp4','m3u8']);
    await page.setViewportSize({width:800,height:650});
    const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));
    await page.goto(origin+'/'+manifest.action.default_popup);
    await page.waitForSelector('#btn-resize-popup');
    assert.equal(await page.evaluate(()=>document.documentElement.dataset.surface),'popup');
    assert.equal(await page.evaluate(()=>document.documentElement.style.width),'720px');
    assert.equal(await page.evaluate(()=>document.documentElement.style.height),'600px');
    assert.equal(await page.evaluate(()=>sentMessages.find(message=>message.type==='mediaflow-source-tab')?.windowId),77);
    const handle=page.locator('#btn-resize-popup');
    await handle.press('ArrowLeft');await handle.press('ArrowUp');
    assert.equal(await page.evaluate(()=>document.documentElement.style.width),'700px');
    assert.equal(await page.evaluate(()=>document.documentElement.style.height),'580px');
    await handle.press('Home');
    const grip=await handle.boundingBox();await page.mouse.move(grip.x+10,grip.y+10);await page.mouse.down();await page.mouse.move(grip.x+40,grip.y+10);await page.mouse.up();
    await page.waitForFunction(()=>JSON.parse(localStorage.getItem('testPopupSize')).width===750);
    await page.reload();await page.waitForSelector('#btn-resize-popup');
    assert.equal(await page.evaluate(()=>document.documentElement.style.width),'750px');
    assert.deepEqual(await page.evaluate(()=>browserWindowMutations),[],'opening/resizing the popup must not create or resize any browser window');
    await page.locator('#btn-open-browser-tab').click();
    assert.equal(await page.evaluate(()=>createdBrowserTabs[0].url),origin+'/src/pages/popup/index.html?surface=tab');
    await page.locator('#btn-resize-popup').press('Home');
    await page.setViewportSize({width:720,height:600});
    await page.locator('[data-tab="profile"]').click();
    assert.equal(await page.evaluate(()=>getComputedStyle(document.querySelector('.profile-video-grid')).gridTemplateColumns.split(' ').length),2);
    await page.evaluate(()=>document.fonts.ready);
    const density=await page.evaluate(()=>{
      const grid=document.querySelector('.profile-video-grid'),bounds=grid.getBoundingClientRect();
      return {height:bounds.height,visible:[...grid.children].filter(card=>{const box=card.getBoundingClientRect();return box.top>=bounds.top && box.bottom<=bounds.bottom;}).length};
    });
    assert.ok(density.height>=350,JSON.stringify(density));
    assert.ok(density.visible>=10,'the attached popup must show at least ten full cards: '+JSON.stringify(density));
    await page.screenshot({path:path.join(root,'test-results/attached-toolbar-popup.png'),fullPage:true});
    await page.locator('#profile-filter-input').fill('Test video 12');
    assert.equal(await page.locator('.profile-video-card').count(),6,'search includes matches across all loaded pages');
    assert.match(await page.locator('.profile-selection-summary').innerText(),/118 selected outside this search/);
    assert.match(await page.locator('[data-role="profile-selection-count"]').innerText(),/124 \/ 125 selected/,'search preserves library selection');
    assert.equal(await page.locator('#profile-filter-input').evaluate(node=>document.activeElement===node),true,'search preserves typing focus');
    await page.locator('#btn-profile-clear-selection').click();
    assert.doesNotMatch(await page.locator('[data-role="profile-selection-note"]').innerText(),/outside this search/,'clearing selection updates the search warning');
    await page.locator('#btn-profile-select-all').click();
    assert.match(await page.locator('[data-role="profile-selection-note"]').innerText(),/118 selected outside this search/);
    await page.locator('#profile-filter-input').fill('No matching title exists');
    assert.equal(await page.locator('.profile-video-card').count(),0);
    assert.equal(await page.locator('.profile-filter-empty').isVisible(),true);
    assert.equal(await page.locator('#btn-batch-download').isVisible(),true);
    await page.locator('#profile-filter-input').fill('');
    assert.equal(await page.locator('.profile-video-card').count(),60);
    await page.locator('[data-tab="video"]').click();
    assert.equal(await page.locator('.video-detected-box').count(),1);
    assert.equal(await page.locator('.queue-section').count(),0);
    await page.locator('[data-download-view="queue"]').click();
    assert.equal(await page.locator('.video-detected-box').count(),0);
    assert.equal(await page.locator('.queue-section').count(),1);
    await page.screenshot({path:path.join(root,'test-results/downloads-workspace.png'),fullPage:true});
    await page.locator('[data-tab="history"]').click();
    await page.locator('.history-file-details summary').first().click();
    assert.equal(await page.locator('.history-file-details p').first().isVisible(),true);
    await page.screenshot({path:path.join(root,'test-results/history-workspace.png'),fullPage:true});
    await page.locator('[data-tab="settings"]').click();
    assert.equal(await page.locator('.settings-section').count(),3);
    await page.locator('#toggle-channel-folder').press('Space');
    await page.waitForFunction(()=>document.querySelector('#toggle-channel-folder').getAttribute('aria-checked')==='false');
    await page.locator('#toggle-channel-folder').press('Space');
    await page.waitForFunction(()=>document.querySelector('#toggle-channel-folder').getAttribute('aria-checked')==='true');
    await page.screenshot({path:path.join(root,'test-results/settings-workspace.png'),fullPage:true});
    await page.locator('[data-tab="profile"]').click();
    await page.locator('.profile-video-checkbox').nth(20).focus();
    const scrolled=await page.evaluate(()=>document.querySelector('.profile-video-grid').scrollTop);
    assert.ok(scrolled>0);
    await page.evaluate(()=>testStorage.set({profileBatchState:{id:'progress-test',profileKey:'example.test/model/creator',status:'complete',processed:10,total:10,enqueued:10,failed:0}}));
    assert.equal(await page.evaluate(()=>document.activeElement?.dataset.videoId),'video-20','batch updates preserve checkbox focus');
    assert.equal(await page.evaluate(()=>document.querySelector('.profile-video-grid').scrollTop),scrolled,'batch updates preserve list scroll');
    assert.equal(await page.locator('#btn-batch-download').isVisible(),true,'download action remains visible while the list scrolls');
    await page.locator('[data-tab="settings"]').click();await page.locator('[data-tab="profile"]').click();
    assert.equal(await page.evaluate(()=>document.querySelector('.profile-video-grid').scrollTop),scrolled,'tab switching preserves library position');
    await page.evaluate(()=>{document.querySelector('.profile-video-grid').scrollTop=0;});
    await page.screenshot({path:path.join(root,'test-results/profile-with-batch-summary.png'),fullPage:true});
    console.log('Attached popup profile density:',density);
    for(let i=0;i<12;i++)await page.locator('#btn-resize-popup').press('ArrowLeft');
    await page.setViewportSize({width:480,height:600});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.screenshot({path:path.join(root,'test-results/profile-narrow.png'),fullPage:true});
    for(let i=0;i<12;i++)await page.locator('#btn-resize-popup').press('ArrowUp');
    await page.setViewportSize({width:480,height:360});
    const footer=await page.locator('.profile-download-bar').boundingBox();
    assert.ok(footer.y+footer.height<=360,'batch actions must fit at the minimum popup size');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.screenshot({path:path.join(root,'test-results/profile-minimum.png'),fullPage:true});
    await page.locator('#profile-source-summary').click();
    assert.equal(await page.locator('#profile-url-input').isVisible(),true);
    const expandedFooter=await page.locator('.profile-download-bar').boundingBox();
    assert.ok(expandedFooter.y+expandedFooter.height<=360,'expanded source controls must leave batch actions accessible');
    await page.evaluate(()=>testStorage.set({downloadQueueState:{tasks:[{id:'active-narrow',status:'downloading',batchId:'progress-test',batchProfileKey:'example.test/model/creator'}]}}));
    assert.equal(await page.locator('#btn-cancel-profile-batch').isVisible(),true);
    const narrowAction=await page.locator('#btn-batch-download').boundingBox();
    assert.ok(narrowAction.x+narrowAction.width<=480-22,'batch cancellation and download actions must fit beside the resize grip');
    assert.deepEqual(await page.evaluate(()=>browserWindowMutations),[]);
    await page.locator('#profile-output-format').selectOption('source');
    await page.waitForFunction(()=>document.querySelector('#profile-output-format')?.value==='source');
    await page.locator('#btn-batch-download').click();
    assert.equal(await page.evaluate(()=>sentMessages.filter(message=>message.type==='profile-batch-start').at(-1)?.outputFormat),'source','batch requests must capture the chosen format');
    await page.goto(origin+'/generic-test');
    await page.waitForFunction(()=>sentMessages.some(message=>message.type==='media-detection-report' && message.videoInfos.some(video=>video.format==='webm')));
    const frame=page.frames().find(frame=>frame.url().endsWith('/generic-frame'));assert.ok(frame);
    await frame.waitForFunction(()=>sentMessages.some(message=>message.type==='media-detection-report' && message.videoInfos.some(video=>video.format==='mp4')));
    const frameReport=await frame.evaluate(()=>sentMessages.find(message=>message.type==='media-detection-report' && message.videoInfos.length));
    assert.equal(frameReport.videoInfos[0].headers.Referer,origin+'/generic-frame');
    const topButton=page.locator('body > .mediaflow-download-pill .mediaflow-download');
    await topButton.click();
    assert.equal(await page.evaluate(()=>sentMessages.find(message=>message.type==='download-queue-enqueue')?.url),origin+'/generic-top.webm');
    await page.evaluate(()=>{
      const send=chrome.runtime.sendMessage;
      chrome.runtime.sendMessage=(message,...args)=>message.type==='ext-fetch-text' && message.url.endsWith('/generic-master.m3u8')
        ? Promise.resolve({ok:true,text:'#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=750000,RESOLUTION=854x480\ngeneric-480.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=2400000,RESOLUTION=1280x720\ngeneric-720.m3u8'})
        : send(message,...args);
    });
    const hlsButton=page.locator('#hls-player .mediaflow-download');
    await hlsButton.hover();await page.locator('#hls-player .mediaflow-download-quality').click();
    await page.getByRole('button',{name:'480p HLS',exact:true}).click();await hlsButton.click();
    const hlsDownload=await page.evaluate(()=>sentMessages.filter(message=>message.type==='download-queue-enqueue').at(-1));
    assert.equal(hlsDownload.url,origin+'/generic-480.m3u8');assert.equal(hlsDownload.quality,'480');
    await frame.locator('.mediaflow-download').click();
    const frameDownload=await frame.evaluate(()=>sentMessages.find(message=>message.type==='download-queue-enqueue'));
    assert.equal(frameDownload.url,origin+'/generic-frame.mp4');assert.equal(frameDownload.headers.Referer,origin+'/generic-frame');
    await page.goto(origin+'/generic-blob');
    await page.locator('.mediaflow-download').click();
    await page.waitForFunction(()=>sentMessages.some(message=>message.type==='download-queue-enqueue'));
    const blobDownload=await page.evaluate(()=>sentMessages.find(message=>message.type==='download-queue-enqueue'));
    assert.equal(blobDownload.url,origin+'/generic-full.mp4');assert.equal(blobDownload.quality,'720');
    await page.goto(origin+'/mgp-toolbar-test');
    const floating=page.locator('.mgp_player > .mediaflow-download-pill[data-player-fallback]');
    await floating.getByText('Download',{exact:true}).waitFor();
    await floating.locator('.mediaflow-download').hover();
    await floating.locator('.mediaflow-download-quality').click();
    const choices=page.getByRole('group',{name:'Available video qualities'});
    await choices.getByRole('button',{name:'480p MP4'}).waitFor();
    assert.deepEqual((await choices.getByRole('button').allTextContents()).map(text=>text.trim()),['720p MP4','480p MP4']);
    await page.evaluate(()=>document.querySelector('.mgp_player').append(document.querySelector('#toolbar-template').content.cloneNode(true)));
    await choices.getByRole('button',{name:'480p MP4'}).click();
    await page.mouse.click(18,18);
    const docked=page.locator('.mgp_controlsBar > .mediaflow-download-pill');
    const autoplay=page.locator('#autoplay-toggle');
    await docked.waitFor();
    assert.equal(await autoplay.evaluate(node=>node.previousElementSibling.matches('.mediaflow-download-pill[data-toolbar]')),true);
    await docked.locator('.mediaflow-download').hover();
    const [dockRect,autoRect]=await Promise.all([docked.boundingBox(),autoplay.boundingBox()]);
    assert.ok(dockRect.x+dockRect.width<=autoRect.x && Math.abs(dockRect.y-autoRect.y)<2,'the expanded control sits beside Autoplay');
    await autoplay.click();
    assert.equal(await autoplay.getAttribute('aria-pressed'),'false','the site toggle remains clickable');
    await docked.locator('.mediaflow-download').hover();
    await docked.locator('.mediaflow-download-quality').click();
    await choices.getByRole('button',{name:'480p MP4',pressed:true}).waitFor();
    await page.evaluate(()=>document.querySelector('.mgp_controlsBar').classList.add('controls-hidden'));
    await floating.getByText('Download',{exact:true}).waitFor();
    assert.equal(await docked.count(),0,'the extension button must remain visible when the native controls fade out');
    await choices.getByRole('button',{name:'480p MP4',pressed:true}).waitFor();
    await page.keyboard.press('Escape');
    await page.mouse.click(18,18);
    await page.evaluate(()=>document.querySelector('.mgp_controlsBar').classList.remove('controls-hidden'));
    await docked.waitFor();
    await page.evaluate(()=>{
      const toolbar=document.querySelector('.mgp_controlsBar'),replacement=toolbar.cloneNode(true);
      replacement.querySelector('#autoplay-toggle').removeAttribute('aria-label');
      replacement.querySelector('#autoplay-toggle').id='auto';
      toolbar.replaceWith(replacement);
    });
    await page.waitForFunction(()=>document.querySelector('.mgp_nextBtn').previousElementSibling.matches('.mediaflow-download-pill[data-toolbar]') && document.querySelectorAll('.mediaflow-download-pill').length===1);
    await docked.locator('.mediaflow-download').click();
    await page.waitForFunction(()=>sentMessages.some(message=>message.type==='download-queue-enqueue'));
    const toolbarDownload=await page.evaluate(()=>sentMessages.find(message=>message.type==='download-queue-enqueue'));
    assert.equal(toolbarDownload.url,origin+'/toolbar-480p.mp4');assert.equal(toolbarDownload.quality,'480');
    assert.deepEqual(errors,[]);
    console.log('PASS: attached toolbar popup, cursor/keyboard resize and saved size, browser-tab full view, no browser-window mutation; quality/history/settings/profile controls; player headers; generic top-level/frame detection.');
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>server.close());
