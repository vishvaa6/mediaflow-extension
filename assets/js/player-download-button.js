import {expandHlsChoices} from './hls-playlist.js';
import {icon} from './icons.js';
import {videoKey} from './video-details.js';
import {notifyIfContextInvalid} from './extension-context.js';

const height=video=>Number(String(video.quality || '').match(/\d+/)?.[0]) || 0;
const validVariants=videos=>videos.filter(video=>video?.videoUrl && ['mp4','webm','m3u8'].includes(video.format));

// Prefer the highest native MP4 for a one-click download.
export function bestPlayerDownload(videos) {
  const candidates=validVariants(videos);
  const mp4=candidates.filter(video=>video.format==='mp4');
  return (mp4.length?mp4:candidates).sort((a,b)=>height(b)-height(a))[0];
}
const fileName=value=>String(value || 'Video').replace(/[<>:"/\\|?*\x00-\x1f]/g,' ').replace(/\s+/g,' ').trim().replace(/[. ]+$/,'').slice(0,120) || 'Video';
const samePlayer=(a,b)=>!!a && !!b && a.pageUrl===b.pageUrl && a.poster===b.poster && a.sourceKey===b.sourceKey;
const qualityKey=video=>`${video.format}:${height(video)}`;
const resolutionLabel=video=>height(video) ? `${height(video)}p` : 'Auto';
const formatLabel=video=>video.format==='m3u8' ? 'HLS' : video.format==='webm' ? 'WebM' : 'MP4';
const qualityLabel=video=>`${resolutionLabel(video)} ${formatLabel(video)}`;
const selectedVideo=(record,videos)=>videos.find(video=>video.videoUrl===record.selectedUrl) || videos.find(video=>qualityKey(video)===record.selectedQuality) || bestPlayerDownload(videos);

export async function fetchPlayerText(url,headers){
  try {
    const response=await chrome.runtime.sendMessage({type:'ext-fetch-text',url,headers});
    if(!response?.ok || typeof response.text!=='string')throw Error(response?.error || 'Unable to read video sources');
    return response.text;
  } catch(error) { notifyIfContextInvalid(error); throw error; }
}

export function createPlayerDownloadButtons({variants,loadEntry,visiblePlayers,pageScoped=false,
  needsLoad=entry=>!variants(entry).length,expandPlaylist=video=>expandHlsChoices(video,fetchPlayerText),unavailable=()=>''}) {
  const controls=new Map(),inFlight=new Set(),recent=new Set(),selections=new Map();
  const playlists=new Map();
  const reducedMotion=matchMedia('(prefers-reduced-motion: reduce)');
  let queuedPages=new Set(),queuedUrls=new Set(),latest=[],queueRevision=0,contextInvalid=false;
  const identity=(entry,video)=>pageScoped || entry.watchPage ? videoKey(video?.pageUrl || entry.pageUrl) : entry.sourceKey;
  const isQueued=(id,videos)=>queuedPages.has(id) || !pageScoped && videos.some(video=>queuedUrls.has(video.videoUrl));
  function setStyle(node,property,value){
    if(node.style.getPropertyValue(property)!==value)node.style.setProperty(property,value,'important');
  }
  function movePill(pill,parent,before=null){
    // When supported, move the existing control without closing its open menu or losing focus.
    if(pill.isConnected && parent.moveBefore)parent.moveBefore(pill,before);
    else parent.insertBefore(pill,before);
  }
  function positionMenu(record){
    const rect=record.pill.getBoundingClientRect();
    const viewportWidth=document.documentElement.clientWidth;
    const width=Math.min(174,viewportWidth-16);
    const below=window.innerHeight-rect.bottom-16,above=rect.top-16;
    const openBelow=below>=214 || below>=above;
    setStyle(record.menu,'width',`${width}px`);
    setStyle(record.menu,'left',`${Math.max(8,Math.min(rect.right,viewportWidth-8)-width)}px`);
    setStyle(record.menu,'top',openBelow?`${rect.bottom+6}px`:'auto');
    setStyle(record.menu,'bottom',openBelow?'auto':`${window.innerHeight-rect.top+6}px`);
    setStyle(record.menu,'max-height',`${Math.max(0,Math.min(292,openBelow?below:above))}px`);
    setStyle(record.menu,'transform-origin',openBelow?'top right':'bottom right');
    setStyle(record.menu,'--mf-menu-offset',openBelow?'-6px':'6px');
  }
  function loadPlaylists(videos){
    for(const video of videos){
      if(!expandPlaylist || video.format!=='m3u8')continue;
      const cached=playlists.get(video.videoUrl);
      if(cached && (!cached.retryAfter || cached.retryAfter>Date.now()))continue;
      const result={pending:true};
      playlists.set(video.videoUrl,result);
      while(playlists.size>64)playlists.delete(playlists.keys().next().value);
      expandPlaylist(video).then(choices=>{
        result.choices=choices.map(({videoUrl,quality})=>({videoUrl,quality}));
      },()=>{result.retryAfter=Date.now()+30000;}).finally(()=>{
        result.pending=false;
        sync(latest);
      });
    }
  }
  function choicesFor(videos){
    const unique=new Map();
    for(const video of videos){
      const sources=playlists.get(video.videoUrl)?.choices?.map(choice=>({...video,...choice})) || [video];
      for(const source of sources){
        const key=qualityKey(source);
        if(!unique.has(key))unique.set(key,source);
      }
    }
    return [...unique.values()].sort((a,b)=>height(b)-height(a) || Number(b.format==='mp4')-Number(a.format==='mp4'));
  }
  function updateChoices(record,videos,selected){
    const signature=JSON.stringify(videos.map(video=>[video.pageUrl,video.videoUrl,qualityKey(video)]));
    if(record.optionSignature!==signature){
      const focused=record.options.contains(document.activeElement)?document.activeElement.textContent:'';
      record.options.replaceChildren();
      for(const video of videos){
        const option=document.createElement('button');
        option.type='button';option.className='mediaflow-quality-option';
        const resolution=document.createElement('span');
        resolution.className='mediaflow-quality-resolution';resolution.textContent=resolutionLabel(video);
        const format=document.createElement('span');
        format.className='mediaflow-quality-format';format.textContent=formatLabel(video);
        option.append(resolution,' ',format);option.insertAdjacentHTML('beforeend',icon('check'));
        option.addEventListener('click',event=>{
          if(!event.isTrusted)return;
          record.selectedUrl=video.videoUrl;record.selectedQuality=qualityKey(video);
          const id=identity(record.entry,video);
          if(id){
            selections.set(id,record.selectedQuality);
            while(selections.size>64)selections.delete(selections.keys().next().value);
          }
          record.menu.hidePopover();record.trigger.focus({preventScroll:true});
          sync(latest);
          if(!reducedMotion.matches){
            record.label.animate([
              {opacity:.4,transform:'translateY(4px)'},
              {opacity:1,transform:'translateY(0)'}
            ],{duration:220,easing:'cubic-bezier(.18,.8,.3,1)'});
          }
        });
        record.options.append(option);
        if(focused && option.textContent===focused)option.focus({preventScroll:true});
      }
      record.optionSignature=signature;
    }
    for(const [index,option] of Array.from(record.options.children).entries()){
      option.setAttribute('aria-pressed',String(videos[index]===selected));
    }
  }
  function setMessage(record,value){if(contextInvalid)return;record.message.textContent=value;record.message.hidden=!value;clearTimeout(record.messageTimer);if(value)record.messageTimer=setTimeout(()=>{record.message.hidden=true;},5000);}
  function showReconnect(){
    if(contextInvalid)return;
    contextInvalid=true;
    for(const record of controls.values()){
      clearTimeout(record.messageTimer);
      record.button.disabled=true;record.trigger.disabled=true;
      if(record.menu.matches(':popover-open'))record.menu.hidePopover();
      const label=document.createElement('span');label.textContent='MediaFlow was reloaded. Refresh this page to reconnect.';
      const refresh=document.createElement('button');refresh.type='button';refresh.className='mediaflow-reconnect';refresh.textContent='Refresh page';
      for(const eventName of ['pointerdown','mousedown','touchstart','keydown','keyup'])refresh.addEventListener(eventName,event=>event.stopPropagation());
      refresh.addEventListener('click',event=>{event.stopPropagation();if(event.isTrusted)location.reload();});
      record.message.replaceChildren(label,refresh);record.message.hidden=false;
    }
  }
  document.addEventListener('mediaflow:context-invalidated',showReconnect);
  function removeControl(player,record){
    clearTimeout(record.messageTimer);record.glintMotion?.forEach(animation=>animation.cancel());
    record.pill.remove();record.message.remove();controls.delete(player);
    if(record.positioned && ![...controls.values()].some(other=>other.host===record.host))record.host.classList.remove('mediaflow-download-host');
  }
  function updateQueue(tasks){
    const list=Array.isArray(tasks)?tasks:[];
    const pages=new Set(list.map(task=>videoKey(task.pageUrl)).filter(Boolean));
    const urls=new Set(list.map(task=>task.url).filter(Boolean));
    const equal=(a,b)=>a.size===b.size && [...a].every(value=>b.has(value));
    if(equal(pages,queuedPages) && equal(urls,queuedUrls))return;
    queuedPages=pages;queuedUrls=urls;
    sync(latest);
  }
  chrome.storage?.onChanged?.addListener((changes,area)=>{if(area==='local' && changes.downloadQueueState){queueRevision++;updateQueue(changes.downloadQueueState.newValue?.tasks);}});
  const revision=queueRevision;
  chrome.storage?.local?.get?.('downloadQueueState').then(value=>{if(queueRevision===revision)updateQueue(value?.downloadQueueState?.tasks);}).catch(()=>{});
  function sync(entries){
    if(contextInvalid)return;
    latest=entries;
    const present=new Set();
    for(const entry of entries){
      const player=entry.element;
      const mediaElement=player.matches('video,iframe');
      const host=entry.overlayHost || (mediaElement?(player.closest('a,button') || player).parentElement:player);
      if(!host)continue;
      const fixed=host.matches('body,html');
      present.add(player);let record=controls.get(player);
      if(record && record.host!==host){removeControl(player,record);record=null;}
      if(!record){
        const claimed=new Set([...controls.values()].flatMap(control=>[control.pill,control.message]));
        const oldPills=[...host.children].filter(node=>node.classList.contains('mediaflow-download-pill') && !claimed.has(node));
        const oldButtons=[...host.children].filter(node=>node.classList.contains('mediaflow-download') && !claimed.has(node));
        const oldMessages=[...host.children].filter(node=>node.classList.contains('mediaflow-download-message') && !claimed.has(node));
        oldPills.shift()?.remove();oldButtons.shift()?.remove();
        const pill=document.createElement('span'),button=document.createElement('button'),message=oldMessages.shift() || document.createElement('span');
        const trigger=document.createElement('button'),label=document.createElement('span'),glint=document.createElement('span');
        const menu=document.createElement('div'),list=document.createElement('div'),options=document.createElement('div'),note=document.createElement('div');
        if(!mediaElement || host.querySelectorAll('video,iframe').length<2)for(const node of [...oldPills,...oldButtons,...oldMessages])node.remove();
        pill.className='mediaflow-download-pill';
        glint.className='mediaflow-glint';glint.setAttribute('aria-hidden','true');
        button.type='button';button.className='mediaflow-download';button.innerHTML=icon('download');
        const downloadLabel=document.createElement('span');
        downloadLabel.className='mediaflow-download-label';downloadLabel.textContent='Download';downloadLabel.setAttribute('aria-hidden','true');
        button.append(downloadLabel);
        trigger.type='button';trigger.className='mediaflow-download-quality';trigger.setAttribute('aria-expanded','false');
        trigger.append(label);trigger.insertAdjacentHTML('beforeend',icon('chevron-down'));
        menu.className='mediaflow-quality-menu';menu.popover='auto';menu.inert=true;
        menu.setAttribute('role','group');menu.setAttribute('aria-label','Available video qualities');
        list.className='mediaflow-quality-list';options.className='mediaflow-quality-options';
        note.className='mediaflow-quality-note';note.setAttribute('role','status');
        list.append(options,note);menu.append(list);
        trigger.popoverTargetElement=menu;
        pill.append(glint,trigger,button,menu);
        message.className='mediaflow-download-message';message.hidden=true;message.setAttribute('role','status');
        const positioned=!fixed && (host.classList.contains('mediaflow-download-host') || getComputedStyle(host).position==='static');
        if(positioned)host.classList.add('mediaflow-download-host');
        host.append(message);
        record={pill,button,trigger,label,menu,options,note,message,host,positioned,entry,mediaId:'',selectedUrl:'',selectedQuality:'',optionSignature:''};
        controls.set(player,record);
        const retryDock=()=>{
          if(record.entry.toolbarAnchor && !record.toolbarAnchor)requestAnimationFrame(()=>sync(latest));
        };
        pill.addEventListener('pointerleave',retryDock);
        pill.addEventListener('focusout',retryDock);
        pill.addEventListener('pointermove',event=>{
          if(reducedMotion.matches || event.pointerType==='touch' || menu.contains(event.target))return;
          if(!record.glintMotion){
            // Move the light inside the fixed rim mask without changing the page DOM.
            record.glintMotion=['backgroundPositionX','backgroundPositionY'].map(property=>{
              const animation=glint.animate([{[property]:'100%'},{[property]:'0%'}],{duration:1000,fill:'both'});
              animation.pause();return animation;
            });
          }
          const rect=pill.getBoundingClientRect();
          if(rect.width && rect.height){
            const position=[(event.clientX-rect.left)/rect.width,(event.clientY-rect.top)/rect.height];
            record.glintMotion.forEach((animation,index)=>{animation.currentTime=1000*Math.max(0,Math.min(1,position[index]));});
          }
        },{passive:true});
        for(const name of ['pointerdown','mousedown','touchstart'])button.addEventListener(name,event=>event.stopPropagation());
        for(const node of [trigger,menu])for(const name of ['pointerdown','mousedown','touchstart','click','keydown','keyup'])node.addEventListener(name,event=>event.stopPropagation());
        button.addEventListener('click',event=>{event.preventDefault();event.stopImmediatePropagation();if(event.isTrusted)download(record);});
        menu.addEventListener('beforetoggle',event=>{
          const open=event.newState==='open';
          pill.toggleAttribute('data-menu-open',open);trigger.setAttribute('aria-expanded',String(open));
          menu.inert=!open;
          if(open){
            positionMenu(record);
            loadPlaylists(validVariants(variants(record.entry)));
            sync(latest);
          }
        });
        menu.addEventListener('toggle',event=>{
          if(event.newState==='open' && loadEntry && needsLoad(record.entry)){
            record.loadingEntry=true;
            loadEntry(record.entry).finally(()=>{record.loadingEntry=false;sync(latest);});
          }
          sync(latest);
        });
      }
      let anchor=entry.toolbarAnchor?.isConnected ? entry.toolbarAnchor : null;
      if(anchor && !record.toolbarAnchor && (record.pill.matches(':hover,:focus-within') || record.menu.matches(':popover-open')))anchor=null;
      record.pill.toggleAttribute('data-player-fallback',Boolean((entry.overlayHost || entry.watchPage || entry.pageButton) && !anchor));
      record.pill.toggleAttribute('data-page-download',Boolean(entry.pageButton));
      record.message.toggleAttribute('data-page-download',Boolean(entry.pageButton));
      if(record.toolbarAnchor!==anchor){
        record.toolbarAnchor=anchor;
        record.pill.toggleAttribute('data-toolbar',Boolean(anchor));
        if(anchor)for(const property of ['position','top','right','--mf-player-width'])record.pill.style.removeProperty(property);
      }
      if(anchor){
        if(record.pill.parentElement!==anchor.parentElement){
          const activePills=new Set([...controls.values()].map(control=>control.pill));
          for(const child of [...anchor.parentElement.children]){
            if(child.matches('.mediaflow-download-pill[data-toolbar]') && !activePills.has(child))child.remove();
          }
        }
        if(anchor.previousElementSibling!==record.pill)movePill(record.pill,anchor.parentElement,anchor);
      }else if(record.pill.parentElement!==host){
        movePill(record.pill,host);
      }
      if(record.message.parentElement!==host)host.append(record.message);
      if(mediaElement){
        const rect=player.getBoundingClientRect(),parent=host.getBoundingClientRect();
        const top=Math.round(fixed?rect.top:rect.top-parent.top-host.clientTop+host.scrollTop);
        const right=Math.round(fixed?document.documentElement.clientWidth-rect.right:parent.left+host.clientLeft+host.clientWidth-rect.right-host.scrollLeft);
        if(fixed)setStyle(record.message,'position','fixed');
        if(!anchor){
          if(fixed)setStyle(record.pill,'position','fixed');
          setStyle(record.pill,'--mf-player-width',`${Math.max(0,Math.round(rect.width)-20)}px`);
          setStyle(record.pill,'top',`${top+10}px`);setStyle(record.pill,'right',`${right+10}px`);
        }
        setStyle(record.message,'top',`${top+48}px`);setStyle(record.message,'right',`${right+10}px`);
      }
      if(!samePlayer(record.entry,entry)){
        record.menu.hidePopover();setMessage(record,'');record.mediaId='';record.selectedUrl='';record.selectedQuality='';
      }
      record.entry=entry;
      const sources=validVariants(variants(entry)),open=record.menu.matches(':popover-open');
      if(open){loadPlaylists(sources);positionMenu(record);}
      const videos=choicesFor(sources),mediaId=identity(entry,sources[0]);
      if(record.mediaId!==mediaId){record.mediaId=mediaId;record.selectedUrl='';record.selectedQuality=selections.get(mediaId) || '';}
      const video=selectedVideo(record,videos),id=identity(entry,video);
      updateChoices(record,videos.filter(choice=>!playlists.get(choice.videoUrl)?.pending),video);
      const checking=sources.some(source=>playlists.get(source.videoUrl)?.pending);
      const note=checking?'Checking HLS qualities…':record.loadingEntry?'Detecting video…':videos.length?'':unavailable(entry) || 'No downloadable qualities found.';
      if(record.note.textContent!==note)record.note.textContent=note;
      if(record.note.hidden!==!note)record.note.hidden=!note;
      const quality=video?qualityLabel(video):'Quality';
      if(record.label.textContent!==quality)record.label.textContent=quality;
      record.trigger.setAttribute('aria-label',video?`Video quality: ${quality}`:'Video quality');
      const busy=inFlight.has(id),already=isQueued(id,[...sources,...videos]) || recent.has(id);
      record.button.disabled=busy || already;
      record.trigger.disabled=busy || already;
      if(open && record.trigger.disabled)record.menu.hidePopover();
      const label=busy?'Adding video to queue':already?'Video is already in the download queue':'Download video';
      record.button.setAttribute('aria-label',label);
    }
    for(const [player,record] of controls)if(!present.has(player)){
      removeControl(player,record);
    }
  }
  async function download(record){
    const start=record.entry,sources=validVariants(variants(start)),choices=choicesFor(sources);
    const initial=selectedVideo(record,choices),initialId=identity(start,initial);
    if(!initialId || inFlight.has(initialId) || isQueued(initialId,[...sources,...choices]) || recent.has(initialId))return;
    inFlight.add(initialId);sync(latest);setMessage(record,'');let finalId='';
    try{
      if(!initial && loadEntry)await loadEntry(start);
      const current=visiblePlayers().find(entry=>entry.element===start.element);
      if(!samePlayer(current,start))throw Error('The video changed. Choose it again.');
      const currentSources=validVariants(variants(current)),currentChoices=choicesFor(currentSources);
      const video=selectedVideo(record,currentChoices);if(!video)throw Error(unavailable(current) || 'No downloadable video was detected. Start playback and try again.');
      const id=identity(current,video),allSources=[...currentSources,...currentChoices];
      if(!id || isQueued(id,allSources) || recent.has(id) || id!==initialId && inFlight.has(id))throw Error('This video is already in the download queue.');
      if(id!==initialId){inFlight.add(id);finalId=id;sync(latest);}
      let settings={};try{settings=(await chrome.storage?.local?.get?.('download-settings'))?.['download-settings'] || {};}catch(error){if(notifyIfContextInvalid(error))throw error;}
      const still=visiblePlayers().find(entry=>entry.element===start.element);
      if(!samePlayer(still,start))throw Error('The video changed. Choose it again.');
      if(isQueued(id,allSources) || recent.has(id))throw Error('This video is already in the download queue.');
      const response=await chrome.runtime.sendMessage({type:'download-queue-enqueue',url:video.videoUrl,format:video.format,quality:String(video.quality || 'Auto'),
        outputFormat:settings.outputFormat==='source'?'source':'mp4',pageUrl:video.pageUrl,title:video.title,fileName:fileName(video.title),thumbnail:video.thumbnail || '',thumbnails:video.thumbnails || [],headers:video.headers});
      if(!response?.success)throw Error(response?.error || 'Unable to add video to the queue.');
      recent.add(id);if(controls.get(start.element)===record && samePlayer(record.entry,start))setMessage(record,'Added to download queue.');
      setTimeout(()=>{recent.delete(id);sync(latest);},2500);
    }catch(error){if(!notifyIfContextInvalid(error) && controls.get(start.element)===record && samePlayer(record.entry,start))setMessage(record,error.message || 'Unable to add video to the queue.');}
    finally{inFlight.delete(initialId);if(finalId)inFlight.delete(finalId);sync(latest);}
  }
  return {sync};
}
