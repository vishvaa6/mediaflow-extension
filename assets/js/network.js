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
export const transientError = error => ['TIMEOUT','NETWORK'].includes(error?.code) || [408,429,474].includes(error?.status) || error?.status >= 500 && error?.status <= 599;
export const errorData = error => ({message:error?.message || String(error),code:error?.code,status:error?.status,retryAfter:error?.retryAfter,...(error?.needsSourceRefresh?{needsSourceRefresh:true}:{})});
export const restoreError = value => Object.assign(Error(value?.message || String(value)),value);
export function retryDelay(attempt,retryAfter=0) {
  const count=Number.isFinite(Number(attempt))?Math.max(1,Math.floor(Number(attempt))):1;
  const exponential=Math.min(120000,Math.round(1000 * 2 ** Math.min(7,count-1) * (1 + Math.random()*.2)));
  return Math.max(Math.min(120000,Math.max(0,Number(retryAfter)||0)),exponential);
}
export function retryAfterMs(value,now=Date.now()) {
  if (!value) return 0;
  const text=String(value).trim();
  const delay=/^\d+(?:\.\d+)?$/.test(text) ? Number(text)*1000 : Date.parse(text)-now;
  return Math.max(0,Math.min(120000,delay || 0));
}
export function abortableSleep(ms,signal) {
  if (signal?.aborted) return Promise.reject(signal.reason || new DOMException('Cancelled','AbortError'));
  const delay=Math.max(0,Number(ms)||0);
  if (delay===0) return Promise.resolve();
  return new Promise((resolve,reject)=>{
    const onAbort=()=>{clearTimeout(timer);reject(signal.reason || new DOMException('Cancelled','AbortError'));};
    const timer=setTimeout(()=>{signal?.removeEventListener('abort',onAbort);resolve();},delay);
    signal?.addEventListener('abort',onAbort,{once:true});
  });
}
export async function withRetry(fn,{attempts=4,signal,onRetry,shouldRetry,baseDelay}={}) {
  const maxAttempts=Math.max(1,Math.floor(Number(attempts)||1));
  for (let attempt=1;;attempt++) {
    if (signal?.aborted) throw signal.reason || new DOMException('Cancelled','AbortError');
    try {
      return await fn(attempt);
    } catch (rawError) {
      if (signal?.aborted) throw signal.reason || rawError;
      const error=networkError(rawError);
      const retryable=shouldRetry ? shouldRetry(error,attempt) : transientError(error);
      if (attempt>=maxAttempts || !retryable) throw error;
      const retryAfter=Math.min(120000,Math.max(0,Number(error?.retryAfter)||0));
      const ms=baseDelay===undefined
        ? retryDelay(attempt,retryAfter)
        : Math.max(retryAfter,Math.min(120000,Math.round(Math.max(0,Number(baseDelay)||0) * 2 ** Math.min(7,attempt-1) * (1 + Math.random()*.2))));
      await onRetry?.(attempt,ms,error);
      await abortableSleep(ms,signal);
    }
  }
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
