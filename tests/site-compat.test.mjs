import test from 'node:test';
import assert from 'node:assert/strict';
import {extractMedia,resolveMedia} from '../assets/js/media-resolver.js';
import {mediaHeaders,exactRequestCondition} from '../assets/js/media-headers.js';
import {createMediaDiscovery} from '../assets/js/media-discovery.js';

const master='#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=100,RESOLUTION=1280x720\n720/list.m3u8?sig=fresh\n#EXT-X-STREAM-INF:BANDWIDTH=200,RESOLUTION=1920x1080\n1080/list.m3u8?sig=fresh';
test('123av refresh resolves the player API with its token and keeps iframe headers on quality variants',async()=>{
  const calls=[];
  const result=await resolveMedia('<title>Example</title><iframe class="player__frame" src="https://javplayer.cc/e/abc_123?token=a%2Bb&amp;expires=123"></iframe>','https://123av.com/en/v/example','720p',async(url,headers)=>{
    calls.push({url,headers});
    if(url.includes('/stream?')){
      const api=new URL(url);assert.equal(api.searchParams.get('id'),'abc_123');assert.equal(api.searchParams.get('token'),'a+b');assert.equal(api.searchParams.get('expires'),'123');
      assert.equal(headers.Origin,'https://javplayer.cc');assert.match(headers.Referer,/\/e\/abc_123\?/);
      return JSON.stringify({media:{stream:'https://cdn.test/master.m3u8?sig=fresh'}});
    }
    assert.deepEqual(headers,{Origin:'https://javplayer.cc',Referer:'https://javplayer.cc/'});return master;
  },{format:'m3u8',strictQuality:true});
  assert.equal(result.url,'https://cdn.test/720/list.m3u8?sig=fresh');assert.equal(result.quality,'720');
  assert.deepEqual(result.headers,{Origin:'https://javplayer.cc',Referer:'https://javplayer.cc/'});assert.equal(calls.length,2);
});

test('Pornhub domain aliases resolve MP4 metadata and HLS with the same requested quality',async()=>{
  const html='var flashvars_123 = '+JSON.stringify({mediaDefinitions:[{format:'mp4',videoUrl:'/api/streams'},{format:'hls',videoUrl:'https://cdn.test/master.m3u8'}]})+';';
  for(const host of ['pornhub.com','pornhub.org','pornhubpremium.com']){
    const fetcher=async url=>url.includes('/api/')?JSON.stringify([{videoUrl:'https://cdn.test/video.mp4',quality:'720'}]):master;
    assert.equal((await resolveMedia(html,`https://${host}/view_video.php?viewkey=example`,'720',fetcher,{format:'mp4',strictQuality:true})).format,'mp4');
    assert.equal((await resolveMedia(html,`https://${host}/view_video.php?viewkey=example`,'720',fetcher,{format:'m3u8',strictQuality:true})).format,'m3u8');
  }
});

test('XVideos and XNXX aliases resolve High/Low/HLS player sources',async()=>{
  const html='html5player.setVideoHLS("https://cdn.test/master.m3u8");html5player.setVideoUrlHigh("https://cdn.test/high.mp4");html5player.setVideoUrlLow("https://cdn.test/low.mp4");';
  for(const host of ['xvideos.com','xvv1deos.com','xnxx.es','xnxx.com'])assert.equal((await resolveMedia(html,`https://${host}/video123/example`,'720',async()=>master,{format:'mp4',strictQuality:true})).url,'https://cdn.test/high.mp4');
});

test('XHamster aliases extract JSON player sources without evaluating page scripts',async()=>{
  const html='window.initials = '+JSON.stringify({xplayerSettings:{sources:{standard:{h264:[{url:'https://cdn.test/high.mp4',quality:'720p'}]}}}})+';';
  for(const host of ['xhamster.com','xhamster42.desi','xhamster43.desi','xhamster44.desi','xhamster1.desi','xhamster.desi'])assert.equal((await resolveMedia(html,`https://${host}/videos/example`,'720',async()=>assert.fail())).url,'https://cdn.test/high.mp4');
});

test('Redtube mediaDefinition metadata endpoints resolve relative MP4 URLs',async()=>{
  const html='window.page_params = '+JSON.stringify({generalVideoConfig:{mainRoll:{mediaDefinition:[{format:'mp4',videoUrl:'/api/streams',quality:720}]}}})+';';
  const result=await resolveMedia(html,'https://www.redtube.com/123','720',async()=>JSON.stringify([{quality:720,videoUrl:'/file.mp4'}]),{format:'mp4',strictQuality:true});
  assert.equal(result.url,'https://www.redtube.com/file.mp4');
});

test('MissAV aliases decode packed stream IDs without eval and retain requested qualities',async()=>{
  const packed='m3u8|eeeeeeeeeeee|dddd|cccc|bbbb|aaaaaaaa|com|surrit|https|video|720p|1080p';
  for(const host of ['missav.ws','missav.live','missav.com']){
    const result=await resolveMedia(packed,`https://${host}/example`,'720',async()=>{throw Error('Master temporarily unavailable');},{format:'m3u8',strictQuality:true});
    assert.equal(result.url,'https://surrit.com/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/720p/video.m3u8');
  }
});

test('Tangxin and Rou support structured media and extensionless HLS APIs',async()=>{
  const tang=await resolveMedia('<meta property="og:image" content="https://cdn.test/videos/123/cover.jpg">','https://tangxinvlog.app/v/123','best',async()=> '#EXTM3U\n#EXTINF:1,\na.ts\n#EXT-X-ENDLIST');
  assert.equal(tang.url,'https://cdn.test/videos/123/index.m3u8');
  const rou=await resolveMedia('','https://rou.video/v/abc','best',async()=> '#EXTM3U\n#EXTINF:1,\na.ts\n#EXT-X-ENDLIST');
  assert.equal(rou.url,'https://rou.video/api/hls/abc');assert.equal(rou.format,'m3u8');
});

test('Huangguo resolves the current episode and rejects a different episode returned by its API',async()=>{
  const html='<script id="videoInitialData" type="application/json">'+JSON.stringify({id:123,ep:1,videoSrc:'https://cdn.test/episode-1.mp4',epPlaySrcs:{2:'https://cdn.test/episode-2.mp4'}})+'</script>';
  const result=await resolveMedia(html,'https://huangguoai.com/video/123/ep-2','best',async()=>JSON.stringify({code:200,data:{ep_num:1,video_url:'https://cdn.test/wrong.mp4'}}));
  assert.equal(result.url,'https://cdn.test/episode-2.mp4');
});

test('generic HTML5, JSON-LD and player config extraction preserves URLs and never executes scripts',async()=>{
  const samples=[
    ['<video src="/file.mp4?token=a&amp;b=2"></video>','https://site.test/file.mp4?token=a&b=2','mp4'],
    ['<video><source src="/api/video" type="video/webm"></video>','https://site.test/api/video','webm'],
    ['<script type="application/ld+json">{"@type":"VideoObject","contentUrl":"https://cdn.test/file.mp4"}</script>','https://cdn.test/file.mp4','mp4'],
    ['player.setup({file: "https://cdn.test/list.m3u8?token=example"});','https://cdn.test/list.m3u8?token=example','m3u8']
  ];
  for(const [html,url,format]of samples){const result=await resolveMedia(html,'https://site.test/watch','best',async()=> '#EXTM3U\n#EXTINF:1,\na.ts\n#EXT-X-ENDLIST');assert.equal(result.url,url);assert.equal(result.format,format);}
  assert.equal(extractMedia('<video src="javascript:alert(1)"></video>').definitions.length,0);
});

test('player header names are normalized and exact DNR filters cannot match a different signed URL',()=>{
  assert.deepEqual(mediaHeaders({referer:'https://player.test/',origin:'https://player.test'},'https://outer.test/watch'),{Referer:'https://player.test/',Origin:'https://player.test'});
  assert.deepEqual(mediaHeaders({Referer:'https://player.test/'},'https://outer.test/watch'),{Referer:'https://player.test/',Origin:'https://player.test'});
  const url='https://cdn.test/video.m3u8?token=a|b*&name=one+two';
  const filter=new RegExp(exactRequestCondition(url).regexFilter);
  assert.equal(filter.test(new URL(url).href),true);assert.equal(filter.test(url+'x'),false);assert.equal(filter.test(url.replace('a|b','axb')),false);
});

test('generic discovery keeps iframe headers, separates tabs, and drops stale pages and unsafe media URLs',()=>{
  const discovery=createMediaDiscovery();
  const sender={tab:{id:1,url:'https://outer.test/watch'},url:'https://player.test/embed',frameId:5};
  discovery.report({videoInfos:[{videoUrl:'https://cdn.test/video.m3u8',format:'m3u8',quality:'720'},{videoUrl:'file:///private',format:'mp4'}]},sender);
  assert.equal(discovery.snapshot(1,sender.tab.url).length,1);assert.equal(discovery.snapshot(2).length,0);
  assert.deepEqual(discovery.snapshot(1)[0].headers,{Referer:'https://player.test/embed',Origin:'https://player.test'});
  assert.equal(discovery.snapshot(1,'https://outer.test/other').length,0);
  discovery.report({videoInfos:[]},{...sender,tab:{id:1,url:'https://outer.test/other'}});
  assert.equal(discovery.snapshot(1).length,0);discovery.remove(1);
});
