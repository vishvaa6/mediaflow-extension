const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const runtime=process.env.CODEX_NODE_MODULES || 'C:/Users/vishv/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const {chromium}=require(path.join(runtime,'playwright'));
const root=path.resolve(__dirname,'..');
(async()=>{
  const browser=await chromium.launch({executablePath:process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  try{
    const page=await browser.newPage({viewport:{width:720,height:600}}),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.route('https://fixture.test/**',route=>{
      const name=decodeURIComponent(new URL(route.request().url()).pathname),file=path.resolve(root,'.'+name);
      if(!file.startsWith(root+path.sep) || !fs.existsSync(file))return route.abort();
      const ext=path.extname(file),type=ext==='.js'?'text/javascript':ext==='.css'?'text/css':ext==='.html'?'text/html':ext==='.png'?'image/png':'application/octet-stream';
      return route.fulfill({contentType:type,body:fs.readFileSync(file)});
    });
    await page.addInitScript(()=>{
      const videos=Array.from({length:2000},(_,i)=>({id:'v'+i,url:'https://example.test/view_video.php?viewkey='+i,title:'Video '+i}));
      const values={downloadQueueState:{tasks:Array.from({length:2000},(_,i)=>({id:'task-'+i,fileName:'Video '+i,status:i<2?'downloading':'queued',progress:i<2?20:0,format:'mp4'}))},
        m3u8DownloadHistory:{records:Array.from({length:1500},(_,i)=>({id:'old-'+i,pageUrl:'https://example.test/view_video.php?viewkey='+i,completedAt:i}))},
        profileScanState:{status:'complete',profileName:'Fixture',profileUrl:'https://example.test/model/creator/videos',pagesScanned:1,videos}};
      const localChanged=[],changed=[];
      const local={onChanged:{addListener:fn=>localChanged.push(fn)},get:async keys=>Object.fromEntries((Array.isArray(keys)?keys:[keys]).filter(key=>values[key]!==undefined).map(key=>[key,structuredClone(values[key])])),set:async patch=>{
        const updates={};for(const [key,value] of Object.entries(patch)){updates[key]={oldValue:values[key],newValue:structuredClone(value)};values[key]=structuredClone(value);}
        localChanged.forEach(fn=>fn(updates));changed.forEach(fn=>fn(updates,'local'));
      }};
      window.testStorage=local;window.queueValues=values;
      window.chrome={i18n:{getMessage:()=>''},storage:{local,onChanged:{addListener:fn=>changed.push(fn)}},
        runtime:{id:'fixture',getURL:value=>'https://fixture.test/'+value,onMessage:{addListener(){}},sendMessage(message,callback){const response=message.type==='download-queue-snapshot'?{success:true,state:values.downloadQueueState}:{success:true};callback?.(response);return Promise.resolve(response);}},
        tabs:{query:(query,callback)=>callback([{id:1,url:'https://example.test/watch',title:'Fixture'}]),sendMessage:(id,message,callback)=>callback({videoInfos:[]})},windows:{getCurrent:async()=>({id:1})}};
    });
    await page.goto('https://fixture.test/src/pages/popup/index.html?surface=popup');
    await page.waitForSelector('[data-task-id="task-0"]',{timeout:15000});
    assert.equal(await page.locator('.queue-items-list [data-task-id]').count(),30,'a large queue must have a bounded DOM');
    assert.match(await page.locator('.queue-pagination').innerText(),/1–30 of 2000/);
    const box=await page.locator('.popup-scroll').boundingBox();
    await page.mouse.move(box.x+box.width/2,box.y+box.height/2);
    await page.mouse.wheel(0,550);
    await page.waitForFunction(()=>document.querySelector('.popup-scroll').scrollTop>0);
    const before=await page.evaluate(()=>document.querySelector('.popup-scroll').scrollTop);
    await page.evaluate(async()=>{const queue=structuredClone(queueValues.downloadQueueState);queue.tasks[0].progress=35;await testStorage.set({downloadQueueState:queue});});
    await page.waitForFunction(()=>document.querySelector('[data-task-id="task-0"] [data-role="bar"]')?.style.width==='35%');
    assert.equal(await page.evaluate(()=>document.querySelector('.popup-scroll').scrollTop),before,'progress updates must preserve the scroll position');
    await page.locator('#queue-next').click();
    assert.equal(await page.locator('.queue-items-list [data-task-id]').count(),30);
    assert.equal(await page.locator('[data-task-id="task-30"]').count(),1);
    assert.match(await page.locator('.queue-pagination').innerText(),/31–60 of 2000/);
    await page.locator('[data-tab="profile"]').click();
    await page.waitForSelector('.profile-video-grid');
    assert.equal(await page.locator('.profile-video-card').count(),60);
    const toolbar=await page.locator('.profile-selection-toolbar').boundingBox();
    await page.mouse.move(toolbar.x+toolbar.width/2,toolbar.y+toolbar.height/2);
    await page.mouse.wheel(0,450);
    await page.waitForFunction(()=>document.querySelector('.profile-video-grid').scrollTop>0);
    assert.deepEqual(errors,[]);
    console.log('PASS: popup opens a 2000-item queue and library with bounded cards; scrolling and queue paging work during progress updates.');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
