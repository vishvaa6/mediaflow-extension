export function attributes(value) {
  const result = {};
  for (const match of value.matchAll(/([A-Z0-9-]+)=(?:"([^"]*)"|([^,]*))/gi)) result[match[1].toUpperCase()] = match[2] ?? match[3];
  return result;
}
const absolute = (value, base) => {
  const url = new URL(value, base);
  if (!/^https?:$/.test(url.protocol)) throw Error('Unsupported HLS resource URL');
  return url.href;
};
function byteRange(value, previousEnd, sameResource) {
  const match = String(value).match(/^(\d+)(?:@(\d+))?$/);
  if (!match || !Number.isSafeInteger(Number(match[1])) || Number(match[1]) <= 0) throw Error('Invalid HLS byte range');
  if (match[2] === undefined && (!sameResource || previousEnd === undefined)) throw Error('HLS byte range has no starting offset');
  const start = match[2] === undefined ? previousEnd : Number(match[2]);
  const length = Number(match[1]);
  if (!Number.isSafeInteger(start + length)) throw Error('HLS byte range is too large');
  return {start,length};
}
export function parsePlaylist(text, baseUrl) {
  const lines = String(text).replace(/^\uFEFF/,'').split(/\r?\n/).map(line => line.trim());
  if (lines[0] !== '#EXTM3U') throw Error('The server did not return an HLS playlist');
  const variants = [], audioGroups = new Set(), units = [];
  let sequence = 0, duration = 0, key = null, map = null, lastMap = '', rangeText, lastRange, lastUrl = '', discontinuity = 0;
  for (let i=0;i<lines.length;i++) {
    const line = lines[i];
    if (line.startsWith('#EXT-X-MEDIA:')) {
      const attrs = attributes(line.slice(line.indexOf(':')+1));
      if (attrs.TYPE === 'AUDIO' && attrs.URI) audioGroups.add(attrs['GROUP-ID']);
    } else if (line.startsWith('#EXT-X-STREAM-INF:')) {
      const attrs = attributes(line.slice(line.indexOf(':')+1));
      let next = i+1;
      while (next < lines.length && (!lines[next] || lines[next].startsWith('#'))) next++;
      if (next >= lines.length) throw Error('HLS variant has no playlist URL');
      variants.push({url:absolute(lines[next],baseUrl),height:Number(attrs.RESOLUTION?.split('x')[1]) || 0,bandwidth:Number(attrs.BANDWIDTH) || 0,audio:attrs.AUDIO});
      i = next;
    } else if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) {
      sequence = Number(line.split(':')[1]);
      if (!Number.isSafeInteger(sequence) || sequence < 0) throw Error('Invalid HLS media sequence');
    } else if (line.startsWith('#EXT-X-KEY:')) {
      const attrs = attributes(line.slice(line.indexOf(':')+1));
      if (attrs.METHOD === 'NONE') key = null;
      else {
        if (attrs.METHOD !== 'AES-128' || (attrs.KEYFORMAT && attrs.KEYFORMAT !== 'identity')) throw Error('This HLS encryption format is unsupported');
        if (!attrs.URI) throw Error('HLS encryption key URL is missing');
        key = {url:absolute(attrs.URI,baseUrl),iv:attrs.IV || ''};
      }
    } else if (line.startsWith('#EXT-X-MAP:')) {
      const attrs = attributes(line.slice(line.indexOf(':')+1));
      if (!attrs.URI) throw Error('HLS initialization URL is missing');
      if (key && !key.iv) throw Error('Encrypted HLS initialization needs an explicit IV');
      map = {url:absolute(attrs.URI,baseUrl),key:key ? {...key} : null,isMap:true,sequence,duration:0,discontinuity};
      if (attrs.BYTERANGE) map.range = byteRange(attrs.BYTERANGE,undefined,false);
    } else if (line.startsWith('#EXT-X-BYTERANGE:')) rangeText = line.slice(line.indexOf(':')+1);
    else if (line.startsWith('#EXTINF:')) duration = Number(line.slice(8).split(',')[0]) || 0;
    else if (line === '#EXT-X-DISCONTINUITY') { discontinuity++; lastMap = ''; }
    else if (line === '#EXT-X-GAP') throw Error('The playlist contains an unavailable segment; cached progress is retained');
    else if (line && !line.startsWith('#')) {
      const url = absolute(line,baseUrl);
      const unit = {url,sequence:sequence++,duration,key:key ? {...key} : null,isMap:false,discontinuity};
      if (rangeText) unit.range = byteRange(rangeText,lastRange?.start + lastRange?.length,url === lastUrl);
      lastRange = unit.range; lastUrl = url; rangeText = undefined;
      if (map) {
        const signature = JSON.stringify(map);
        if (lastMap !== signature) { units.push({...map}); lastMap = signature; }
      }
      units.push(unit);
      duration = 0;
    }
  }
  if (variants.length) return {variants,audioGroups:[...audioGroups]};
  if (!units.length) throw Error('The HLS playlist contains no video segments');
  if (!lines.includes('#EXT-X-ENDLIST') && !lines.includes('#EXT-X-PLAYLIST-TYPE:VOD')) throw Error('Persistent resume requires a complete video playlist; this stream is live');
  return {units,outputExtension:units.some(unit => unit.isMap) ? 'mp4' : 'ts'};
}
export function chooseVariant(variants, quality) {
  const sorted = [...variants].sort((a,b) => b.height-a.height || b.bandwidth-a.bandwidth);
  const wanted = Number(String(quality || '').match(/\d+/)?.[0]);
  return wanted ? sorted.find(item => item.height === wanted) || sorted.find(item => item.height < wanted) || sorted[0] : sorted[0];
}
export function compatiblePlaylists(oldUnits, newUnits) {
  // Sequence/timing/layout must match; query signatures and CDN hosts may change.
  return oldUnits.length === newUnits.length && oldUnits.every((unit,i) => {
    const fresh = newUnits[i];
    return unit.sequence === fresh.sequence && unit.duration === fresh.duration && unit.isMap === fresh.isMap &&
      unit.discontinuity === fresh.discontinuity && JSON.stringify(unit.range) === JSON.stringify(fresh.range) &&
      Boolean(unit.key) === Boolean(fresh.key) && (unit.key?.iv || '') === (fresh.key?.iv || '') &&
      new URL(unit.url).pathname.split('/').pop() === new URL(fresh.url).pathname.split('/').pop();
  });
}
export function encryptionIV(iv, sequence) {
  if (iv) {
    const hex = iv.replace(/^0x/i,'');
    if (!/^[a-f0-9]{1,32}$/i.test(hex)) throw Error('Invalid HLS encryption IV');
    return Uint8Array.from(hex.padStart(32,'0').match(/../g),value => parseInt(value,16));
  }
  const result = new Uint8Array(16);
  let value = BigInt(sequence);
  for (let i=15;i>=0;i--) { result[i] = Number(value & 255n); value >>= 8n; }
  return result;
}
