import {Mp4File} from './mp4-file.js';
export const MP4_CONVERTER_VERSION=2;

// Refuse media codecs mux.js would otherwise silently drop from the output.
export function checkTsCodecs(data){
  for(let offset=0;offset+188<=data.length;offset+=188){
    if(data[offset]!==0x47)throw Object.assign(Error('This input is not MPEG-TS'),{code:'CONVERSION_UNSUPPORTED'});
    if(!(data[offset+1]&0x40))continue;
    const control=(data[offset+3]>>4)&3;if(control===0 || control===2)continue;
    let start=offset+4;if(control===3)start+=1+data[start];
    if(start>=offset+188)continue;start+=1+data[start];
    if(data[start]!==2 || start+12>offset+188)continue;
    const end=Math.min(start+3+((data[start+1]&15)<<8 | data[start+2])-4,offset+188);
    let entry=start+12+((data[start+10]&15)<<8 | data[start+11]);
    while(entry+5<=end){
      const type=data[entry];
      if(![0x1b,0x0f,0x15,0x86].includes(type))throw Object.assign(Error('The stream contains a codec that cannot be remuxed to MP4'),{code:'CONVERSION_UNSUPPORTED'});
      entry+=5+((data[entry+3]&15)<<8 | data[entry+4]);
    }
  }
}
// Append committed segments in playlist order while later segments download.
// The output is committed only after every segment has been processed.
export async function createMp4Remuxer({root,output,transmuxerFactory,fragmented=false,check=()=>{}}) {
  check();
  const writer=await (await root.getFileHandle(output,{create:true})).createWritable();
  const mp4=new Mp4File(writer);
  let mux,initWritten=false,initialSegment,pending=[],muxError,elapsed=0,lastDiscontinuity,closed=false;
  const createMux=()=>{
    const instance=transmuxerFactory();
    instance.setBaseMediaDecodeTime?.(Math.round(elapsed*90000));
    instance.on('data',event=>{
      if(event.type==='audio')muxError=Object.assign(Error('MP4 conversion did not retain the video track'),{code:'CONVERSION_UNSUPPORTED'});
      if(!initWritten){initialSegment=event.initSegment;initWritten=true;}
      else if(initialSegment.length!==event.initSegment.length || initialSegment.some((value,i)=>value!==event.initSegment[i]))muxError=Object.assign(Error('The video changes its codec configuration; the original format is required'),{code:'CONVERSION_UNSUPPORTED'});
      pending.push(event);
    });
    instance.on('error',error=>{muxError=Object.assign(Error(error.message || 'MP4 conversion is unsupported'),{code:'CONVERSION_UNSUPPORTED'});});
    return instance;
  };
  const abort=async()=>{
    if(closed)return;
    closed=true;pending=[];mux?.dispose?.();mp4.dispose();
    await writer.abort();
  };
  return {
    async append(unit){
      if(closed)throw Error('MP4 converter is closed');
      try {
        check();
        if(fragmented){
          const file=await (await root.getFileHandle(unit.cacheName)).getFile();
          const data=new Uint8Array(await file.arrayBuffer());check();
          if(unit.isMap){
            if(initialSegment && (initialSegment.length!==data.length || initialSegment.some((n,i)=>n!==data[i])))throw Object.assign(Error('MP4 track configuration changes at a discontinuity'),{code:'CONVERSION_UNSUPPORTED'});
            initialSegment=data;initWritten=true;return;
          }
          if(!initialSegment)throw Object.assign(Error('MP4 initialization is missing'),{code:'CONVERSION_UNSUPPORTED'});
          await mp4.append({initSegment:initialSegment,data});return;
        }
        if(unit.isMap)return;
        if(!mux || unit.discontinuity!==lastDiscontinuity){mux?.dispose?.();lastDiscontinuity=unit.discontinuity;mux=createMux();}
        const file=await (await root.getFileHandle(unit.cacheName)).getFile();
        checkTsCodecs(new Uint8Array(await file.slice(0,188*512).arrayBuffer()));
        const reader=file.stream().getReader();
        try {while(true){check();const {done,value}=await reader.read();if(done)break;mux.push(value);}}
        finally {await reader.cancel().catch(()=>{});}
        mux.flush();
        if(muxError)throw muxError;
        for(const event of pending){check();await mp4.append(event);}
        pending=[];elapsed+=Number(unit.duration)||0;
      }catch(error){await abort().catch(()=>{});throw error;}
    },
    async finish(){
      if(closed)throw Error('MP4 converter is closed');
      try {
        check();
        if(!initWritten)throw Object.assign(Error('This stream uses a codec that cannot be remuxed to MP4'),{code:'CONVERSION_UNSUPPORTED'});
        const bytes=await mp4.finish();check();
        await writer.close();closed=true;mux?.dispose?.();mp4.dispose();return bytes;
      }catch(error){await abort().catch(()=>{});throw error;}
    },
    abort
  };
}

// Retain the complete-cache entry point for callers outside the downloader.
export async function remuxToMp4({units,onProgress=()=>{},...options}) {
  const remuxer=await createMp4Remuxer(options);
  try {
    for(let index=0;index<units.length;index++){
      await remuxer.append(units[index]);onProgress((index+1)/units.length);
    }
    return await remuxer.finish();
  }finally {await remuxer.abort().catch(()=>{});}
}
