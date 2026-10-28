// Track the source website without opening or resizing any browser window.
export function installWindowManager(){
  let sourceTabId,sourceWindowId;
  if(!chrome.tabs?.query)return {source:async()=>({})};
  const rememberSource=async tab=>{
    if(!tab || !/^https?:\/\//.test(tab.url || ''))return;
    sourceTabId=tab.id;sourceWindowId=tab.windowId;
    await chrome.storage.local.set({mediaflowSource:{tabId:sourceTabId,windowId:sourceWindowId}});
    chrome.runtime.sendMessage({type:'mediaflow-source-changed',tabId:sourceTabId}).catch(()=>{});
  };
  async function source(requestedWindowId){
    if(Number.isInteger(requestedWindowId)){
      const [tab]=await chrome.tabs.query({active:true,windowId:requestedWindowId});
      if(tab && /^https?:\/\//.test(tab.url || '')){await rememberSource(tab);return {tab};}
    }
    if(sourceTabId==null){const saved=(await chrome.storage.local.get('mediaflowSource')).mediaflowSource;sourceTabId=saved?.tabId;sourceWindowId=saved?.windowId;}
    if(sourceTabId!=null)try {const tab=await chrome.tabs.get(sourceTabId);if(/^https?:\/\//.test(tab.url || ''))return {tab};}catch{}
    const tabs=await chrome.tabs.query({active:true,windowType:'normal'});
    const tab=tabs.find(tab=>tab.windowId===sourceWindowId) || tabs.find(tab=>/^https?:\/\//.test(tab.url || ''));
    await rememberSource(tab);return {tab};
  }
  chrome.tabs.onActivated?.addListener(async info=>{try{const win=await chrome.windows.get(info.windowId);if(win.type==='normal')await rememberSource(await chrome.tabs.get(info.tabId));}catch{}});
  chrome.tabs.onUpdated?.addListener((id,change,tab)=>{if(id===sourceTabId && (change.url || change.status==='complete'))rememberSource(tab);});
  chrome.tabs.onRemoved?.addListener(async id=>{if(id!==sourceTabId)return;sourceTabId=undefined;await chrome.storage.local.set({mediaflowSource:{}});const next=await source();if(!next.tab)chrome.runtime.sendMessage({type:'mediaflow-source-changed',tabId:null}).catch(()=>{});});
  chrome.windows?.onFocusChanged?.addListener(async id=>{if(id<0)return;try{const win=await chrome.windows.get(id);if(win.type==='normal'){const [tab]=await chrome.tabs.query({active:true,windowId:id});await rememberSource(tab);}}catch{}});
  return {source};
}
