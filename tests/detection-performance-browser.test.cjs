const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const runtime=process.env.CODEX_NODE_MODULES || 'C:/Users/vishv/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const {chromium}=require(path.join(runtime,'playwright'));
const root=path.resolve(__dirname,'..');
(async()=>{
  const browser=await chromium.launch({executablePath:process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  try{
    const page=await browser.newPage();
    await page.route('https://fixture.test/**',route=>{
      const name=new URL(route.request().url()).pathname;
      if(name==='/')return route.fulfill({contentType:'text/html',body:'<!doctype html><title>Fixture</title><p>Page content</p>'});
      const file=path.resolve(root,'.'+name);
      if(!file.startsWith(root+path.sep) || !fs.existsSync(file))return route.abort();
      return route.fulfill({contentType:'text/javascript',body:fs.readFileSync(file)});
    });
    await page.addInitScript(()=>{
      window.reports=[];window.resources=[];window.outerReads=0;
      const nativeEntries=performance.getEntriesByType.bind(performance);
      performance.getEntriesByType=type=>type==='resource'?resources:nativeEntries(type);
      window.PerformanceObserver=class {constructor(callback){window.resourceCallback=callback;}observe(){}};
      window.chrome={runtime:{id:'fixture',onMessage:{addListener(){}},sendMessage:async message=>{reports.push(message);return {success:true};}}};
    });
    await page.goto('https://fixture.test/');
    await page.evaluate(async()=>{
      const descriptor=Object.getOwnPropertyDescriptor(Element.prototype,'outerHTML');
      Object.defineProperty(document.documentElement,'outerHTML',{get(){outerReads++;return descriptor.get.call(this);}});
      const {installMediaDetection}=await import('/assets/js/media-detection.js');installMediaDetection();
    });
    await page.waitForFunction(()=>outerReads>0 && reports.length>0);
    const before=await page.evaluate(()=>outerReads);
    await page.evaluate(()=>resourceCallback({getEntries:()=>[{name:'https://fixture.test/photo.jpg'},{name:'https://fixture.test/style.css'}]}));
    await page.waitForTimeout(400);
    assert.equal(await page.evaluate(()=>outerReads),before,'unrelated resources must not trigger full-page scans');
    await page.evaluate(()=>{resources.push({name:'https://fixture.test/video.m3u8'});resourceCallback({getEntries:()=>resources});});
    await page.waitForFunction(()=>reports.some(report=>report.videoInfos?.some(video=>video.videoUrl==='https://fixture.test/video.m3u8')));
    assert.ok(await page.evaluate(()=>outerReads)>before,'video resources must still trigger detection');
    console.log('PASS: unrelated page resources do not trigger rescans; newly loaded video resources remain detectable.');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
