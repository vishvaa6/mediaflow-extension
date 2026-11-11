const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs');
const runtime=process.env.CODEX_NODE_MODULES || 'C:/Users/vishv/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const {chromium}=require(path.join(runtime,'playwright'));
const {PNG}=require(path.join(runtime,'pngjs'));
const root=path.resolve(__dirname,'..');
(async()=>{
  // An extension copy with the declarative host omitted simulates a tab that was
  // open before an extension reload. The popup must inject the host on demand.
  const extension=path.join(root,'test-results','overlay-extension-'+process.pid);
  const profile=path.join(root,'test-results','overlay-extension-profile-'+process.pid);
  fs.mkdirSync(extension,{recursive:true});
  for(const entry of ['assets','src','_locales','js','icon-34.png','icon-128.png'])fs.cpSync(path.join(root,entry),path.join(extension,entry),{recursive:true});
  const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));
  manifest.content_scripts=manifest.content_scripts.filter(entry=>!entry.js?.includes('src/pages/overlay-host.js'));
  fs.writeFileSync(path.join(extension,'manifest.json'),JSON.stringify(manifest));
  const browser=await chromium.launchPersistentContext(profile,{
    executablePath:process.env.CHROME_TESTING_PATH || 'C:/Users/vishv/.cache/selenium/chrome/win64/154.0.8037.92/chrome.exe',
    headless:true,ignoreDefaultArgs:['--disable-extensions'],args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`],viewport:{width:1000,height:800},colorScheme:'dark'
  });
  try{
    let worker=browser.serviceWorkers()[0] || await browser.waitForEvent('serviceworker',{timeout:15000});
    await browser.route('https://fixture.test/**',route=>route.fulfill({contentType:'text/html',headers:new URL(route.request().url()).pathname==='/style-policy'?{'Content-Security-Policy':"style-src 'self'; frame-src chrome-extension:"}:{},body:'<!doctype html><title>Glass fixture</title><body style="margin:0;min-height:100vh;background:linear-gradient(to bottom,#f00 0 500px,#00f 500px 100%)"><button>Page control</button></body>'}));
    const page=await browser.newPage();page.on('console',msg=>{if(msg.type()==='error')console.log('PAGE ERROR:',msg.text());});page.on('pageerror',err=>console.log('PAGE EXCEPTION:',err.message));
    await page.goto('https://fixture.test/');
    await page.waitForTimeout(1000);
    await page.evaluate(()=>{window.retainedPageMarker='not reloaded';const stale=document.createElement('div');stale.dataset.mediaflowGlassPanel='';document.documentElement.append(stale);});
    await worker.evaluate(()=>chrome.action.openPopup());
    await page.waitForFunction(()=>document.querySelector('html > div')?.style.visibility==='visible',{timeout:12000});
    assert.equal(await page.evaluate(()=>window.retainedPageMarker),'not reloaded','the popup injects its host without refreshing the page');
    assert.equal(await page.locator('[data-mediaflow-glass-panel]').count(),1,'a stale panel from a previous extension instance is removed');
    const frame=page.frames().find(frame=>frame.url().includes('/overlay.html'));
    assert.ok(frame);await frame.waitForSelector('.popup-tabs-bar');
    assert.match(await page.locator('html > div').evaluate(el=>getComputedStyle(el).backdropFilter),/blur/);
    await page.waitForTimeout(500);
    const screenshot=await page.screenshot();
    if(process.env.POPUP_SCREENSHOT)fs.writeFileSync(process.env.POPUP_SCREENSHOT,screenshot);
    const picture=PNG.sync.read(screenshot);
    const pixel=(x,y)=>{const i=(picture.width*y+x)*4;return [...picture.data.subarray(i,i+3)];};
    const red=pixel(800,450),blue=pixel(800,550);
    if(process.env.POPUP_SCREENSHOT)console.log('frame backgrounds:',await frame.evaluate(()=>[document.documentElement,document.body,document.querySelector('#app-container'),document.querySelector('.App'),document.querySelector('.popup-scroll')].map(el=>({name:el.tagName+'.'+el.className,background:getComputedStyle(el).background,colorScheme:getComputedStyle(el).colorScheme}))));
    assert.ok(red[0]-red[2]>15 && blue[2]-blue[0]>15,`webpage colours must be visible through the actual dark panel: ${red} / ${blue}`);
    const boundary=pixel(800,500);
    assert.ok(boundary[0]>Math.min(red[0],blue[0])+4 && boundary[2]>Math.min(red[2],blue[2])+4,`blur must mix colours at the page's sharp edge: ${boundary}`);
    await page.evaluate(()=>{document.body.style.background='linear-gradient(to bottom,#00f 0 500px,#f00 500px 100%)';});
    await page.waitForTimeout(150);
    const changed=PNG.sync.read(await page.screenshot());
    const changedAt=(x,y)=>{const i=(changed.width*y+x)*4;return [...changed.data.subarray(i,i+3)];};
    const liveTop=changedAt(800,450),liveBottom=changedAt(800,550);
    assert.ok(liveTop[2]-liveTop[0]>15 && liveBottom[0]-liveBottom[2]>15,`glass must reflect live page changes: ${liveTop} / ${liveBottom}`);
    await frame.locator('#btn-close-overlay').click();
    await page.waitForFunction(()=>!document.querySelector('html > div'));
    await page.waitForTimeout(400);
    await worker.evaluate(()=>chrome.action.openPopup());
    await page.waitForFunction(()=>document.querySelector('html > div')?.style.visibility==='visible',{timeout:10000});
    const popupFrame=page.frames().find(frame=>frame.url().includes('/overlay.html'));
    assert.ok(popupFrame,'opening the toolbar popup hands off to the page');
    await popupFrame.locator('#btn-close-overlay').click();
    await page.waitForFunction(()=>!document.querySelector('html > div'));
    await page.goto('https://fixture.test/style-policy');
    await page.waitForTimeout(700);
    await worker.evaluate(()=>chrome.action.openPopup());
    await page.waitForFunction(()=>document.querySelector('html > div')?.style.visibility==='visible',{timeout:12000});
    assert.match(await page.locator('html > div').evaluate(el=>getComputedStyle(el).backdropFilter),/blur/,'page style policies do not remove glass styling');
    console.log('PASS: real extension panel opens and blurs the webpage.');
  }finally{
    await browser.close();
    const testResults=path.resolve(root,'test-results');
    for(const target of [extension,profile]){
      const resolved=path.resolve(target);
      if(path.dirname(resolved)===testResults && path.basename(resolved).endsWith('-'+process.pid))fs.rmSync(resolved,{recursive:true,force:true,maxRetries:3,retryDelay:100});
    }
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
