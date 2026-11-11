const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const runtime=process.env.CODEX_NODE_MODULES || 'C:/Users/vishv/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const {chromium}=require(path.join(runtime,'playwright'));
const root=path.resolve(__dirname,'..');
const responses={
  'https://example.test/watch/1':{text:'<video src="/media/video.mp4" type="video/mp4"></video>'},
  'https://example.test/master.m3u8':{url:'https://cdn.example.test/stream/master.m3u8',text:'#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1000,RESOLUTION=640x360\nplaylist.m3u8'},
  'https://cdn.example.test/stream/playlist.m3u8':{text:'#EXTM3U\n#EXTINF:2,\nsegment.ts\n#EXT-X-ENDLIST'},
  'https://example.test/audio.m3u8':{text:'#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="English",URI="audio.m3u8"\n#EXT-X-STREAM-INF:BANDWIDTH=1000,AUDIO="audio"\nvideo.m3u8'},
  'https://example.test/live.m3u8':{text:'#EXTM3U\n#EXTINF:2,\nsegment.ts'},
};
(async()=>{
  const browser=await chromium.launch({executablePath:process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  try {
    const page=await browser.newPage();
    await page.addInitScript(responses=>{
      window.MediaFlowNative={ready(){window.resolverReady=true;},fetchText(url){
        const result=responses[url] || (url.startsWith('https://cdn.syndication.twimg.com/') ? {text:JSON.stringify({id_str:'1234567890123456789',text:'Example post',mediaDetails:[{type:'video',video_info:{variants:[{content_type:'video/mp4',bitrate:100000,url:'https://video.twimg.com/vid/640x360/video.mp4'}]}}]})} : null);
        return JSON.stringify(result ? {ok:true,url,...result} : {ok:false,error:'Fixture not found: '+url});
      },finish(value){window.resolverResult=JSON.parse(value);}};
    },responses);
    await page.route('https://mediaflow.local/**',route=>{
      const name=new URL(route.request().url()).pathname.slice(1);
      const file=name==='resolver.html'?path.join(root,'android/app/src/main/assets/resolver.html'):path.join(root,'assets/js',name);
      if(!/^[\w.-]+\.(?:html|js)$/.test(name) || !fs.existsSync(file))return route.abort();
      return route.fulfill({status:200,contentType:name.endsWith('.js')?'text/javascript':'text/html',body:fs.readFileSync(file)});
    });
    await page.goto('https://mediaflow.local/resolver.html');
    await page.waitForFunction(()=>window.resolverReady);
    const resolve=async url=>page.evaluate(async url=>{window.resolverResult=null;await window.resolveSharedLink(url);return window.resolverResult;},url);
    let result=await resolve('https://example.test/direct.mp4?token=1');
    assert.equal(result.ok,true);assert.equal(result.media.url,'https://example.test/direct.mp4?token=1');
    result=await resolve('https://example.test/watch/1');assert.equal(result.ok,true);assert.equal(result.media.url,'https://example.test/media/video.mp4');
    result=await resolve('https://x.com/example/status/1234567890123456789');assert.equal(result.ok,true);assert.match(result.media.url,/video\.twimg\.com/);
    result=await resolve('https://example.test/master.m3u8');assert.equal(result.ok,true);assert.equal(result.media.outputExtension,'ts');assert.equal(result.media.units[0].url,'https://cdn.example.test/stream/segment.ts');
    result=await resolve('https://example.test/audio.m3u8');assert.equal(result.ok,false);assert.match(result.error,/separate audio/i);
    result=await resolve('https://example.test/live.m3u8');assert.equal(result.ok,false);assert.match(result.error,/live/i);
    result=await resolve('https://user:password@example.test/video.mp4');assert.equal(result.ok,false);
    console.log('PASS: Android resolver handles direct links, site pages, public X posts, redirected HLS, and rejects unsupported live/separate-audio streams.');
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
