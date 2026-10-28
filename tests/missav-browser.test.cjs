const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {first,second,player,master}=require('./fixtures/missav.cjs');
const runtime=process.env.CODEX_NODE_MODULES || 'C:/Users/vishv/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const {chromium}=require(path.join(runtime,'playwright'));
const root=path.resolve(__dirname,'..'),catalogue='https://missav.ws/dm265/en';
const card=(id,style='')=>`<div class="thumbnail group" id="card-${id}" style="width:480px;height:280px;${style}"><div class="relative"><a href="/en/sample-${id}"><img data-src="https://images.test/${id}.jpg" alt="Sample ${id}" style="width:480px;height:240px"></a><video class="preview hidden" data-src="https://fourhoi.com/sample-${id}/preview.mp4"></video></div><a href="/en/sample-${id}">Sample ${id}</a></div>`;
(async()=>{
  const browser=await chromium.launch({executablePath:process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  try{
    const context=await browser.newContext({viewport:{width:600,height:500}}),errors=[],requests=[];
    context.on('page',page=>page.on('pageerror',error=>errors.push(error.message)));
    await context.route('**/*',async route=>{
      const url=new URL(route.request().url());requests.push(url.href);
      const headers={'access-control-allow-origin':'https://missav.ws','access-control-allow-credentials':'true'};
      if(url.hostname==='images.test')return route.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aU1cAAAAASUVORK5CYII=','base64')});
      if(url.href===catalogue)return route.fulfill({contentType:'text/html',body:`<!doctype html><title>MissAV catalogue</title><style>body{margin:0}.preview{display:none}</style>${card(101)}<div style="height:1000px"></div>${card(102)}${card(104,'display:none')}<div style="height:1000px"></div>`});
      if(url.pathname==='/en/sample-101')return route.fulfill({contentType:'text/html',body:player(first,'Sample 101')});
      if(url.pathname==='/en/sample-102')return route.fulfill({contentType:'text/html',body:player(second,'Sample 102')});
      if(url.pathname==='/en/sample-103')return route.fulfill({status:403,contentType:'text/html',body:'<title>Just a moment...</title><div class="cf-chl-container"></div>'});
      if(url.hostname==='surrit.com')return route.fulfill({headers,contentType:'application/vnd.apple.mpegurl',body:url.pathname.endsWith('/playlist.m3u8')?master:'#EXTM3U\n#EXTINF:1,\nsegment.ts\n#EXT-X-ENDLIST'});
      const file=path.resolve(root,'.'+url.pathname);if(!file.startsWith(root+path.sep))return route.abort();
      try{return route.fulfill({contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html',body:fs.readFileSync(file)});}catch{return route.fulfill({status:404,body:''});}
    });
    await context.addInitScript(()=>{
      window.messages=[];window.runtimeListeners=[];
      window.chrome={runtime:{id:'missav-test',onMessage:{addListener:fn=>runtimeListeners.push(fn)},sendMessage:async message=>{messages.push(message);return message.type==='ext-fetch-text'?{ok:false,error:'HTTP 403'}:{success:true};}}};
    });
    const page=await context.newPage();await page.goto(catalogue);
    await page.evaluate(async()=>{const {installMediaDetection}=await import('/assets/js/media-detection.js');installMediaDetection();});
    const waitVideo=id=>page.waitForFunction(value=>{
      const report=messages.filter(message=>message.type==='media-detection-report').at(-1);
      return report?.videoInfos.length===2 && report.videoInfos.every(video=>video.pageUrl.endsWith('/sample-'+value));
    },id);
    await waitVideo(101);
    assert.equal(requests.some(url=>url.includes('preview.mp4')),false,'a catalogue preview must never be fetched as the full video');
    assert.equal(requests.some(url=>url.endsWith('/en/sample-102')),false,'offscreen cards are not fetched');
    await page.evaluate(()=>scrollTo(0,600));
    await page.waitForFunction(()=>messages.filter(message=>message.type==='media-detection-report').at(-1)?.videoInfos.length===0);
    await page.evaluate(()=>scrollTo(0,1260));await waitVideo(102);
    const selected=await page.evaluate(()=>messages.filter(message=>message.type==='media-detection-report').at(-1));
    assert.equal(selected.site,'missav');assert.deepEqual(selected.videoInfos.map(video=>video.quality),[720,1080]);
    assert.ok(selected.videoInfos.every(video=>video.headers.Referer==='https://missav.ws/en/sample-102'));
    // Failed verification is reported once and does not produce a retry storm.
    await page.evaluate(()=>{const card=document.getElementById('card-102');for(const link of card.querySelectorAll('a'))link.href='/en/sample-103';});
    await page.waitForFunction(()=>messages.filter(message=>message.type==='media-detection-report').at(-1)?.detectionError.includes('verification'));
    const failedRequests=requests.filter(url=>url.endsWith('/en/sample-103')).length;
    await page.evaluate(async()=>{for(let i=0;i<4;i++)dispatchEvent(new Event('scroll'));await new Promise(resolve=>setTimeout(resolve,500));});
    assert.equal(requests.filter(url=>url.endsWith('/en/sample-103')).length,failedRequests);
    await page.evaluate(()=>{const card=document.getElementById('card-102');for(const link of card.querySelectorAll('a'))link.href='/en/sample-102';});
    await waitVideo(102);

    // The real popup must enqueue the chosen full HLS source, not the catalogue.
    const popup=await context.newPage();await popup.setViewportSize({width:480,height:740});
    await popup.addInitScript(snapshot=>{
      const values={downloadQueueState:{tasks:[]},m3u8DownloadHistory:{records:[]}};
      const local={onChanged:{addListener(){}},get:async keys=>Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(key=>[key,values[key]])),set:async patch=>Object.assign(values,patch)};
      window.enqueues=[];
      window.chrome={i18n:{getMessage:()=>''},storage:{local,onChanged:{addListener(){}}},runtime:{id:'missav-popup',onMessage:{addListener(){}},sendMessage(message,callback){
        if(message.type==='download-queue-enqueue')enqueues.push(message);
        const result=message.type==='media-detection-snapshot'?{site:'missav',pageUrl:snapshot.pageUrl,videoInfos:[]}:{success:true,state:{tasks:[]}};
        callback?.(result);return Promise.resolve(result);
      }},tabs:{query:(_,callback)=>callback([{id:1,url:snapshot.pageUrl,title:'MissAV catalogue'}]),sendMessage:(_,message,callback)=>callback(message.command==='get_generic_video_info'?snapshot:{})}};
    },selected);
    await popup.goto('https://missav.ws/src/pages/popup/index.html');
    await popup.waitForSelector('[data-video-page]');
    assert.deepEqual(await popup.locator('.quality-badge').allTextContents(),['720','1080']);
    await popup.locator('.btn-download-action').last().click();
    const queued=await popup.evaluate(()=>enqueues[0]);
    assert.equal(queued.url,`https://surrit.com/${second}/1080p/video.m3u8`);assert.equal(queued.pageUrl,'https://missav.ws/en/sample-102');assert.equal(queued.format,'m3u8');assert.equal(queued.title,'Sample 102');
    fs.mkdirSync(path.join(root,'test-results'),{recursive:true});await popup.screenshot({path:path.join(root,'test-results/missav-popup.png'),fullPage:true});
    await page.goto('https://missav.ws/en/sample-101');
    await page.evaluate(async()=>{const {installMediaDetection}=await import('/assets/js/media-detection.js');installMediaDetection();});
    await waitVideo(101);
    assert.deepEqual(errors,[]);
    console.log('PASS: MissAV catalogue viewport detection, full-video sources, scroll updates, packed player parsing, HLS qualities, verification handling and popup enqueue.');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
