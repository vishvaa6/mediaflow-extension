// Reject common login, verification, and API error documents masquerading as
// a successful media response. Do not require specific video magic bytes:
// CDNs commonly serve valid video with a generic or incorrect content type.
export function assertMediaResponse(bytes, {sniff = true} = {}) {
  if (!sniff || !bytes?.length) return;
  const text = new TextDecoder().decode(bytes.subarray(0, 1024)).replace(/^\uFEFF/, '').trimStart();
  if (/^<(?:!doctype\s+html\b|html\b|head\b|body\b|title\b|script\b|\?xml\b)/i.test(text) ||
      /^[{[]/.test(text) && /"(?:error|errors|message|msg|detail|status|success|code)"\s*:/i.test(text)) throw invalidResponse();
}

function invalidResponse() {
  return Object.assign(Error('The site returned a login, verification, or error page instead of video. Open the original page, complete any required sign-in or verification, and retry. Cached data was kept.'), {code:'INVALID_MEDIA_RESPONSE'});
}
