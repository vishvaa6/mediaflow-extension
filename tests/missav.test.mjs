import test from 'node:test';
import assert from 'node:assert/strict';
import fixtures from './fixtures/missav.cjs';
import {isMissavPage,missavVideoPage,missavMediaUrl,extractMissavDefinitions,resolveMissavSources} from '../assets/js/missav-media.js';
import {resolveMedia} from '../assets/js/media-resolver.js';
import {createMediaDiscovery} from '../assets/js/media-discovery.js';

const page='https://missav.ws/en/sample-101';
test('MissAV catalogue and detail routes preserve video identities across dm prefixes',()=>{
  assert.equal(isMissavPage('https://missav.ws/dm265/en'),true);
  assert.equal(missavVideoPage('https://missav.ws/dm265/en'),'');
  assert.equal(missavVideoPage('/dm265/en/sample-101?utm_source=card#preview',page),page);
  for(const host of ['missav.ws','www.missav.ws','missav.live','missav.com','missav.ai'])assert.ok(missavVideoPage(`https://${host}/en/sample-101`));
  for(const value of ['/en/undefined','/en/release','/en/fc2','https://missav.ws.evil.test/en/sample-101','javascript:alert(1)'])assert.equal(missavVideoPage(value,page),'');
});
test('MissAV decodes the current packed source assignments without running page JavaScript',()=>{
  const definitions=extractMissavDefinitions(fixtures.packed(),page);
  assert.deepEqual(definitions.map(def=>def.videoUrl),[`https://surrit.com/${fixtures.first}/playlist.m3u8`,`https://surrit.com/${fixtures.first}/720p/video.m3u8`]);
  assert.deepEqual(definitions.map(def=>def.quality),[0,720]);
  assert.deepEqual(definitions[1].headers,{Origin:'https://missav.ws',Referer:page});
  const hostile=`source='https://cdn.test/full.m3u8';globalThis.missavExecuted=true;`;
  delete globalThis.missavExecuted;
  assert.equal(extractMissavDefinitions(hostile,page).length,1);assert.equal(globalThis.missavExecuted,undefined);
});
test('MissAV keeps signed literal sources and rejects previews, unsafe URLs and unrelated quality labels',()=>{
  const html=`const source='https://cdn.test/full.m3u8?token=a\\u0026b=2';const source720='https://cdn.test/720p/video.m3u8';const source1280='https://cdn.test/720p/video.m3u8';let label='1080p';<video src="https://fourhoi.com/sample-101/preview.mp4"></video>`;
  const definitions=extractMissavDefinitions(html,page);
  assert.equal(definitions.length,2);assert.equal(definitions[0].videoUrl,'https://cdn.test/full.m3u8?token=a&b=2');
  assert.ok(definitions.every(def=>def.quality!==1080));
  for(const value of ['blob:https://missav.ws/id','javascript:alert(1)','file:///x.mp4','https://cdn.test/a/preview.mp4','https://cdn.test/trailer-1.mp4'])assert.equal(missavMediaUrl(value,page),'');
});
test('MissAV expands only real master variants and preserves request headers on each quality',async()=>{
  const calls=[];
  const sources=await resolveMissavSources(fixtures.player(),page,async(url,headers)=>{calls.push({url,headers});return fixtures.master;});
  assert.deepEqual(sources.map(source=>source.quality),[720,1080]);assert.equal(calls.length,1);
  assert.ok(sources.every(source=>source.headers.Referer===page && source.headers.Origin==='https://missav.ws'));
  assert.equal(sources[1].videoUrl,`https://surrit.com/${fixtures.first}/1080p/video.m3u8`);
});
test('MissAV retains known packed qualities when master fetch fails and reports verification explicitly',async()=>{
  const sources=await resolveMissavSources(fixtures.player(),page,async()=>{throw Error('Network unavailable');});
  assert.deepEqual(sources.map(source=>source.quality),[0,720]);
  await assert.rejects(resolveMissavSources('<title>Just a moment...</title><script src="/cdn-cgi/challenge-platform/a.js"></script>',page,async()=>''),/complete its verification/);
  assert.deepEqual(await resolveMissavSources('<h1>Catalogue</h1>',page,async()=>''),[]);
});
test('MissAV resolver and expired-link renewal keep the selected HLS quality and format',async()=>{
  const fetcher=async()=>fixtures.master;
  const source=await resolveMedia(fixtures.player(),page,'1080',fetcher,{format:'m3u8',strictQuality:true});
  assert.equal(source.url,`https://surrit.com/${fixtures.first}/1080p/video.m3u8`);
  const renewed=await resolveMedia(fixtures.player(fixtures.second),page,'1080',fetcher,{format:'m3u8',strictQuality:true});
  assert.equal(renewed.url,`https://surrit.com/${fixtures.second}/1080p/video.m3u8`);
  assert.deepEqual(renewed.headers,source.headers);
  await assert.rejects(resolveMedia(fixtures.player(),page,'2160',fetcher,{format:'m3u8',strictQuality:true}),/quality\/format is unavailable/);
});
test('MissAV background discovery retains each visible card identity and clears stale viewport results',()=>{
  const discovery=createMediaDiscovery(),catalogue='https://missav.ws/dm265/en';
  const sender={tab:{id:5,url:catalogue},url:catalogue,frameId:0};
  const source={...extractMissavDefinitions(fixtures.packed(),page)[1],pageUrl:page,title:'Sample 101',site:'missav'};
  discovery.report({videoInfos:[source,{...source,videoUrl:'https://fourhoi.com/sample-101/preview.mp4'},{...source,pageUrl:'https://other.test/en/sample-101'}]},sender);
  const found=discovery.snapshot(5,catalogue);
  assert.equal(found.length,1);assert.equal(found[0].site,'missav');assert.equal(found[0].pageUrl,page);assert.equal(found[0].title,'Sample 101');
  discovery.report({videoInfos:[]},sender);assert.deepEqual(discovery.snapshot(5,catalogue),[]);
});
