import test from 'node:test';
import assert from 'node:assert/strict';
import {isXPage,xPost,xMediaUrl,extractXMedia,xSyndicationUrl,fetchXMedia} from '../assets/js/x-media.js';
import {resolveMedia} from '../assets/js/media-resolver.js';
import {videoKey,downloadedRecord} from '../assets/js/video-details.js';
import {createMediaDiscovery} from '../assets/js/media-discovery.js';
import {DirectDownloader} from '../assets/js/direct-downloader.js';
import {installQueueManager} from '../assets/js/queue-manager.js';

const id='2050000000000000001', otherId='2050000000000000002';
const page=`https://x.com/example/status/${id}`;
const url=(quality,token='first')=>`https://video.twimg.com/amplify_video/123/vid/avc1/${quality===720?'1280x720':'640x360'}/video.mp4?tag=12&token=${token}`;
const video=(token='first')=>({type:'video',media_url_https:'https://pbs.twimg.com/ext_tw_video_thumb/123/pu/img/poster.jpg',
  video_info:{variants:[{content_type:'application/x-mpegURL',url:'https://video.twimg.com/amplify_video/123/pl/master.m3u8'},
    {content_type:'video/mp4',bitrate:832000,url:url(360,token)},{content_type:'video/mp4',bitrate:2176000,url:url(720,token)}]}});
const payload=(token='first')=>({id_str:id,text:'An X post',mediaDetails:[video(token)]});

test('X and Twitter post URLs retain large IDs, video indices and stable history identities',()=>{
  for(const host of ['x.com','www.x.com','twitter.com','mobile.twitter.com']){
    const parsed=xPost(`https://${host}/example/status/${id}/video/2?s=20`);
    assert.equal(parsed.id,id);assert.equal(parsed.index,2);
    assert.equal(videoKey(parsed.pageUrl),videoKey(`https://${host}/example/status/${id}/video/2`));
  }
  assert.equal(videoKey(page),videoKey(`https://twitter.com/i/web/status/${id}?s=20`));
  assert.notEqual(videoKey(page),videoKey(page+'/video/2'));
  assert.ok(downloadedRecord([{pageUrl:page+'/video/2'}],`https://twitter.com/another/status/${id}/video/2`));
  assert.equal(xPost('https://x.com/home'),null);
  assert.equal(xPost(page+'/video/0'),null);assert.equal(xPost(page+'/video/5'),null);
  assert.equal(isXPage('https://x.com.attacker.test/example/status/1'),false);
});

test('X extraction reads only the requested GraphQL post and ignores quoted posts, replies and photos',()=>{
  const graph={data:{instructions:[{entries:[
    {result:{__typename:'TweetWithVisibilityResults',tweet:{rest_id:id,legacy:{full_text:'Chosen post',extended_entities:{media:[video()]},quoted_status_result:{result:{rest_id:otherId,legacy:{extended_entities:{media:[video('quoted')]}}}}}}}},
    {result:{rest_id:otherId,legacy:{extended_entities:{media:[video('reply')]}}}}
  ]}]}};
  const found=extractXMedia(graph,page);
  assert.equal(found.length,3);assert.ok(found.every(item=>!item.videoUrl.includes('quoted') && !item.videoUrl.includes('reply')));
  assert.deepEqual(found.map(item=>item.quality),['Auto',360,720]);
  assert.match(found[0].title,/Chosen post/);assert.equal(found[0].thumbnail,video().media_url_https);
  assert.deepEqual(extractXMedia(graph,'https://x.com/home'),[]);
});

test('X multi-video posts, portrait dimensions and animated GIF MP4 sources select the requested video',()=>{
  const p=payload();p.mediaDetails.push({type:'photo',media_url_https:'https://pbs.twimg.com/a.jpg'},
    {type:'animated_gif',video_info:{variants:[{url:'https://video.twimg.com/tweet_video/loop.mp4'}]}});
  const second=extractXMedia(p,page+'/video/2');
  assert.equal(second.length,1);assert.match(second[0].videoUrl,/loop\.mp4$/);
  assert.equal(second[0].pageUrl,`https://x.com/i/status/${id}/video/2`);
  assert.match(second[0].title,/Video 2$/);
  p.mediaDetails[0].video_info.variants=[{url:'https://video.twimg.com/ext_tw_video/123/pu/vid/720x1280/portrait.mp4'}];
  assert.equal(extractXMedia(p,page)[0].quality,720);
  assert.deepEqual(extractXMedia(p,page+'/video/3'),[]);
});

test('X media validation rejects non-media and foreign URLs and bounds hostile page payloads',()=>{
  for(const bad of ['javascript:alert(1)','blob:https://x.com/abc','http://video.twimg.com/a.mp4','https://video.twimg.com.evil.test/a.mp4','https://video.twimg.com/a.ts','https://user:pass@video.twimg.com/a.mp4'])assert.equal(xMediaUrl(bad),'');
  const p=payload();p.mediaDetails[0].video_info.variants.push({url:'https://attacker.test/tracking.mp4'});
  p.mediaDetails[0].video_info.variants.push(null);
  assert.equal(extractXMedia(p,page).length,3);
  const cyclic={};cyclic.self=cyclic;assert.deepEqual(extractXMedia(cyclic,page),[]);
});

test('X public metadata uses the post ID and supports MP4 quality selection and HLS expansion',async()=>{
  const endpoint=new URL(xSyndicationUrl(page));
  assert.equal(endpoint.origin,'https://cdn.syndication.twimg.com');assert.equal(endpoint.searchParams.get('id'),id);
  assert.match(endpoint.searchParams.get('token'),/^[1-9a-z]+$/);
  const calls=[];
  const fetcher=async(target,headers)=>{
    calls.push({target,headers});
    return target.includes('tweet-result')?JSON.stringify(payload()):'#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1,RESOLUTION=1280x720\n720/video.m3u8';
  };
  const direct=await resolveMedia('',page,'720',fetcher,{format:'mp4',strictQuality:true});
  assert.equal(direct.url,url(720));assert.match(direct.title,/An X post/);
  const hls=await resolveMedia('',page,'720',fetcher,{format:'m3u8',strictQuality:true});
  assert.equal(hls.url,'https://video.twimg.com/amplify_video/123/pl/720/video.m3u8');
  assert.deepEqual(direct.headers,{Origin:'https://x.com',Referer:'https://x.com/'});
  assert.ok(calls.some(call=>call.target.startsWith('https://cdn.syndication.twimg.com/')));
  await assert.rejects(fetchXMedia(page,async()=>JSON.stringify({})),/Open the post on X/);
  await assert.rejects(resolveMedia('',page,'1080',fetcher,{format:'mp4',strictQuality:true}),/quality\/format is unavailable/);
});

test('X discovery keeps post metadata and excludes stale navigation and unrelated media',()=>{
  const discovery=createMediaDiscovery(),sender={tab:{id:10,url:page},url:page,frameId:0};
  discovery.report({videoInfos:[...extractXMedia(payload(),page),{videoUrl:'https://ads.test/a.mp4',format:'mp4'}]},sender);
  const found=discovery.snapshot(10,page);assert.equal(found.length,3);assert.match(found[0].title,/An X post/);
  assert.equal(found[0].pageUrl,`https://x.com/i/status/${id}/video/1`);
  assert.equal(discovery.snapshot(10,page+'/video/2').length,0);
  discovery.report({videoInfos:extractXMedia(payload(),page)},{...sender,tab:{id:10,url:page+'/video/2'}});
  assert.equal(discovery.snapshot(10,page+'/video/2').length,3,'a visible player keeps its own source identity even when the tab URL differs');
  const timeline='https://x.com/home';
  discovery.report({videoInfos:extractXMedia(payload(),page)},{...sender,tab:{id:10,url:timeline},url:timeline});
  assert.equal(discovery.snapshot(10,timeline).length,3,'timeline viewport reports must survive background discovery');
  discovery.report({videoInfos:[]},{...sender,tab:{id:10,url:timeline},url:timeline});
  assert.equal(discovery.snapshot(10,timeline).length,0,'scrolling away clears the previous viewport');
});

test('an expired X direct URL renews the same post and quality, verifies its partial bytes and finishes',async()=>{
  const bytes=new Map([['partial',Uint8Array.of(1,2)]]);let saved=false,refreshed;
  const storage={getDirectory:async()=>({getFileHandle:async name=>({
    getFile:async()=>new Blob([bytes.get(name) || new Uint8Array()]),
    createWritable:async()=>{let data=[...bytes.get(name)],position=0;return {seek:async n=>{position=n;},write:async b=>{for(const value of b)data[position++]=value;},close:async()=>bytes.set(name,Uint8Array.from(data)),abort:async()=>{}};}
  })})};
  const requests=[];
  const downloader=new DirectDownloader({storage,saveFile:async()=>{saved=true},
    resolveSource:async()=>resolveMedia('',page,'720',async()=>JSON.stringify(payload('renewed')),{format:'mp4',strictQuality:true}),
    onSourceRefreshed:async source=>{refreshed=source;},fetcher:async(target,{headers})=>{
      requests.push({target,range:headers.get('Range')});
      return target.includes('renewed')?new Response(Uint8Array.of(1,2,3,4),{status:206,headers:{'Content-Range':'bytes 0-3/4','Content-Length':'4'}}):new Response('',{status:403});
    }});
  globalThis.chrome={declarativeNetRequest:{updateSessionRules:async()=>{}}};
  await downloader.start({url:url(720),format:'mp4',opfsFileName:'partial',onError:error=>assert.fail(error)});
  assert.equal(saved,true);assert.equal(refreshed.url,url(720,'renewed'));
  assert.deepEqual([...bytes.get('partial')],[1,2,3,4]);assert.equal(requests[1].range,'bytes=0-');
});

test('the real queue renews an expired X MP4 without fetching the login page and records the saved video',async()=>{
  const bytes=new Map([['x-cache',Uint8Array.of(1,2)]]),requests=[],history=[];
  let tasks=[{id:'x-task',url:url(720),format:'mp4',quality:'720',pageUrl:page,fileName:'X post',title:'X post',status:'queued',createdAt:1,opfsCacheFileName:'x-cache'}],saved;
  const originalFetch=globalThis.fetch,originalChrome=globalThis.chrome;
  const previousStorage=Object.getOwnPropertyDescriptor(navigator,'storage');
  const listeners=new Set();
  const storage={getDirectory:async()=>({removeEntry:async name=>bytes.delete(name),getFileHandle:async name=>({
    getFile:async()=>new Blob([bytes.get(name) || new Uint8Array()]),
    createWritable:async()=>{let data=[...bytes.get(name)],position=0;return {seek:async n=>{position=n},write:async b=>{for(const value of b)data[position++]=value},close:async()=>bytes.set(name,Uint8Array.from(data)),abort:async()=>{}};}
  })})};
  Object.defineProperty(navigator,'storage',{configurable:true,value:storage});
  globalThis.chrome={runtime:{id:'x-queue',onMessage:{addListener(){}},sendMessage:async message=>{
    if(message.type==='OPFS_TO_BLOB_URL'){saved=[...bytes.get(message.filename)];return {ok:true,blobUrl:'blob:x-cache'};}
    return {};
  }},storage:{local:{get:async()=>({}),set:async()=>{}}},offscreen:{hasDocument:async()=>true},
  declarativeNetRequest:{updateSessionRules:async()=>{}},downloads:{onChanged:{addListener:fn=>listeners.add(fn),removeListener:fn=>listeners.delete(fn)},
    download:(_,callback)=>callback(42),search:async()=>[{id:42,state:'complete'}]}};
  globalThis.fetch=async target=>{
    requests.push(target);
    if(target.includes('tweet-result'))return new Response(JSON.stringify(payload('renewed')));
    if(target.includes('renewed'))return new Response(Uint8Array.of(1,2,3,4),{status:206,headers:{'Content-Range':'bytes 0-3/4','Content-Length':'4'}});
    assert.equal(target,url(720),'the queue must not request an X HTML/login page to renew a video');
    return new Response('',{status:403});
  };
  try{
    const manager=installQueueManager({
      queueStorage:{get:async()=>({tasks:structuredClone(tasks)}),updateTask:async(id,patch)=>{tasks=tasks.map(task=>task.id===id?{...task,...patch}:task)},removeTask:async id=>{tasks=tasks.filter(task=>task.id!==id)}},
      historyStorage:{get:async()=>({records:[]}),addRecord:async(...args)=>history.push(args)},
      settingsStorage:{get:async()=>({maxConcurrentTasks:1}),subscribe(){}},registerBlob(){},bindBlob(){},clearBlob(){},formatFilename:name=>name,withSubdir:name=>name
    });
    await manager.ready;
    for(let i=0;i<100 && (!history.length || tasks.length);i++)await new Promise(resolve=>setTimeout(resolve,5));
    assert.equal(tasks.length,0);assert.deepEqual(saved,[1,2,3,4]);
    assert.equal(history.length,1);assert.equal(history[0][1],url(720,'renewed'));assert.equal(history[0][3].downloadId,42);
    assert.ok(requests.some(target=>target.includes('tweet-result')));
  }finally{
    globalThis.fetch=originalFetch;globalThis.chrome=originalChrome;
    if(previousStorage)Object.defineProperty(navigator,'storage',previousStorage);else delete navigator.storage;
  }
});
