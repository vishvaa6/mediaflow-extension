// Small structural fragments for testing ordering, cancellation and validation.
const word=n=>{const d=new Uint8Array(4);new DataView(d.buffer).setUint32(0,n);return d;};
const text=s=>new TextEncoder().encode(s);
function box(type,...parts){const size=8+parts.reduce((n,p)=>n+p.length,0),d=new Uint8Array(size);d.set(word(size));d.set(text(type),4);let i=8;for(const p of parts){d.set(p,i);i+=p.length;}return d;}
const full=(type,...p)=>box(type,word(0),...p);
const tkhd=new Uint8Array(84);tkhd.set(word(1),12);
const mdhd=new Uint8Array(24);mdhd.set(word(90000),12);
const mvhd=new Uint8Array(100);mvhd.set(word(1000),12);
const hdlr=new Uint8Array(24);hdlr.set(text('vide'),8);
export const initSegment=box('moov',box('mvhd',mvhd),box('trak',box('tkhd',tkhd),box('mdia',box('mdhd',mdhd),box('hdlr',hdlr),box('minf',box('stbl',full('stsd',word(0)))))));
export function fragment(marker,index=marker,count=1){
  const make=offset=>box('moof',box('traf',box('tfhd',word(0x38),word(1),word(180000),word(1),word(0)),full('tfdt',word(index*180000)),box('trun',word(1),word(count),word(offset))));
  const moof=make(make(0).length+8),mdat=box('mdat',new Uint8Array(count).fill(marker));
  const data=new Uint8Array(moof.length+mdat.length);data.set(moof);data.set(mdat,moof.length);
  return {type:'combined',initSegment,data};
}
export function mediaPayload(data){let p=0;while(p<data.length){const v=new DataView(data.buffer,data.byteOffset+p),n=v.getUint32(0),type=new TextDecoder().decode(data.subarray(p+4,p+8)),size=n===1?Number(v.getBigUint64(8)):n;if(type==='mdat')return [...data.subarray(p+(n===1?16:8),p+size)];p+=size;}throw Error('Missing mdat');}
export function memoryRoot(files=new Map()){
  return {async getFileHandle(name){return {getFile:async()=>new Blob([files.get(name)]),async createWritable(){let data=new Uint8Array(),position=0;return {async seek(n){position=n;},async write(value){const next=new Uint8Array(Math.max(data.length,position+value.length));next.set(data);next.set(value,position);data=next;position+=value.length;},async close(){files.set(name,data);},async abort(){}};}};}};
}
