// A progressing response has no wall-clock download deadline. Only silence times out.
export function networkError(error) {
  if (typeof error?.code==='string') return error;
  if(error?.name==='QuotaExceededError' || /FILE_NO_SPACE|DISK_FULL/.test(error?.message || String(error)))return Object.assign(Error('There is not enough storage space. Free disk space, then retry; committed progress is retained.'),{code:'STORAGE_FULL'});
  if(error?.name==='NotAllowedError' || /FILE_ACCESS_DENIED|FILE_SECURITY_CHECK_FAILED/.test(error?.message || String(error)))return Object.assign(Error('The browser could not save to the downloads folder. Check folder access, then retry the cached file.'),{code:'SAVE_ACCESS'});
  if (error?.name === 'TimeoutError' || /signal.*timed out|network_timeout/i.test(error?.message || String(error))) return Object.assign(Error('The connection timed out. Retrying will continue from cached progress.'),{code:'TIMEOUT'});
  if(/^(NETWORK_|SERVER_UNREACHABLE)/.test(error?.message || String(error)))return Object.assign(Error('The browser could not finish saving the file. Cached progress is retained.'),{code:'NETWORK'});
  if (error instanceof TypeError && /fetch|network|load|stream|connection/i.test(error.message)) return Object.assign(Error('The connection was interrupted. Cached progress is retained.'),{code:'NETWORK'});
  return error instanceof Error ? error : Error(String(error));
}
export const transientError = error => ['TIMEOUT','NETWORK'].includes(error?.code) || error?.status === 429 || error?.status >= 500 && error?.status <= 599;
export const errorData = error => ({message:error?.message || String(error),code:error?.code,status:error?.status,retryAfter:error?.retryAfter});
export const restoreError = value => Object.assign(Error(value?.message || String(value)),value);
export function retryDelay(attempt,retryAfter=0) {
  return Math.max(Math.min(120000,Number(retryAfter)||0),Math.round(1000 * 2 ** Math.max(0,attempt-1) * (1 + Math.random()*.2)));
}
export function retryAfterMs(value,now=Date.now()) {
  if (!value) return 0;
  const delay=/^\d+(?:\.\d+)?$/.test(value) ? Number(value)*1000 : Date.parse(value)-now;
  return Math.max(0,Math.min(120000,delay || 0));
}
export async function waitForData(promise,controller,timeout=60000) {
  let timer,abort;
  const signal=controller.signal;
  try {
    signal.throwIfAborted();
    return await Promise.race([promise,new Promise((_,reject)=>{
      abort=()=>reject(signal.reason || new DOMException('Cancelled','AbortError'));
      signal.addEventListener('abort',abort,{once:true});
      timer=setTimeout(()=>{
        const error=Object.assign(Error('The connection timed out after no data arrived. Cached progress is retained.'),{code:'TIMEOUT'});
        controller.abort(error);reject(error);
      },timeout);
    })]);
  } catch(error) { throw signal.aborted ? signal.reason || error : networkError(error); }
  finally {clearTimeout(timer);signal.removeEventListener('abort',abort);}
}
export async function fetchBytes(url,{headers={},signal,fetcher=fetch,timeout=60000,maxBytes=Infinity}={}) {
  const controller=new AbortController(),abort=()=>controller.abort(signal.reason);
  signal?.throwIfAborted();signal?.addEventListener('abort',abort,{once:true});
  let reader;
  try {
    const response=await waitForData(fetcher.call(globalThis,url,{headers,signal:controller.signal,credentials:'include',cache:'no-store'}),controller,timeout);
    if (!response.ok) {
      await response.body?.cancel();
      throw Object.assign(Error(`HTTP ${response.status}: unable to fetch this resource`),{code:'HTTP',status:response.status,retryAfter:retryAfterMs(response.headers.get('Retry-After'))});
    }
    reader=response.body?.getReader();
    if(!reader)throw Object.assign(Error('The server returned no readable data'),{code:'NETWORK'});
    const chunks=[];let length=0;
    while(true){
      const {done,value}=await waitForData(reader.read(),controller,timeout);
      if(done)break;
      length+=value.length;
      if(length>maxBytes)throw Object.assign(Error('The resource exceeds the supported size'),{code:'RESOURCE_SIZE'});
      chunks.push(value);
    }
    const expected=Number(response.headers.get('Content-Length'));
    if(expected && !response.headers.get('Content-Encoding') && length!==expected)throw Object.assign(Error('The response ended before all data arrived'),{code:'NETWORK'});
    const data=new Uint8Array(length);let offset=0;
    for(const chunk of chunks){data.set(chunk,offset);offset+=chunk.length;}
    return {data,url:response.url || url,headers:response.headers,status:response.status};
  } finally {signal?.removeEventListener('abort',abort);await reader?.cancel().catch(()=>{});}
}
