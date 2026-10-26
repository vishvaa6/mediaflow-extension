const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const runtime=process.env.CODEX_NODE_MODULES || 'C:/Users/vishv/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const {chromium}=require(path.join(runtime,'playwright'));
const root=path.resolve(__dirname,'..');
const card=i=>`<li class="videoBox" data-video-id="${i}"><a class="title" href="/view_video.php?viewkey=${i}"><div class="poster">Video ${i}</div><span>Video ${i}</span></a></li>`;
const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost');
  res.setHeader('Cache-Control','no-store');
  if(url.pathname==='/background-test'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Coordinator test</title>');return;}
  if(url.pathname==='/model/creator/videos'){
    const page=Number(url.searchParams.get('page')||1);
    res.setHeader('Content-Type','text/html');
    res.end(`<!doctype html><meta charset="utf-8"><title>Creator videos</title><style>body{font:16px system-ui;background:#101827;color:#eef2ff;margin:32px}ul{display:grid;grid-template-columns:repeat(3,1fr);gap:22px;list-style:none;padding:0}li{border:1px solid #52617a;border-radius:10px;overflow:hidden}a{color:inherit;text-decoration:none}a span{display:block;padding:12px}.poster{background:linear-gradient(140deg,#3730a3,#0e7490);height:155px;display:grid;place-items:center;font-size:24px}.pagination{display:flex;gap:22px}</style><h1 class="profileUserName">Test Creator</h1><p>Creator listing · page ${page}</p><ul class="videoUList">${Array.from({length:6},(_,i)=>card((page-1)*6+i)).join('')}</ul><nav class="pagination">${[1,2,3].map(i=>`<a href="?page=${i}">${i}</a>`).join('')}</nav><script type="module">import {installProfilePageSelector} from '/assets/js/profile-page-selector.js';installProfilePageSelector();</script>`);return;
  }
  if(url.pathname==='/view_video.php'){res.setHeader('Content-Type','text/html');res.end('var flashvars_123 = '+JSON.stringify({video_title:'Video '+url.searchParams.get('viewkey'),mediaDefinitions:[{format:'hls',quality:720,videoUrl:'/playlist.m3u8'}]})+';');return;}
  if(url.pathname==='/playlist.m3u8'){res.end('#EXTM3U\n#EXTINF:1,\nsegment.ts\n#EXT-X-ENDLIST');return;}
  const file=path.resolve(root,'.'+decodeURIComponent(url.pathname));
  if(!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}
  try{res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.png')?'image/png':'text/html');res.end(fs.readFileSync(file));}catch{res.writeHead(404);res.end();}
});
let browser;
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${server.address().port}`;
  browser=await chromium.launch({executablePath:process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  const context=await browser.newContext({viewport:{width:1100,height:850}});
  let background;
  await context.exposeBinding('sendToCoordinator',async(source,message)=>background.evaluate(message=>window.dispatchCommand(message),message));
  await context.addInitScript(({origin})=>{
    const changed=[],localChanged=[],runtimeListeners=[];
    const event=()=>({addListener(){},removeListener(){}});
    const values=()=>JSON.parse(localStorage.getItem('mediaflow-test-storage')||'{}');
    window.readTestValues=values;
    function notify(changes){for(const listener of localChanged)listener(changes);for(const listener of changed)listener(changes,'local');}
    const local={onChanged:{addListener:fn=>localChanged.push(fn)},async get(keys){const all=values();return Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(key=>[key,all[key]]).filter(([,value])=>value!==undefined));},async set(patch){const all=values(),changes={};for(const [key,value]of Object.entries(patch)){changes[key]={oldValue:all[key],newValue:structuredClone(value)};all[key]=value;}localStorage.setItem('mediaflow-test-storage',JSON.stringify(all));notify(changes);}};
    window.addEventListener('storage',event=>{
      if(event.key!=='mediaflow-test-storage')return;
      const previous=JSON.parse(event.oldValue||'{}'),next=JSON.parse(event.newValue||'{}'),changes={};
      for(const key of new Set([...Object.keys(previous),...Object.keys(next)]))if(JSON.stringify(previous[key])!==JSON.stringify(next[key]))changes[key]={oldValue:previous[key],newValue:next[key]};
      notify(changes);
    });
    window.testStorage=local;
    window.dispatchCommand=message=>new Promise(resolve=>{for(const listener of runtimeListeners)if(listener(message,{id:'range-test'},resolve))return;resolve({success:false,error:'Unknown command'});});
    const sendMessage=async(message,callback)=>{
      let result;
      if(message.type==='profile-parse-html'){
        const {parseProfileDocument}=await import('/assets/js/profile-scanner.js');
        result={ok:true,result:parseProfileDocument(new DOMParser().parseFromString(message.html,'text/html'),message.pageUrl)};
      }else if(['profile-scan-keepalive','download-task-error','download-task-complete','revoke-blob-url'].includes(message.type))result={ok:true};
      else result=await window.sendToCoordinator(message);
      callback?.(result);return result;
    };
    window.chrome={i18n:{getMessage:()=>''},runtime:{id:'range-test',sendMessage,onMessage:{addListener:fn=>runtimeListeners.push(fn)}},storage:{local,onChanged:{addListener:fn=>changed.push(fn)}},
      offscreen:{hasDocument:async()=>true},declarativeNetRequest:{updateSessionRules:async()=>{}},downloads:{onChanged:event(),search:async()=>[],cancel:async()=>{}},
      tabs:{query:(query,cb)=>cb([{id:1,url:origin+'/model/creator/videos',title:'Creator'}]),sendMessage:(id,message,cb)=>cb({videoInfos:[]})}};
  },{origin});
  background=await context.newPage();await background.goto(origin+'/background-test');
  await background.evaluate(async({origin})=>{
    await testStorage.set({'download-settings':{maxConcurrentTasks:1},m3u8DownloadHistory:{records:[{id:'downloaded',pageUrl:origin+'/view_video.php?viewkey=4'}]}});
    const {installQueueManager}=await import('/assets/js/queue-manager.js');
    const {queueStorage,historyStorage,settingsStorage}=await import('/assets/js/storage.js');
    class PendingHls{constructor(callbacks){this.callbacks=callbacks;}start(){}getBytesReceived(){return 0;}async destroy(){}async pauseSoft(){}}
    window.manager=installQueueManager({queueStorage,historyStorage,settingsStorage,HlsDownloader:PendingHls,registerBlob(){},bindBlob(){},clearBlob(){},formatFilename:value=>value,withSubdir:value=>value});
    await manager.ready;
  },{origin});
  const page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(origin+'/model/creator/videos');
  const toolbar=page.locator('#mediaflow-profile-picker');
  await toolbar.locator('#range').click();
  await page.waitForFunction(()=>document.querySelector('#mediaflow-profile-picker').shadowRoot.querySelector('#range').getAttribute('aria-pressed')==='true' && !document.querySelector('.mediaflow-pick-tick').disabled);
  await page.locator('[data-video-id="2"] .poster').click();
  await page.waitForFunction(()=>document.querySelector('#mediaflow-profile-picker').shadowRoot.querySelector('#hint').textContent.includes('last video'));
  assert.match(await toolbar.locator('#hint').innerText(),/last video/);
  assert.equal(await toolbar.locator('#download').isDisabled(),true);
  assert.equal(new URL(page.url()).pathname,'/model/creator/videos','range clicks must not open video pages');
  await page.locator('.pagination a').nth(2).click();
  await page.waitForSelector('.mediaflow-pick-tick');
  await page.locator('[data-video-id="14"] .poster').click();
  await page.waitForFunction(()=>!!readTestValues().profileSelectionState?.end);
  await page.waitForFunction(()=>!document.querySelector('#mediaflow-profile-picker').shadowRoot.querySelector('#download').disabled);
  assert.equal(await background.evaluate(()=>readTestValues().profileScanState.pagesScanned),3);
  assert.match(await toolbar.locator('#hint').innerText(),/Range 3–15 · 12 new videos/);
  assert.equal(await page.locator('.mediaflow-pick-tick[aria-checked="true"]').count(),3);
  assert.match(await page.locator('[data-video-id="14"] .mediaflow-pick-tick').innerText(),/End/);
  await page.reload();await page.waitForSelector('.mediaflow-pick-tick');
  assert.equal(await page.locator('.mediaflow-pick-tick[aria-checked="true"]').count(),3,'ticks persist after navigation/reload');
  await page.evaluate(html=>document.querySelector('.videoUList').insertAdjacentHTML('beforeend',html),card(6));
  await page.waitForSelector('[data-video-id="6"] .mediaflow-pick-tick[aria-checked="true"]');
  await page.locator('.pagination a').nth(0).click();await page.waitForSelector('.mediaflow-pick-tick');
  assert.equal(await page.locator('.mediaflow-pick-tick[aria-checked="true"]').count(),3);
  assert.match(await page.locator('[data-video-id="2"] .mediaflow-pick-tick').innerText(),/Start/);
  assert.match(await page.locator('[data-video-id="4"] .mediaflow-pick-tick').innerText(),/Downloaded/);
  assert.equal(await page.locator('[data-video-id="4"] .mediaflow-pick-tick').getAttribute('aria-checked'),'false');
  const popup=await context.newPage();popup.on('pageerror',error=>errors.push(error.message));
  await popup.goto(origin+'/src/pages/popup/index.html');await popup.locator('[data-tab="profile"]').click();
  assert.equal(await popup.locator('.profile-selection-tick:visible').count(),12);
  assert.match(await popup.locator('[data-role="profile-range-hint"]').innerText(),/Range 3–15/);
  // Individual adjustments in the popup update the real webpage selection.
  await popup.locator('.profile-video-card[data-video-id="3"] input').uncheck();
  await page.waitForSelector('[data-video-id="3"] .mediaflow-pick-tick[aria-checked="false"]');
  assert.match(await popup.locator('#btn-batch-download').innerText(),/11/);
  // Re-pick a cross-page range in the popup and verify labels/ticks on the page.
  await popup.locator('#btn-profile-range').click();
  await popup.locator('.profile-video-card[data-video-id="2"] input').click();
  await popup.locator('.profile-video-card[data-video-id="14"] input').click();
  await page.waitForSelector('[data-video-id="3"] .mediaflow-pick-tick[aria-checked="true"]');
  await popup.setViewportSize({width:480,height:760});
  await popup.evaluate(()=>{document.querySelector('.popup-scroll').scrollTop=0;});
  assert.equal(await popup.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'range controls must fit the extension popup');
  fs.mkdirSync(path.join(root,'test-results'),{recursive:true});
  await page.screenshot({path:path.join(root,'test-results/webpage-range-selection.png'),fullPage:true});
  await popup.screenshot({path:path.join(root,'test-results/popup-range-selection.png'),fullPage:true});
  await page.locator('#mediaflow-profile-picker').locator('#download').click();
  await background.waitForFunction(()=>readTestValues().profileBatchState?.status==='complete');
  const queue=await background.evaluate(async()=>(await testStorage.get('downloadQueueState')).downloadQueueState.tasks);
  const batch=await background.evaluate(async()=>(await testStorage.get('profileBatchState')).profileBatchState);
  assert.equal(batch.failed,0,JSON.stringify(batch.errors));
  assert.equal(batch.enqueued,12,JSON.stringify({batch,queue,selection:await background.evaluate(async()=>(await testStorage.get('profileSelectionState')).profileSelectionState)}));
  assert.deepEqual(queue.map(task=>new URL(task.pageUrl).searchParams.get('viewkey')),Array.from({length:13},(_,i)=>i+2).filter(i=>i!==4).map(String));
  await popup.locator('#btn-clear-profile-results').click();
  await popup.waitForFunction(()=>document.querySelectorAll('.profile-video-card').length===0);
  assert.equal(await background.evaluate(()=>readTestValues().profileScanState.status),'cleared');
  assert.equal(await background.evaluate(()=>readTestValues().downloadQueueState.tasks.length),12,'clearing results must preserve active and queued downloads');
  assert.equal(await background.evaluate(()=>readTestValues().m3u8DownloadHistory.records.length),1);
  assert.equal(await popup.locator('#btn-cancel-profile-batch').isVisible(),true,'active batch controls remain available after clearing results');
  await popup.reload();await popup.locator('[data-tab="profile"]').click();
  assert.equal(await popup.locator('.profile-video-card').count(),0);
  assert.equal(await popup.locator('#btn-clear-profile-results').isDisabled(),true);
  assert.equal(await background.evaluate(()=>readTestValues().profileScanState.status),'cleared','reopening must not automatically refetch cleared results');
  await page.waitForFunction(()=>!document.querySelector('#mediaflow-profile-picker').shadowRoot.querySelector('#cancel').hidden);
  await page.locator('#mediaflow-profile-picker').locator('#cancel').click();
  await background.waitForFunction(()=>!readTestValues().downloadQueueState?.tasks.length);
  assert.deepEqual(errors,[]);
  console.log('PASS: cross-page ranges and selected-only batches; Clear results persists across popup reopening and preserves downloads, history and batch controls.');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{await browser?.close();await new Promise(resolve=>server.close(resolve));});
