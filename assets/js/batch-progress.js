export function batchProgress(batch,tasks=[],records=[]) {
  if(!batch?.id)return null;
  const own=tasks.filter(task=>task.batchId===batch.id);
  const ids=new Set(own.map(task=>task.id));
  const completed=records.filter(record=>record.batchId===batch.id && !ids.has(record.id)).length;
  const counts={remaining:Math.max(0,(batch.total || 0)-(batch.processed || 0)),waiting:0,active:0,paused:0,completed,failed:0};
  for(const task of own){
    if(task.status==='queued')counts.waiting++;
    else if(task.status==='downloading')counts.active++;
    else if(task.status==='paused')counts.paused++;
    else if(task.status==='error')counts.failed++;
  }
  const finished=batch.status==='complete' && !counts.remaining && !counts.waiting && !counts.active && !counts.paused && !counts.failed && !(batch.failed || 0) && completed+(batch.skipped || 0)>=(batch.total || 0);
  const label=batch.status==='cancelled'?'Batch cancelled':batch.status==='cancelling'?'Cancelling batch':batch.batchPaused?'Batch paused':finished?'All downloads completed':batch.status==='complete'?(batch.failed || batch.skipped?'Finished adding videos':'All videos queued'):batch.status==='error'?'Batch interrupted':batch.waitingForQueue?'Waiting for queue space':'Adding videos';
  const details=`${counts.remaining} not added · ${counts.waiting} waiting · ${counts.active} active · ${counts.paused} paused · ${counts.completed} completed · ${counts.failed} failed`;
  return {counts,finished,label,text:`${label} · ${details}${batch.skipped?' · '+batch.skipped+' skipped':''}${batch.failed?' · '+batch.failed+' could not be added':''}${batch.error?' · '+batch.error:''}`};
}
