import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchBytes,transientError,retryAfterMs,retryDelay,abortableSleep,withRetry} from '../assets/js/network.js';
import {HlsDownloader} from '../assets/js/hls-downloader.js';
import {DirectDownloader} from '../assets/js/direct-downloader.js';
import {OffscreenDownload} from '../assets/js/offscreen-client.js';
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
  assert.equal(manifest.action.default_popup,undefined,'toolbar clicks launch the panel without first opening a popup');
});

function memoryStorageFixture() {
  const files=new Map();
  const missing=()=>new DOMException('Missing file','NotFoundError');
  const root={
    async getFileHandle(name,{create=false}={}) {
      if(!files.has(name)){if(!create)throw missing();files.set(name,new Uint8Array());}
      return {
        async getFile(){if(!files.has(name))throw missing();return new Blob([files.get(name)]);},
        async createWritable({keepExistingData=false}={}) {
          let staged=keepExistingData?files.get(name).slice():new Uint8Array(),position=0;
          return {
            async seek(n){position=n;},
            async write(value){
              const data=typeof value==='string'?new TextEncoder().encode(value):value instanceof Blob?new Uint8Array(await value.arrayBuffer()):new Uint8Array(value);
              const next=new Uint8Array(Math.max(staged.length,position+data.length));next.set(staged);next.set(data,position);staged=next;position+=data.length;
            },
            async close(){files.set(name,staged);},async abort(){}
          };
        }
      };
    },
    async removeEntry(name){if(!files.delete(name))throw missing();},
    async *entries(){for(const name of [...files.keys()])yield [name,{kind:'file'}];}
  };
  return {files,getDirectory:async()=>root};
}

test('withRetry honours Retry-After, caps backoff, stops on non-transient errors, and aborts promptly on AbortSignal',async()=>{
  // Already-aborted signal rejects immediately without calling fn.
  const preAborted=new AbortController();
  preAborted.abort(new DOMException('Already cancelled','AbortError'));
  let called=0;
  await assert.rejects(withRetry(()=>{called++;},{signal:preAborted.signal}),error=>error.name==='AbortError');
  assert.equal(called,0);

  // Non-transient errors stop immediately on attempt 1 without calling onRetry.
  for(const nonTransient of [
    Object.assign(Error('HTTP 403'),{code:'HTTP',status:403}),
    Object.assign(Error('HTTP 404'),{code:'HTTP',status:404}),
    new DOMException('Disk full','QuotaExceededError'),
    Error('Unexpected permanent failure')
  ]){
    let attempts=0,retries=0;
    await assert.rejects(withRetry(()=>{attempts++;throw nonTransient;},{attempts:4,baseDelay:0,onRetry:()=>{retries++;}}));
    assert.equal(attempts,1);assert.equal(retries,0);
  }

  // Honours Retry-After (above attempt-1 exponential backoff) and succeeds on retry.
  const retryLog=[];
  let attemptCount=0;
  const started=Date.now();
  const value=await withRetry(async()=>{
    attemptCount++;
    if(attemptCount===1)throw Object.assign(Error('HTTP 429: rate limited'),{code:'HTTP',status:429,retryAfter:1350});
    return 'recovered';
  },{attempts:4,onRetry:(attempt,ms,err)=>retryLog.push({attempt,ms,status:err.status})});
  const elapsed=Date.now()-started;
  assert.equal(value,'recovered');
  assert.equal(attemptCount,2);
  assert.deepEqual(retryLog,[{attempt:1,ms:1350,status:429}]);
  assert.ok(elapsed>=1250,`expected Retry-After delay >= 1250ms, got ${elapsed}ms`);

  // Caps Retry-After at 2 minutes (120000ms) and aborts promptly during backoff sleep.
  const capController=new AbortController();
  let cappedMs=0;
  const abortStart=Date.now();
  await assert.rejects(withRetry(async()=>{
    throw Object.assign(Error('HTTP 429'),{code:'HTTP',status:429,retryAfter:500000});
  },{
    attempts:4,
    signal:capController.signal,
    onRetry:(_attempt,ms)=>{cappedMs=ms;setTimeout(()=>capController.abort(new DOMException('Paused','AbortError')),20);}
  }),error=>error.name==='AbortError');
  assert.equal(cappedMs,120000);
  assert.ok(Date.now()-abortStart<400,'backoff sleep must abort promptly on AbortSignal');

  // Exponential backoff + TypeError normalization + exhausting attempts.
  const expDelays=[];
  let netCalls=0;
  await assert.rejects(withRetry(async()=>{
    netCalls++;
    throw new TypeError('Failed to fetch');
  },{attempts:3,baseDelay:10,onRetry:(attempt,ms,err)=>expDelays.push({attempt,ms,code:err.code})}),error=>error.code==='NETWORK');
  assert.equal(netCalls,3);
  assert.equal(expDelays.length,2);
  assert.equal(expDelays[0].attempt,1);assert.equal(expDelays[0].code,'NETWORK');assert.ok(expDelays[0].ms>=10 && expDelays[0].ms<=12);
  assert.equal(expDelays[1].attempt,2);assert.ok(expDelays[1].ms>=20 && expDelays[1].ms<=24);

  // abortableSleep rejects promptly when aborted mid-sleep.
  const sleepController=new AbortController();
  const sleepStart=Date.now();
  setTimeout(()=>sleepController.abort(new DOMException('Stop','AbortError')),15);
  await assert.rejects(abortableSleep(60000,sleepController.signal),error=>error.name==='AbortError');
  assert.ok(Date.now()-sleepStart<400);
});

test('HlsDownloader retries HTTP 429 with Retry-After, emits retrying metadata, and finishes cleanly',async()=>{
  const storage=memoryStorageFixture();
  const playlist='#EXTM3U\n#EXTINF:2,\nseg-0.ts\n#EXTINF:2,\nseg-1.ts\n#EXT-X-ENDLIST';
  const progress=[],calls=[];
  let seg1Attempts=0,saved=false,failure;
  const startTime=Date.now();
  const engine=new HlsDownloader({
    storage,
    maxConcurrent:1,
    retryInterval:10,
    fetcher:async url=>{
      calls.push(url);
      if(url.endsWith('.m3u8'))return new Response(playlist);
      if(url.includes('seg-0'))return new Response(Uint8Array.of(1,11));
      seg1Attempts++;
      if(seg1Attempts===1)return new Response('',{status:429,headers:{'Retry-After':'0.08'}});
      return new Response(Uint8Array.of(2,12));
    },
    onProgress:data=>progress.push(structuredClone(data)),
    saveFile:async()=>{saved=true;},
    onFailure:err=>{failure=err;}
  });
  await engine.start('https://video.test/list.m3u8',{opfsFileName:'hls-429.ts',fileName:'hls-429',quality:'best'});
  assert.equal(failure,undefined);
  assert.equal(saved,true);
  assert.equal(seg1Attempts,2);
  assert.ok(Date.now()-startTime>=65,'HlsDownloader must honour Retry-After delay');
  assert.deepEqual([...storage.files.get('hls-429.ts')],[1,11,2,12]);

  const retryingEvents=progress.filter(event=>event.retrying===true);
  assert.equal(retryingEvents.length,1);
  assert.equal(retryingEvents[0].phase,'retrying');
  assert.equal(retryingEvents[0].retryAttempt,1);
  assert.equal(retryingEvents[0].retryMax,4);
  assert.ok(retryingEvents[0].retryAt>startTime);
  assert.match(retryingEvents[0].retryError,/429/);

  const retryIndex=progress.findIndex(event=>event.retrying===true);
  const afterRetry=progress.slice(retryIndex+1).find(event=>event.finishNum===2);
  assert.ok(afterRetry,'progress after recovery must be emitted');
  assert.equal(afterRetry.retrying,false);
  assert.equal(afterRetry.phase,'downloading');

  // Pausing during an HLS Retry-After backoff aborts promptly without reporting an error.
  const pauseStorage=memoryStorageFixture();
  let pauseErr;
  const pauseEngine=new HlsDownloader({
    storage:pauseStorage,
    maxConcurrent:1,
    fetcher:async url=>{
      if(url.endsWith('.m3u8'))return new Response(playlist);
      return new Response('',{status:429,headers:{'Retry-After':'60'}});
    },
    onProgress:data=>{if(data.retrying)queueMicrotask(()=>pauseEngine.pauseSoft());},
    saveFile:async()=>assert.fail('Paused HLS must not save'),
    onFailure:err=>{pauseErr=err;}
  });
  const pauseStart=Date.now();
  await pauseEngine.start('https://video.test/list.m3u8',{opfsFileName:'hls-pause.ts',fileName:'hls-pause',quality:'best'});
  assert.equal(pauseErr,undefined);
  assert.ok(Date.now()-pauseStart<500,'pauseSoft must interrupt HLS retry backoff promptly');
});

test('DirectDownloader recovers from mid-stream drop and HTTP 503 resuming from exact bytesReceived without corruption',async()=>{
  const storage=memoryStorageFixture();
  const payload=Uint8Array.from({length:16384},(_,i)=>(i*31+7)&255);
  // Start with an MP4 ftyp header so media sniffing passes cleanly.
  payload.set([0x00,0x00,0x00,0x18,0x66,0x74,0x79,0x70,0x69,0x73,0x6f,0x6d],0);
  const ranges=[],progress=[];
  let requestNum=0,saved=false,completed=false,failure;
  const engine=new DirectDownloader({
    storage,
    maxAttempts:4,
    retryInterval:10,
    saveFile:async()=>{saved=true;},
    fetcher:async(_url,{headers})=>{
      requestNum++;
      ranges.push(headers.get('Range'));
      if(requestNum===1){
        // Stream 4096 bytes across 3 chunks then drop mid-stream with a transient network error.
        const chunks=[payload.slice(0,1024),payload.slice(1024,2048),payload.slice(2048,4096)];
        return new Response(new ReadableStream({
          pull(controller){
            if(chunks.length)controller.enqueue(chunks.shift());
            else controller.error(new TypeError('network error'));
          }
        }),{status:200,headers:{'Content-Length':String(payload.length)}});
      }
      if(requestNum===2){
        // Transient HTTP 503 with Retry-After on the resumed range request.
        return new Response('',{status:503,headers:{'Retry-After':'0.06'}});
      }
      if(requestNum===3){
        // Resume from exact offset 4096, deliver up to 10000, then close prematurely.
        return new Response(payload.slice(4096,10000),{
          status:206,
          headers:{'Content-Range':`bytes 4096-${payload.length-1}/${payload.length}`,'Content-Length':String(payload.length-4096)}
        });
      }
      // Final request resumes from exact offset 10000 and delivers the remainder.
      return new Response(payload.slice(10000),{
        status:206,
        headers:{'Content-Range':`bytes 10000-${payload.length-1}/${payload.length}`,'Content-Length':String(payload.length-10000)}
      });
    }
  });
  const started=Date.now();
  await engine.start({
    url:'https://cdn.test/video.mp4',
    fileName:'video',
    opfsFileName:'direct-resume.mp4',
    onProgress:data=>progress.push(structuredClone(data)),
    onComplete:()=>{completed=true;},
    onFailure:err=>{failure=err;}
  });
  assert.equal(failure,undefined);
  assert.equal(saved,true);
  assert.equal(completed,true);
  assert.equal(engine.getBytesReceived(),payload.length);
  assert.ok(Date.now()-started>=50,'DirectDownloader must honour Retry-After on 503');
  assert.deepEqual(ranges,[null,'bytes=4096-','bytes=4096-','bytes=10000-']);
  assert.deepEqual(storage.files.get('direct-resume.mp4'),payload,'resumed output must match original bytes without corruption');

  const retryingEvents=progress.filter(event=>event.retrying===true);
  assert.equal(retryingEvents.length,3);
  assert.deepEqual(retryingEvents.map(event=>event.retryAttempt),[1,2,3]);
  assert.ok(retryingEvents.every(event=>event.retryMax===4 && event.phase==='retrying' && event.retryAt>started && typeof event.retryError==='string' && event.retryError.length>0));
  assert.equal(retryingEvents[0].bytesReceived,4096);
  assert.equal(retryingEvents[1].bytesReceived,4096);
  assert.match(retryingEvents[1].retryError,/503/);
  assert.equal(retryingEvents[2].bytesReceived,10000);

  const lastRetryIdx=progress.findLastIndex(event=>event.retrying===true);
  const resumedProgress=progress.slice(lastRetryIdx+1).find(event=>event.bytesReceived===payload.length && !event.isFileDownloading);
  assert.ok(resumedProgress,'downloading progress after final retry must be emitted');
  assert.equal(resumedProgress.retrying,false);
  assert.equal(resumedProgress.phase,'downloading');

  // Non-transient error (HTTP 403) does not retry and emits no retrying events.
  const failStorage=memoryStorageFixture(),failProgress=[];
  let failCalls=0,failErr;
  const failEngine=new DirectDownloader({
    storage:failStorage,
    retries:3,
    retryInterval:0,
    saveFile:async()=>assert.fail('403 must not save'),
    fetcher:async()=>{failCalls++;return new Response('',{status:403});}
  });
  await failEngine.start({
    url:'https://cdn.test/forbidden.mp4',
    fileName:'forbidden',
    opfsFileName:'forbidden.mp4',
    onProgress:data=>failProgress.push(data),
    onFailure:err=>{failErr=err;}
  });
  assert.equal(failCalls,1);
  assert.equal(failErr?.status,403);
  assert.equal(failProgress.some(event=>event.retrying),false);

  // Pausing during DirectDownloader backoff aborts promptly and preserves committed bytes.
  const pauseStorage=memoryStorageFixture();
  let pauseReq=0,pauseErr;
  const pauseEngine=new DirectDownloader({
    storage:pauseStorage,
    maxAttempts:4,
    saveFile:async()=>assert.fail('Paused direct download must not save'),
    fetcher:async()=>{
      pauseReq++;
      if(pauseReq===1){
        const chunks=[payload.slice(0,1024),payload.slice(1024,2048)];
        return new Response(new ReadableStream({
          pull(controller){
            if(chunks.length)controller.enqueue(chunks.shift());
            else controller.error(new TypeError('network error'));
          }
        }),{status:200,headers:{'Content-Length':String(payload.length)}});
      }
      return new Response('',{status:503,headers:{'Retry-After':'60'}});
    }
  });
  const pauseStart=Date.now();
  await pauseEngine.start({
    url:'https://cdn.test/pause.mp4',
    fileName:'pause',
    opfsFileName:'direct-pause.mp4',
    onProgress:data=>{if(data.retrying)queueMicrotask(()=>pauseEngine.pauseSoft());},
    onFailure:err=>{pauseErr=err;}
  });
  assert.equal(pauseErr,undefined);
  assert.ok(Date.now()-pauseStart<500,'pauseSoft must interrupt direct retry backoff promptly');
  assert.deepEqual(pauseStorage.files.get('direct-pause.mp4'),payload.slice(0,2048));
});

test('HlsDownloader retries playlist HTTP 429 and OffscreenDownload forwards retrying metadata intact',async()=>{
  const storage=memoryStorageFixture();
  const playlist='#EXTM3U\n#EXTINF:2,\nseg-0.ts\n#EXT-X-ENDLIST';
  let playlistCalls=0,saved=false,failure;
  const progress=[];
  const engine=new HlsDownloader({
    storage,
    maxConcurrent:1,
    retryInterval:10,
    fetcher:async url=>{
      if(url.endsWith('.m3u8')){
        playlistCalls++;
        if(playlistCalls===1)return new Response('',{status:429,headers:{'Retry-After':'0.05'}});
        return new Response(playlist);
      }
      return new Response(Uint8Array.of(7,8));
    },
    onProgress:data=>progress.push(structuredClone(data)),
    saveFile:async()=>{saved=true;},
    onFailure:err=>{failure=err;}
  });
  await engine.start('https://video.test/list.m3u8',{opfsFileName:'hls-pl-429.ts',fileName:'hls-pl-429',quality:'best'});
  assert.equal(failure,undefined);assert.equal(saved,true);assert.equal(playlistCalls,2);
  assert.deepEqual([...storage.files.get('hls-pl-429.ts')],[7,8]);
  assert.ok(progress.some(event=>event.retrying===true && event.retryAttempt===1 && event.retryMax===4 && /429/.test(event.retryError)));

  // OffscreenDownload + progress-reporter flush retry metadata promptly and clear it on recovery.
  const forwarded=[],emitted=[];
  const client=new OffscreenDownload({task:{id:'t1',cachedBytes:0},ensureOffscreen:async()=>{},saveFile:async()=>{},onProgress:data=>forwarded.push(data)});
  client.runId='run-1';
  const reporter=createProgressReporter(data=>emitted.push(data),250);
  const workerOnProgress=data=>{
    if(data.retrying){reporter.update({phase:'retrying',...data});reporter.flush();}
    else reporter.update({phase:'downloading',retrying:false,retryAt:undefined,retryAttempt:undefined,retryMax:undefined,retryError:undefined,...data});
  };
  workerOnProgress({bytesReceived:100,progress:10});
  const retryAt=Date.now()+2000;
  workerOnProgress({bytesReceived:100,progress:10,retrying:true,retryAt,retryAttempt:1,retryMax:4,retryError:'HTTP 429'});
  workerOnProgress({bytesReceived:100,progress:10,retrying:true,retryAt:retryAt+2000,retryAttempt:2,retryMax:4,retryError:'HTTP 429'});
  workerOnProgress({bytesReceived:200,progress:20});
  reporter.dispose();
  assert.equal(emitted.length,4,'retrying transitions and consecutive retry attempts must flush immediately');
  for(const data of emitted)await client.handle({runId:'run-1',event:'progress',data});
  assert.equal(forwarded[1].retrying,true);assert.equal(forwarded[1].retryAttempt,1);assert.equal(forwarded[1].retryMax,4);assert.equal(forwarded[1].retryAt,retryAt);assert.equal(forwarded[1].retryError,'HTTP 429');
  assert.equal(forwarded[2].retrying,true);assert.equal(forwarded[2].retryAttempt,2);
  assert.equal(forwarded[3].retrying,false);assert.equal(forwarded[3].retryAt,undefined);assert.equal(forwarded[3].retryAttempt,undefined);assert.equal(forwarded[3].phase,'downloading');
  assert.equal(client.getBytesReceived(),200);
});
