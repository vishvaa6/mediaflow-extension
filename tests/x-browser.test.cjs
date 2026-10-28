const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const runtime=process.env.CODEX_NODE_MODULES || 'C:/Users/vishv/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const {chromium}=require(path.join(runtime,'playwright'));
const root=path.resolve(__dirname,'..');
const firstId='2050000000000000001',secondId='2050000000000000002',fallbackId='2050000000000000003';
const viewportId='2050000000000000004';
const pageUrl=id=>`https://x.com/example/status/${id}`;
const media=(name,quality)=>`https://video.twimg.com/amplify_video/${name}/vid/avc1/${quality===720?'1280x720':'640x360'}/clip.mp4?tag=12`;
const detail=name=>({type:'video',media_url_https:`https://pbs.twimg.com/ext_tw_video_thumb/${name}/poster.jpg`,video_info:{variants:[{url:media(name,360)},{url:media(name,720)}]}});
const tweet=(id,name)=>({rest_id:id,legacy:{id_str:id,full_text:'Video '+name,extended_entities:{media:[detail(name)]}}});
const graph={data:{entries:[{tweet_results:{result:tweet(firstId,'first')}},{tweet_results:{result:{__typename:'TweetWithVisibilityResults',tweet:tweet(secondId,'second')}}}]},private_data:{cookie:'must-not-cross-the-bridge',authorization:'must-not-cross-the-bridge'}};
const viewportTweet=tweet(viewportId,'third');viewportTweet.legacy.extended_entities.media.push(detail('third-alt'));
graph.data.entries.push({tweet_results:{result:viewportTweet}});
const card=(id,name,style='')=>`<article data-testid="tweet" id="card-${name}" style="height:1200px;width:480px;${style}"><a href="/example/status/${id}"><time>Now</time></a><div data-testid="tweetText">Video ${name}</div><div data-testid="videoPlayer" style="width:480px;height:240px"><video style="width:100%;height:100%" poster="${detail(name).media_url_https}" src="blob:https://x.com/player-${name}"></video></div></article>`;

(async()=>{
  const browser=await chromium.launch({executablePath:process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  try{
    const context=await browser.newContext();
    const errors=[];
    context.on('page',page=>page.on('pageerror',error=>errors.push(error.message)));
    // All URLs are routed to fixtures. This test never contacts X or a live CDN.
    await context.route('**/*',async route=>{
      const url=new URL(route.request().url());
      if(url.hostname==='pbs.twimg.com')return route.fulfill({contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aU1cAAAAASUVORK5CYII=','base64')});
      if(url.pathname.includes('/i/api/'))return route.fulfill({contentType:'application/json',body:JSON.stringify(graph)});
      if(url.pathname==='/home')return route.fulfill({contentType:'text/html',body:`<!doctype html><title>X timeline</title><style>body{margin:0}article{box-sizing:border-box}video{display:block}</style>${card(firstId,'first')}${card(secondId,'second')}${card(secondId,'hidden','display:none')}<div style="height:0;overflow:hidden">${card(secondId,'clipped')}</div><script src="/src/pages/xMain/index.js"></script>`});
      if(url.pathname.startsWith('/example/status/'))return route.fulfill({contentType:'text/html',body:'<!doctype html><title>X post</title><video src="blob:https://x.com/unusable-player-source"></video><script src="/src/pages/xMain/index.js"></script>'});
      const file=path.resolve(root,'.'+url.pathname);
      if(!file.startsWith(root+path.sep))return route.abort();
      try{return await route.fulfill({contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html',body:fs.readFileSync(file)});}catch{return route.fulfill({status:404,body:''});}
    });
    await context.addInitScript(()=>{
      window.messages=[];window.runtimeListeners=[];window.bridgeEvents=[];window.publicPost={};window.fallbackHeld=false;
      document.addEventListener('mediaflow:x:media',event=>bridgeEvents.push(event.detail));
      window.chrome={runtime:{id:'x-test',onMessage:{addListener:fn=>runtimeListeners.push(fn)},sendMessage:async message=>{
        messages.push(message);
        if(message.type==='ext-fetch-text'){
          const id=new URL(message.url).searchParams.get('id');
          if(fallbackHeld)await new Promise(resolve=>window.releaseFallback=resolve);
          return {ok:true,text:JSON.stringify(publicPost[id] || {})};
        }
        return {success:true};
      }}};
    });
    const page=await context.newPage();
    await page.goto(pageUrl(firstId));
    // Capture before isolated-world detection starts; the handshake must replay it.
    const original=await page.evaluate(async()=>{
      const response=await fetch('/i/api/graphql/fixture/TweetDetail');return response.json();
    });
    assert.equal(original.private_data.cookie,'must-not-cross-the-bridge');
    await page.waitForFunction(()=>bridgeEvents.length>0);
    assert.equal((await page.evaluate(()=>bridgeEvents.join(''))).includes('must-not-cross-the-bridge'),false);
    await page.evaluate(async()=>{const {installMediaDetection}=await import('/assets/js/media-detection.js');installMediaDetection();});
    await page.waitForFunction(()=>messages.some(message=>message.type==='media-detection-report' && message.videoInfos.length===2));
    const snapshot=()=>page.evaluate(()=>new Promise(resolve=>{
      for(const listener of runtimeListeners)listener({command:'get_generic_video_info'},{id:'x-test'},resolve);
    }));
    let result=await snapshot();
    assert.deepEqual(result.videoInfos.map(video=>video.quality),[360,720]);
    assert.ok(result.videoInfos.every(video=>video.videoUrl.includes('/first/')));
    assert.equal(await page.evaluate(()=>messages.filter(message=>message.type==='ext-fetch-text').length),0,'observed responses should avoid a second metadata request');
    await page.evaluate(url=>history.pushState({},'',url),pageUrl(secondId));
    await page.waitForFunction(()=>messages.some(message=>message.type==='media-detection-report' && message.pageUrl.endsWith('2050000000000000002')));
    result=await snapshot();
    assert.ok(result.videoInfos.every(video=>video.videoUrl.includes('/second/')));
    assert.equal(result.videoInfos.length,2,'cached preloaded posts survive X SPA navigation');
    // Exercise XMLHttpRequest independently of fetch.
    await page.reload();
    await page.evaluate(async()=>{
      await new Promise((resolve,reject)=>{const xhr=new XMLHttpRequest();xhr.open('GET','/i/api/graphql/fixture/TweetDetail');xhr.responseType='json';xhr.onload=resolve;xhr.onerror=reject;xhr.send();});
      const {installMediaDetection}=await import('/assets/js/media-detection.js');installMediaDetection();
    });
    assert.equal((await snapshot()).videoInfos.length,2);
    // A late fallback for a previous post must never replace the current post.
    await page.evaluate(({id,url})=>{
      publicPost[id]={id_str:id,text:'Public fallback',mediaDetails:[{type:'animated_gif',video_info:{variants:[{url:'https://video.twimg.com/tweet_video/fallback.mp4'}]}}]};
      fallbackHeld=true;history.pushState({},'',url);
    },{id:fallbackId,url:pageUrl(fallbackId)});
    await page.waitForFunction(()=>typeof releaseFallback==='function');
    await page.evaluate(url=>{history.pushState({},'',url);releaseFallback();fallbackHeld=false;},pageUrl(firstId));
    await page.waitForFunction(()=>messages.some(message=>message.type==='media-detection-report' && message.pageUrl.endsWith('2050000000000000001')));
    result=await snapshot();assert.ok(result.videoInfos.every(video=>video.videoUrl.includes('/first/')));
    await page.evaluate(url=>history.pushState({},'',url),pageUrl(fallbackId));
    await page.waitForFunction(()=>messages.some(message=>message.type==='media-detection-report' && message.videoInfos.some(video=>video.videoUrl.includes('fallback.mp4'))));
    assert.equal((await snapshot()).videoInfos[0].format,'mp4');
    await page.evaluate(()=>history.pushState({},'','/home'));
    assert.equal((await snapshot()).videoInfos.length,0,'timeline must clear the previous post');

    // Actual viewport geometry on a timeline: no post navigation, playback,
    // or Refresh click is needed. Scroll and recycled cards drive reports.
    const timeline=await context.newPage();
    await timeline.setViewportSize({width:600,height:500});
    await timeline.goto('https://x.com/home');
    await timeline.evaluate(async()=>{
      await (await fetch('/i/api/graphql/fixture/HomeTimeline')).json();
      const {installMediaDetection}=await import('/assets/js/media-detection.js');installMediaDetection();
    });
    const waitViewport=names=>timeline.waitForFunction(expected=>{
      const report=messages.filter(message=>message.type==='media-detection-report').at(-1);
      if(!report)return false;
      const actual=[...new Set(report.videoInfos.map(video=>new URL(video.videoUrl).pathname.split('/')[2]))].sort();
      return JSON.stringify(actual)===JSON.stringify([...expected].sort());
    },names);
    await waitViewport(['first']);
    assert.equal(await timeline.evaluate(()=>messages.filter(message=>message.type==='ext-fetch-text').length),0);
    await timeline.evaluate(()=>scrollTo(0,450));
    await waitViewport([]);
    await timeline.evaluate(()=>scrollTo(0,1200));
    await waitViewport(['second']);
    await timeline.evaluate(({id,poster})=>{
      const card=document.getElementById('card-second');card.querySelector('a').href='/example/status/'+id;
      card.querySelector('video').poster=poster;card.querySelector('[data-testid="tweetText"]').textContent='Recycled card';
    },{id:viewportId,poster:detail('third-alt').media_url_https});
    await waitViewport(['third-alt']);
    assert.equal(await timeline.evaluate(()=>messages.filter(message=>message.type==='media-detection-report').at(-1).videoInfos[0].pageUrl),`https://x.com/i/status/${viewportId}/video/2`);
    await timeline.evaluate(()=>{
      document.getElementById('card-first').style.height='340px';
      document.getElementById('card-second').style.height='340px';scrollTo(0,0);
    });
    await waitViewport(['first','third-alt']);
    const viewportSnapshot=await timeline.evaluate(()=>new Promise(resolve=>{
      for(const listener of runtimeListeners)listener({command:'get_generic_video_info'},{id:'x-test'},resolve);
    }));
    assert.equal(viewportSnapshot.videoInfos.length,4,'both visible players and their qualities are detected; hidden, clipped and offscreen media are excluded');
    assert.equal(viewportSnapshot.pageUrl,'https://x.com/home');

    // Open the real popup against the detected X snapshot with browser API mocks.
    const popup=await context.newPage();
    const popupSnapshot=viewportSnapshot;
    await popup.addInitScript(({snapshot})=>{
      const changed=[],localChanged=[],values={downloadQueueState:{tasks:[]},m3u8DownloadHistory:{records:[]}};
      const local={onChanged:{addListener:fn=>localChanged.push(fn)},get:async keys=>Object.fromEntries((Array.isArray(keys)?keys:[keys]).map(key=>[key,structuredClone(values[key])])),set:async patch=>{Object.assign(values,patch);for(const fn of changed)fn(Object.fromEntries(Object.entries(patch).map(([key,value])=>[key,{newValue:value}])),'local');}};
      window.xSnapshot=snapshot;window.enqueues=[];window.forceRequests=[];
      window.chrome={i18n:{getMessage:()=>''},storage:{local,onChanged:{addListener:fn=>changed.push(fn)}},runtime:{id:'x-popup',onMessage:{addListener:fn=>runtimeListeners.push(fn)},sendMessage(message,callback){
        if(message.type==='download-queue-enqueue')enqueues.push(message);
        // An empty background cache must not overwrite a fresh content snapshot.
        const result=message.type==='media-detection-snapshot'?{site:'x',pageUrl:xSnapshot.pageUrl,videoInfos:[]}:{success:true,state:{tasks:[]}};
        callback?.(result);return Promise.resolve(result);
      }},tabs:{query:(_,callback)=>callback([{id:1,url:snapshot.pageUrl,title:'X post'}]),sendMessage:(_,message,callback)=>{
        if(message.command==='get_generic_video_info'){forceRequests.push(message.refresh);callback(structuredClone(xSnapshot));}else callback({videoInfos:[]});
      }}};
    },{snapshot:popupSnapshot});
    await popup.goto('https://x.com/src/pages/popup/index.html');
    await popup.waitForSelector('.qualities-list .quality-row');
    assert.deepEqual(await popup.locator('.qualities-list .quality-badge').allTextContents(),['360','720','360','720']);
    assert.equal(await popup.locator('[data-x-video-page]').count(),2);
    await popup.locator('.btn-download-action').nth(1).click();
    const queued=await popup.evaluate(()=>enqueues[0]);
    assert.equal(queued.url,media('first',720));assert.equal(queued.pageUrl,`https://x.com/i/status/${firstId}/video/1`);
    assert.match(queued.title,/Video first/);assert.deepEqual(queued.headers,{Origin:'https://x.com',Referer:'https://x.com/'});
    await popup.locator('.btn-download-action').last().click();
    const secondQueued=await popup.evaluate(()=>enqueues[1]);
    assert.equal(secondQueued.url,media('third-alt',720));assert.equal(secondQueued.pageUrl,`https://x.com/i/status/${viewportId}/video/2`);
    assert.match(secondQueued.fileName,/Video third/);assert.notEqual(secondQueued.fileName,queued.fileName);
    fs.mkdirSync(path.join(root,'test-results'),{recursive:true});
    await popup.screenshot({path:path.join(root,'test-results/x-viewport-popup.png'),fullPage:true});
    await popup.locator('#btn-refresh-detection').click();
    assert.equal(await popup.evaluate(()=>forceRequests.at(-1)),true);
    await popup.evaluate(()=>{xSnapshot={site:'x',pageUrl:'https://x.com/home',videoInfos:[]};for(const listener of runtimeListeners)listener({type:'media-detection-updated',tabId:1});});
    await popup.waitForFunction(()=>document.querySelectorAll('.qualities-list .quality-row').length===0);
    assert.match(await popup.locator('.profile-scan-status').innerText(),/detected automatically/);
    assert.deepEqual(errors,[]);
    console.log('PASS: X viewport auto-detection on timelines, scroll/remove/insert updates, hidden/clipped players excluded, recycled multi-video cards, fetch/XHR metadata, fallback races and per-video popup enqueue.');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
