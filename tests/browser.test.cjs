const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const runtime = process.env.CODEX_NODE_MODULES || 'C:/Users/vishv/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const {chromium} = require(path.join(runtime,'playwright'));
const root = path.resolve(__dirname,'..');
const server = http.createServer((req,res) => {
  const requested = new URL(req.url,'http://localhost').pathname;
  if(requested==='/generic-test' || requested==='/generic-frame'){
    res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Generic video</title><video preload="none" src="/generic-'+(requested==='/generic-frame'?'frame.mp4':'top.webm')+'"></video>'+(requested==='/generic-test'?'<iframe src="/generic-frame"></iframe>':'')+'<script type="module">import {installMediaDetection} from "/assets/js/media-detection.js";installMediaDetection();</script>');return;
  }
  if (requested === '/thumb.png') { res.setHeader('Content-Type','image/png');res.end(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aU1cAAAAASUVORK5CYII=','base64')); return; }
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
    },{origin});
    await page.goto(origin+'/src/pages/popup/index.html');
    await page.waitForSelector('.task-speed-badge');
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
    assert.match(await page.locator('.task-speed-badge').innerText(),/2.0 MB\/s/);
    await page.evaluate(()=>testStorage.set({downloadQueueState:{tasks:[{id:'download-1',fileName:'Test download',status:'downloading',progress:30,downloadSpeed:4096}]}}));
    await page.waitForFunction(()=>document.querySelector('.task-speed-badge')?.textContent.includes('4.0 KB/s'));
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
    assert.match(await page.locator('.profile-scan-status').innerText(),/4 pages scanned/);
    assert.equal(await page.locator('#injected').count(),0);
    await page.locator('.profile-thumb-img').first().waitFor();
    await page.waitForFunction(()=>document.querySelector('.profile-thumb-img')?.naturalWidth>0);
    await page.evaluate(()=>{window.originalImage=document.querySelector('.profile-thumb-img');});
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
    await page.locator('[data-tab="video"]').click();assert.equal(await page.locator('.current-thumbnail-img').count(),0);
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
    await page.locator('[data-tab="video"]').click();await page.locator('.btn-download-action').first().click();
    assert.deepEqual(await page.evaluate(()=>sentMessages.find(message=>message.type==='download-queue-enqueue')?.headers),{Origin:'https://javplayer.cc',Referer:'https://javplayer.cc/'});
    const generic=await page.evaluate(async()=>{
      const {detectDocumentMedia}=await import('/assets/js/media-detection.js');
      const doc=new DOMParser().parseFromString('<title>Example</title><video src="blob:example"></video><source src="/video.webm" type="video/webm"><script type="application/ld+json">{"@type":"VideoObject","contentUrl":"https://cdn.test/file.mp4"}</script>','text/html');
      return detectDocumentMedia(doc,'https://site.test/watch',{getEntriesByType:()=>[{name:'https://cdn.test/720p/list.m3u8?token=fresh'},{name:'https://cdn.test/segment.ts'}]});
    });
    assert.deepEqual(generic.videoInfos.map(video=>video.format),['webm','mp4','m3u8']);
    await page.goto(origin+'/generic-test');
    await page.waitForFunction(()=>sentMessages.some(message=>message.type==='media-detection-report' && message.videoInfos.some(video=>video.format==='webm')));
    const frame=page.frames().find(frame=>frame.url().endsWith('/generic-frame'));assert.ok(frame);
    await frame.waitForFunction(()=>sentMessages.some(message=>message.type==='media-detection-report' && message.videoInfos.some(video=>video.format==='mp4')));
    const frameReport=await frame.evaluate(()=>sentMessages.find(message=>message.type==='media-detection-report' && message.videoInfos.length));
    assert.equal(frameReport.videoInfos[0].headers.Referer,origin+'/generic-frame');
    assert.deepEqual(errors,[]);
    console.log('PASS: popup quality/history/settings/profile controls; player headers preserved on enqueue; generic HTML5/JSON-LD/resource detection; discovery in top-level pages and embedded frames.');
  } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>server.close());
