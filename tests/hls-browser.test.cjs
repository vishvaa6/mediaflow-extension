const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const runtime = process.env.CODEX_NODE_MODULES || 'C:/Users/vishv/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const {chromium} = require(path.join(runtime,'playwright'));
const root = path.resolve(__dirname,'..');
const temporaryRoot = path.resolve(os.tmpdir());
const profile = fs.mkdtempSync(path.join(temporaryRoot,'mediaflow-hls-restart-'));
const requests = new Map(), held = new Set();
let blockThirdSegment = true;
let expireLinks = false;
const directBytes = Uint8Array.from({length:200000},(_,i)=>i%251), directRequests=[];
const workerSource = `
import {HlsDownloader} from '/assets/js/hls-downloader.js';
import {DirectDownloader} from '/assets/js/direct-downloader.js';
import {resolveMedia} from '/assets/js/media-resolver.js';
let downloader;
const resolveSource = format => async signal => {
  const page = location.origin+'/watch';
  const fetchText = async url => (await fetch(url,{signal,cache:'no-store'})).text();
  return resolveMedia(await fetchText(page),page,'720',fetchText,{format,strictQuality:true});
};
const saveFile = async options => {
  const root = await navigator.storage.getDirectory();
  const file = await (await root.getFileHandle(options.opfsFileName)).getFile();
  postMessage({type:'saved',format:options.format,bytes:[...new Uint8Array(await file.arrayBuffer())]});
};
onmessage = async ({data}) => {
  if (data.type === 'pause') { await downloader.pauseSoft(); postMessage({type:'paused'}); return; }
  const onProgress = progress => postMessage({type:'progress',...progress});
  const onError = error => postMessage({type:'error',error});
  const onComplete = () => postMessage({type:'complete'});
  if (data.type === 'direct' || data.type === 'direct-resume') {
    const resume = data.type === 'direct-resume';
    downloader = new DirectDownloader({saveFile,resolveSource:resolveSource('mp4')});
    await downloader.start({url:location.origin+(resume?'/resume.mp4?token=old':'/file.mp4'),fileName:'direct',opfsFileName:resume?'expired-direct.mp4':'direct.mp4',onProgress,onError,onComplete});
  } else {
    downloader = new HlsDownloader({saveFile,maxConcurrent:1,resolveSource:resolveSource('m3u8'),onProgress,onError,onComplete});
    await downloader.start(location.origin+'/playlist.m3u8',{fileName:'resume-test',quality:'720',opfsFileName:data.base || 'browser-resume.ts'});
  }
};`;
const server = http.createServer((req,res) => {
  const requestUrl = new URL(req.url,'http://localhost'), pathname = requestUrl.pathname;
  const fresh = requestUrl.searchParams.get('token') === 'fresh';
  res.setHeader('Cache-Control','no-store');
  if (pathname === '/') {
    res.setHeader('Content-Type','text/html');
    res.end('<!doctype html><title>HLS restart regression</title><script>window.events=[];window.worker=new Worker("/worker.js",{type:"module"});worker.onmessage=event=>events.push(event.data);window.start=(type,base)=>worker.postMessage({type,base});</script>');
  } else if (pathname === '/worker.js') { res.setHeader('Content-Type','text/javascript'); res.end(workerSource); }
  else if (pathname === '/watch') {
    res.setHeader('Content-Type','text/html');
    res.end('var flashvars_123 = '+JSON.stringify({mediaDefinitions:[{format:'mp4',quality:720,videoUrl:'/resume.mp4?token=fresh'},{format:'hls',quality:720,videoUrl:'/playlist.m3u8?token=fresh'}]})+';');
  }
  else if (pathname === '/playlist.m3u8') {
    if(expireLinks && !fresh){res.writeHead(472);res.end();return;}
    res.setHeader('Content-Type','application/vnd.apple.mpegurl'); res.end('#EXTM3U\n'+Array.from({length:4},(_,i)=>`#EXTINF:1,\n/seg-${i}.ts${fresh?'?token=fresh':''}`).join('\n')+'\n#EXT-X-ENDLIST');
  }
  else if (/^\/seg-\d\.ts$/.test(pathname)) {
    requests.set(pathname,(requests.get(pathname)||0)+1);
    if(expireLinks && !fresh){res.writeHead(472);res.end();return;}
    const index=Number(pathname.match(/\d/)[0]);
    if (index===2 && blockThirdSegment) { held.add(res); res.on('close',()=>held.delete(res)); return; }
    res.setHeader('Content-Type','video/MP2T'); res.end(Buffer.from([index+1,index+11]));
  } else if (pathname === '/file.mp4') { res.setHeader('Content-Type','video/mp4'); res.end(Buffer.from([9,8,7,6])); }
  else if (pathname === '/resume.mp4') {
    directRequests.push({fresh,range:req.headers.range});
    if(expireLinks && !fresh){res.writeHead(472);res.end();return;}
    res.setHeader('Content-Type','video/mp4');
    const start=Number(req.headers.range?.match(/bytes=(\d+)-/)?.[1]||0);
    res.setHeader('Content-Length',directBytes.length-start);
    if(req.headers.range){res.statusCode=206;res.setHeader('Content-Range',`bytes ${start}-${directBytes.length-1}/${directBytes.length}`);res.end(directBytes.slice(start));}
    else {res.write(directBytes.slice(0,100000));held.add(res);res.on('close',()=>held.delete(res));}
  }
  else {
    const file=path.resolve(root,'.'+pathname);
    if (!file.startsWith(root+path.sep)) { res.writeHead(403);res.end();return; }
    try { res.setHeader('Content-Type','text/javascript');res.end(fs.readFileSync(file)); }
    catch { res.writeHead(404);res.end(); }
  }
});
let context;
async function launch(origin) {
  context=await chromium.launchPersistentContext(profile,{executablePath:process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  const page=await context.newPage();
  await page.goto(origin);
  return page;
}
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${server.address().port}`;
  let page=await launch(origin);
  await page.evaluate(()=>start('hls'));
  await page.waitForFunction(()=>events.some(e=>e.type==='progress' && e.finishNum===2) || events.some(e=>e.type==='error'));
  assert.equal(await page.evaluate(()=>events.find(e=>e.type==='error')?.error),undefined);
  assert.equal(requests.get('/seg-0.ts'),1);assert.equal(requests.get('/seg-1.ts'),1);
  // No pause call: terminate the old worker with an in-flight segment request.
  await context.close();context=null;
  for(const response of held)response.destroy();
  blockThirdSegment=false;
  page=await launch(origin);
  await page.evaluate(()=>start('hls'));
  await page.waitForFunction(()=>events.some(e=>e.type==='complete') || events.some(e=>e.type==='error'));
  const events=await page.evaluate(()=>window.events);
  assert.equal(events.find(e=>e.type==='error')?.error,undefined);
  assert.deepEqual(events.find(e=>e.type==='saved')?.bytes,[1,11,2,12,3,13,4,14]);
  assert.equal(requests.get('/seg-0.ts'),1,'completed segment 0 must never be downloaded again');
  assert.equal(requests.get('/seg-1.ts'),1,'completed segment 1 must never be downloaded again');
  assert.equal(requests.get('/seg-3.ts'),1);
  assert.ok(events.some(e=>e.type==='progress' && e.finishNum===2),'restored progress must appear before downloading missing segments');
  await page.evaluate(()=>{events.length=0;start('direct');});
  await page.waitForFunction(()=>events.some(e=>e.type==='complete') || events.some(e=>e.type==='error'));
  const direct=await page.evaluate(()=>window.events);
  assert.equal(direct.find(e=>e.type==='error')?.error,undefined);
  assert.deepEqual(direct.find(e=>e.type==='saved')?.bytes,[9,8,7,6]);
  blockThirdSegment=true;
  await page.evaluate(()=>{events.length=0;start('hls','paused-resume.ts');});
  await page.waitForFunction(()=>events.some(e=>e.type==='progress' && e.finishNum===2) || events.some(e=>e.type==='error'));
  assert.equal(await page.evaluate(()=>events.find(e=>e.type==='error')?.error),undefined);
  await page.evaluate(()=>worker.postMessage({type:'pause'}));
  await page.waitForFunction(()=>events.some(e=>e.type==='paused'));
  const zeroBefore=requests.get('/seg-0.ts'),oneBefore=requests.get('/seg-1.ts');
  // Also commit a partial direct file, then expire both saved source links.
  await page.evaluate(()=>{events.length=0;start('direct-resume');});
  await page.waitForFunction(()=>events.some(e=>e.type==='progress' && e.bytesReceived===100000) || events.some(e=>e.type==='error'));
  assert.equal(await page.evaluate(()=>events.find(e=>e.type==='error')?.error),undefined);
  await page.evaluate(()=>worker.postMessage({type:'pause'}));
  await page.waitForFunction(()=>events.some(e=>e.type==='paused'));
  await context.close();context=null;
  for(const response of held)response.destroy();
  blockThirdSegment=false;
  expireLinks=true;
  page=await launch(origin);
  await page.evaluate(()=>start('hls','paused-resume.ts'));
  await page.waitForFunction(()=>events.some(e=>e.type==='complete') || events.some(e=>e.type==='error'));
  const resumed=await page.evaluate(()=>window.events);
  assert.equal(resumed.find(e=>e.type==='error')?.error,undefined);
  assert.deepEqual(resumed.find(e=>e.type==='saved')?.bytes,[1,11,2,12,3,13,4,14]);
  assert.equal(requests.get('/seg-0.ts'),zeroBefore);assert.equal(requests.get('/seg-1.ts'),oneBefore);
  await page.evaluate(()=>{events.length=0;start('direct-resume');});
  await page.waitForFunction(()=>events.some(e=>e.type==='complete') || events.some(e=>e.type==='error'));
  const directResumed=await page.evaluate(()=>window.events);
  assert.equal(directResumed.find(e=>e.type==='error')?.error,undefined);
  assert.deepEqual(directResumed.find(e=>e.type==='saved')?.bytes,[...directBytes]);
  assert.deepEqual(directRequests,[{fresh:false,range:undefined},{fresh:false,range:'bytes=34464-'},{fresh:true,range:'bytes=34464-'}]);
  console.log('PASS: native worker fetch; abrupt close/reopen; pause/close/reopen with expired HTTP 472 links; HLS skips completed segments; direct resume verifies overlap and requests the remaining range; output bytes match.');
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(async()=>{
  await context?.close();
  for(const response of held)response.destroy();
  await new Promise(resolve=>server.close(resolve));
  // Only remove this test's own generated temporary browser profile.
  const resolved=path.resolve(profile);
  if(path.dirname(resolved)!==temporaryRoot || !path.basename(resolved).startsWith('mediaflow-hls-restart-'))throw Error('Unexpected test profile path');
  fs.rmSync(resolved,{recursive:true,force:true});
});
