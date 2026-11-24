export const decodeMediaText = value => String(value || '')
  .replace(/&amp;/g, '&')
  .replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'")
  .replace(/&#x2f;/gi, '/')
  .replace(/\\\//g, '/')
  .replace(/\\u0026/gi, '&');

export function mediaHeight(value) {
  const raw = String(Array.isArray(value) ? value[0] : value || '').trim();
  const digits = Number(raw.match(/\d{3,4}/)?.[0]);
  if (digits) return digits;
  if (/(?:^|[^a-z0-9])(?:4k|uhd)(?:$|[^a-z0-9])/i.test(raw)) return 2160;
  if (/(?:^|[^a-z0-9])(?:2k|qhd)(?:$|[^a-z0-9])/i.test(raw)) return 1440;
  return 0;
}

export function urlHeightHint(url) {
  const match = String(url || '').match(/(?:^|[/_.-])(\d{3,4})p?(?:[/_.-]|$)/i);
  if (match) {
    const height = Number(match[1]);
    if (height >= 144 && height <= 4320) return height;
  }
  return mediaHeight(String(url || '').match(/(?:^|[/_.-])(4k|2k|uhd|qhd)(?:[/_.-]|$)/i)?.[1] || '');
}

export function mediaFormat(url, type = '') {
  if (/m3u8|mpegurl|^hls$/i.test(type) || /\.m3u8(?:[?#]|$)/i.test(url)) return 'm3u8';
  if (/webm/i.test(type) || /\.webm(?:[?#]|$)/i.test(url)) return 'webm';
  return 'mp4';
}

export function tagAttribute(tag, name) {
  return decodeMediaText(tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, 'i'))?.[1]);
}

function skipWsAndComments(source, index) {
  let i = index;
  while (i < source.length) {
    const ch = source[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (ch === '/' && source[i + 1] === '/') {
      const nl = source.indexOf('\n', i + 2);
      i = nl === -1 ? source.length : nl + 1;
      continue;
    }
    if (ch === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2);
      i = end === -1 ? source.length : end + 2;
      continue;
    }
    break;
  }
  return i;
}

function readJsString(source, start) {
  const quote = source[start];
  let out = '', i = start + 1;
  while (i < source.length) {
    const ch = source[i++];
    if (ch === quote) return {value: out, end: i};
    if (ch === '\\' && i < source.length) {
      const esc = source[i++];
      if (esc === 'n') out += '\n';
      else if (esc === 'r') out += '\r';
      else if (esc === 't') out += '\t';
      else if (esc === 'b') out += '\b';
      else if (esc === 'f') out += '\f';
      else if (esc === 'u' && /^[0-9a-f]{4}/i.test(source.slice(i, i + 4))) {
        out += String.fromCharCode(parseInt(source.slice(i, i + 4), 16));
        i += 4;
      } else if (esc === 'x' && /^[0-9a-f]{2}/i.test(source.slice(i, i + 2))) {
        out += String.fromCharCode(parseInt(source.slice(i, i + 2), 16));
        i += 2;
      } else {
        out += esc;
      }
    } else {
      out += ch;
    }
  }
  return {value: out, end: i};
}

function readJsValue(source, start, depth) {
  let i = skipWsAndComments(source, start);
  if (i >= source.length || depth > 8) return {value: undefined, end: i};
  const ch = source[i];
  if (ch === "'" || ch === '"' || ch === '`') {
    let {value, end} = readJsString(source, i);
    while (true) {
      const next = skipWsAndComments(source, end);
      if (source[next] === '+') {
        const afterPlus = skipWsAndComments(source, next + 1);
        const q = source[afterPlus];
        if (q === "'" || q === '"' || q === '`') {
          const part = readJsString(source, afterPlus);
          value += part.value;
          end = part.end;
          continue;
        }
      }
      break;
    }
    return {value, end};
  }
  if (ch === '{') return readJsObject(source, i, depth + 1);
  if (ch === '[') return readJsArray(source, i, depth + 1);

  let end = i;
  let parenDepth = 0, braceDepth = 0, bracketDepth = 0;
  while (end < source.length) {
    const cur = source[end];
    if (cur === "'" || cur === '"' || cur === '`') {
      end = readJsString(source, end).end;
      continue;
    }
    if (cur === '(') { parenDepth++; end++; continue; }
    if (cur === ')') {
      if (parenDepth === 0 && braceDepth === 0 && bracketDepth === 0) break;
      if (parenDepth > 0) parenDepth--;
      end++; continue;
    }
    if (cur === '{') { braceDepth++; end++; continue; }
    if (cur === '}') {
      if (parenDepth === 0 && braceDepth === 0 && bracketDepth === 0) break;
      if (braceDepth > 0) braceDepth--;
      end++; continue;
    }
    if (cur === '[') { bracketDepth++; end++; continue; }
    if (cur === ']') {
      if (parenDepth === 0 && braceDepth === 0 && bracketDepth === 0) break;
      if (bracketDepth > 0) bracketDepth--;
      end++; continue;
    }
    if (parenDepth === 0 && braceDepth === 0 && bracketDepth === 0 && cur === ',') break;
    end++;
  }
  const token = source.slice(i, end).trim();
  if (token === 'true') return {value: true, end};
  if (token === 'false') return {value: false, end};
  if (token === 'null') return {value: null, end};
  if (/^-?\d+(?:\.\d+)?$/.test(token)) return {value: Number(token), end};
  return {value: token || undefined, end};
}

function readJsArray(source, start, depth = 0) {
  if (source[start] !== '[' || depth > 8) return {value: null, end: start};
  const items = [];
  let i = skipWsAndComments(source, start + 1);
  while (i < source.length) {
    if (source[i] === ']') return {value: items, end: i + 1};
    const parsed = readJsValue(source, i, depth + 1);
    items.push(parsed.value);
    i = skipWsAndComments(source, parsed.end);
    if (source[i] === ',') {
      i = skipWsAndComments(source, i + 1);
      continue;
    }
    if (source[i] === ']') return {value: items, end: i + 1};
    break;
  }
  return {value: null, end: i};
}

function readJsObject(source, start, depth = 0) {
  if (source[start] !== '{' || depth > 8) return {value: null, end: start};
  const obj = {};
  let i = skipWsAndComments(source, start + 1);
  while (i < source.length) {
    if (source[i] === '}') return {value: obj, end: i + 1};
    let key = '';
    const ch = source[i];
    if (ch === "'" || ch === '"' || ch === '`') {
      const parsedKey = readJsString(source, i);
      key = parsedKey.value;
      i = parsedKey.end;
    } else {
      const keyMatch = source.slice(i).match(/^[A-Za-z0-9_$-]+/);
      if (!keyMatch) break;
      key = keyMatch[0];
      i += key.length;
    }
    i = skipWsAndComments(source, i);
    if (source[i] !== ':') break;
    const parsedVal = readJsValue(source, i + 1, depth + 1);
    if (key) obj[key] = parsedVal.value;
    i = skipWsAndComments(source, parsedVal.end);
    if (source[i] === ',') {
      i = skipWsAndComments(source, i + 1);
      continue;
    }
    if (source[i] === '}') return {value: obj, end: i + 1};
    break;
  }
  return {value: Object.keys(obj).length ? obj : null, end: i};
}

export function parseJsObjectLiteral(source, startIndex) {
  const i = skipWsAndComments(source, startIndex);
  if (source[i] !== '{') return null;
  return readJsObject(source, i, 0).value;
}

export function parseJsArrayLiteral(source, startIndex) {
  const i = skipWsAndComments(source, startIndex);
  if (source[i] !== '[') return null;
  return readJsArray(source, i, 0).value;
}

export function computeKvsLicenseToken(licenseCode) {
  const digits = String(licenseCode || '').replace(/\D/g, '');
  if (digits.length < 4) return '';
  const modLicense = digits.replace(/0/g, '1');
  const center = Math.floor(modLicense.length / 2);
  if (!center) return '';
  const frontHalf = BigInt(modLicense.slice(0, center + 1));
  const backHalf = BigInt(modLicense.slice(center));
  const diff = frontHalf >= backHalf ? frontHalf - backHalf : backHalf - frontHalf;
  const scaled = (4n * diff).toString().slice(0, center + 1);
  let token = '';
  for (let o = 0; o < scaled.length; o++) {
    const modDigit = Number(scaled[o]);
    for (let i = 0; i < 4; i++) {
      token += String((Number(digits[(o + i) % digits.length]) + modDigit) % 10);
    }
  }
  return token;
}

export function decodeKvsUrl(videoUrl, licenseCode) {
  const raw = decodeMediaText(videoUrl).trim();
  if (!raw) return '';
  if (!raw.startsWith('function/0/')) return raw;
  const target = raw.slice('function/0/'.length);
  if (!licenseCode) return '';
  const token = computeKvsLicenseToken(licenseCode);
  if (token.length < 32) return '';

  const isRelative = target.startsWith('/') && !target.startsWith('//');
  const normalizedTarget = target.startsWith('//') ? `https:${target}` : target;
  let parsed;
  try {
    parsed = isRelative ? new URL(normalizedTarget, 'https://kvs.invalid') : new URL(normalizedTarget);
  } catch {
    return '';
  }

  const parts = parsed.pathname.split('/');
  const hashIndex = (parts[3] && /^[a-f0-9]{32,}$/i.test(parts[3]))
    ? 3
    : parts.findIndex(part => /^[a-f0-9]{32,}$/i.test(part));
  const effectiveIndex = hashIndex !== -1 ? hashIndex : (parts[3] && parts[3].length >= 32 ? 3 : -1);
  if (effectiveIndex === -1) return isRelative ? `${parsed.pathname}${parsed.search}${parsed.hash}` : parsed.href;

  const segment = parts[effectiveIndex];
  const HASH_LENGTH = 32;
  const hash = segment.slice(0, HASH_LENGTH);
  const tail = segment.slice(HASH_LENGTH);
  const indices = Array.from({length: HASH_LENGTH}, (_, idx) => idx);
  let j = 0;
  for (let k = HASH_LENGTH - 1; k >= 0; k--) {
    j += Number(token[k]);
    const swap = (k + j) % HASH_LENGTH;
    [indices[k], indices[swap]] = [indices[swap], indices[k]];
  }
  parts[effectiveIndex] = indices.map(idx => hash[idx]).join('') + tail;
  parsed.pathname = parts.join('/');
  return isRelative ? `${parsed.pathname}${parsed.search}${parsed.hash}` : parsed.href;
}

function isPreviewOrNonVideo(url) {
  return /(?:_preview\.mp4|_preview\.webm|\/preview(?:s|_|\/|-)|\/thumbs?\/|sprite)/i.test(url) ||
    /^(?:blob:|data:|javascript:)/i.test(url);
}

export function extractKvsFlashvars(html) {
  const text = String(html || '');
  const merged = {};
  let foundAny = false;
  for (const match of text.matchAll(/(?:(?:var|let|const)\s+|window\.)?flashvars(?:_\d+)?\s*=\s*/gi)) {
    const obj = parseJsObjectLiteral(text, match.index + match[0].length);
    if (obj && typeof obj === 'object') {
      Object.assign(merged, obj);
      foundAny = true;
    }
  }
  for (const match of text.matchAll(/\bflashvars(?:_\d+)?(?:\.([a-z0-9_]+)|\[['"]([a-z0-9_]+)['"]\])\s*=\s*(['"])((?:\\.|(?!\3)[^\\\r\n])*?)\3/gi)) {
    const key = match[1] || match[2];
    if (key) {
      merged[key] = match[4];
      foundAny = true;
    }
  }
  return foundAny ? merged : null;
}

export function extractKvsDefinitions(html) {
  const vars = extractKvsFlashvars(html);
  if (!vars) return [];
  const licenseCode = typeof vars.license_code === 'string' ? vars.license_code : '';
  const definitions = [];
  const add = (rawUrl, qualityHint = '', hint = '') => {
    if (typeof rawUrl !== 'string' || !rawUrl.trim()) return;
    const decoded = decodeKvsUrl(rawUrl, licenseCode);
    if (!decoded || isPreviewOrNonVideo(decoded)) return;
    const normalized = decoded.startsWith('//') ? `https:${decoded}` : decoded;
    if (!/^(?:https?:\/\/|\/)/i.test(normalized) || /^\/?\.?[a-z0-9]{1,5}$/i.test(normalized)) return;
    const quality = mediaHeight(qualityHint) || urlHeightHint(normalized) || 0;
    const format = mediaFormat(normalized, hint);
    if (!definitions.some(def => def.videoUrl === normalized && def.quality === quality)) {
      definitions.push({videoUrl: normalized, quality, format});
    }
  };

  if (typeof vars.video_url === 'string') {
    add(vars.video_url, vars.video_url_text || vars.video_url_quality || '', '');
  }
  for (const [key, value] of Object.entries(vars)) {
    if (typeof value !== 'string') continue;
    if (/^video_alt_url\d*$/i.test(key)) {
      add(value, vars[`${key}_text`] || vars[`${key}_quality`] || '', '');
    } else if (/^video_(?:hd|sd|mobile)_url$/i.test(key)) {
      const fallbackQ = /hd/i.test(key) ? 720 : 480;
      add(value, vars[`${key}_text`] || fallbackQ, '');
    } else if (/^(?:video_hls|hls_url|hls|video_url_hls|m3u8)$/i.test(key)) {
      add(value, vars[`${key}_text`] || '', 'm3u8');
    } else if (/^video_.*url/i.test(key) && !/preview|thumb|poster|timeline|sprite|vast|adv|redirect/i.test(key) && key !== 'video_url') {
      add(value, vars[`${key}_text`] || '', '');
    }
  }
  return definitions;
}
