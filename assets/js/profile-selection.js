import {videoKey,downloadedRecord} from './video-details.js';

export function selectionView(videos,selection,history = []) {
  const keys = videos.map(video => videoKey(video.url));
  const start = selection?.mode === 'range' ? keys.indexOf(selection.start) : -1;
  const end = selection?.mode === 'range' ? keys.indexOf(selection.end) : -1;
  const complete = selection?.mode !== 'range' || start >= 0 && end >= 0;
  const wanted = selection?.mode === 'range'
    ? new Set(complete ? keys.slice(Math.min(start,end),Math.max(start,end)+1) : [selection.start].filter(Boolean))
    : selection?.mode === 'manual' ? new Set(selection.keys) : new Set(keys.filter(key => !selection?.excludedKeys?.includes(key)));
  const selected = videos.filter(video => wanted.has(videoKey(video.url)) && !downloadedRecord(history,video.url,video.videoUrl));
  return {videos:selected,keys:new Set(selected.map(video => videoKey(video.url))),start,end,complete};
}

export function changeSelection(previous,action,videos,history = []) {
  if (action.type === 'range') return {mode:'range',start:'',end:''};
  if (action.type === 'new') return {mode:'new'};
  if (action.type === 'clear') return {mode:'manual',keys:[]};
  if (!action.key) throw Error('Choose a video');
  if (action.type === 'pick' && previous?.mode === 'range' && !previous.end) {
    return {...previous,start:previous.start || action.key,end:previous.start ? action.key : ''};
  }
  if (action.type !== 'pick' && action.type !== 'toggle') throw Error('Unknown video selection action');
  if (!previous || previous.mode === 'new') {
    const excluded = new Set(previous?.excludedKeys || []);
    if (excluded.has(action.key)) excluded.delete(action.key); else excluded.add(action.key);
    return {mode:'new',excludedKeys:[...excluded]};
  }
  const keys = previous?.mode === 'manual' ? new Set(previous.keys) : selectionView(videos,previous,history).keys;
  if (keys.has(action.key)) keys.delete(action.key); else keys.add(action.key);
  return {mode:'manual',keys:[...keys]};
}

export function rangeHint(selection,view) {
  if (selection?.mode !== 'range') return 'Tick videos individually or choose a range.';
  if (!selection.start) return 'Click the first video in the range.';
  if (!selection.end) return 'Click the last video. You can change pages first.';
  if (!view.complete) return 'Finding both endpoints in the creator scan…';
  return `Range ${Math.min(view.start,view.end)+1}–${Math.max(view.start,view.end)+1} · ${view.videos.length} new videos selected`;
}
