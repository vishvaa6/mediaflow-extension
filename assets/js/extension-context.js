// A content script cannot reconnect after Chrome invalidates its extension
// context. Notify the page controls so the user can choose to reload the tab.
export function notifyIfContextInvalid(error) {
  const message=typeof error==='string' ? error : error?.message || '';
  if(!/extension context invalidated/i.test(message))return false;
  document.dispatchEvent(new Event('mediaflow:context-invalidated'));
  return true;
}
