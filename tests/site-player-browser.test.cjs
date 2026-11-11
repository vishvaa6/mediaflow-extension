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
const embed='https://javplayer.cc/e/example?token=a%2Bb';
const cases=[
  {page:'https://123av.com/en/v/example',html:`<div id="embed"><iframe width="420" height="240" src="${embed}"></iframe></div>`,mount:'#embed',
    quality:'720p HLS',url:'https://cdn.test/720/list.m3u8',headers:{Origin:'https://javplayer.cc',Referer:'https://javplayer.cc/'},replies:{
      'https://javplayer.cc/stream?token=a%2Bb&id=example':JSON.stringify({media:{stream:'https://cdn.test/master.m3u8'}}),
      'https://cdn.test/master.m3u8':master
    }},
  {page:'https://www.pornhub.org/view_video.php?viewkey=sample',html:player+preview+'<script>var flashvars_1={"mediaDefinitions":[{"format":"mp4","videoUrl":"/api/streams"}]};</script>',
    quality:'480p MP4',url:source('ph-480'),replies:{'https://www.pornhub.org/api/streams':JSON.stringify([{quality:480,videoUrl:source('ph-480')},{quality:720,videoUrl:source('ph-720')}])}},
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
    fixed:true,quality:'720p MP4',url:source('generic')}
];

(async()=>{
  const browser=await chromium.launch({executablePath:process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  try{
    const page=await browser.newPage({viewport:{width:640,height:480}});
    const fixtures=new Map(cases.map(test=>[test.page,test]));
    const loader='<link rel="stylesheet" href="/assets/css/player-download.css"><script type="module">import {installMediaDetection} from "/assets/js/media-detection.js";installMediaDetection();</script>';
    await page.route('**/*',async route=>{
      const url=new URL(route.request().url()),test=fixtures.get(url.href);
      if(test)return route.fulfill({contentType:'text/html',body:`<!doctype html><title>Player fixture</title>${loader}${test.html}`});
      if(url.href===embed)return route.fulfill({contentType:'text/html',body:`<!doctype html>${loader}<video width="320" height="180" preload="none" src="https://cdn.test/embed.mp4"></video>`});
      if(!/^\/assets\/(?:js|css)\/[\w.-]+\.(?:js|css)$/.test(url.pathname))return route.fulfill({status:404,body:''});
      const file=path.join(root,url.pathname);
      try{return await route.fulfill({contentType:file.endsWith('.css')?'text/css':'text/javascript',body:fs.readFileSync(file)});}
      catch{return route.fulfill({status:404,body:''});}
    });
    await page.addInitScript(replies=>{
      window.reported=false;window.enqueues=[];
      window.chrome={storage:{local:{get:async()=>({})},onChanged:{addListener(){}}},runtime:{id:'fixture',onMessage:{addListener(){}},
        sendMessage:async message=>{
          if(message.type==='ext-fetch-text'){
            const text=replies[message.url];return text ? {ok:true,text} : {ok:false,error:'Unmatched fixture URL'};
          }
          if(message.type==='media-detection-report')window.reported=true;
          if(message.type==='download-queue-enqueue')enqueues.push(message);
          return {success:true};
        }}};
    },Object.assign({},...cases.map(test=>test.replies || {})));

    for(const test of cases){
      await page.goto(test.page);
      const pill=page.locator('.mediaflow-download-pill');
      await pill.waitFor();
      assert.equal(await pill.count(),1,test.page);
      if(test.fixed)assert.equal(await pill.getAttribute('data-page-download'),'');
      if(test.mount){
        assert.equal(await page.locator(`${test.mount} > .mediaflow-download-pill`).count(),1);
        const frame=page.frames().find(frame=>frame.url()===embed);
        await frame.waitForFunction(()=>reported);
        assert.equal(await frame.locator('.mediaflow-download-pill').count(),0,'the 123av embed uses the outer button');
      }
      await pill.locator('.mediaflow-download').hover();
      await pill.locator('.mediaflow-download-quality').click();
      if(test.latePlayer){
        await pill.getByRole('button',{name:test.quality,exact:true}).waitFor();
        await page.evaluate(markup=>document.querySelector('#loading-player').insertAdjacentHTML('afterend',markup),player);
      }
      await pill.getByRole('button',{name:test.quality,exact:true}).click();
      assert.equal(await pill.locator('.mediaflow-download-quality span').textContent(),test.quality);
      await pill.locator('.mediaflow-download').click();
      await page.waitForFunction(()=>enqueues.length===1);
      const request=await page.evaluate(()=>enqueues[0]);
      assert.equal(request.url,test.url,test.page);assert.equal(request.pageUrl,test.page);
      if(test.headers)assert.deepEqual(request.headers,test.headers);
      console.log(`PASS: download button and selected source for ${new URL(test.page).hostname}`);
    }
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
