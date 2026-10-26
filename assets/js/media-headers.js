// Keep a player's request context (often an iframe), filling only missing
// values from the outer page. Header names are case insensitive.
export function mediaHeaders(headers = {},pageUrl) {
  const result = {};
  for (const [key,value] of Object.entries(headers || {})) {
    if (typeof value !== 'string' || !value.trim() || /[\r\n]/.test(value)) continue;
    const name = /^referer$/i.test(key) ? 'Referer' : /^origin$/i.test(key) ? 'Origin' : key;
    result[name] = value.trim();
  }
  try {
    const page = new URL(pageUrl);
    if (/^https?:$/.test(page.protocol)) {
      result.Referer ||= page.href;
      // The referrer may be an embedded player on another origin.
      result.Origin ||= new URL(result.Referer).origin;
    }
  } catch {}
  return result;
}

export const exactRequestCondition = url => ({
  regexFilter:'^'+new URL(url).href.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'$',
  isUrlFilterCaseSensitive:true
});
