const first='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const second='11111111-2222-3333-4444-555555555555';
function packed(id=first){
  const table=['m3u8',...id.split('-').reverse(),'com','surrit','https','video','720p','source1280','source842','playlist','source'].join('|');
  const payload="e='8://7.6/5-4-3-2-1/d.0';c='8://7.6/5-4-3-2-1/a/9.0';b='8://7.6/5-4-3-2-1/a/9.0';";
  return `eval(function(p,a,c,k,e,d){return p}(${JSON.stringify(payload)},15,15,${JSON.stringify(table)}.split('|'),0,{}))`;
}
function player(id=first,title='Sample 101'){
  return `<!doctype html><title>${title}</title><meta property="og:image" content="https://images.test/${id}/cover.jpg"><h1>${title}</h1><video class="player" style="width:480px;height:240px" src="blob:https://missav.ws/fixture"></video><script type="application/x-player-source">${packed(id)}</script>`;
}
const master='#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=100,RESOLUTION=1280x720\n720p/video.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=200,RESOLUTION=1920x1080\n1080p/video.m3u8';
module.exports={first,second,packed,player,master};
