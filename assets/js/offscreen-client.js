import {restoreError} from './network.js';
export class OffscreenDownload {
  persistent=true;
  constructor({task,ensureOffscreen,saveFile,onProgress,onComplete,onFailure,onSourceRefreshed}){Object.assign(this,{task,ensureOffscreen,saveFile,onProgress,onComplete,onFailure,onSourceRefreshed});this.bytes=task.cachedBytes || 0;}
  getBytesReceived(){return this.bytes;}
  async start(){
    await this.ensureOffscreen();
    this.stopped=false;this.runId=crypto.randomUUID();
    const response=await chrome.runtime.sendMessage({type:'mf-offscreen-command',command:'start',task:this.task,runId:this.runId});
    if(!response?.ok)throw restoreError(response?.error || {message:'The transfer worker could not start'});
  }
  resume(){return this.start();}
  async handle(message){
    if(message.runId!==this.runId || this.stopped)return;
    if(message.event==='source'){Object.assign(this.task,message.source);await this.onSourceRefreshed?.(message.source);}
    if(message.event==='progress'){this.bytes=message.data.bytesReceived ?? this.bytes;this.onProgress?.(message.data);}
    if(message.event==='error')this.onFailure?.(restoreError(message.error));
    if(message.event==='ready' && !this.saving){
      this.saving=true;this.output=message.output;
      try {
        await this.onProgress?.({phase:'saving',progress:94,isFileDownloading:true,outputExtension:message.output.outputExtension,outputCacheFileName:message.output.opfsFileName,outputBytes:message.output.bytesReceived});
        await this.saveFile({...message.output,onProgress:this.onProgress});
        if(!this.stopped)this.onComplete?.();
      }catch(error){if(!this.stopped)this.onFailure?.(error);}
    }
  }
  async pauseSoft(){this.stopped=true;const response=await chrome.runtime.sendMessage({type:'mf-offscreen-command',command:'drop',taskId:this.task.id});if(!response?.ok)throw restoreError(response?.error || {message:'Could not pause the transfer'});}
  async destroy(){await this.pauseSoft();}
}
