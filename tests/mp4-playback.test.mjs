import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import vm from 'node:vm';
import path from 'node:path';
import {remuxToMp4} from '../assets/js/mp4-output.js';
import {memoryRoot} from './fixtures/mp4.mjs';

const out=path.resolve('test-results/playback');mkdirSync(out,{recursive:true});
function run(tool,args){const r=spawnSync(tool,args,{encoding:'utf8',windowsHide:true,maxBuffer:20*1024*1024});if(r.error)throw r.error;assert.equal(r.status,0,r.stderr);return r.stdout;}
const realm={};vm.runInNewContext(readFileSync('assets/vendor/mux-mp4.min.js','utf8'),realm);
function topBoxes(data){const result=[];let offset=0;while(offset<data.length){const v=new DataView(data.buffer,data.byteOffset+offset),size=v.getUint32(0),length=size===1?Number(v.getBigUint64(8)):size;assert.ok(length>=8 && offset+length<=data.length);result.push(new TextDecoder().decode(data.subarray(offset+4,offset+8)));offset+=length;}return result;}

for(const [name,extra] of [['bframes',[]],['delayed-audio',['-af','adelay=120|120']]]){
  test('indexed MP4 decodes every frame and seeks: '+name,async()=>{
    run('ffmpeg',['-y','-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc=size=160x90:rate=30000/1001','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','7.3','-c:v','libx264','-pix_fmt','yuv420p','-bf','3','-g','60','-c:a','aac',...extra,'-f','hls','-hls_time','2','-hls_playlist_type','vod','-hls_segment_filename',path.join(out,name+'-%d.ts'),path.join(out,name+'.m3u8')]);
    const playlist=readFileSync(path.join(out,name+'.m3u8'),'utf8'),files=new Map(),units=[];
    for(const match of playlist.matchAll(/#EXTINF:([\d.]+),\r?\n([^\r\n]+)/g)){
      files.set(match[2],readFileSync(path.join(out,match[2])));units.push({cacheName:match[2],duration:Number(match[1]),discontinuity:0});
    }
    await remuxToMp4({root:memoryRoot(files),units,output:'converted',transmuxerFactory:()=>new realm.muxjs.Transmuxer({keepOriginalTimestamps:false,remux:true})});
    const output=files.get('converted'),filename=path.join(out,name+'.mp4');writeFileSync(filename,output);
    assert.deepEqual(topBoxes(output),['ftyp','mdat','moov'],'saved MP4 must have a complete conventional index');
    const probe=JSON.parse(run('ffprobe',['-v','error','-count_frames','-show_entries','stream=codec_name,codec_type,nb_read_frames,duration:format=duration','-of','json',filename]));
    const video=probe.streams.find(s=>s.codec_type==='video');assert.equal(video.codec_name,'h264');assert.equal(Number(video.nb_read_frames),219);
    assert.equal(probe.streams.find(s=>s.codec_type==='audio').codec_name,'aac');
    assert.ok(Math.abs(Number(probe.format.duration)-7.3)<.15,JSON.stringify(probe));
    run('ffmpeg',['-v','error','-xerror','-i',filename,'-f','null','-']);
    run('ffmpeg',['-v','error','-xerror','-ss','5','-i',filename,'-frames:v','10','-f','null','-']);
    // Decoded pixels must match the original TS samples, including B-frame order.
    const source=path.join(out,name+'-all.ts');writeFileSync(source,Buffer.concat(units.map(u=>files.get(u.cacheName))));
    const hashes=file=>run('ffmpeg',['-v','error','-i',file,'-map','0:v','-f','framemd5','-']).split('\n').filter(l=>l && !l.startsWith('#')).map(l=>l.split(',').at(-1).trim());
    assert.deepEqual(hashes(filename),hashes(source));
    const audioHashes=file=>run('ffmpeg',['-v','error','-i',file,'-map','0:a','-f','framemd5','-']).split('\n').filter(l=>l && !l.startsWith('#')).map(l=>l.split(',').at(-1).trim());
    assert.deepEqual(audioHashes(filename),audioHashes(source),'conversion must retain decoded audio samples');
  });
}

test('timestamp resets at playlist discontinuities retain video and audio',async()=>{
  const files=new Map(),units=[];
  for(let repeat=0;repeat<2;repeat++)for(let i=0;i<2;i++){
    const cacheName=`${repeat}-${i}`;files.set(cacheName,readFileSync(path.join(out,`bframes-${i}.ts`)));units.push({cacheName,duration:2.002,discontinuity:repeat});
  }
  await remuxToMp4({root:memoryRoot(files),units,output:'converted',transmuxerFactory:()=>new realm.muxjs.Transmuxer({keepOriginalTimestamps:false,remux:true})});
  const filename=path.join(out,'discontinuous.mp4');writeFileSync(filename,files.get('converted'));
  const info=JSON.parse(run('ffprobe',['-v','error','-count_frames','-show_entries','stream=codec_type,nb_read_frames:format=duration','-of','json',filename]));
  assert.equal(Number(info.streams.find(s=>s.codec_type==='video').nb_read_frames),240);
  assert.ok(Math.abs(Number(info.format.duration)-8.008)<.15,JSON.stringify(info));
  run('ffmpeg',['-v','error','-xerror','-i',filename,'-f','null','-']);
});

test('native fragmented HLS becomes an indexed MP4 with audio and video',async()=>{
  run('ffmpeg',['-y','-hide_banner','-loglevel','error','-f','lavfi','-i','testsrc=size=160x90:rate=25','-f','lavfi','-i','sine=frequency=440:sample_rate=44100','-t','4','-c:v','libx264','-pix_fmt','yuv420p','-g','25','-c:a','aac','-f','hls','-hls_segment_type','fmp4','-hls_time','1','-hls_playlist_type','vod','-hls_fmp4_init_filename',path.join(out,'native-init.mp4'),'-hls_segment_filename',path.join(out,'native-%d.m4s'),path.join(out,'native.m3u8')]);
  const files=new Map([['init',readFileSync(path.join(out,'native-init.mp4'))]]),units=[{cacheName:'init',isMap:true}];
  for(let i=0;i<4;i++){files.set(String(i),readFileSync(path.join(out,`native-${i}.m4s`)));units.push({cacheName:String(i),duration:1});}
  await remuxToMp4({root:memoryRoot(files),units,output:'converted',fragmented:true});
  const output=files.get('converted'),filename=path.join(out,'native.mp4');writeFileSync(filename,output);
  assert.deepEqual(topBoxes(output),['ftyp','mdat','moov']);
  const info=JSON.parse(run('ffprobe',['-v','error','-count_frames','-show_entries','stream=codec_type,nb_read_frames:format=duration','-of','json',filename]));
  assert.equal(Number(info.streams.find(s=>s.codec_type==='video').nb_read_frames),100);
  assert.ok(Math.abs(Number(info.format.duration)-4)<.15,JSON.stringify(info));
  run('ffmpeg',['-v','error','-xerror','-i',filename,'-f','null','-']);
  run('ffmpeg',['-v','error','-xerror','-ss','2.5','-i',filename,'-frames:v','10','-f','null','-']);
});
