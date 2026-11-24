import test from 'node:test';
import assert from 'node:assert/strict';
import {extractMedia,resolveMedia} from '../assets/js/media-resolver.js';
import {detectDocumentMedia} from '../assets/js/media-detection.js';
import {computeKvsLicenseToken} from '../assets/js/kvs-media.js';
import {mediaHeaders,exactRequestCondition} from '../assets/js/media-headers.js';
import {createMediaDiscovery} from '../assets/js/media-discovery.js';
import {is91PornPage,is91PornWatchPage} from '../assets/js/porn91-media.js';

const master='#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=100,RESOLUTION=1280x720\n720/list.m3u8?sig=fresh\n#EXT-X-STREAM-INF:BANDWIDTH=200,RESOLUTION=1920x1080\n1080/list.m3u8?sig=fresh';
test('91porn watch pages resolve their video source with signed URLs intact',async()=>{
  for(const path of ['view_video.php','view_video_hd.php']){
    const page=`https://91porn.com/${path}?viewkey=example`;
    assert.equal(is91PornWatchPage(page),true);
    const result=await resolveMedia('<video src="https://cdn.test/preview.mp4"></video><video id="player_one_html5_api"><source type="video/mp4" src="https://cdn.test/video.mp4?token=a%2Bb&amp;id=1"></video>',page,'best',async()=>assert.fail());
    assert.equal(result.url,'https://cdn.test/video.mp4?token=a%2Bb&id=1');
    await assert.rejects(resolveMedia('<video src="https://cdn.test/preview.mp4"></video>',page,'best',async()=>assert.fail()),/No supported video stream/);
  }
  assert.equal(is91PornPage('https://91porn.com.evil.test/index.php'),false);
  assert.equal(is91PornWatchPage('https://91porn.com/index.php'),false);
});
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

test('HLS resolution keeps separate audio from being silently discarded',async()=>{
  const html='<video src="https://cdn.test/master.m3u8"></video>';
  const audio='#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="separate",NAME="English",URI="audio.m3u8"';
  const unsupported='#EXTM3U\n'+audio+'\n#EXT-X-STREAM-INF:BANDWIDTH=200,RESOLUTION=1920x1080,AUDIO="separate"\nvideo-only.m3u8';
  assert.equal((await resolveMedia(html,'https://example.test/watch','best',async()=>unsupported)).url,'https://cdn.test/master.m3u8');
  const mixed=unsupported+'\n#EXT-X-STREAM-INF:BANDWIDTH=100,NAME="720p"\ncombined.m3u8';
  const chosen=await resolveMedia(html,'https://example.test/watch','best',async()=>mixed);
  assert.equal(chosen.url,'https://cdn.test/combined.m3u8');assert.equal(chosen.quality,'720');
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

test('MindGeek HLS and MP4 metadata endpoints resolve across YouPorn, Tube8, and Thumbzilla',async()=>{
  const html=`<script>var page_params = { video_player_setup: { mediaDefinitions: [
    {"format":"mp4","videoUrl":"/api/mp4_streams"},
    {"format":"hls","videoUrl":"/api/hls_streams"},
    {"format":"hls","videoUrl":"https://cdn.test/direct-master.m3u8"}
  ] } };</script>`;
  const doc={title:'MindGeek',documentElement:{outerHTML:html},querySelector:()=>null,querySelectorAll:()=>[]};
  const docDetected=detectDocumentMedia(doc,'https://www.youporn.com/watch/123/demo/');
  assert.deepEqual(docDetected.videoInfos.map(v=>v.videoUrl),['https://cdn.test/direct-master.m3u8']);

  for(const page of [
    'https://www.youporn.com/watch/12345/demo/',
    'https://www.tube8.com/amateur/demo/98765/',
    'https://www.thumbzilla.com/video/ph5f123abc/demo'
  ]){
    const fetcher=async url=>{
      if(url.includes('/api/mp4_streams'))return JSON.stringify({streams:[{quality:'720',videoUrl:'https://cdn.test/video-720.mp4'}]});
      if(url.includes('/api/hls_streams'))return JSON.stringify([{quality:'1080',videoUrl:'https://cdn.test/hls-1080?sig=extless'}]);
      if(url.includes('direct-master.m3u8'))return master;
      return '#EXTM3U\n#EXTINF:1,\nseg.ts\n#EXT-X-ENDLIST';
    };
    const mp4=await resolveMedia(html,page,'720',fetcher,{format:'mp4',strictQuality:true});
    assert.equal(mp4.url,'https://cdn.test/video-720.mp4');assert.equal(mp4.format,'mp4');
    const hls=await resolveMedia(html,page,'1080',fetcher,{format:'m3u8',strictQuality:true});
    assert.equal(hls.url,'https://cdn.test/hls-1080?sig=extless');assert.equal(hls.format,'m3u8');
  }
});

test('SpankBang resolves inline stream_data, stream_url_<q>, and data-streamkey API fallback gracefully',async()=>{
  const inlineHtml=`<script>
    var stream_data = {'4k': ['https://cdn.sb.test/4k.mp4'], '720p': ['https://cdn.sb.test/720.mp4'], 'm3u8': ['https://cdn.sb.test/master.m3u8'], 'cover_image': 'https://cdn.sb.test/cover.jpg'};
    var stream_url_480p = 'https://cdn.sb.test/480.mp4';
  </script>`;
  const page='https://spankbang.com/7abc1/video/sample+clip';
  assert.equal((await resolveMedia(inlineHtml,page,'best',async()=>assert.fail('inline stream_data needs no API fetch'),{preferMp4:true})).url,'https://cdn.sb.test/4k.mp4');
  assert.equal((await resolveMedia(inlineHtml,page,'480',async()=>assert.fail(),{format:'mp4',strictQuality:true})).url,'https://cdn.sb.test/480.mp4');

  const keyHtml='<div id="video" data-streamkey="7abc1-key"></div>';
  const apiRes=await resolveMedia(keyHtml,page,'720',async url=>{
    assert.match(url,/\/api\/videos\/stream\?id=7abc1-key/);
    return JSON.stringify({stream_url_720p:['https://cdn.sb.test/api-720.mp4'],m3u8:['https://cdn.sb.test/api.m3u8']});
  },{format:'mp4',strictQuality:true});
  assert.equal(apiRes.url,'https://cdn.sb.test/api-720.mp4');

  await assert.rejects(resolveMedia(keyHtml,page,'best',async()=>{throw Error('network down');}),/No supported video stream/);
  await assert.rejects(resolveMedia(keyHtml,page,'best'),/No supported video stream/);
});

test('Eporner computes base-36 chunk hashes and extracts HLS and MP4 streams',async()=>{
  const hash='0123456789abcdef1020304050607080';
  const expectedCalc=BigInt('0x01234567').toString(36)+BigInt('0x89abcdef').toString(36)+BigInt('0x10203040').toString(36)+BigInt('0x50607080').toString(36);
  const html=`<script>EP.video.player.vid = 'XyZ987'; EP.video.player.hash = '${hash}';</script>`;
  const page='https://de.eporner.com/video-XyZ987/sample-clip/';
  const fetcher=async url=>{
    if(url.includes('/xhr/video/')){
      const parsed=new URL(url);
      assert.equal(parsed.pathname,'/xhr/video/XyZ987');
      assert.equal(parsed.searchParams.get('hash'),expectedCalc);
      assert.equal(parsed.searchParams.get('domain'),'de.eporner.com');
      assert.equal(parsed.searchParams.get('fallback'),'false');
      assert.equal(parsed.searchParams.get('embed'),'true');
      assert.equal(parsed.searchParams.get('supportedFormats'),'mp4');
      return JSON.stringify({sources:{hls:{auto:{src:'https://cdn.ep.test/master.m3u8'}},mp4:{'1080p':{src:'https://cdn.ep.test/1080.mp4',labelShort:'1080p'},'720p':{src:'https://cdn.ep.test/720.mp4',labelShort:'720p'}}}});
    }
    return master;
  };
  assert.equal((await resolveMedia(html,page,'1080',fetcher,{format:'mp4',strictQuality:true})).url,'https://cdn.ep.test/1080.mp4');
  assert.equal((await resolveMedia(html,page,'720',fetcher,{format:'m3u8',strictQuality:true})).url,'https://cdn.ep.test/720/list.m3u8?sig=fresh');
});

test('Beeg fetches externulls facts API and maps hls_resources to video.beeg.com',async()=>{
  const page='https://beeg.com/-0987654321';
  const fetcher=async url=>{
    if(url==='https://store.externulls.com/facts/file/0987654321'){
      return JSON.stringify({file:{hls_resources:{fl_cdn_1080:'key=abc/1080.m3u8',fl_cdn_720:'key=abc/720.m3u8'}}});
    }
    assert.equal(url,'https://video.beeg.com/key=abc/720.m3u8');
    return '#EXTM3U\n#EXTINF:1,\nseg.ts\n#EXT-X-ENDLIST';
  };
  const resolved=await resolveMedia('',page,'720',fetcher,{format:'m3u8',strictQuality:true});
  assert.equal(resolved.url,'https://video.beeg.com/key=abc/720.m3u8');
  assert.equal(resolved.quality,'720');
});

test('YouJizz extracts dataEncodings and encodings with protocol-relative URLs',async()=>{
  const html=`<script>var dataEncodings = [{"name":"1080","filename":"\\/\\/cdn.youjizz.test\\/v\\/1080.mp4?sig=1"},{"name":"720","filename":"//cdn.youjizz.test/v/720.mp4?sig=2"}];</script>`;
  const res=await resolveMedia(html,'https://www.youjizz.com/videos/demo-12345.html','720',async()=>assert.fail(),{format:'mp4',strictQuality:true});
  assert.equal(res.url,'https://cdn.youjizz.test/v/720.mp4?sig=2');
  const best=await resolveMedia(html,'https://www.youjizz.com/videos/demo-12345.html','best',async()=>assert.fail());
  assert.equal(best.url,'https://cdn.youjizz.test/v/1080.mp4?sig=1');
});

test('Txxx decodes Cyrillic-mapped Base64 videofile.php entries across .com and .tube',async()=>{
  const encodeTxxx=str=>btoa(str)
    .replace(/A/g,'\u0410').replace(/B/g,'\u0412').replace(/C/g,'\u0421').replace(/E/g,'\u0415').replace(/M/g,'\u041c')
    .replace(/\+/g,'.').replace(/\//g,',').replace(/=/g,'~');
  const encoded720=encodeTxxx('/get_file/1/abc/76543/76543_720p.mp4/?br=1500');
  const encoded480=encodeTxxx('https://cdn.txxx.test/get_file/1/abc/76543/76543.mp4/');
  for(const host of ['txxx.com','txxx.tube']){
    const page=`https://${host}/videos/76543/sample-clip/`;
    const resolved=await resolveMedia('',page,'720',async url=>{
      assert.equal(url,`https://${host}/api/videofile.php?video_id=76543&lifetime=8640000`);
      return JSON.stringify([{video_url:encoded480,format:'.mp4'},{video_url:encoded720,format:'_720p.mp4'}]);
    },{format:'mp4',strictQuality:true});
    assert.equal(resolved.url,`https://${host}/get_file/1/abc/76543/76543_720p.mp4/?br=1500`);
  }
});

test('HQPorner and cross-origin iframe embed sites fetch non-ad player frames and attach embed headers',async()=>{
  const hqHtml=`
    <iframe src="https://ads.exoclick.com/iframe.php" width="300" height="250"></iframe>
    <iframe class="ad-banner" src="https://partner.test/banner" width="728" height="90"></iframe>
    <iframe src="//mydaddy.cc/video/abc123/" allowfullscreen></iframe>`;
  const hqPage='https://hqporner.com/hdporn/99999-sample.html';
  const calls=[];
  const hqResult=await resolveMedia(hqHtml,hqPage,'1080',async(url,headers)=>{
    calls.push({url,headers});
    assert.equal(url,'https://mydaddy.cc/video/abc123/');
    assert.deepEqual(headers,{Referer:hqPage});
    return '<video><source src="//s1.mydaddy.cc/1080.mp4" title="1080p"><source src="//s1.mydaddy.cc/720.mp4" title="720p"></video>';
  },{format:'mp4',strictQuality:true});
  assert.equal(calls.length,1);
  assert.equal(hqResult.url,'https://s1.mydaddy.cc/1080.mp4');
  assert.deepEqual(hqResult.headers,{Origin:'https://mydaddy.cc',Referer:'https://mydaddy.cc/video/abc123/'});

  const tnaPage='https://www.tnaflix.com/amateur-porn/clip/video12345';
  const tnaHtml='<iframe src="https://player.tnaflix.com/embed/12345" allowfullscreen></iframe>';
  const tnaResult=await resolveMedia(tnaHtml,tnaPage,'720',async(url,headers)=>{
    if(url==='https://player.tnaflix.com/embed/12345'){
      assert.deepEqual(headers,{Referer:tnaPage});
      return 'player.setup({sources:[{file:"https://cdn.tna.test/master.m3u8",type:"application/x-mpegURL"}]});';
    }
    assert.deepEqual(headers,{Origin:'https://player.tnaflix.com',Referer:'https://player.tnaflix.com/embed/12345'});
    return master;
  },{format:'m3u8',strictQuality:true});
  assert.equal(tnaResult.url,'https://cdn.tna.test/720/list.m3u8?sig=fresh');
  assert.deepEqual(tnaResult.headers,{Origin:'https://player.tnaflix.com',Referer:'https://player.tnaflix.com/embed/12345'});
});

test('KVS sites resolve decoded function/0/ streams end-to-end through resolveMedia',async()=>{
  const licenseCode='$6192837465192837';
  const realHash='abcdef0123456789abcdef0123456789';
  const token=computeKvsLicenseToken(licenseCode);
  const chars=[...realHash];
  const sums=Array(32).fill(0);let acc=0;
  for(let k=31;k>=0;k--){acc+=Number(token[k]);sums[k]=acc;}
  for(let k=0;k<32;k++){const s=(k+sums[k])%32;[chars[k],chars[s]]=[chars[s],chars[k]];}
  const html=`<script>var flashvars = {license_code:'${licenseCode}',video_url:'function/0/https://cdn.pt.test/get_file/1/${chars.join('')}/77/77_4k.mp4/',video_url_text:'4K'};</script>`;
  const res=await resolveMedia(html,'https://porntrex.com/video/77/demo','2160',async()=>assert.fail(),{format:'mp4',strictQuality:true});
  assert.equal(res.url,`https://cdn.pt.test/get_file/1/${realHash}/77/77_4k.mp4/`);
  assert.equal(res.quality,'2160');
});
