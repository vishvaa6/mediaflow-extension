// Finalize mux.js fragments as a conventional, indexed MP4. Encoded samples
// stream straight to disk; only sample sizes/timing and chunk offsets stay in RAM.
const unsupported = message => Object.assign(Error(message),{code:'CONVERSION_UNSUPPORTED'});
const view = data => new DataView(data.buffer,data.byteOffset,data.byteLength);
const u32 = (data,offset=0) => {if(offset<0 || offset+4>data.length)throw unsupported('Truncated MP4 field');return view(data).getUint32(offset);};
const i32 = (data,offset=0) => {if(offset<0 || offset+4>data.length)throw unsupported('Truncated MP4 field');return view(data).getInt32(offset);};
const u64 = (data,offset=0) => {if(offset<0 || offset+8>data.length)throw unsupported('Truncated MP4 field');const n=Number(view(data).getBigUint64(offset));if(!Number.isSafeInteger(n))throw unsupported('MP4 offset is too large');return n;};
const word = n => {const data=new Uint8Array(4);view(data).setUint32(0,n);return data;};
const wide = n => {const data=new Uint8Array(8);view(data).setBigUint64(0,BigInt(n));return data;};
function words(values) {const data=new Uint8Array(values.length*4),v=view(data);values.forEach((n,i)=>v.setUint32(i*4,n));return data;}
const text = value => new TextEncoder().encode(value);
function join(parts) {const out=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let offset=0;for(const p of parts){out.set(p,offset);offset+=p.length;}return out;}
const box = (type,...parts) => {const body=join(parts);return join([word(body.length+8),text(type),body]);};
const full = (type,flags,...parts) => box(type,word(flags),...parts);
function boxes(data,start=0,end=data.length) {
  const result=[];
  while(start<end){
    if(end-start<8)throw unsupported('Truncated MP4 box');
    let size=u32(data,start),header=8;
    if(size===1){if(end-start<16)throw unsupported('Truncated MP4 box');size=u64(data,start+8);header=16;}
    if(size===0)size=end-start;
    if(size<header || start+size>end)throw unsupported('Invalid MP4 box size');
    result.push({type:String.fromCharCode(...data.subarray(start+4,start+8)),start,end:start+size,body:start+header,data:data.subarray(start,start+size)});
    start+=size;
  }
  return result;
}
const children = b => boxes(b.data,b.body-b.start);
const child = (b,type) => {const result=children(b).find(x=>x.type===type);if(!result)throw unsupported('Missing MP4 '+type);return result;};
const payload = b => b.data.subarray(b.body-b.start);
function durationBox(b,duration,timescale) {
  const p=payload(b),version=p[0],isTrack=b.type==='tkhd';
  // Version 1 supports long videos without overflowing a 32-bit duration.
  const head=isTrack?p.subarray(version?20:12,version?28:20):word(timescale);
  const rest=p.subarray(isTrack?(version?36:24):(version?32:20));
  const epoch=Math.floor(Date.now()/1000)+2082844800;
  return box(b.type,Uint8Array.of(1,p[1],p[2],p[3]),wide(epoch),wide(epoch),head,wide(duration),rest);
}
function addRun(runs,value,count=1) {const last=runs.at(-1);if(last?.[1]===value)last[0]+=count;else runs.push([count,value]);}
const table = (type,rows,version=0) => full(type,version<<24,word(rows.length),words(rows.flat()));

export class Mp4File {
  constructor(writer){this.writer=writer;this.tracks=new Map();this.position=0;this.started=false;}
  async initialize(init) {
    const top=boxes(init);this.moov=top.find(b=>b.type==='moov');
    if(!this.moov)throw unsupported('MP4 initialization is missing');
    const defaults=new Map();
    for(const b of children(this.moov).filter(b=>b.type==='mvex').flatMap(children).filter(b=>b.type==='trex')){
      const p=payload(b);if(u32(p,8)!==1)throw unsupported('Multiple MP4 sample descriptions are unsupported');defaults.set(u32(p,4),{duration:u32(p,12),size:u32(p,16),flags:u32(p,20)});
    }
    for(const trak of children(this.moov).filter(b=>b.type==='trak')){
      const tkhd=child(trak,'tkhd'),mdia=child(trak,'mdia'),mdhd=child(mdia,'mdhd'),minf=child(mdia,'minf'),stbl=child(minf,'stbl');
      const tp=payload(tkhd),mp=payload(mdhd),id=u32(tp,tp[0]?20:12),timescale=u32(mp,mp[0]?20:12);
      if(!timescale)throw unsupported('Invalid MP4 track timescale');
      const type=String.fromCharCode(...payload(child(mdia,'hdlr')).subarray(8,12));
      this.tracks.set(id,{id,timescale,type,trak,tkhd,mdia,mdhd,minf,stsd:child(stbl,'stsd').data,defaults:defaults.get(id)||{},sizes:[],times:[],cts:[],sync:[],chunks:[],duration:0,presentationEnd:0});
    }
    if(![...this.tracks.values()].some(t=>t.type==='vide'))throw unsupported('MP4 conversion did not retain the video track');
    const ftyp=box('ftyp',text('isom'),word(512),text('isomiso2avc1mp41'));
    await this.writer.write(ftyp);this.mdatPosition=ftyp.length;
    await this.writer.write(join([word(1),text('mdat'),wide(16)]));
    this.position=ftyp.length+16;this.started=true;
  }
  async append(event) {
    if(!this.started)await this.initialize(event.initSegment);
    const data=event.data,top=boxes(data),media=top.filter(b=>b.type==='mdat');
    for(const moof of top.filter(b=>b.type==='moof')){
      for(const traf of children(moof).filter(b=>b.type==='traf')){
        const hp=payload(child(traf,'tfhd')),flags=u32(hp)&0xffffff,track=this.tracks.get(u32(hp,4));
        if(!track)throw unsupported('MP4 contains an unknown track');
        let cursor=8,base=moof.start,defaults={...track.defaults};
        if(flags&1){base=u64(hp,cursor);cursor+=8;}
        if(flags&2){if(u32(hp,cursor)!==1)throw unsupported('MP4 sample description changes are unsupported');cursor+=4;}
        for(const [flag,key] of [[8,'duration'],[16,'size'],[32,'flags']])if(flags&flag){defaults[key]=u32(hp,cursor);cursor+=4;}
        const dp=payload(child(traf,'tfdt'));let decodeTime=dp[0]?u64(dp,4):u32(dp,4),dataOffset;
        for(const trun of children(traf).filter(b=>b.type==='trun')){
          const p=payload(trun),f=u32(p)&0xffffff,count=u32(p,4);let c=8,firstFlags;
          if(f&1){dataOffset=base+i32(p,c);c+=4;}
          if(f&4){firstFlags=u32(p,c);c+=4;}
          if(dataOffset==null)throw unsupported('MP4 sample offset is missing');
          const samples=[];let total=0;
          for(let i=0;i<count;i++){
            const sample={duration:defaults.duration,size:defaults.size,flags:i===0 && firstFlags!=null?firstFlags:defaults.flags,cts:0};
            for(const [flag,key] of [[256,'duration'],[512,'size'],[1024,'flags'],[2048,'cts']])if(f&flag){sample[key]=key==='cts' && p[0]===1?i32(p,c):u32(p,c);c+=4;}
            if(!sample.duration || !sample.size)throw unsupported('MP4 has an empty sample');
            total+=sample.size;samples.push(sample);
          }
          if(!media.some(b=>dataOffset>=b.body && dataOffset+total<=b.end))throw unsupported('MP4 samples exceed their media box');
          if(track.start==null)track.start=decodeTime;
          // Audio encoders can repeat priming packets across a discontinuity.
          // Drop only complete duplicate audio samples; retain video keyframes.
          while(samples.length && track.type==='soun' && decodeTime<track.start+track.duration-2){const s=samples.shift();dataOffset+=s.size;total-=s.size;decodeTime+=s.duration;}
          if(samples.length){
            const delta=decodeTime-(track.start+track.duration);
            if(delta< -2)throw unsupported(`MP4 ${track.type} decode timestamps overlap by ${-delta} ticks`);
            if(delta>2 && track.sizes.length){
              if(delta>track.timescale)throw unsupported('MP4 decode timestamps contain a large gap');
              const last=track.times.at(-1);last[0]--;if(!last[0])track.times.pop();addRun(track.times,last[1]+delta);track.duration+=delta;
            }
            track.chunks.push({offset:this.position,count:samples.length});
            for(const s of samples){track.sizes.push(s.size);addRun(track.times,s.duration);addRun(track.cts,s.cts);if(!(s.flags&0x10000))track.sync.push(track.sizes.length);track.presentationEnd=Math.max(track.presentationEnd,track.duration+s.duration+s.cts);track.duration+=s.duration;}
            await this.writer.write(data.subarray(dataOffset,dataOffset+total));this.position+=total;
          }
          dataOffset+=total;
        }
      }
    }
  }
  async finish() {
    const tracks=[...this.tracks.values()];
    if(!this.started || tracks.some(t=>!t.sizes.length))throw unsupported('MP4 conversion produced an empty track');
    const movieScale=1000,origin=Math.min(...tracks.map(t=>t.start/t.timescale));
    let movieDuration=0;
    const traks=tracks.map(t=>{
      const delay=Math.max(0,Math.round((t.start/t.timescale-origin)*movieScale));
      const duration=Math.ceil(t.presentationEnd/t.timescale*movieScale),total=duration+delay;movieDuration=Math.max(movieDuration,total);
      const stsc=[];t.chunks.forEach((chunk,i)=>{if(!i || chunk.count!==t.chunks[i-1].count)stsc.push([i+1,chunk.count,1]);});
      const offsets=t.chunks.some(c=>c.offset>0xffffffff)?full('co64',0,word(t.chunks.length),join(t.chunks.map(c=>wide(c.offset)))):full('stco',0,word(t.chunks.length),words(t.chunks.map(c=>c.offset)));
      const stbl=box('stbl',t.stsd,table('stts',t.times),...(t.cts.some(r=>r[1]!==0)?[table('ctts',t.cts,t.cts.some(r=>r[1]<0)?1:0)]:[]),table('stsc',stsc),full('stsz',0,word(0),word(t.sizes.length),words(t.sizes)),offsets,...(t.type==='vide'?[table('stss',t.sync.map(n=>[n]))]:[]));
      const minf=box('minf',...children(t.minf).filter(b=>b.type!=='stbl').map(b=>b.data),stbl);
      const mdia=box('mdia',...children(t.mdia).map(b=>b.type==='mdhd'?durationBox(b,t.duration,t.timescale):b.type==='minf'?minf:b.data));
      const edits=delay?[[delay,0xffffffff,0x10000],[duration,0,0x10000]]:[[duration,0,0x10000]];
      return box('trak',durationBox(t.tkhd,total),box('edts',table('elst',edits)),...children(t.trak).filter(b=>!['tkhd','mdia','edts'].includes(b.type)).map(b=>b.data),mdia);
    });
    const moov=box('moov',durationBox(child(this.moov,'mvhd'),movieDuration,movieScale),...traks);
    await this.writer.write(moov);const bytes=this.position+moov.length;
    await this.writer.seek(this.mdatPosition+8);await this.writer.write(wide(this.position-this.mdatPosition));
    return bytes;
  }
  dispose(){this.tracks.clear();this.moov=null;}
}
