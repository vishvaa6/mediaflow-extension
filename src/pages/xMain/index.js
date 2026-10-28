// MAIN-world observer: use responses the page already receives. Never read or
// forward request headers, cookies, credentials, or an entire API response.
(() => {
  if(!/^(?:(?:www|m|mobile)\.)?(?:x|twitter)\.com$/i.test(location.hostname))return;
  const cache=new Map(), responseEvent='mediaflow:x:media';
  let requestedIds=null;
  const mediaUrl=value=>{
    try{const url=new URL(value);return url.protocol==='https:' && url.hostname==='video.twimg.com' && /\.(?:mp4|m3u8)$/i.test(url.pathname)?url.href:'';}catch{return '';}
  };
  function publish(){
    const id=location.pathname.match(/\/(?:status|statuses|tweet)\/(\d+)/)?.[1];
    const ids=requestedIds || (id?[id]:[]);
    document.dispatchEvent(new CustomEvent(responseEvent,{detail:JSON.stringify({posts:ids.map(id=>cache.get(id)).filter(Boolean)})}));
  }
  function capture(payload){
    const pending=[{value:payload,depth:0}];let visited=0,changed=false;
    while(pending.length && visited++<10000){
      const {value,depth}=pending.pop();
      if(!value || typeof value!=='object' || depth>32)continue;
      const legacy=value.legacy || value,id=String(value.rest_id || value.id_str || legacy.id_str || '');
      const media=legacy.extended_entities?.media || value.mediaDetails || legacy.entities?.media;
      if(/^\d+$/.test(id) && Array.isArray(media)){
        const details=media.slice(0,4).filter(item=>['video','animated_gif'].includes(item?.type)).map(item=>{
          const variants=item.video_info?.variants || item.video?.variants || item.media_info?.variants;
          return {type:item.type,media_url_https:String(item.media_url_https || item.poster || '').slice(0,2048),
            video_info:{variants:(Array.isArray(variants)?variants:[]).slice(0,16)
              .map(variant=>({url:mediaUrl(variant?.url || variant?.src)})).filter(variant=>variant.url)}};
        });
        if(details.some(item=>item.video_info.variants.length)){
          cache.set(id,{id_str:id,text:String(legacy.full_text || value.text || '').slice(0,300),mediaDetails:details});
          while(cache.size>32)cache.delete(cache.keys().next().value);
          changed=true;
        }
      }
      for(const child of Object.values(value))if(child && typeof child==='object')pending.push({value:child,depth:depth+1});
    }
    if(changed)publish();
  }
  function apiUrl(value){
    try{const url=new URL(value,location.href);return /^(?:(?:api|www|m|mobile)\.)?(?:x|twitter)\.com$/i.test(url.hostname) && /^\/(?:i\/api\/|1\.1\/|2\/)/.test(url.pathname);}catch{return false;}
  }
  const originalFetch=window.fetch;
  window.fetch=function(...args){
    const result=Reflect.apply(originalFetch,this,args);
    result.then(response=>{
      if(!response.ok || !apiUrl(args[0]?.url || args[0]))return;
      response.clone().json().then(capture).catch(()=>{});
    }).catch(()=>{});
    return result;
  };
  const originalOpen=XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open=function(...args){
    if(apiUrl(args[1]))this.addEventListener('load',()=>{
      if(this.status<200 || this.status>=300)return;
      try{capture(this.responseType==='json'?this.response:JSON.parse(this.responseText));}catch{}
    },{once:true});
    return Reflect.apply(originalOpen,this,args);
  };
  document.addEventListener('mediaflow:x:request',event=>{
    if(typeof event.detail==='string' && event.detail.length<4096){
      try{const ids=JSON.parse(event.detail).postIds;if(Array.isArray(ids))requestedIds=ids.filter(id=>typeof id==='string' && /^\d+$/.test(id)).slice(0,16);}catch{}
    }
    publish();
  });
  for(const method of ['pushState','replaceState']){
    const original=history[method];
    history[method]=function(...args){
      const result=Reflect.apply(original,this,args);
      document.dispatchEvent(new Event('mediaflow:x:navigate'));
      return result;
    };
  }
})();
