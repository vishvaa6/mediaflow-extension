// Keep transfer progress responsive without sending a cross-process message for
// every network chunk. Phase changes and terminal events are delivered promptly.
export function createProgressReporter(send,interval=250) {
  let pending,timer,lastPhase,lastSaving,hasSent=false;
  function flush(){
    clearTimeout(timer);timer=undefined;
    if(!pending)return;
    const value=pending;pending=undefined;
    hasSent=true;lastPhase=value.phase;lastSaving=!!value.isFileDownloading;
    send(value);
  }
  function update(value){
    pending={...pending,...value};
    if(!hasSent || pending.phase!==lastPhase || !!pending.isFileDownloading!==lastSaving){flush();return;}
    if(!timer)timer=setTimeout(flush,interval);
  }
  return {update,flush,dispose(){clearTimeout(timer);timer=undefined;pending=undefined;}};
}
