import {fetchBytes,errorData} from './network.js';

// Only this document owns transfer workers. The UI can close and the background
// coordinator can restart without terminating a transfer or duplicating it.
export function installOffscreenDownloads(){
  const runs=new Map(),fetches=new Map();
  const send=message=>chrome.runtime.sendMessage(message).catch(()=>{});
  async function drop(taskId){
    const run=runs.get(taskId);if(!run)return;
    if(run.state!=='ready' && run.state!=='error'){
      await new Promise(resolve=>{run.onPaused=resolve;run.worker.postMessage({command:'pause'});});
    }
    run.worker.terminate();runs.delete(taskId);
    for(const id of run.ruleIds)await send({type:'mf-header-release',id});
  }
  chrome.runtime.onMessage.addListener((message,sender,respond)=>{
    if(sender.id!==chrome.runtime.id || sender.tab)return false;
    if(message.type==='mf-offscreen-command'){
      const {command,task,taskId,runId}=message;
      if(command==='snapshot'){respond({ok:true,runs:[...runs.values()].map(({worker,onPaused,...run})=>({...run,ruleIds:[...run.ruleIds]}))});return false;}
      if(command==='drop'){drop(taskId).then(()=>respond({ok:true}),error=>respond({ok:false,error:errorData(error)}));return true;}
      if(command==='start'){
        const existing=runs.get(task.id);
        if(existing){respond({ok:existing.runId===runId,runId:existing.runId,error:existing.runId===runId?undefined:{message:'A transfer already owns this task'}});return false;}
        const worker=new Worker(new URL('./download-worker.js',import.meta.url),{type:'module'});
        const run={taskId:task.id,runId,task,state:'running',bytes:task.cachedBytes || 0,progress:{},ruleIds:new Set(),worker};
        runs.set(task.id,run);
        worker.onmessage=async({data})=>{
          if(data.rpc){
            try {
              let response;
              for(let attempt=0;attempt<4;attempt++){
                try{response=await chrome.runtime.sendMessage({type:'mf-run-rpc',taskId:task.id,runId,method:data.method,params:data.params});if(!response)throw Error('Download coordinator unavailable');break;}
                catch(error){if(attempt===3 || !/closed|context|channel|receiv|coordinator unavailable/i.test(error.message))throw Object.assign(error,{code:'NETWORK'});await new Promise(resolve=>setTimeout(resolve,250*2**attempt));}
              }
              if(!response?.success)throw Object.assign(Error(response?.error || 'Download coordinator unavailable'),response?.detail);
              if(data.method==='headers' && response.result)run.ruleIds.add(response.result);
              if(data.method==='release-headers')run.ruleIds.delete(data.params.id);
              worker.postMessage({reply:true,id:data.id,result:response.result});
            }catch(error){worker.postMessage({reply:true,id:data.id,error:errorData(error)});}
            return;
          }
          if(data.event==='paused'){run.state='paused';run.onPaused?.();return;}
          if(data.event==='source')Object.assign(run.task,data.source);
          if(data.event==='progress'){Object.assign(run.progress,data.data);run.bytes=data.data.bytesReceived ?? run.bytes;}
          if(data.event==='ready'){run.state='ready';run.output=data.output;}
          if(data.event==='error'){run.state='error';run.error=data.error;}
          send({type:'mf-run-event',taskId:task.id,runId,...data});
        };
        worker.onerror=event=>{
          run.state='error';run.error={message:event.message || 'The transfer worker stopped unexpectedly',code:'WORKER'};run.onPaused?.();
          send({type:'mf-run-event',taskId:task.id,runId,event:'error',error:run.error});
        };
        worker.postMessage({command:'start',task});respond({ok:true,runId});return false;
      }
    }
    if(message.type==='mf-fetch-cancel'){fetches.get(message.id)?.abort();respond({ok:true});return false;}
    if(message.type==='mf-fetch-resource'){
      const controller=new AbortController();fetches.set(message.id,controller);
      (async()=>{
        let ruleId;
        try{
          const headers=new Headers(message.headers || {});
          const rule=await chrome.runtime.sendMessage({type:'mf-header-add',url:message.url,headers:message.headers});
          if(!rule?.success)throw Error(rule?.error || 'Cannot prepare request headers');ruleId=rule.result;
          for(const key of ['Origin','Referer','Cookie'])headers.delete(key);
          const result=await fetchBytes(message.url,{headers,signal:controller.signal,maxBytes:message.image?5*1024*1024:16*1024*1024});
          if(!message.image)return {ok:true,text:new TextDecoder().decode(result.data)};
          const mime=(result.headers.get('Content-Type') || '').split(';')[0];
          if(!/^image\/(jpeg|png|webp|gif|avif)$/i.test(mime))throw Error('The thumbnail URL did not return an image');
          let binary='';for(let i=0;i<result.data.length;i+=8192)binary+=String.fromCharCode(...result.data.subarray(i,i+8192));
          return {ok:true,dataUrl:`data:${mime};base64,${btoa(binary)}`};
        }finally{fetches.delete(message.id);if(ruleId)await send({type:'mf-header-release',id:ruleId});}
      })().then(respond,error=>respond({ok:false,error:errorData(error)}));return true;
    }
    return false;
  });
}
