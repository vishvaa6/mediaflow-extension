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
// The pinned mux.js distribution is loaded only inside the download worker.
export async function remuxToMp4({root,units,output,transmuxerFactory,check=()=>{},onProgress=()=>{}}) {
  const writer=await (await root.getFileHandle(output,{create:true})).createWritable();
  let mux,bytes=0,initWritten=false,initialSegment,pending=[],muxError,elapsed=0,lastDiscontinuity=units[0]?.discontinuity;
  const createMux=()=>{
    const instance=transmuxerFactory();
    instance.setBaseMediaDecodeTime?.(Math.round(elapsed*90000));
    instance.on('data',event=>{
      if(event.type==='audio')muxError=Object.assign(Error('MP4 conversion did not retain the video track'),{code:'CONVERSION_UNSUPPORTED'});
      if(!initWritten){initialSegment=event.initSegment;pending.push(initialSegment);initWritten=true;}
      else if(initialSegment.length!==event.initSegment.length || initialSegment.some((value,i)=>value!==event.initSegment[i]))muxError=Object.assign(Error('The video changes its codec configuration; the original format is required'),{code:'CONVERSION_UNSUPPORTED'});
      pending.push(event.data);
    });
    instance.on('error',error=>{muxError=Object.assign(Error(error.message || 'MP4 conversion is unsupported'),{code:'CONVERSION_UNSUPPORTED'});});
    return instance;
  };
  try {
    mux=createMux();
    for(let index=0;index<units.length;index++){
      check();
      if(units[index].isMap)continue;
      if(units[index].discontinuity!==lastDiscontinuity){mux.dispose?.();lastDiscontinuity=units[index].discontinuity;mux=createMux();}
      const file=await (await root.getFileHandle(units[index].cacheName)).getFile();
      checkTsCodecs(new Uint8Array(await file.slice(0,188*512).arrayBuffer()));
      const reader=file.stream().getReader();
      try {while(true){check();const {done,value}=await reader.read();if(done)break;mux.push(value);}}
      finally {await reader.cancel().catch(()=>{});}
      mux.flush();
      if(muxError)throw muxError;
      for(const data of pending){check();await writer.write(data);bytes+=data.byteLength;}
      pending=[];elapsed+=Number(units[index].duration)||0;onProgress((index+1)/units.length);
    }
    if(!initWritten || !bytes)throw Object.assign(Error('This stream uses a codec that cannot be remuxed to MP4'),{code:'CONVERSION_UNSUPPORTED'});
    check();await writer.close();return bytes;
  } catch(error){await writer.abort().catch(()=>{});throw error;}
  finally {mux?.dispose?.();}
}
