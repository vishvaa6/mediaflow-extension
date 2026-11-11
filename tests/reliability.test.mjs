import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchBytes,transientError,retryAfterMs,retryDelay} from '../assets/js/network.js';
import {installWindowManager} from '../assets/js/window-manager.js';
import {clampPopupSize} from '../assets/js/popup-surface.js';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {chooseDefinition} from '../assets/js/media-resolver.js';
import {videoKey} from '../assets/js/video-details.js';
import {remuxToMp4,checkTsCodecs} from '../assets/js/mp4-output.js';
import {networkError} from '../assets/js/network.js';
import {recognizedVideoPage} from '../assets/js/download-badges.js';
import {fragment,mediaPayload,memoryRoot} from './fixtures/mp4.mjs';
import {Mp4File} from '../assets/js/mp4-file.js';
import {createProgressReporter} from '../assets/js/progress-reporter.js';

test('rapid transfer progress is coalesced and phase changes flush the latest bytes',async()=>{
  const sent=[],reporter=createProgressReporter(value=>sent.push(value),25);
  reporter.update({phase:'downloading',bytesReceived:1});
  for(let i=2;i<=1000;i++)reporter.update({phase:'downloading',bytesReceived:i});
  assert.equal(sent.length,1,'network chunks must not each create a progress message');
  await new Promise(resolve=>setTimeout(resolve,50));
  assert.equal(sent.length,2);assert.equal(sent.at(-1).bytesReceived,1000);
  reporter.update({phase:'downloading',bytesReceived:1200});
  reporter.update({phase:'saving',isFileDownloading:true});
  assert.equal(sent.length,3);assert.equal(sent.at(-1).bytesReceived,1200);assert.equal(sent.at(-1).phase,'saving');
  reporter.update({phase:'saving',isFileDownloading:true,bytesReceived:1300});
  reporter.flush();assert.equal(sent.at(-1).bytesReceived,1300);
  reporter.dispose();
});

test('content bootstrap handles invalidated contexts and still reports unexpected errors',async()=>{
  const script=readFileSync(new URL('../src/pages/contentDetection/index.js',import.meta.url),'utf8');
  for(const [message,expectedEvents,expectedWarnings] of [['Extension context invalidated.',2,0],['Unexpected bootstrap failure',0,2]]){
    const events=[],warnings=[];
    const context={chrome:{runtime:{getURL(){throw Error(message);}}},document:{dispatchEvent:event=>events.push(event.type)},Event:class{constructor(type){this.type=type;}},console:{warn:(...args)=>warnings.push(args)}};
    runInNewContext(script,context);
    await new Promise(resolve=>setTimeout(resolve,0));
    assert.deepEqual(events,Array(expectedEvents).fill('mediaflow:context-invalidated'));
    assert.equal(warnings.length,expectedWarnings);
  }
});

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
  assert.equal(transientError({status:474}),true);assert.equal(transientError({status:408}),true);
  for(const attempt of [1,3,20,1024,1000000])assert.ok(retryDelay(attempt)<=120000 && retryDelay(attempt)>=1000);
  assert.equal(retryDelay(1,120000),120000);
});
test('MP4 preference does not downgrade quality to find a native MP4',()=>{
  const definitions=[{format:'m3u8',quality:1080,videoUrl:'hls'},{format:'mp4',quality:720,videoUrl:'low'},{format:'mp4',quality:1080,videoUrl:'native'}];
  assert.equal(chooseDefinition(definitions,'best',{preferMp4:true}).videoUrl,'native');
  assert.equal(chooseDefinition(definitions.slice(0,2),'best',{preferMp4:true}).videoUrl,'hls');
});
test('history identities recognize aliases without merging different videos',()=>{
  assert.equal(videoKey('https://pornhub.org/view_video.php?viewkey=abc'),videoKey('https://www.pornhub.com/view_video.php?viewkey=abc&ref=feed'));
  assert.equal(videoKey('https://missav.ws/dm265/en/abc-123'),videoKey('https://missav.live/ja/abc-123'));
  assert.equal(videoKey('https://missav123.com/dm36/en/juq-045'),videoKey('https://missav.ws/en/juq-045'));
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
  const files=new Map([['one',packet],['two',packet]]);let aborted=0,stopped=false;
  const base=memoryRoot(files),root={async getFileHandle(name){const handle=await base.getFileHandle(name),create=handle.createWritable;handle.createWritable=async()=>{const writer=await create();writer.abort=async()=>{aborted++;};return writer;};return handle;}};
  const factory=()=>{let data,index=0;return {on:(event,listener)=>{if(event==='data')data=listener;},push(){},flush(){data(fragment(2,index++));},dispose(){}};};
  const options={root,units:[{cacheName:'one'},{cacheName:'two'}],output:'output.mp4',transmuxerFactory:factory};
  await assert.rejects(remuxToMp4({...options,check:()=>{if(stopped)throw new DOMException('Paused','AbortError');},onProgress:()=>{stopped=true;}}),error=>error.name==='AbortError');
  assert.equal(aborted,1);assert.equal(files.has('output.mp4'),false);assert.equal(files.get('one').length,188);assert.equal(files.get('two').length,188);
  assert.equal(await remuxToMp4(options),files.get('output.mp4').length);assert.deepEqual(mediaPayload(files.get('output.mp4')),[2,2]);
});
test('unsupported TS codecs are detected before MP4 conversion and disk failures are actionable',()=>{
  const packet=new Uint8Array(188);packet[0]=0x47;packet[1]=0x40;packet[3]=0x10;packet[4]=0;packet[5]=2;packet[6]=0xb0;packet[7]=18;packet[15]=0xf0;packet[17]=0x24;
  assert.throws(()=>checkTsCodecs(packet),error=>error.code==='CONVERSION_UNSUPPORTED');
  packet[17]=0x1b;assert.doesNotThrow(()=>checkTsCodecs(packet));
  assert.equal(networkError(new DOMException('Full','QuotaExceededError')).code,'STORAGE_FULL');
  assert.equal(networkError(Error('FILE_ACCESS_DENIED')).code,'SAVE_ACCESS');
});

test('large sample tables and long track durations finalize without integer or argument overflow',async()=>{
  const files=new Map(),handle=await memoryRoot(files).getFileHandle('long'),writer=await handle.createWritable(),mp4=new Mp4File(writer);
  await mp4.append(fragment(7,0,150001));const bytes=await mp4.finish();await writer.close();
  const output=files.get('long');assert.equal(bytes,output.length);assert.equal(mediaPayload(output).length,150001);
  const index=Buffer.from(output).indexOf('mdhd');assert.ok(index>0);assert.equal(output[index+4],1);
  assert.equal(new DataView(output.buffer).getBigUint64(index+28),180000n*150001n);
  mp4.dispose();assert.equal(mp4.tracks.size,0);
});

test('malformed MP4 fragments fail before output can be saved',async()=>{
  const files=new Map(),handle=await memoryRoot(files).getFileHandle('invalid'),writer=await handle.createWritable(),mp4=new Mp4File(writer);
  await assert.rejects(mp4.append({initSegment:Uint8Array.of(0,1),data:new Uint8Array()}),error=>error.code==='CONVERSION_UNSUPPORTED');
  assert.equal(files.has('invalid'),false);await writer.abort();mp4.dispose();
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
