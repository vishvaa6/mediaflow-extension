import {xPost,xMediaUrl} from './x-media.js';
import {visibleArea} from './viewport.js';

const playerSelector='video,[data-testid="videoPlayer"],[data-testid="videoComponent"]';
const ownerSelector='[data-testid="quoteTweet"],article,[data-testid="tweet"]';
const playerFor=node=>node.closest('[data-testid="videoPlayer"]') || node.querySelector('[data-testid="videoPlayer"]') || node.closest('[data-testid="videoComponent"]') || node;

// Resolve each visible player to its own post, rather than the timeline URL.
export function visibleXPlayers(doc=document,pageUrl=location.href,view=window){
  const current=xPost(pageUrl),seen=new Set(),visible=[];
  for(const node of doc.querySelectorAll(playerSelector)){
    const player=playerFor(node);
    if(seen.has(player))continue;
    seen.add(player);
    const area=visibleArea(player,view);
    if(!area)continue;
    const owner=player.closest(ownerSelector);
    const links=owner ? [...owner.querySelectorAll('a[href]')].filter(link=>link.closest(ownerSelector)===owner) : [];
    const postLinks=links.map(link=>({link,post:xPost(new URL(link.getAttribute('href'),pageUrl).href)})).filter(item=>item.post);
    const timestamp=postLinks.find(item=>item.link.querySelector('time')) || postLinks[0];
    const post=timestamp?.post || (!owner?current:null);
    if(!post)continue;
    const siblings=owner ? [...new Set([...owner.querySelectorAll(playerSelector)].map(playerFor))].filter(item=>item.closest(ownerSelector)===owner) : [player];
    const linked=xPost(player.closest('a[href]')?.href);
    const index=linked?.id===post.id ? linked.index : siblings.length===1 && current?.id===post.id ? current.index : siblings.indexOf(player)+1;
    if(index<1 || index>4)continue;
    const video=player.matches('video')?player:player.querySelector('video');
    const direct=[video?.currentSrc,video?.getAttribute('src'),video?.querySelector('source')?.getAttribute('src')].map(xMediaUrl).find(Boolean) || '';
    const poster=video?.getAttribute('poster') || player.querySelector('img')?.getAttribute('src') || '';
    const title=String(owner?.querySelector('[data-testid="tweetText"]')?.textContent || video?.getAttribute('aria-label') || '').trim().slice(0,160);
    visible.push({element:player,pageUrl:`https://x.com/i/status/${post.id}/video/${index}`,postId:post.id,index,
      poster,direct,title,playing:!!video && !video.paused && !video.ended,area});
  }
  return visible.sort((a,b)=>Number(b.playing)-Number(a.playing) || b.area-a.area).slice(0,16);
}

export function sameXThumbnail(a,b){
  if(!a || !b)return false;
  try{
    const first=new URL(a),second=new URL(b);
    if(first.hostname!=='pbs.twimg.com' || second.hostname!=='pbs.twimg.com')return false;
    const id=url=>url.pathname.match(/\/(?:ext_tw_video_thumb|amplify_video_thumb|tweet_video_thumb)\/([^/]+)/)?.[1];
    return first.pathname===second.pathname || Boolean(id(first) && id(first)===id(second));
  }catch{return false;}
}
