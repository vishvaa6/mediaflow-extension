const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const runtime=process.env.CODEX_NODE_MODULES || 'C:/Users/vishv/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const {chromium}=require(path.join(runtime,'playwright'));
const root=path.resolve(__dirname,'..');
(async()=>{
  const browser=await chromium.launch({executablePath:process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  try {
    const page=await browser.newPage({viewport:{width:1000,height:800}}),errors=[];
    await page.emulateMedia({colorScheme:'dark'});
    page.on('pageerror',error=>errors.push(error.message));
    await page.route('https://fixture.test/**',route=>{
      const name=new URL(route.request().url()).pathname;
      if(name==='/' || name==='/blocked')return route.fulfill({contentType:'text/html',headers:name==='/blocked'?{'Content-Security-Policy':"frame-src 'none'"}:{},body:'<!doctype html><title>Glass fixture</title><body style="margin:0;background:repeating-linear-gradient(90deg,white 0 20px,black 20px 40px)"><button>Page control</button></body>'});
      const file=path.resolve(root,'.'+name);
      if(!file.startsWith(root+path.sep) || !fs.existsSync(file))return route.abort();
      const ext=path.extname(file),type=ext==='.js'?'text/javascript':ext==='.css'?'text/css':ext==='.html'?'text/html':'application/octet-stream';
      return route.fulfill({contentType:type,body:fs.readFileSync(file)});
    });
    await page.addInitScript(()=>{
      const listeners=[];window.overlayListeners=listeners;
      const session={set:async values=>Object.entries(values).forEach(([key,value])=>localStorage.setItem(key,JSON.stringify(value))),get:async key=>({[key]:JSON.parse(localStorage.getItem(key) || 'null')}),remove:async key=>localStorage.removeItem(key)};
      const local={get:async keys=>Object.fromEntries((Array.isArray(keys)?keys:[keys]).filter(key=>localStorage.getItem('local:'+key)!==null).map(key=>[key,JSON.parse(localStorage.getItem('local:'+key))])),set:async values=>Object.entries(values).forEach(([key,value])=>localStorage.setItem('local:'+key,JSON.stringify(value))),onChanged:{addListener(){}}};
      window.chrome={i18n:{getMessage:()=>''},storage:{session,local,onChanged:{addListener(){}}},runtime:{id:'fixture',getURL:value=>'https://fixture.test/'+value,onMessage:{addListener:fn=>listeners.push(fn)},sendMessage:(message,callback)=>{const result={success:true};callback?.(result);return Promise.resolve(result);}},tabs:{query:(query,callback)=>callback([{id:1,url:'https://fixture.test/',title:'Glass fixture'}]),sendMessage:(id,message,callback)=>callback({videoInfos:[]})},windows:{getCurrent:async()=>({id:1})}};
    });
    await page.goto('https://fixture.test/');
    await page.addScriptTag({url:'https://fixture.test/src/pages/overlay-host.js'});
    const result=await page.evaluate(async()=>{
      const token='secret-test-grant';await chrome.storage.session.set({['mediaflowOverlayGrant:'+token]:Date.now()+10000});
      return await new Promise(resolve=>overlayListeners[0]({type:'mediaflow-overlay-toggle',token},{id:'fixture'},resolve));
    });
    assert.equal(result.success,true,'authorized panel opens');
    const frame=page.frames().find(item=>item.url().includes('/overlay.html'));
    assert.ok(frame,'extension panel is embedded in the page');
    await frame.waitForSelector('.popup-tabs-bar');
    assert.equal(await page.evaluate(()=>localStorage.getItem('mediaflowOverlayGrant:secret-test-grant')),null,'grant is consumed');
    assert.match(await page.locator('html > div').evaluate(el=>getComputedStyle(el).backdropFilter),/blur\(28px\)/);
    assert.equal(await page.locator('html > div').evaluate(el=>getComputedStyle(el).borderRadius),'24px');
    assert.equal(await page.locator('html > div').evaluate(el=>Math.round(el.getBoundingClientRect().width)),900);
    assert.equal(await page.locator('html > div').evaluate(el=>getComputedStyle(el).backgroundColor),'rgba(8, 8, 12, 0.52)');
    assert.equal(await frame.locator('html').getAttribute('data-surface'),'overlay');
    if(process.env.POPUP_SCREENSHOT){await page.waitForTimeout(500);await page.screenshot({path:process.env.POPUP_SCREENSHOT});}
    const resizeHandle=frame.locator('#btn-resize-popup');
    const grip=await resizeHandle.boundingBox();
    await page.mouse.move(grip.x+grip.width/2,grip.y+grip.height/2);
    await page.mouse.down();await page.mouse.move(grip.x+grip.width/2+100,grip.y+grip.height/2-100,{steps:8});await page.mouse.up();
    await page.waitForFunction(()=>{const box=document.querySelector('[data-mediaflow-glass-panel]')?.getBoundingClientRect();return box && box.width<830 && box.height<680;});
    const resized=await page.locator('[data-mediaflow-glass-panel]').evaluate(el=>({width:el.getBoundingClientRect().width,height:el.getBoundingClientRect().height}));
    assert.ok(Math.abs(resized.width-800)<10 && Math.abs(resized.height-650)<10,'drag resizes in both directions');
    await page.waitForFunction(width=>JSON.parse(localStorage.getItem('local:mediaflowOverlaySize') || 'null')?.width===width,resized.width);
    await frame.locator('#btn-close-overlay').click();
    await page.waitForFunction(()=>!document.querySelector('html > div'));
    await page.evaluate(()=>{const iframe=document.createElement('iframe');iframe.src='/src/pages/popup/overlay.html?surface=overlay';document.body.append(iframe);});
    await page.waitForTimeout(300);
    const unauthorized=page.frames().find(item=>item.url().includes('/overlay.html'));
    assert.ok(unauthorized);
    await page.evaluate(()=>document.querySelector('body iframe').contentWindow.postMessage({type:'mediaflow-overlay-grant',token:'forged'},location.origin));
    await page.waitForTimeout(100);
    assert.equal(await unauthorized.locator('.popup-tabs-bar').count(),0,'a page cannot initialize the extension UI without a grant');
    await page.evaluate(()=>document.querySelector('body iframe').remove());
    const launched=await page.evaluate(async()=>{
      chrome.tabs.sendMessage=(id,message,callback)=>overlayListeners[0](message,{id:'fixture'},callback);
      const {handleOverlayAction}=await import('/src/pages/popup/overlay-launch.js');
      return await handleOverlayAction({id:1,windowId:1,url:'https://fixture.test/'});
    });
    assert.equal(launched,'overlay','the panel opens directly for the source tab');
    assert.equal(await page.locator('html > div').count(),1);
    await page.waitForFunction(width=>Math.round(document.querySelector('[data-mediaflow-glass-panel]').getBoundingClientRect().width)===width,resized.width);
    const reopened=page.frames().find(item=>item.url().includes('/overlay.html'));
    await reopened.locator('#btn-resize-popup').press('ArrowLeft');
    await page.waitForFunction(width=>Math.round(document.querySelector('[data-mediaflow-glass-panel]').getBoundingClientRect().width)===width+20,resized.width);
    await reopened.locator('#btn-resize-popup').press('Home');
    await page.waitForFunction(()=>Math.round(document.querySelector('[data-mediaflow-glass-panel]').getBoundingClientRect().width)===900);
    await page.setViewportSize({width:500,height:400});
    await page.waitForFunction(()=>{const box=document.querySelector('[data-mediaflow-glass-panel]').getBoundingClientRect();return box.width<=484 && box.height<=384;});
    await page.setViewportSize({width:1000,height:800});
    await page.waitForFunction(()=>Math.round(document.querySelector('[data-mediaflow-glass-panel]').getBoundingClientRect().width)===900);
    await page.mouse.click(30,700);
    assert.equal(await page.locator('html > div').count(),0,'clicking outside closes the panel');
    await page.goto('https://fixture.test/blocked');
    await page.addScriptTag({url:'https://fixture.test/src/pages/overlay-host.js'});
    const blocked=await page.evaluate(async()=>{
      chrome.tabs.sendMessage=(id,message,callback)=>overlayListeners[0](message,{id:'fixture'},callback);
      const changes=[];chrome.action={setPopup:async value=>changes.push(value),openPopup:async value=>changes.push(value)};
      const {handleOverlayAction}=await import('/src/pages/popup/overlay-launch.js');
      return {opened:await handleOverlayAction({id:1,windowId:1,url:'https://fixture.test/blocked'}),changes};
    });
    assert.equal(blocked.opened,'popup','blocked frames open the extension popup');
    assert.deepEqual(blocked.changes,[{tabId:1,popup:'src/pages/popup/index.html?surface=popup'},{windowId:1},{tabId:1,popup:''}]);
    const olderChrome=await page.evaluate(async()=>{
      const changes=[];chrome.action={setPopup:async value=>changes.push(value),openPopup:async()=>{throw Error('unavailable');}};
      const {handleOverlayAction}=await import('/src/pages/popup/overlay-launch.js');
      return {opened:await handleOverlayAction({id:1,windowId:1,url:'chrome://version/'}),changes};
    });
    assert.equal(olderChrome.opened,'popup-on-next-click');
    assert.deepEqual(olderChrome.changes,[{tabId:1,popup:'src/pages/popup/index.html?surface=popup'}]);
    assert.equal(await page.locator('html > div').count(),0);
    assert.deepEqual(errors,[]);
    console.log('PASS: authorized in-page glass blurs the live page, closes, and rejects ungranted frames.');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
