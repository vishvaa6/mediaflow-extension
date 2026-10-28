import '../vendor/mux-mp4.min.js';
import {HlsDownloader} from './hls-downloader.js';
import {DirectDownloader} from './direct-downloader.js';
import {resolveMedia} from './media-resolver.js';
import {mediaHeaders} from './media-headers.js';
import {isXPage} from './x-media.js';
import {fetchBytes,errorData,restoreError,networkError} from './network.js';

let engine,task,controller,stopped=false,callId=0;
const pending=new Map();
const emit=(event,data={})=>postMessage({event,...data});
function rpc(method,params){const id=++callId;return new Promise((resolve,reject)=>{pending.set(id,{resolve,reject});postMessage({rpc:true,id,method,params});});}
const headerBridge={add:(url,headers)=>rpc('headers',{url,headers}),remove:id=>rpc('release-headers',{id})};
async function fetchText(url,headers={}){
  const id=await headerBridge.add(url,headers),clean=new Headers(headers);
  for(const key of ['Origin','Referer','Cookie'])clean.delete(key);
  try {return new TextDecoder().decode((await fetchBytes(url,{headers:clean,signal:controller.signal,maxBytes:16*1024*1024})).data);}
  finally {if(id)await headerBridge.remove(id);}
}
async function resolveSource(strict=false){
  const html=isXPage(task.pageUrl)?'':await fetchText(task.pageUrl,{Referer:task.pageUrl});
  const source=await resolveMedia(html,task.pageUrl,task.quality,fetchText,{...(strict?{format:task.format,strictQuality:true}:{}),preferMp4:task.outputFormat==='mp4'});
  source.headers=mediaHeaders(source.headers || task.headers,task.pageUrl);
  source.title ||= task.title;
  // HLS checkpoints are anchored to the original URL. Renewed playlist URLs
  // live inside that checkpoint, while direct-file tasks persist the new URL.
  const persisted=strict && task.format==='m3u8'?{...source,url:task.url}:source;
  const result=await rpc('source',persisted);if(result?.skip){stopped=true;return null;}
  Object.assign(task,persisted);emit('source',{source:persisted});return source;
}
async function run(value){
  task=value;controller=new AbortController();stopped=false;
  try {
    if(!task.url){emit('progress',{data:{phase:'resolving',progress:0}});if(!await resolveSource())return;}
    controller.signal.throwIfAborted();
    const hls=task.format==='m3u8';
    const onProgress=data=>emit('progress',{data:{phase:'downloading',...data}});
    const onFailure=error=>{if(!stopped)emit('error',{error:errorData(networkError(error))});};
    const saveFile=async output=>{
      controller.signal.throwIfAborted();
      emit('ready',{output:{...output,onProgress:undefined,outputExtension:output.format==='m3u8'?'ts':output.format}});
    };
    const renewal=task.pageUrl?()=>resolveSource(true):undefined;
    if(hls){
      engine=new HlsDownloader({saveFile,headerBridge,resolveSource:renewal,maxConcurrent:4,resourceRetries:0,timeout:60000,
        transmuxerFactory:()=>new globalThis.muxjs.Transmuxer({keepOriginalTimestamps:false,remux:true}),onProgress,onFailure});
      await engine.start(task.url,{fileName:task.fileName,headers:task.headers,quality:task.quality,opfsFileName:task.opfsCacheFileName,outputFormat:task.outputFormat || 'source',downloadSubdir:task.downloadSubdir});
    }else{
      engine=new DirectDownloader({saveFile,headerBridge,resolveSource:renewal,onSourceRefreshed:source=>{Object.assign(task,source);emit('source',{source});}});
      const fallbackReason=task.outputFormat==='mp4' && task.format==='webm'?'MP4 is unavailable; saving the original WebM format.':undefined;
      await engine.start({...task,opfsFileName:task.opfsCacheFileName,onProgress:data=>onProgress({...data,outputExtension:task.format,outputCacheFileName:task.opfsCacheFileName,fallbackReason}),onFailure});
    }
  }catch(error){if(!stopped)emit('error',{error:errorData(networkError(error))});}
}
onmessage=async({data})=>{
  if(data.reply){const waiter=pending.get(data.id);pending.delete(data.id);if(waiter)data.error?waiter.reject(restoreError(data.error)):waiter.resolve(data.result);return;}
  if(data.command==='start'){run(data.task);return;}
  if(data.command==='pause'){
    stopped=true;controller?.abort(new DOMException('Paused','AbortError'));
    await engine?.pauseSoft();emit('paused');
  }
};
