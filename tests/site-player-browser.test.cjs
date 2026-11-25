const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const runtime=process.env.CODEX_NODE_MODULES || 'C:/Users/vishv/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const {chromium}=require(path.join(runtime,'playwright'));
const root=path.resolve(__dirname,'..');
const source=(name)=>`https://cdn.test/${name}.mp4`;
const player='<video id="main" width="420" height="240" preload="none" src="blob:unusable"></video>';
const preview='<div class="thumb-block"><video width="180" height="100" preload="none" src="https://cdn.test/preview.mp4"></video></div>';
const config=value=>`<script type="application/json">${JSON.stringify(value)}</script>`;
const master='#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=100,RESOLUTION=1280x720\n720/list.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=200,RESOLUTION=1920x1080\n1080/list.m3u8';
const mediaPlaylist='#EXTM3U\n#EXTINF:1,\nseg.ts\n#EXT-X-ENDLIST';
const embed='https://javplayer.cc/e/example?token=a%2Bb';
const hqEmbed='https://mydaddy.cc/video/abc';

function scrambleKvsHash(realHash,licenseCode,computeKvsLicenseToken){
  const token=computeKvsLicenseToken(licenseCode);
  const chars=[...realHash.slice(0,32)];
  const prefixSums=Array(32).fill(0);
  let sum=0;
  for(let k=31;k>=0;k--){sum+=Number(token[k]);prefixSums[k]=sum;}
  for(let k=0;k<32;k++){const swap=(k+prefixSums[k])%32;[chars[k],chars[swap]]=[chars[swap],chars[k]];}
  return chars.join('')+realHash.slice(32);
}

(async()=>{
  const {computeKvsLicenseToken}=await import('../assets/js/kvs-media.js');
  const kvsLicense='$7049281635490128';
  const kvsHash720='0123456789abcdef0123456789abcdef';
  const kvsHash1080='fedcba9876543210fedcba9876543210';
  const kvsUrl720=`https://cdn.kvs.test/get_file/1/${kvsHash720}/12345/12345_720p.mp4/?br=1200`;
  const kvsUrl1080=`https://cdn.kvs.test/get_file/1/${kvsHash1080}/12345/12345_1080p.mp4/?br=2500`;
  const kvsScrambled720=`function/0/https://cdn.kvs.test/get_file/1/${scrambleKvsHash(kvsHash720,kvsLicense,computeKvsLicenseToken)}/12345/12345_720p.mp4/?br=1200`;
  const kvsScrambled1080=`function/0/https://cdn.kvs.test/get_file/1/${scrambleKvsHash(kvsHash1080,kvsLicense,computeKvsLicenseToken)}/12345/12345_1080p.mp4/?br=2500`;

  const epHash='0123456789abcdef1020304050607080';
  let epCalc='';
  for(let i=0;i<32;i+=8)epCalc+=BigInt('0x'+epHash.slice(i,i+8)).toString(36);
  const epApiUrl=`https://www.eporner.com/xhr/video/FJsA19J3Y3H?hash=${epCalc}&domain=www.eporner.com&fallback=false&embed=true&supportedFormats=mp4`;

  const cases=[
    {page:'https://123av.com/en/v/example',html:`<div id="embed"><iframe width="420" height="240" src="${embed}"></iframe></div>`,mount:'#embed',childFrame:embed,
      quality:'720p HLS',url:'https://cdn.test/720/list.m3u8',headers:{Origin:'https://javplayer.cc',Referer:'https://javplayer.cc/'},replies:{
        'https://javplayer.cc/stream?token=a%2Bb&id=example':JSON.stringify({media:{stream:'https://cdn.test/master.m3u8'}}),
        'https://cdn.test/master.m3u8':master
      }},
    {page:'https://www.pornhub.org/view_video.php?viewkey=sample',html:player+preview+'<script>var flashvars_1={"mediaDefinitions":[{"format":"mp4","videoUrl":"/api/streams"}]};</script>',
      quality:'480p MP4',url:source('ph-480'),replies:{'https://www.pornhub.org/api/streams':JSON.stringify([{quality:480,videoUrl:source('ph-480')},{quality:720,videoUrl:source('ph-720')}])}},
    ...['view_video.php','view_video_hd.php'].map(pathname=>({page:`https://91porn.com/${pathname}?viewkey=example`,
      html:preview+`<div class="video-js"><video id="player_one_html5_api" width="420" height="240" preload="none"><source src="${source('91-main')}?token=a%2Bb" type="video/mp4"></video></div>`,
      quality:'Auto MP4',url:source('91-main')+'?token=a%2Bb',check91:true})),
    ...['xvideos.com','xnxx.es'].map(host=>({page:`https://${host}/video123/example`,
      html:player+preview+'<script type="text/plain">html5player.setVideoUrlLow("https://cdn.test/low.mp4");html5player.setVideoUrlHigh("https://cdn.test/high.mp4");</script>',quality:'480p MP4',url:source('low')})),
    {page:'https://xhamster42.desi/videos/sample',html:config({xplayerSettings:{sources:{standard:{h264:[{url:source('xh'),quality:'720p'}]}}}}),
      fixed:true,quality:'720p MP4',url:source('xh')},
    {page:'https://www.redtube.com/123',html:'<script>window.page_params={"generalVideoConfig":{"mainRoll":{"mediaDefinition":[{"format":"mp4","videoUrl":"/api/streams"}]}}};</script>',
      fixed:true,quality:'720p MP4',url:'https://www.redtube.com/sample.mp4',replies:{'https://www.redtube.com/api/streams':'[{"quality":720,"videoUrl":"/sample.mp4"}]'}},
    {page:'https://tangxinvlog.app/v/123',html:'<meta property="og:image" content="https://cdn.test/videos/123/cover.jpg">',
      fixed:true,quality:'720p HLS',url:'https://cdn.test/videos/123/720/list.m3u8',replies:{'https://cdn.test/videos/123/index.m3u8':master}},
    {page:'https://rou.video/v/example',html:'<div id="loading-player">Loading player</div>',
      fixed:true,latePlayer:true,quality:'720p HLS',url:'https://rou.video/api/hls/720/list.m3u8',replies:{'https://rou.video/api/hls/example':master}},
    {page:'https://huangguoai.com/detail/123?ep=2',html:'<script id="videoInitialData" type="application/json">{"id":123,"ep":2}</script>',
      fixed:true,quality:'Auto MP4',url:source('episode-2'),replies:{'https://huangguoai.com/api/videos/123/play?ep=2':JSON.stringify({code:200,data:{ep_num:2,video_url:source('episode-2')}})}},
    {page:'https://other.test/watch',html:'<script type="application/ld+json">{"@type":"VideoObject","contentUrl":"https://cdn.test/generic.mp4","height":720}</script>',
      fixed:true,quality:'720p MP4',url:source('generic')},
    // Wave 2 / Track 3 end-to-end watch-page fixtures
    {page:'https://www.porntrex.com/video/12345/sample',
      html:preview+`<div id="kt_player"><div class="fp-player"><video width="420" height="240" preload="none" src="blob:unusable"></video></div></div><script>var flashvars = ${JSON.stringify({video_title:'KVS Sample',license_code:kvsLicense,video_url:kvsScrambled720,video_url_text:'720p',video_alt_url:kvsScrambled1080,video_alt_url_text:'1080p'})};</script>`,
      mount:'.fp-player',expectedChoices:['1080p MP4','720p MP4'],quality:'1080p MP4',url:kvsUrl1080},
    {page:'https://www.youporn.com/watch/16290308/sample',
      html:preview+'<div id="player-container"><video width="420" height="240" preload="none" src="blob:unusable"></video></div><script>var page_params = {"video_player_setup":{"mediaDefinitions":[{"format":"hls","videoUrl":"/api/yp/hls"}]}};</script>',
      mount:'#player-container',expectedChoices:['1080p HLS','720p HLS'],quality:'1080p HLS',url:'https://cdn.yp.test/1080/list.m3u8',
      replies:{'https://www.youporn.com/api/yp/hls':JSON.stringify([{quality:'Auto',videoUrl:'https://cdn.yp.test/master.m3u8'}]),'https://cdn.yp.test/master.m3u8':master}},
    {page:'https://spankbang.com/56b3d/video/sample',
      html:preview+'<div id="video-player-bg"><video class="video-js" width="420" height="240" preload="none" src="blob:unusable"></video></div><script>var stream_data = {"4k":["https://cdn.sb.test/4k.mp4"],"720p":["https://cdn.sb.test/720.mp4"],"m3u8":["https://cdn.sb.test/master.m3u8"],"cover_image":"https://cdn.sb.test/cover.jpg"};</script>',
      mount:'#video-player-bg',expectedChoices:['2160p MP4','1080p HLS','720p MP4','720p HLS'],quality:'2160p MP4',url:'https://cdn.sb.test/4k.mp4',
      replies:{'https://cdn.sb.test/master.m3u8':master}},
    {page:'https://www.eporner.com/video-FJsA19J3Y3H/sample',
      html:preview+`<div class="video-js"><video class="vjs-tech" width="420" height="240" preload="none" src="blob:unusable"></video></div><script>var EP={video:{player:{}}}; EP.video.player.vid = 'FJsA19J3Y3H'; EP.video.player.hash = '${epHash}';</script>`,
      mount:'.video-js',expectedChoices:['1080p MP4','1080p HLS','720p HLS'],quality:'720p HLS',url:'https://cdn.ep.test/720/list.m3u8',
      replies:{[epApiUrl]:JSON.stringify({sources:{hls:{auto:{src:'https://cdn.ep.test/master.m3u8'}},mp4:{'1080p':{src:'https://cdn.ep.test/1080.mp4',labelShort:'1080p'}}}}),'https://cdn.ep.test/master.m3u8':master}},
    {page:'https://beeg.com/-0983946056129650',
      html:preview+'<div id="player"><video width="420" height="240" preload="none" src="blob:unusable"></video></div>',
      mount:'#player',expectedChoices:['1080p HLS','720p HLS'],quality:'1080p HLS',url:'https://video.beeg.com/key=bg/1080.m3u8',
      replies:{'https://store.externulls.com/facts/file/0983946056129650':JSON.stringify({file:{hls_resources:{fl_cdn_1080:'key=bg/1080.m3u8',fl_cdn_720:'key=bg/720.m3u8'}}}),'https://video.beeg.com/key=bg/1080.m3u8':mediaPlaylist,'https://video.beeg.com/key=bg/720.m3u8':mediaPlaylist}},
    {page:'https://hqporner.com/hdporn/12345-sample.html',
      html:preview+`<iframe src="https://ads.exoclick.com/iframe.php" width="480" height="270"></iframe><div id="hq-embed"><iframe width="480" height="270" src="${hqEmbed}" allowfullscreen></iframe></div>`,
      mount:'#hq-embed',childFrame:hqEmbed,expectedChoices:['1080p MP4','720p MP4'],quality:'1080p MP4',url:'https://s1.mydaddy.cc/1080.mp4',
      headers:{Origin:'https://mydaddy.cc',Referer:hqEmbed},
      replies:{[hqEmbed]:'<video><source src="//s1.mydaddy.cc/1080.mp4" title="1080p"><source src="//s1.mydaddy.cc/720.mp4" title="720p"></video>'}},
    {page:'https://hqporner.com/hdporn/12345-offscreen.html',
      html:preview+`<div style="margin-top:1200px"><iframe width="480" height="270" src="${hqEmbed}" allowfullscreen></iframe></div>`,
      fixed:true,expectedChoices:['1080p MP4','720p MP4'],quality:'720p MP4',url:'https://s1.mydaddy.cc/720.mp4',
      headers:{Origin:'https://mydaddy.cc',Referer:hqEmbed}},
    {page:'https://blob-hls.test/watch',
      html:preview+'<div class="video-js"><video width="420" height="240" preload="none" src="blob:https://blob-hls.test/stream"></video></div>',
      mount:'.video-js',expectedChoices:['1080p HLS','720p HLS'],quality:'1080p HLS',url:'https://cdn.hls.test/1080/list.m3u8',
      expectLitLabel:'720p HLS',
      snapshot:{pageUrl:'https://blob-hls.test/watch',videoInfos:[
        {videoUrl:'https://cdn.hls.test/720/list.m3u8',format:'m3u8',quality:720},
        {videoUrl:'https://cdn.hls.test/master.m3u8',format:'m3u8',quality:'Auto'}
      ]},
      replies:{'https://cdn.hls.test/master.m3u8':master,'https://cdn.hls.test/720/list.m3u8':mediaPlaylist}}
  ];

  const browser=await chromium.launch({executablePath:process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  try{
    const page=await browser.newPage({viewport:{width:640,height:480}});
    const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    const fixtures=new Map(cases.map(test=>[test.page,test]));
    fixtures.set('https://91porn.com/index.php',{html:preview});
    fixtures.set('https://www.porntrex.com/video/88888/lazy-hls',{
      html:'<div id="kt_player"><video width="420" height="240" preload="none" src="blob:https://www.porntrex.com/lazy"></video></div>'
    });
    fixtures.set('https://lazy-dom.test/watch',{
      html:'<video id="main" width="420" height="240" preload="none" src="blob:https://lazy-dom.test/stream"></video>'
    });
    const loader='<link rel="stylesheet" href="/assets/css/player-download.css"><script type="module">import {installMediaDetection} from "/assets/js/media-detection.js";installMediaDetection();</script>';
    await page.route('**/*',async route=>{
      const url=new URL(route.request().url()),test=fixtures.get(url.href);
      if(test)return route.fulfill({contentType:'text/html',body:`<!doctype html><title>Player fixture</title>${loader}${test.html}`});
      if(url.href===embed)return route.fulfill({contentType:'text/html',body:`<!doctype html>${loader}<video width="320" height="180" preload="none" src="https://cdn.test/embed.mp4"></video>`});
      if(url.href===hqEmbed)return route.fulfill({contentType:'text/html',body:`<!doctype html>${loader}<video width="480" height="270"><source src="//s1.mydaddy.cc/1080.mp4" title="1080p"><source src="//s1.mydaddy.cc/720.mp4" title="720p"></video>`});
      if(!/^\/assets\/(?:js|css)\/[\w.-]+\.(?:js|css)$/.test(url.pathname))return route.fulfill({status:404,body:''});
      const file=path.join(root,url.pathname);
      try{return await route.fulfill({contentType:file.endsWith('.css')?'text/css':'text/javascript',body:fs.readFileSync(file)});}
      catch{return route.fulfill({status:404,body:''});}
    });
    const replies=Object.assign({},...cases.map(test=>test.replies || {}),{
      'https://cdn.lazy.test/master.m3u8':master,
      'https://cdn.lazy.test/720/list.m3u8':mediaPlaylist,
      'https://cdn.dom.test/master.m3u8':master,
      'https://cdn.dom.test/720/list.m3u8':mediaPlaylist
    });
    const snapshots=Object.fromEntries(cases.filter(test=>test.snapshot).map(test=>[test.page,test.snapshot]));
    await page.addInitScript(({replies,snapshots})=>{
      window.reported=false;window.enqueues=[];window.runtimeListeners=[];window.resources=[];
      const nativeEntries=performance.getEntriesByType.bind(performance);
      performance.getEntriesByType=type=>type==='resource'?window.resources:nativeEntries(type);
      window.snapshotState=snapshots[location.href] || null;
      window.chrome={storage:{local:{get:async()=>({})},onChanged:{addListener(){}}},runtime:{id:'fixture',
        onMessage:{addListener:fn=>window.runtimeListeners.push(fn)},
        sendMessage:async message=>{
          if(message.type==='ext-fetch-text'){
            const text=replies[message.url];return text ? {ok:true,text} : {ok:false,error:'Unmatched fixture URL'};
          }
          if(message.type==='media-detection-snapshot'){
            return window.snapshotState || {pageUrl:location.href,videoInfos:[]};
          }
          if(message.type==='media-detection-report')window.reported=true;
          if(message.type==='download-queue-enqueue')enqueues.push(message);
          return {success:true};
        }}};
    },{replies,snapshots});

    for(const test of cases){
      await page.goto(test.page);
      const pill=page.locator('.mediaflow-download-pill');
      await pill.waitFor();
      assert.equal(await pill.count(),1,test.page);
      if(test.fixed)assert.equal(await pill.getAttribute('data-page-download'),'');
      if(test.mount){
        assert.equal(await page.locator(`${test.mount} > .mediaflow-download-pill`).count(),1,`${test.page} mount ${test.mount}`);
      }
      if(test.childFrame){
        const frame=page.frames().find(frame=>frame.url()===test.childFrame);
        await frame.waitForFunction(()=>reported);
        assert.equal(await frame.locator('.mediaflow-download-pill').count(),0,`${test.page} child embed must use the outer button`);
      }
      if(test.expectLitLabel){
        await page.waitForFunction(expected=>document.querySelector('.mediaflow-download-quality span')?.textContent===expected,test.expectLitLabel);
      }
      await pill.locator('.mediaflow-download').hover();
      await pill.locator('.mediaflow-download-quality').click();
      if(test.latePlayer){
        await pill.getByRole('button',{name:test.quality,exact:true}).waitFor();
        await page.evaluate(markup=>document.querySelector('#loading-player').insertAdjacentHTML('afterend',markup),player);
      }
      if(test.expectedChoices){
        await pill.getByRole('button',{name:test.expectedChoices[0],exact:true}).waitFor();
        const actualChoices=(await pill.locator('.mediaflow-quality-option').allInnerTexts()).map(t=>t.replace(/\s+/g,' ').trim());
        assert.deepEqual(actualChoices,test.expectedChoices,test.page);
      }
      await pill.getByRole('button',{name:test.quality,exact:true}).click();
      assert.equal(await pill.locator('.mediaflow-download-quality span').textContent(),test.quality);
      await pill.locator('.mediaflow-download').click();
      await page.waitForFunction(()=>enqueues.length===1);
      const request=await page.evaluate(()=>enqueues[0]);
      assert.equal(request.url,test.url,test.page);assert.equal(request.pageUrl,test.page);
      if(test.check91){
        assert.deepEqual(request.headers,{Referer:test.page,Origin:'https://91porn.com'});
        const snapshot=await page.evaluate(async()=>{const {detectDocumentMedia}=await import('/assets/js/media-detection.js');return detectDocumentMedia().videoInfos.map(video=>video.videoUrl);});
        assert.deepEqual(snapshot,[test.url],'91porn detection must exclude preview clips');
      }
      if(test.headers)assert.deepEqual(request.headers,test.headers);
      console.log(`PASS: download button and selected source for ${new URL(test.page).hostname}`);
    }

    // 7b. Lazy stream via media-detection-updated invalidates empty resolved cache and populates open menu
    await page.goto('https://www.porntrex.com/video/88888/lazy-hls');
    const lazyPill=page.locator('#kt_player > .mediaflow-download-pill');
    await lazyPill.waitFor();
    await lazyPill.locator('.mediaflow-download').hover();
    await lazyPill.locator('.mediaflow-download-quality').click();
    await page.waitForFunction(()=>document.querySelector('.mediaflow-quality-note')?.textContent.includes('No downloadable qualities'));
    await page.evaluate(()=>{
      window.snapshotState={
        pageUrl:'https://www.porntrex.com/video/88888/lazy-hls',
        videoInfos:[
          {videoUrl:'https://cdn.lazy.test/720/list.m3u8',format:'m3u8',quality:720},
          {videoUrl:'https://cdn.lazy.test/master.m3u8',format:'m3u8',quality:'Auto'}
        ]
      };
      for(const fn of window.runtimeListeners)fn({type:'media-detection-updated',tabId:1},{id:'fixture'},()=>{});
    });
    await lazyPill.getByRole('button',{name:'1080p HLS',exact:true}).waitFor();
    const lazyChoices=(await lazyPill.locator('.mediaflow-quality-option').allInnerTexts()).map(t=>t.replace(/\s+/g,' ').trim());
    assert.deepEqual(lazyChoices,['1080p HLS','720p HLS']);
    await lazyPill.getByRole('button',{name:'720p HLS',exact:true}).click();
    await lazyPill.locator('.mediaflow-download').click();
    await page.waitForFunction(()=>enqueues.length===1);
    assert.equal(await page.evaluate(()=>enqueues[0].url),'https://cdn.lazy.test/720/list.m3u8');
    console.log('PASS: lazy media-detection-updated invalidates empty cache and expands multi-playlist HLS');

    // 7c. Lazy DOM/resource update lights up closed glass pill immediately without reopening
    await page.goto('https://lazy-dom.test/watch');
    const domPill=page.locator('.mediaflow-download-pill');
    await domPill.waitFor();
    assert.equal(await domPill.locator('.mediaflow-download-quality span').textContent(),'Quality');
    await page.evaluate(()=>{
      window.resources.push(
        {name:'https://cdn.dom.test/720/list.m3u8'},
        {name:'https://cdn.dom.test/master.m3u8'}
      );
      document.getElementById('main').dispatchEvent(new Event('loadedmetadata',{bubbles:true}));
    });
    await page.waitForFunction(()=>document.querySelector('.mediaflow-download-quality span')?.textContent==='720p HLS');
    await domPill.locator('.mediaflow-download').hover();
    await domPill.locator('.mediaflow-download-quality').click();
    await domPill.getByRole('button',{name:'1080p HLS',exact:true}).click();
    await domPill.locator('.mediaflow-download').click();
    await page.waitForFunction(()=>enqueues.length===1);
    assert.equal(await page.evaluate(()=>enqueues[0].url),'https://cdn.dom.test/1080/list.m3u8');
    console.log('PASS: closed pill lights up immediately on lazy DOM/resource stream discovery');

    await page.goto('https://91porn.com/index.php');
    await page.waitForTimeout(500);
    assert.equal(await page.locator('.mediaflow-download-pill').count(),0,'homepage previews must not get download buttons');
    assert.deepEqual(await page.evaluate(async()=>{const {detectDocumentMedia}=await import('/assets/js/media-detection.js');return detectDocumentMedia().videoInfos;}),[]);
    assert.deepEqual(errors,[],'no uncaught page errors');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
