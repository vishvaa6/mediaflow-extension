// Viewport intersection also respects scroll containers and hidden ancestors.
export function visibleArea(node,view=window){
  const rect=node.getBoundingClientRect();
  let left=Math.max(0,rect.left),right=Math.min(view.innerWidth,rect.right);
  let top=Math.max(0,rect.top),bottom=Math.min(view.innerHeight,rect.bottom);
  if(right<=left || bottom<=top || rect.width<8 || rect.height<8)return 0;
  for(let parent=node;parent;parent=parent.parentElement){
    const style=view.getComputedStyle(parent);
    if(style.display==='none' || style.visibility==='hidden' || style.visibility==='collapse' || Number(style.opacity)===0)return 0;
    if(parent===node)continue;
    const clip=parent.getBoundingClientRect();
    if(/hidden|clip|auto|scroll/.test(style.overflowX)){left=Math.max(left,clip.left);right=Math.min(right,clip.right);}
    if(/hidden|clip|auto|scroll/.test(style.overflowY)){top=Math.max(top,clip.top);bottom=Math.min(bottom,clip.bottom);}
    if(right<=left || bottom<=top)return 0;
  }
  return (right-left)*(bottom-top);
}
