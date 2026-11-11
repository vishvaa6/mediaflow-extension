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
      const local={get:async()=>({}),set:async()=>{},onChanged:{addListener(){}}};
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
    assert.equal(await frame.locator('html').getAttribute('data-surface'),'overlay');
    if(process.env.POPUP_SCREENSHOT){await page.waitForTimeout(500);await page.screenshot({path:process.env.POPUP_SCREENSHOT});}
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
      window.close=()=>{window.overlayPopupClosed=true;};
      chrome.tabs.sendMessage=(id,message,callback)=>overlayListeners[0](message,{id:'fixture'},callback);
      const {openPageOverlay}=await import('/src/pages/popup/overlay-launch.js');
      await openPageOverlay();return window.overlayPopupClosed===true;
    });
    assert.equal(launched,true,'the toolbar popup hands off after the panel is ready');
    assert.equal(await page.locator('html > div').count(),1);
    await page.mouse.click(30,700);
    assert.equal(await page.locator('html > div').count(),0,'clicking outside closes the panel');
    await page.goto('https://fixture.test/blocked');
    await page.addScriptTag({url:'https://fixture.test/src/pages/overlay-host.js'});
    const blocked=await page.evaluate(async()=>{
      window.close=()=>{window.overlayPopupClosed=true;};
      chrome.tabs.sendMessage=(id,message,callback)=>overlayListeners[0](message,{id:'fixture'},callback);
      const {openPageOverlay}=await import('/src/pages/popup/overlay-launch.js');
      await openPageOverlay();return window.overlayPopupClosed===true;
    });
    assert.equal(blocked,false,'the toolbar popup stays open when the page blocks the frame');
    assert.equal(await page.locator('html > div').count(),0);
    assert.deepEqual(errors,[]);
    console.log('PASS: authorized in-page glass blurs the live page, closes, and rejects ungranted frames.');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
