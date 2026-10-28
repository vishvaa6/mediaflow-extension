import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchBytes,transientError,retryAfterMs} from '../assets/js/network.js';
import {installWindowManager} from '../assets/js/window-manager.js';
import {clampPopupSize} from '../assets/js/popup-surface.js';
import {readFileSync} from 'node:fs';
import {chooseDefinition} from '../assets/js/media-resolver.js';
import {videoKey} from '../assets/js/video-details.js';
import {remuxToMp4,checkTsCodecs} from '../assets/js/mp4-output.js';
import {networkError} from '../assets/js/network.js';
import {recognizedVideoPage} from '../assets/js/download-badges.js';

test('a slow but progressing body outlives the inactivity timeout',async()=>{
  const data=await fetchBytes('https://fixture.test/slow',{timeout:60,fetcher:async()=>new Response(new ReadableStream({async start(controller){for(let i=0;i<6;i++){await new Promise(resolve=>setTimeout(resolve,20));controller.enqueue(Uint8Array.of(i));}controller.close();}}))});
  assert.deepEqual([...data.data],[0,1,2,3,4,5]);
});
test('initial response stalls are classified for retry; cancellation is not',async()=>{
  await assert.rejects(fetchBytes('https://fixture.test/stall',{timeout:10,fetcher:(url,{signal})=>new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason)))}),error=>error.code==='TIMEOUT' && transientError(error));
  const controller=new AbortController();controller.abort(new DOMException('Cancelled','AbortError'));
  await assert.rejects(fetchBytes('https://fixture.test/cancel',{signal:controller.signal}),error=>error.name==='AbortError' && !transientError(error));
});
test('HTTP retry policy retains status and bounded Retry-After information',async()=>{
  await assert.rejects(fetchBytes('https://fixture.test/limited',{fetcher:async()=>new Response('',{status:429,headers:{'Retry-After':'5'}})}),error=>error.status===429 && error.retryAfter===5000 && transientError(error));
  assert.equal(retryAfterMs('1000'),120000);assert.equal(retryAfterMs('invalid'),0);
  assert.equal(transientError({status:403}),false);assert.equal(transientError({status:503}),true);
});
test('MP4 preference does not downgrade quality to find a native MP4',()=>{
  const definitions=[{format:'m3u8',quality:1080,videoUrl:'hls'},{format:'mp4',quality:720,videoUrl:'low'},{format:'mp4',quality:1080,videoUrl:'native'}];
  assert.equal(chooseDefinition(definitions,'best',{preferMp4:true}).videoUrl,'native');
  assert.equal(chooseDefinition(definitions.slice(0,2),'best',{preferMp4:true}).videoUrl,'hls');
});
test('history identities recognize aliases without merging different videos',()=>{
  assert.equal(videoKey('https://pornhub.org/view_video.php?viewkey=abc'),videoKey('https://www.pornhub.com/view_video.php?viewkey=abc&ref=feed'));
  assert.equal(videoKey('https://missav.ws/dm265/en/abc-123'),videoKey('https://missav.live/ja/abc-123'));
  assert.equal(videoKey('https://xhamster42.desi/videos/same-123'),videoKey('https://xhamster.com/videos/same-123'));
  assert.notEqual(videoKey('https://missav.ws/en/abc-123'),videoKey('https://missav.ws/en/abc-124'));
});
test('download badges recognize supported video routes without treating arbitrary numeric links as videos',()=>{
  for(const url of ['https://missav.ws/dm265/en/abc-123','https://x.com/i/status/1841234567890123456/video/2','https://redtube.com/123','https://123av.com/en/v/example','https://xvideos.com/video.abc/title'])assert.equal(recognizedVideoPage(url),true,url);
  for(const url of ['https://example.test/123','https://missav.ws/dm265/en','https://example.test/model/creator','javascript:alert(1)'])assert.equal(recognizedVideoPage(url),false,url);
});
test('attached popup sizes respect browser limits and smaller displays',()=>{
  assert.deepEqual(clampPopupSize(),{width:720,height:600});
  assert.deepEqual(clampPopupSize({width:200,height:100}),{width:480,height:360});
  assert.deepEqual(clampPopupSize({width:2000,height:2000}),{width:800,height:600});
  assert.deepEqual(clampPopupSize({width:2000,height:2000},{availWidth:500,availHeight:400}),{width:500,height:400});
});
test('an interrupted conversion aborts its output and can restart from the same cached segments',async()=>{
  const packet=new Uint8Array(188);packet[0]=0x47;packet[3]=0x10;
  const files=new Map([['one',new Blob([packet])],['two',new Blob([packet])]]);let aborted=0,stopped=false;
  const root={async getFileHandle(name){return {getFile:async()=>files.get(name),async createWritable(){const chunks=[];return {write:async value=>chunks.push(value),close:async()=>files.set(name,new Blob(chunks)),abort:async()=>{aborted++;}};}};}};
  const factory=()=>{let data;return {on:(event,listener)=>{if(event==='data')data=listener;},push(){},flush(){data({type:'combined',initSegment:Uint8Array.of(1),data:Uint8Array.of(2)});},dispose(){}};};
  const options={root,units:[{cacheName:'one'},{cacheName:'two'}],output:'output.mp4',transmuxerFactory:factory};
  await assert.rejects(remuxToMp4({...options,check:()=>{if(stopped)throw new DOMException('Paused','AbortError');},onProgress:()=>{stopped=true;}}),error=>error.name==='AbortError');
  assert.equal(aborted,1);assert.equal(files.has('output.mp4'),false);assert.equal(files.get('one').size,188);assert.equal(files.get('two').size,188);
  assert.equal(await remuxToMp4(options),3);assert.deepEqual([...new Uint8Array(await files.get('output.mp4').arrayBuffer())],[1,2,2]);
});
test('unsupported TS codecs are detected before MP4 conversion and disk failures are actionable',()=>{
  const packet=new Uint8Array(188);packet[0]=0x47;packet[1]=0x40;packet[3]=0x10;packet[4]=0;packet[5]=2;packet[6]=0xb0;packet[7]=18;packet[15]=0xf0;packet[17]=0x24;
  assert.throws(()=>checkTsCodecs(packet),error=>error.code==='CONVERSION_UNSUPPORTED');
  packet[17]=0x1b;assert.doesNotThrow(()=>checkTsCodecs(packet));
  assert.equal(networkError(new DOMException('Full','QuotaExceededError')).code,'STORAGE_FULL');
  assert.equal(networkError(Error('FILE_ACCESS_DENIED')).code,'SAVE_ACCESS');
});
test('toolbar opens an attached popup; source tracking never registers a detached window launcher',async()=>{
  const event=()=>({addListener(){}}),data={mediaflowSource:{tabId:1,windowId:1}},clicked=[];
  const current={id:5,windowId:2,url:'https://x.com/home'};
  globalThis.chrome={runtime:{getURL:path=>'chrome-extension://test/'+path,sendMessage:async()=>{}},storage:{local:{get:async key=>({[key]:data[key]}),set:async value=>Object.assign(data,value)}},
    action:{onClicked:{addListener:fn=>clicked.push(fn)}},tabs:{get:async id=>({id,windowId:1,url:'https://example.test/old'}),query:async()=>[current],onActivated:event(),onUpdated:event()},
    windows:{create:async()=>assert.fail('Must not create a separate window'),update:async()=>assert.fail('Must not resize the browser'),onFocusChanged:event()}};
  const manager=installWindowManager();
  assert.equal(clicked.length,0);assert.equal((await manager.source(2)).tab.id,5);assert.equal(data.mediaflowSource.tabId,5);
  const manifest=JSON.parse(readFileSync(new URL('../manifest.json',import.meta.url),'utf8'));
  assert.equal(manifest.action.default_popup,'src/pages/popup/index.html?surface=popup');
});
