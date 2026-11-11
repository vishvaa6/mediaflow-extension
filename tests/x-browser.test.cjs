const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const runtime=process.env.CODEX_NODE_MODULES || 'C:/Users/vishv/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const {chromium}=require(path.join(runtime,'playwright'));
const root=path.resolve(__dirname,'..');
const glass='<link rel="stylesheet" href="/assets/css/player-download.css">';
const firstId='2050000000000000001',secondId='2050000000000000002',fallbackId='2050000000000000003';
const viewportId='2050000000000000004';
const hlsId='2050000000000000005',hlsUrl='https://video.twimg.com/amplify_video/hls-post/pl/master.m3u8';
const pageUrl=id=>`https://x.com/example/status/${id}`;
const media=(name,quality)=>`https://video.twimg.com/amplify_video/${name}/vid/avc1/${quality===720?'1280x720':'640x360'}/clip.mp4?tag=12`;
const detail=name=>({type:'video',media_url_https:`https://pbs.twimg.com/ext_tw_video_thumb/${name}/poster.jpg`,video_info:{variants:[{url:media(name,360)},{url:media(name,720)}]}});
const tweet=(id,name)=>({rest_id:id,legacy:{id_str:id,full_text:'Video '+name,extended_entities:{media:[detail(name)]}}});
const graph={data:{entries:[{tweet_results:{result:tweet(firstId,'first')}},{tweet_results:{result:{__typename:'TweetWithVisibilityResults',tweet:tweet(secondId,'second')}}}]},private_data:{cookie:'must-not-cross-the-bridge',authorization:'must-not-cross-the-bridge'}};
const viewportTweet=tweet(viewportId,'third');viewportTweet.legacy.extended_entities.media.push(detail('third-alt'));
graph.data.entries.push({tweet_results:{result:viewportTweet}});
const hlsTweet=tweet(hlsId,'hls-post');hlsTweet.legacy.extended_entities.media[0].video_info.variants.push({url:hlsUrl});
graph.data.entries.push({tweet_results:{result:hlsTweet}});
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
      if(url.pathname==='/root-scroll')return route.fulfill({contentType:'text/html',body:`<!doctype html><title>Scrolled X fixture</title>${glass}<style>html,body{height:100%;margin:0}html{overflow:auto}.spacer{height:950px}article{height:400px;width:480px}video{display:block}</style><div class="spacer"></div>${card(firstId,'first')}<script src="/src/pages/xMain/index.js"></script>`});
      if(url.pathname==='/home')return route.fulfill({contentType:'text/html',body:`<!doctype html><title>X timeline</title>${glass}<style>body{margin:0}article{box-sizing:border-box}video{display:block}</style>${card(firstId,'first')}${card(secondId,'second')}${card(secondId,'hidden','display:none')}<div style="height:0;overflow:hidden">${card(secondId,'clipped')}</div><script src="/src/pages/xMain/index.js"></script>`});
      if(url.pathname.startsWith('/example/status/'))return route.fulfill({contentType:'text/html',body:`<!doctype html><title>X post</title>${glass}<video src="blob:https://x.com/unusable-player-source"></video><script src="/src/pages/xMain/index.js"></script>`});
      const file=path.resolve(root,'.'+url.pathname);
      if(!file.startsWith(root+path.sep))return route.abort();
      try{return await route.fulfill({contentType:file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html',body:fs.readFileSync(file)});}catch{return route.fulfill({status:404,body:''});}
    });
    await context.addInitScript(()=>{
      window.messages=[];window.runtimeListeners=[];window.bridgeEvents=[];window.bridgeRequests=0;window.publicPost={};window.fallbackHeld=false;window.hlsPlaylists={};
      window.fixtureStorage={'download-settings':{outputFormat:'source'},downloadQueueState:{tasks:[]}};window.enqueueFailure='';window.holdSettings=false;
      const changes=[];
      const local={get:async keys=>{if(keys==='download-settings' && holdSettings){await new Promise(resolve=>window.releaseSettings=resolve);window.settingsReturned=true;}return Object.fromEntries((Array.isArray(keys)?keys:[keys]).filter(key=>key in fixtureStorage).map(key=>[key,structuredClone(fixtureStorage[key])]));},
        set:async patch=>{const delta={};for(const [key,value]of Object.entries(patch)){delta[key]={oldValue:fixtureStorage[key],newValue:structuredClone(value)};fixtureStorage[key]=structuredClone(value);}for(const listener of changes)listener(delta,'local');}};
      document.addEventListener('mediaflow:x:media',event=>bridgeEvents.push(event.detail));
      document.addEventListener('mediaflow:x:request',()=>bridgeRequests++);
      window.chrome={storage:{local,onChanged:{addListener:fn=>changes.push(fn)}},runtime:{id:'x-test',onMessage:{addListener:fn=>runtimeListeners.push(fn)},sendMessage:async message=>{
        if(window.invalidForQueue && message.type==='download-queue-enqueue')throw Error('Extension context invalidated.');
        messages.push(message);
        if(message.type==='download-queue-enqueue'){
          if(enqueueFailure)return {success:false,error:enqueueFailure};
          await local.set({downloadQueueState:{tasks:[...fixtureStorage.downloadQueueState.tasks,{id:String(messages.length),pageUrl:message.pageUrl,status:'queued'}]}});
          return {success:true};
        }
        if(message.type==='ext-fetch-text'){
          if(message.url in hlsPlaylists)return {ok:true,text:hlsPlaylists[message.url]};
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
    await timeline.waitForTimeout(400);
    const requestsBeforeScroll=await timeline.evaluate(()=>bridgeRequests);
    await timeline.evaluate(async()=>{for(let i=0;i<3;i++){dispatchEvent(new Event('scroll'));await new Promise(resolve=>setTimeout(resolve,160));}});
    assert.equal(await timeline.evaluate(()=>bridgeRequests),requestsBeforeScroll,'unchanged visible posts must not repeatedly request the same metadata');
    await timeline.evaluate(async()=>chrome.storage.local.set({downloadQueueState:{tasks:[{id:'progress-fixture',pageUrl:'https://x.com/other/status/2050000000000000999',status:'downloading',cachedBytes:0}]}}));
    await timeline.waitForTimeout(200);
    await timeline.evaluate(()=>{
      window.buttonMutations=0;window.buttonObserver=new MutationObserver(changes=>{buttonMutations+=changes.length;});
      buttonObserver.observe(document.querySelector('#card-first .mediaflow-download'),{attributes:true,attributeFilter:['aria-label']});
    });
    await timeline.evaluate(async()=>{for(let i=1;i<=10;i++)await chrome.storage.local.set({downloadQueueState:{tasks:[{id:'progress-fixture',pageUrl:'https://x.com/other/status/2050000000000000999',status:'downloading',cachedBytes:i}]}});});
    await timeline.waitForTimeout(250);
    assert.equal(await timeline.evaluate(()=>buttonMutations),0,'byte-only queue updates must not resync player controls');
    await timeline.evaluate(async()=>{buttonObserver.disconnect();await chrome.storage.local.set({downloadQueueState:{tasks:[]}});});
    assert.equal(await timeline.evaluate(()=>messages.filter(message=>message.type==='ext-fetch-text').length),0);
    const firstButton=timeline.locator('#card-first .mediaflow-download');
    await firstButton.waitFor();assert.equal(await firstButton.getAttribute('aria-label'),'Download video');
    assert.equal(await timeline.locator('#card-hidden .mediaflow-download').count(),0,'hidden videos must not get controls');
    const firstPill=timeline.locator('#card-first .mediaflow-download-pill'),firstQuality=timeline.locator('#card-first .mediaflow-download-quality');
    const firstMenu=firstPill.locator('.mediaflow-quality-menu');
    const circle=await firstPill.boundingBox(),buttonBefore=await firstButton.boundingBox();assert.ok(circle.width<=37,'the control starts as a small circle');
    await firstButton.hover();await timeline.waitForFunction(()=>document.querySelector('#card-first .mediaflow-download-pill').getBoundingClientRect().width>120);
    const expanded=await firstPill.boundingBox(),buttonAfter=await firstButton.boundingBox();
    assert.ok(expanded.width>120 && Math.abs(buttonBefore.x-buttonAfter.x)<2,'the pill expands to the left without moving the download icon');
    const qualityBox=await firstQuality.boundingBox();
    assert.ok(Math.abs(qualityBox.y+qualityBox.height/2-buttonAfter.y-buttonAfter.height/2)<1,'quality and download are vertically aligned');
    const glint=firstPill.locator('.mediaflow-glint');
    const glintOffset=()=>glint.evaluate(node=>parseFloat(getComputedStyle(node).backgroundPositionX));
    await firstQuality.hover();
    const leftHighlight=await glintOffset();
    await firstButton.hover();
    assert.ok(await glintOffset()<leftHighlight-20,'the glass highlight follows the pointer along the fixed rim');
    await timeline.mouse.move(590,490);
    await timeline.waitForFunction(()=>document.querySelector('#card-first .mediaflow-download-pill').getBoundingClientRect().width<37);
    await firstQuality.focus();
    await timeline.waitForFunction(()=>document.querySelector('#card-first .mediaflow-download-pill').getBoundingClientRect().width>120);
    assert.equal(await firstQuality.evaluate(node=>document.activeElement===node),true,'keyboard focus expands the quality picker');
    await timeline.emulateMedia({reducedMotion:'reduce'});
    assert.equal(await firstPill.evaluate(node=>getComputedStyle(node).transitionDuration),'0s','reduced motion disables the animation');
    await timeline.emulateMedia({reducedMotion:'no-preference'});
    await firstQuality.press('Enter');
    await firstMenu.waitFor();
    assert.deepEqual((await firstMenu.getByRole('button').allTextContents()).map(text=>text.trim()),['720p MP4','360p MP4']);
    assert.equal((await firstMenu.getByRole('button',{pressed:true}).textContent()).trim(),'720p MP4','highest MP4 is the default');
    await timeline.keyboard.press('Escape');
    assert.equal(await firstQuality.getAttribute('aria-expanded'),'false','the menu closes logically before its exit animation ends');
    await firstMenu.waitFor({state:'hidden'});
    await firstQuality.click();await firstMenu.getByRole('button',{name:'360p MP4'}).click();
    await timeline.mouse.move(590,490);
    await timeline.waitForFunction(()=>document.querySelector('#card-first .mediaflow-download-pill').getBoundingClientRect().width<37);
    await timeline.evaluate(()=>scrollTo(0,450));await waitViewport([]);
    await timeline.evaluate(()=>scrollTo(0,0));await waitViewport(['first']);
    await firstButton.hover();assert.equal(await firstQuality.locator('span').textContent(),'360p MP4','quality selection survives scrolling');
    fs.mkdirSync(path.join(root,'test-results'),{recursive:true});
    await timeline.screenshot({path:path.join(root,'test-results/x-download-button-expanded.png')});
    await timeline.evaluate(()=>document.querySelector('#card-first .mediaflow-download').click());
    assert.equal(await timeline.evaluate(()=>messages.filter(message=>message.type==='download-queue-enqueue').length),0,'page scripts must not trigger downloads');
    await timeline.evaluate(()=>{window.videoClicks=0;document.querySelector('#card-first [data-testid="videoPlayer"]').addEventListener('click',()=>videoClicks++);enqueueFailure='Pending queue is full';});
    await firstButton.click();
    await timeline.waitForFunction(()=>document.querySelector('#card-first .mediaflow-download-message')?.textContent.includes('Pending queue is full'));
    assert.equal(await firstButton.isEnabled(),true,'failed enqueue must be retryable');
    await timeline.evaluate(()=>{enqueueFailure='';});await firstButton.focus();await firstButton.press('Enter');
    await timeline.waitForFunction(()=>document.querySelector('#card-first .mediaflow-download')?.disabled);
    const directEnqueues=await timeline.evaluate(()=>messages.filter(message=>message.type==='download-queue-enqueue'));
    assert.equal(directEnqueues.length,2);assert.equal(directEnqueues[1].url,media('first',360));assert.equal(directEnqueues[1].quality,'360');
    assert.equal(directEnqueues[1].pageUrl,`https://x.com/i/status/${firstId}/video/1`);assert.equal(directEnqueues[1].outputFormat,'source');
    assert.deepEqual(directEnqueues[1].headers,{Origin:'https://x.com',Referer:'https://x.com/'});
    assert.equal(await timeline.evaluate(()=>videoClicks),0,'the download button must not toggle playback');
    await timeline.evaluate(()=>{
      const first=document.getElementById('card-first');first.style.height='300px';
      const clone=first.cloneNode(true);clone.id='clone-first';clone.style.height='300px';first.after(clone);
    });
    await timeline.waitForFunction(()=>document.querySelector('#clone-first .mediaflow-download')?.disabled===true);
    assert.equal(await timeline.locator('#clone-first .mediaflow-download').count(),1,'cloned cards must not gain a second control');
    assert.equal(await timeline.locator('#clone-first .mediaflow-download').getAttribute('aria-label'),'Video is already in the download queue');
    await timeline.evaluate(()=>{document.getElementById('clone-first').remove();document.getElementById('card-first').style.height='1200px';});
    await timeline.evaluate(()=>scrollTo(0,450));
    await waitViewport([]);
    await timeline.waitForFunction(()=>!document.querySelector('#card-first .mediaflow-download'));
    await timeline.evaluate(()=>scrollTo(0,1200));
    await waitViewport(['second']);
    await timeline.evaluate(({id,poster})=>{
      const card=document.getElementById('card-second');card.querySelector('a').href='/example/status/'+id;
      card.querySelector('video').poster=poster;card.querySelector('[data-testid="tweetText"]').textContent='Recycled card';
    },{id:viewportId,poster:detail('third-alt').media_url_https});
    await waitViewport(['third-alt']);
    assert.equal(await timeline.evaluate(()=>messages.filter(message=>message.type==='media-detection-report').at(-1).videoInfos[0].pageUrl),`https://x.com/i/status/${viewportId}/video/2`);
    const recycledButton=timeline.locator('#card-second .mediaflow-download');await recycledButton.waitFor();
    await timeline.evaluate(()=>{holdSettings=true;});await recycledButton.click();
    await timeline.waitForFunction(()=>typeof releaseSettings==='function');
    await timeline.evaluate(({id,poster})=>{const card=document.getElementById('card-second');card.querySelector('a').href='/example/status/'+id;card.querySelector('video').poster=poster;},{id:secondId,poster:detail('second').media_url_https});
    await waitViewport(['second']);
    await timeline.evaluate(()=>{holdSettings=false;releaseSettings();});
    await timeline.waitForFunction(()=>settingsReturned===true);await timeline.evaluate(()=>new Promise(requestAnimationFrame));
    assert.equal(await timeline.evaluate(()=>messages.filter(message=>message.type==='download-queue-enqueue').length),2,'a recycled player must not queue stale media');
    assert.equal(await timeline.locator('#card-second .mediaflow-download-message').isVisible(),false,'stale errors must not appear on the new video');
    await timeline.evaluate(({id,poster})=>{const card=document.getElementById('card-second');card.querySelector('a').href='/example/status/'+id;card.querySelector('video').poster=poster;},{id:viewportId,poster:detail('third-alt').media_url_https});
    await waitViewport(['third-alt']);await recycledButton.click();
    await timeline.waitForFunction(()=>messages.filter(message=>message.type==='download-queue-enqueue').length===3);
    const recycled=await timeline.evaluate(()=>messages.filter(message=>message.type==='download-queue-enqueue').at(-1));
    assert.equal(recycled.url,media('third-alt',720));assert.equal(recycled.pageUrl,`https://x.com/i/status/${viewportId}/video/2`);
    assert.equal(await timeline.locator('#card-second .mediaflow-download').count(),1,'recycled players must retain only one control');
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

    const scrolled=await context.newPage();await scrolled.setViewportSize({width:600,height:500});await scrolled.goto('https://x.com/root-scroll');
    await scrolled.evaluate(async()=>{await (await fetch('/i/api/graphql/fixture/HomeTimeline')).json();const {installMediaDetection}=await import('/assets/js/media-detection.js');installMediaDetection();scrollTo(0,900);});
    await scrolled.waitForFunction(()=>document.documentElement.getBoundingClientRect().bottom<0);
    await scrolled.waitForSelector('#card-first .mediaflow-download');
    assert.equal(await scrolled.locator('#card-first .mediaflow-download').isVisible(),true,'the scrolling root must not hide visible videos');

    // Two bare video elements can share one wrapper; each button must still
    // point to its own player rather than reusing the first one's handler.
    const multi=await context.newPage();await multi.setViewportSize({width:800,height:600});await multi.goto(pageUrl(viewportId));
    await multi.evaluate(async({id,poster1,poster2})=>{
      document.body.innerHTML=`<article data-testid="tweet"><a href="/example/status/${id}"><time>Now</time></a><div id="shared-videos" style="display:flex;width:600px"><video style="width:280px;height:180px" poster="${poster1}"></video><video style="width:280px;height:180px" poster="${poster2}"></video></div></article>`;
      await (await fetch('/i/api/graphql/fixture/TweetDetail')).json();
      const {installMediaDetection}=await import('/assets/js/media-detection.js');installMediaDetection();
    },{id:viewportId,poster1:detail('third').media_url_https,poster2:detail('third-alt').media_url_https});
    await multi.waitForFunction(()=>document.querySelectorAll('#shared-videos .mediaflow-download').length===2);
    const buttonRects=await multi.locator('#shared-videos .mediaflow-download').evaluateAll(nodes=>nodes.map(node=>node.getBoundingClientRect().left));
    assert.ok(Math.abs(buttonRects[0]-buttonRects[1])>200,'controls must be positioned over their own videos');
    await multi.locator('#shared-videos .mediaflow-download').nth(1).hover();
    await multi.locator('#shared-videos .mediaflow-download-quality').nth(1).click();
    await multi.getByRole('group',{name:'Available video qualities'}).getByRole('button',{name:'360p MP4'}).click();
    await multi.locator('#shared-videos .mediaflow-download').nth(0).click();
    await multi.locator('#shared-videos .mediaflow-download').nth(1).click();
    const multiRequests=await multi.evaluate(()=>messages.filter(message=>message.type==='download-queue-enqueue'));
    assert.deepEqual(multiRequests.map(message=>message.url),[media('third',720),media('third-alt',360)]);
    assert.deepEqual(multiRequests.map(message=>message.pageUrl),[`https://x.com/i/status/${viewportId}/video/1`,`https://x.com/i/status/${viewportId}/video/2`]);

    const fallback=await context.newPage();await fallback.goto(pageUrl(fallbackId));
    await fallback.evaluate(async({id,poster})=>{
      document.body.innerHTML=`<article data-testid="tweet"><a href="/example/status/${id}"><time>Now</time></a><div data-testid="videoPlayer" style="width:480px;height:240px"><video style="width:480px;height:240px" poster="${poster}"></video></div></article>`;
      publicPost[id]={id_str:id,text:'Fallback video',mediaDetails:[{type:'video',media_url_https:poster,video_info:{variants:[{url:'https://video.twimg.com/amplify_video/fallback/vid/avc1/1280x720/clip.mp4'}]}}]};
      fallbackHeld=true;const {installMediaDetection}=await import('/assets/js/media-detection.js');installMediaDetection();
    },{id:fallbackId,poster:detail('fallback').media_url_https});
    await fallback.waitForFunction(()=>typeof releaseFallback==='function');
    await fallback.locator('.mediaflow-download').click();
    await fallback.evaluate(()=>{fallbackHeld=false;releaseFallback();});
    await fallback.waitForFunction(()=>messages.some(message=>message.type==='download-queue-enqueue'));
    const fallbackRequest=await fallback.evaluate(()=>messages.find(message=>message.type==='download-queue-enqueue'));
    assert.equal(fallbackRequest.pageUrl,`https://x.com/i/status/${fallbackId}/video/1`);assert.match(fallbackRequest.url,/\/fallback\//);

    const hls=await context.newPage();await hls.setViewportSize({width:330,height:228});await hls.goto(pageUrl(hlsId));
    const playlist=['#EXTM3U','#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",URI="audio.m3u8"',
      '#EXT-X-STREAM-INF:BANDWIDTH=2500000,RESOLUTION=1920x1080','1080.m3u8',
      '#EXT-X-STREAM-INF:BANDWIDTH=500000,RESOLUTION=640x360','360.m3u8',
      '#EXT-X-STREAM-INF:BANDWIDTH=900000,RESOLUTION=854x480','480.m3u8',
      '#EXT-X-STREAM-INF:BANDWIDTH=4000000,RESOLUTION=2560x1440,AUDIO="audio"','1440.m3u8',
      '#EXT-X-STREAM-INF:BANDWIDTH=750000,RESOLUTION=854x480','480-low.m3u8'].join('\n');
    await hls.evaluate(async({id,poster,url,playlist})=>{
      document.body.innerHTML=`<article data-testid="tweet"><a href="/example/status/${id}"><time>Now</time></a><div data-testid="videoPlayer" style="width:232px;height:124px;overflow:hidden;border-radius:16px;background:linear-gradient(125deg,#ab6377,#5c93cc 60%,#172131)"><video style="width:232px;height:124px" poster="${poster}"></video></div></article>`;
      hlsPlaylists[url]=playlist;
      await (await fetch('/i/api/graphql/fixture/TweetDetail')).json();
      const {installMediaDetection}=await import('/assets/js/media-detection.js');installMediaDetection();
    },{id:hlsId,poster:detail('hls-post').media_url_https,url:hlsUrl,playlist});
    const hlsButton=hls.locator('.mediaflow-download'),hlsQuality=hls.locator('.mediaflow-download-quality');
    const hlsMenu=hls.getByRole('group',{name:'Available video qualities'});
    await hls.waitForFunction(()=>document.querySelector('.mediaflow-download-quality span')?.textContent==='720p MP4');
    assert.equal(await hls.evaluate(url=>messages.some(message=>message.url===url),hlsUrl),false,'the HLS playlist is fetched only when the menu opens');
    await hlsButton.hover();await hlsQuality.click();
    await hlsMenu.getByRole('button',{name:'480p HLS'}).waitFor();
    assert.deepEqual((await hlsMenu.getByRole('button').allTextContents()).map(text=>text.trim()),['1080p HLS','720p MP4','480p HLS','360p MP4','360p HLS']);
    const menuBox=await hlsMenu.boundingBox();
    assert.ok(menuBox.x>=0 && menuBox.x+menuBox.width<=330 && menuBox.y+menuBox.height<=228,'the menu fits the narrow viewport');
    const qualityList=hlsMenu.locator('.mediaflow-quality-list');
    assert.ok(await qualityList.evaluate(list=>list.scrollHeight>list.clientHeight),'only the quality list scrolls in a short viewport');
    await hls.screenshot({path:path.join(root,'test-results/x-download-quality-menu.png'),animations:'disabled'});
    await qualityList.hover();await hls.mouse.wheel(0,100);
    await hls.waitForFunction(()=>document.querySelector('.mediaflow-quality-list').scrollTop>0);
    await hlsMenu.getByRole('button',{name:'480p HLS'}).click();await hlsButton.click();
    await hls.waitForFunction(()=>messages.some(message=>message.type==='download-queue-enqueue'));
    const hlsRequest=await hls.evaluate(()=>messages.find(message=>message.type==='download-queue-enqueue'));
    assert.equal(hlsRequest.url,new URL('480.m3u8',hlsUrl).href);assert.equal(hlsRequest.format,'m3u8');assert.equal(hlsRequest.quality,'480');

    // A reloaded extension invalidates old content scripts. Keep the page in
    // place until the user explicitly chooses to refresh and reconnect.
    const recovery=await context.newPage();await recovery.setViewportSize({width:600,height:500});await recovery.goto('https://x.com/home');
    await recovery.evaluate(async()=>{await (await fetch('/i/api/graphql/fixture/HomeTimeline')).json();const {installMediaDetection}=await import('/assets/js/media-detection.js');installMediaDetection();});
    await recovery.locator('#card-first .mediaflow-download').waitFor();
    await recovery.evaluate(()=>{window.marker='unsaved page state';window.invalidForQueue=true;});
    await recovery.locator('#card-first .mediaflow-download').click();
    const reconnect=recovery.locator('#card-first .mediaflow-download-message');
    await reconnect.getByRole('button',{name:'Refresh page'}).waitFor();
    assert.match(await reconnect.innerText(),/reloaded.*refresh.*reconnect/i);
    assert.doesNotMatch(await reconnect.innerText(),/context invalidated/i);
    assert.equal(await recovery.locator('#card-first .mediaflow-download').isDisabled(),true);
    assert.equal(await recovery.evaluate(()=>window.marker),'unsaved page state','the extension must not reload the page automatically');
    await recovery.waitForTimeout(5200);
    assert.equal(await reconnect.getByRole('button',{name:'Refresh page'}).isVisible(),true,'the recovery action remains available');
    await recovery.evaluate(()=>document.querySelector('#card-first .mediaflow-reconnect').click());
    assert.equal(await recovery.evaluate(()=>window.marker),'unsaved page state','page scripts must not trigger a refresh');
    await reconnect.getByRole('button',{name:'Refresh page'}).focus();
    await Promise.all([recovery.waitForNavigation(),reconnect.getByRole('button',{name:'Refresh page'}).press('Enter')]);
    await recovery.evaluate(async()=>{await (await fetch('/i/api/graphql/fixture/HomeTimeline')).json();const {installMediaDetection}=await import('/assets/js/media-detection.js');installMediaDetection();});
    await recovery.locator('#card-first .mediaflow-download').click();
    await recovery.waitForFunction(()=>messages.some(message=>message.type==='download-queue-enqueue'));

    const disconnected=await context.newPage();await disconnected.setViewportSize({width:600,height:500});await disconnected.goto('https://x.com/home');
    await disconnected.evaluate(async()=>{await (await fetch('/i/api/graphql/fixture/HomeTimeline')).json();const {installMediaDetection}=await import('/assets/js/media-detection.js');installMediaDetection();});
    await disconnected.locator('#card-first .mediaflow-download').waitFor();
    await disconnected.evaluate(()=>{const send=chrome.runtime.sendMessage;chrome.runtime.sendMessage=message=>{if(message.type==='media-detection-report')throw Error('Extension context invalidated.');return send(message);};history.pushState({},'','/home?changed=1');});
    await disconnected.locator('#card-first .mediaflow-download-message').getByRole('button',{name:'Refresh page'}).waitFor();
    assert.equal(await disconnected.locator('#card-first .mediaflow-download').isDisabled(),true,'a failed background report also offers recovery');

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
    await popup.evaluate(()=>{window.stablePopup=document.querySelector('#app-container .App');for(const listener of runtimeListeners)listener({type:'media-detection-updated',tabId:1});});
    await popup.waitForTimeout(200);
    assert.equal(await popup.evaluate(()=>window.stablePopup===document.querySelector('#app-container .App')),true,'unchanged detection snapshots must not rebuild the popup');
    await popup.evaluate(()=>{xSnapshot={site:'x',pageUrl:'https://x.com/home',videoInfos:[]};for(const listener of runtimeListeners)listener({type:'media-detection-updated',tabId:1});});
    await popup.waitForFunction(()=>document.querySelectorAll('.qualities-list .quality-row').length===0);
    assert.match(await popup.locator('.profile-scan-status').innerText(),/detected automatically/);
    assert.deepEqual(errors,[]);
    console.log('PASS: X viewport detection, player controls, context invalidation and user-directed refresh, metadata fallback and popup enqueue.');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
