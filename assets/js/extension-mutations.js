// Ignore changes made entirely by MediaFlow's own controls. Site changes on
// their parents still count, including moving or removing a video player.
const ownedSelector='.mediaflow-download-pill,.mediaflow-download-message,.mediaflow-download-status,.mediaflow-pick-tick,#mediaflow-profile-picker,.mediaflow-optics-defs,[data-mediaflow-glass-defs]';
function owned(node){
  const element=node?.nodeType===1?node:node?.parentElement;
  return !!element?.closest?.(ownedSelector);
}
export function affectsPage(change){
  if(owned(change.target))return false;
  if(change.type!=='childList')return true;
  const nodes=[...change.addedNodes,...change.removedNodes];
  return !nodes.length || nodes.some(node=>!owned(node));
}
