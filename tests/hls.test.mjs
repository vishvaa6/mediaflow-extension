import test from 'node:test';
import assert from 'node:assert/strict';
import {HlsDownloader,removeHlsCache} from '../assets/js/hls-downloader.js';
import {DirectDownloader} from '../assets/js/direct-downloader.js';
import {parsePlaylist,encryptionIV} from '../assets/js/hls-playlist.js';
import {resolveMedia} from '../assets/js/media-resolver.js';

function storageFixture() {
  const files = new Map();
  const missing = () => new DOMException('Missing file','NotFoundError');
  const root = {
    async getFileHandle(name,{create=false}={}) {
      if (!files.has(name)) { if (!create) throw missing(); files.set(name,new Uint8Array()); }
      return {
        async getFile() { if (!files.has(name)) throw missing(); return new Blob([files.get(name)]); },
        async createWritable({keepExistingData=false}={}) {
          let staged = keepExistingData ? files.get(name).slice() : new Uint8Array(), position=0;
          return {
            async seek(n) { position=n; },
            async write(value) {
              const data = typeof value === 'string' ? new TextEncoder().encode(value) : value instanceof Blob ? new Uint8Array(await value.arrayBuffer()) : new Uint8Array(value);
              const next = new Uint8Array(Math.max(staged.length,position+data.length)); next.set(staged); next.set(data,position); staged=next; position+=data.length;
            },
            async close() { files.set(name,staged); },async abort() {}
          };
        }
      };
    },
    async removeEntry(name) { if(!files.delete(name))throw missing(); },
    async *entries() { for(const name of [...files.keys()])yield [name,{kind:'file'}]; }
  };
  return {files,getDirectory:async()=>root};
}
const playlist = (count=4,token='') => '#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:10\n'+Array.from({length:count},(_,i)=>`#EXTINF:2,\nseg-${i}.ts${token}`).join('\n')+'\n#EXT-X-ENDLIST';
const options={opfsFileName:'test.ts',fileName:'test',quality:'best'};
const source='https://video.test/list.m3u8';
const bodyFor = i => Uint8Array.of(i+1,i+11);
function fixtureFetcher(calls,text=playlist()) {
  return function(url) {
    assert.equal(this,globalThis,'fetch must retain the Window/Worker global receiver');
    calls.push(url);
    if(url.includes('.m3u8'))return Promise.resolve(new Response(text));
    return Promise.resolve(new Response(bodyFor(Number(url.match(/seg-(\d+)/)?.[1] || 0))));
  };
}

test('native fetch receiver is preserved for direct downloads',async()=>{
  const storage=storageFixture();let saved=false,error;
  const engine=new DirectDownloader({storage,fetcher:function(){assert.equal(this,globalThis);return Promise.resolve(new Response(Uint8Array.of(1,2)));},saveFile:async()=>{saved=true;}});
  await engine.start({url:'https://video.test/file.mp4',opfsFileName:'direct',fileName:'direct',onError:e=>{error=e;}});
  assert.equal(error,undefined);assert.equal(saved,true);
});

test('a fresh HLS engine resumes only missing segments from durable OPFS files',async()=>{
  const storage=storageFixture(),calls=[],errors=[];
  let first;
  first=new HlsDownloader({storage,maxConcurrent:1,fetcher:fixtureFetcher(calls),saveFile:async()=>assert.fail('Paused download must not save'),onError:e=>errors.push(e),onProgress:p=>{if(p.finishNum===2){first.pauseRequested=true;first.controller.abort();}}});
  await first.start(source,options);await first.pauseSoft();
  assert.equal(first.completed.size,2);
  const before=calls.length;let saved;
  const second=new HlsDownloader({storage,maxConcurrent:1,fetcher:fixtureFetcher(calls),saveFile:async result=>{saved=result;},onError:e=>errors.push(e)});
  await second.start(source,options);
  assert.deepEqual(calls.slice(before),['https://video.test/seg-2.ts','https://video.test/seg-3.ts']);
  assert.deepEqual([...storage.files.get('test.ts')],[1,11,2,12,3,13,4,14]);
  assert.equal(saved.bytesReceived,8);assert.deepEqual(errors,[]);
  await second.destroy(true);assert.equal(storage.files.size,0);
});

test('network errors keep completed segments and retry does not reset the cache',async()=>{
  const storage=storageFixture(),calls=[];let error;
  const normal=fixtureFetcher(calls);
  const first=new HlsDownloader({storage,maxConcurrent:1,retryInterval:0,fetcher:function(url){if(url.includes('seg-2'))return Promise.resolve(new Response('',{status:503}));return normal.call(this,url);},saveFile:async()=>{},onError:e=>{error=e;}});
  await first.start(source,options);assert.match(error,/503/);
  await first.destroy(false);
  const before=calls.length;
  const resumed=new HlsDownloader({storage,maxConcurrent:1,fetcher:fixtureFetcher(calls),saveFile:async()=>{}});
  await resumed.start(source,options);
  assert.deepEqual(calls.slice(before),['https://video.test/seg-2.ts','https://video.test/seg-3.ts']);
});

test('an empty file left by interruption is not counted as a completed segment',async()=>{
  const storage=storageFixture(),calls=[];let first;
  first=new HlsDownloader({storage,maxConcurrent:1,fetcher:fixtureFetcher(calls),saveFile:async()=>{},onProgress:p=>{if(p.finishNum===1){first.pauseRequested=true;first.controller.abort();}}});
  await first.start(source,options);
  storage.files.set('test.ts.hls-seg-0000001',new Uint8Array());
  const before=calls.length;
  await new HlsDownloader({storage,maxConcurrent:1,fetcher:fixtureFetcher(calls),saveFile:async()=>{}}).start(source,options);
  assert.equal(calls.slice(before).length,3);assert.ok(!calls.slice(before).some(url=>url.includes('seg-0')));
});

test('AES-128 IV/key state survives a new downloader without downloading the key again',async()=>{
  const storage=storageFixture(),calls=[];
  const rawKey=Uint8Array.from({length:16},(_,i)=>i+1);
  const key=await crypto.subtle.importKey('raw',rawKey,'AES-CBC',false,['encrypt']);
  const encrypted=await Promise.all([0,1].map(async i=>new Uint8Array(await crypto.subtle.encrypt({name:'AES-CBC',iv:encryptionIV('',50+i)},key,bodyFor(i)))));
  const text='#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:50\n#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\n#EXTINF:2,\nseg-0.ts\n#EXTINF:2,\nseg-1.ts\n#EXT-X-ENDLIST';
  const fetcher=function(url){assert.equal(this,globalThis);calls.push(url);return Promise.resolve(new Response(url.endsWith('key.bin')?rawKey:url.endsWith('.m3u8')?text:encrypted[Number(url.match(/seg-(\d+)/)[1])]));};
  let first;
  first=new HlsDownloader({storage,maxConcurrent:1,fetcher,saveFile:async()=>{},onProgress:p=>{if(p.finishNum===1){first.pauseRequested=true;first.controller.abort();}}});
  await first.start(source,options);
  const errors=[];
  await new HlsDownloader({storage,maxConcurrent:1,fetcher,saveFile:async()=>{},onError:e=>errors.push(e)}).start(source,options);
  assert.deepEqual(errors,[]);assert.deepEqual([...storage.files.get('test.ts')],[1,11,2,12]);
  assert.equal(calls.filter(url=>url.endsWith('key.bin')).length,1);
});

test('initialization fragments and byte-range segments assemble once in MP4 order',async()=>{
  const storage=storageFixture(),ranges=[];let saved;
  const text='#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:2,\n#EXT-X-BYTERANGE:2@0\nvideo.bin\n#EXTINF:2,\n#EXT-X-BYTERANGE:2\nvideo.bin\n#EXT-X-ENDLIST';
  const errors=[];
  const engine=new HlsDownloader({storage,maxConcurrent:1,fetcher:function(url,{headers}){
    if(url.endsWith('.m3u8'))return Promise.resolve(new Response(text));
    if(url.endsWith('init.mp4'))return Promise.resolve(new Response(Uint8Array.of(9,8)));
    const range=headers.get('Range');ranges.push(range);const start=Number(range.match(/=(\d+)/)[1]);
    return Promise.resolve(new Response(Uint8Array.of(start+1,start+2),{status:206,headers:{'Content-Range':`bytes ${start}-${start+1}/4`}}));
  },saveFile:async result=>{saved=result;},onError:e=>errors.push(e)});
  await engine.start(source,options);
  assert.deepEqual(errors,[]);assert.deepEqual(ranges,['bytes=0-1','bytes=2-3']);
  assert.deepEqual([...storage.files.get('test.ts')],[9,8,1,2,3,4]);assert.equal(saved.format,'mp4');
});

test('expired signed URLs refresh without re-fetching completed segments',async()=>{
  const storage=storageFixture(),calls=[];let first;
  first=new HlsDownloader({storage,maxConcurrent:1,fetcher:fixtureFetcher(calls,playlist(2,'?old')),saveFile:async()=>{},onProgress:p=>{if(p.finishNum===1){first.pauseRequested=true;first.controller.abort();}}});
  await first.start(source,options);
  const fresh='https://video.test/fresh.m3u8';let error;
  const engine=new HlsDownloader({storage,maxConcurrent:1,resolveSource:async()=>fresh,fetcher:function(url){calls.push(url);if(url===source||url.includes('?old'))return Promise.resolve(new Response('',{status:403}));return Promise.resolve(new Response(url===fresh?playlist(2,'?new'):bodyFor(1)));},saveFile:async()=>{},onError:e=>{error=e;}});
  await engine.start(source,options);
  assert.equal(error,undefined);assert.equal(calls.filter(url=>url.includes('seg-0')).length,1);
  assert.ok(calls.includes('https://video.test/seg-1.ts?new'));
  assert.deepEqual([...storage.files.get('test.ts')],[1,11,2,12]);
});

test('a changed playlist reports an error and retains all previous cached progress',async()=>{
  const storage=storageFixture(),calls=[];let first;
  first=new HlsDownloader({storage,maxConcurrent:1,fetcher:fixtureFetcher(calls,playlist(2,'?old')),saveFile:async()=>{},onProgress:p=>{if(p.finishNum===1){first.pauseRequested=true;first.controller.abort();}}});
  await first.start(source,options);let error;
  const engine=new HlsDownloader({storage,maxConcurrent:1,fetcher:url=>Promise.resolve(new Response(url===source?playlist(3):'',url===source?{}:{status:403})),saveFile:async()=>assert.fail('Changed playlist must not save'),onError:e=>{error=e;}});
  await engine.start(source,options);
  assert.match(error,/playlist changed/);assert.ok(storage.files.get('test.ts.hls-seg-0000000').length>0);
});

test('a failed final save retries entirely from cache with no network requests',async()=>{
  const storage=storageFixture(),calls=[];
  await new HlsDownloader({storage,maxConcurrent:1,fetcher:fixtureFetcher(calls),saveFile:async()=>{throw Error('Interrupted save');}}).start(source,options);
  let saved=false,error;
  await new HlsDownloader({storage,fetcher:()=>assert.fail('Completed download must not use the network'),saveFile:async()=>{saved=true;},onError:e=>{error=e;}}).start(source,options);
  assert.equal(error,undefined);assert.equal(saved,true);
  await removeHlsCache('test.ts',storage);assert.equal(storage.files.size,0);
});

test('master playlist selection and AES IV parsing are deterministic',()=>{
  const parsed=parsePlaylist('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=100,RESOLUTION=1280x720\nlow.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=200,RESOLUTION=1920x1080\nhigh.m3u8',source);
  assert.equal(parsed.variants.length,2);
  assert.equal(encryptionIV('0x1',0)[15],1);assert.equal(encryptionIV('',258)[14],1);assert.equal(encryptionIV('',258)[15],2);
});

test('direct HTTP 472 refreshes the page source and verifies overlap after a new engine starts',async()=>{
  const storage=storageFixture(),size=160000,offset=100000;
  const data=Uint8Array.from({length:size},(_,i)=>i%251);
  storage.files.set('direct',data.slice(0,offset));
  const calls=[],updates=[];let saved,error,resolutions=0;
  const engine=new DirectDownloader({storage,resolveSource:async signal=>{assert.equal(signal.aborted,false);resolutions++;return {url:'https://cdn.test/fresh.mp4',format:'mp4'};},
    onSourceRefreshed:async source=>updates.push(source.url),saveFile:async()=>{saved=true;},fetcher:async(url,options)=>{
      calls.push([url,options.headers.get('Range')]);assert.equal(options.cache,'no-store');assert.equal(options.credentials,'include');
      if(url.includes('old'))return new Response('',{status:472});
      const start=Number(options.headers.get('Range').match(/=(\d+)/)[1]);
      return new Response(new ReadableStream({start(c){for(let i=start;i<size;i+=7777)c.enqueue(data.slice(i,Math.min(i+7777,size)));c.close();}}),{status:206,headers:{'Content-Range':`bytes ${start}-${size-1}/${size}`}});
    }});
  // The saved queue byte count may lag OPFS after an abrupt browser close.
  await engine.start({url:'https://cdn.test/old.mp4',opfsFileName:'direct',totalBytes:size,resumeFromByte:0,onError:e=>{error=e;}});
  assert.equal(error,undefined);assert.equal(saved,true);assert.equal(resolutions,1);
  assert.deepEqual(calls,[['https://cdn.test/old.mp4','bytes=34464-'],['https://cdn.test/fresh.mp4','bytes=34464-']]);
  assert.deepEqual(updates,['https://cdn.test/fresh.mp4']);assert.deepEqual(storage.files.get('direct'),data);
});

test('direct refreshed content, size and invalid ranges never overwrite the partial file',async()=>{
  for(const scenario of ['content','size','range','short']){
    const storage=storageFixture();storage.files.set('direct',Uint8Array.of(1,2));let error;
    const body=scenario==='content'?Uint8Array.of(8,8,3,4):scenario==='short'?Uint8Array.of(1):Uint8Array.of(1,2,3,4);
    const range=scenario==='size'?'bytes 0-4/5':scenario==='range'?'bytes 2-3/4':'bytes 0-3/4';
    const engine=new DirectDownloader({storage,saveFile:async()=>assert.fail('Invalid source must not save'),fetcher:async()=>new Response(body,{status:206,headers:{'Content-Range':range}})});
    await engine.start({url:'https://cdn.test/video.mp4',opfsFileName:'direct',totalBytes:4,onError:e=>{error=e;}});
    assert.ok(error,scenario);assert.match(error,/Cached data was kept/i);assert.deepEqual([...storage.files.get('direct')],[1,2]);assert.equal(engine.getBytesReceived(),2);
  }
});

test('direct refresh fails once and keeps its cached bytes when the renewed URL is still rejected',async()=>{
  const storage=storageFixture();storage.files.set('direct',Uint8Array.of(1,2));let error,resolutions=0,requests=0;
  const engine=new DirectDownloader({storage,resolveSource:async()=>{resolutions++;return 'https://cdn.test/fresh.mp4';},saveFile:async()=>assert.fail(),fetcher:async()=>{requests++;return new Response('',{status:472});}});
  await engine.start({url:'https://cdn.test/old.mp4',opfsFileName:'direct',onError:e=>{error=e;}});
  assert.match(error,/472.*Link refresh failed.*Cached data was kept/);assert.equal(resolutions,1);assert.equal(requests,2);assert.deepEqual([...storage.files.get('direct')],[1,2]);
});

test('pause during direct source renewal aborts the request and retains the cache',async()=>{
  const storage=storageFixture();storage.files.set('direct',Uint8Array.of(1,2));let resolving;
  const ready=new Promise(resolve=>{resolving=resolve;});
  const engine=new DirectDownloader({storage,saveFile:async()=>assert.fail(),fetcher:async()=>new Response('',{status:472}),resolveSource:signal=>new Promise((resolve,reject)=>{resolving();signal.addEventListener('abort',()=>reject(signal.reason),{once:true});})});
  const run=engine.start({url:'https://cdn.test/old.mp4',opfsFileName:'direct',onError:()=>assert.fail('Pause is not an error')});
  await ready;await engine.pauseSoft();await run;assert.deepEqual([...storage.files.get('direct')],[1,2]);
});

test('source renewal keeps the exact quality and format when Pornhub metadata offers both MP4 and HLS',async()=>{
  const html='var flashvars_123 = '+JSON.stringify({mediaDefinitions:[{format:'mp4',videoUrl:'https://cdn.test/file.mp4',quality:720},{format:'hls',videoUrl:'https://cdn.test/master.m3u8',quality:720}]})+';';
  const fetcher=async()=> '#EXTM3U\n#EXT-X-STREAM-INF:RESOLUTION=1280x720\n720.m3u8';
  assert.equal((await resolveMedia(html,'https://www.pornhub.org/view_video.php?viewkey=test','720',fetcher,{format:'m3u8',strictQuality:true})).format,'m3u8');
  assert.equal((await resolveMedia(html,'https://www.pornhub.org/view_video.php?viewkey=test','720',fetcher,{format:'mp4',strictQuality:true})).format,'mp4');
  await assert.rejects(resolveMedia(html,'https://www.pornhub.org/view_video.php?viewkey=test','1080',fetcher,{format:'mp4',strictQuality:true}),/original video quality/);
});

test('HLS HTTP 472 refreshes even when the old playlist is readable and never re-fetches committed segments',async()=>{
  const storage=storageFixture(),calls=[];let first;
  first=new HlsDownloader({storage,maxConcurrent:1,fetcher:fixtureFetcher(calls,playlist(3,'?old')),saveFile:async()=>{},onProgress:p=>{if(p.finishNum===1){first.pauseRequested=true;first.controller.abort();}}});
  await first.start(source,options);
  let resolutions=0,error;
  const engine=new HlsDownloader({storage,maxConcurrent:2,resolveSource:async signal=>{assert.equal(signal.aborted,false);resolutions++;return {url:'https://video.test/fresh.m3u8',format:'m3u8'};},fetcher:async url=>{
    calls.push(url);
    if(url.includes('?old'))return new Response('',{status:472});
    return new Response(url===source?playlist(3,'?old'):url.includes('.m3u8')?playlist(3,'?new'):bodyFor(Number(url.match(/seg-(\d+)/)[1])));
  },saveFile:async()=>{},onError:e=>{error=e;}});
  await engine.start(source,options);
  assert.equal(error,undefined);assert.equal(resolutions,1);assert.equal(calls.filter(url=>url.includes('seg-0')).length,1);
  assert.deepEqual([...storage.files.get('test.ts')],[1,11,2,12,3,13]);
  const manifest=JSON.parse(new TextDecoder().decode(storage.files.get('test.ts.hls.json')));
  assert.equal(manifest.sourceUrl,source);assert.equal(manifest.refreshSourceUrl,'https://video.test/fresh.m3u8');
});

test('HLS can renew an expired initial playlist and bounds repeated 472 responses',async()=>{
  for(const rejectSegments of [false,true]){
    const storage=storageFixture();let error,resolutions=0,requests=0;
    const engine=new HlsDownloader({storage,maxConcurrent:1,resolveSource:async()=>{resolutions++;return 'https://video.test/fresh.m3u8';},fetcher:async url=>{
      requests++;
      if(url===source || (rejectSegments && !url.includes('.m3u8')))return new Response('',{status:472});
      return new Response(url.includes('.m3u8')?playlist(1):bodyFor(0));
    },saveFile:async()=>{},onError:e=>{error=e;}});
    await engine.start(source,options);
    assert.equal(resolutions,1);assert.ok(requests<=6);
    if(rejectSegments){assert.ok(error);assert.ok(storage.files.has('test.ts.hls.json'));}else{assert.equal(error,undefined);assert.deepEqual([...storage.files.get('test.ts')],[1,11]);}
  }
});

test('123av 403 recovery applies iframe headers to playlists and every segment and cleans request rules',async()=>{
  const previousChrome=globalThis.chrome,rules=new Map(),storage=storageFixture(),requests=[];
  globalThis.chrome={declarativeNetRequest:{updateSessionRules:async({addRules=[],removeRuleIds=[]})=>{for(const rule of addRules)rules.set(rule.id,rule);for(const id of removeRuleIds)rules.delete(id);}}};
  let saved=false,error;
  const page='https://123av.com/en/v/example',html='<iframe class="player__frame" src="https://javplayer.cc/e/example?token=valid"></iframe>';
  const textFor=(url,headers)=>{
    assert.equal(headers.Origin,'https://javplayer.cc');
    if(url.includes('/stream?')){assert.match(headers.Referer,/\/e\/example/);return JSON.stringify({media:{stream:'https://cdn.test/fresh.m3u8'}});}
    assert.equal(headers.Referer,'https://javplayer.cc/');
    return '#EXTM3U\n#EXT-X-STREAM-INF:RESOLUTION=1280x720\n720/list.m3u8';
  };
  const engine=new HlsDownloader({storage,maxConcurrent:2,
    resolveSource:async()=>resolveMedia(html,page,'720p',async(url,headers)=>textFor(url,headers),{format:'m3u8',strictQuality:true}),
    fetcher:async(url,{headers})=>{
      const effective=Object.fromEntries(headers.entries());
      for(const rule of rules.values())if(new RegExp(rule.condition.regexFilter).test(url))for(const header of rule.action.requestHeaders)effective[header.header.toLowerCase()]=header.value;
      requests.push({url,headers:effective});
      if(effective.origin!=='https://javplayer.cc' || effective.referer!=='https://javplayer.cc/')return new Response('',{status:403});
      if(url.includes('.m3u8'))return new Response(playlist(2));
      return new Response(bodyFor(Number(url.match(/seg-(\d+)/)[1])));
    },saveFile:async()=>{saved=true;},onError:e=>{error=e;}});
  try{
    await engine.start('https://cdn.test/old.m3u8',{...options,quality:'720p',headers:{Origin:'https://123av.com',Referer:page}});
    assert.equal(error,undefined);assert.equal(saved,true);assert.equal(requests[0].headers.origin,'https://123av.com');
    for(const request of requests.slice(1)){assert.equal(request.headers.origin,'https://javplayer.cc');assert.equal(request.headers.referer,'https://javplayer.cc/');}
    assert.deepEqual([...storage.files.get('test.ts')],[1,11,2,12]);assert.equal(rules.size,0);
  }finally{if(previousChrome===undefined)delete globalThis.chrome;else globalThis.chrome=previousChrome;}
});
