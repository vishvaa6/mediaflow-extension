const BASE_TOP_VIDEO_SITES = [
  '4tube.com', 'anybunny.org', 'anyporn.com', 'anysex.com', 'assoass.com',
  'beeg.com', 'bigporn.com', 'colliderporn.com', 'dinotube.com', 'eporner.com',
  'fpo.xxx', 'fuq.com', 'hello.porn', 'hotporntubes.com', 'hqporner.com',
  'iwank.tv', 'ixxx.com', 'justporn.com', 'largehdtube.com', 'letsporn.com',
  'lobstertube.com', 'megatube.xxx', 'melonstube.com', 'ok.xxx', 'ozeex.com',
  'perfectgirls.xxx', 'porn.com', 'porn300.com', 'porndoe.com', 'porndroids.com',
  'porngrey.net', 'pornhat.com', 'pornheed.com', 'pornhub.com', 'pornid.xxx',
  'pornone.com', 'porntrex.com', 'porzo.com', 'pussyspace.com', 'qorno.com',
  'redtube.com', 'sexvid.xxx', 'shameless.com', 'spankbang.com', 'stocking-tease.com',
  'superporn.com', 'theyarehuge.com', 'thisvid.com', 'thumbzilla.com', 'tiava.com',
  'tnaflix.com', 'tube8.com', 'tubegalore.com', 'tubesafari.com', 'tubev.sex',
  'txxx.com', 'usersporn.com', 'vipwank.com', 'viviporn.tv', 'xfuntaxy.com',
  'xgroovy.com', 'xhamster.com', 'xnxx.com', 'xvideos.com', 'xxxbunker.com',
  'youjizz.com', 'youporn.com', 'youramateurporn.com', 'youx.xxx', 'zbporn.com'
];

export const TOP_VIDEO_SITES = Object.freeze([...BASE_TOP_VIDEO_SITES]);

const TOP_VIDEO_SITE_SET = new Set(TOP_VIDEO_SITES);
const EXTRA_PLAYER_HOSTS = new Set([
  'mydaddy.cc',
  '91porn.com',
  '123av.com',
  'rou.video',
  'tangxinvlog.app',
  'huangguoai.com'
]);
const KNOWN_PLAYER_HOSTS = new Set([...TOP_VIDEO_SITE_SET, ...EXTRA_PLAYER_HOSTS]);

const NON_WATCH_PREFIXES = new Set([
  'categories', 'category', 'cat', 'cats', 'genres', 'genre',
  'tags', 'tag',
  'models', 'model', 'pornstars', 'pornstar', 'stars', 'actors', 'actresses', 'performers',
  'creators', 'creator',
  'channels', 'channel', 'studios', 'studio', 'networks', 'network', 'sites', 'paysites',
  'users', 'user', 'profiles', 'profile', 'members', 'member', 'account',
  'search', 'find', 'results',
  'playlists', 'playlist', 'albums', 'album', 'collections', 'collection',
  'favorites', 'favourites', 'history', 'liked',
  'trending', 'top-rated', 'top_rated', 'most-viewed', 'most_viewed',
  'most-popular', 'most_popular', 'new', 'newest', 'latest', 'recent',
  'popular', 'best', 'hot', 'featured', 'recommended', 'random',
  'live', 'cams', 'cam', 'chat', 'photos', 'pics', 'pictures', 'galleries', 'gallery', 'gifs',
  'stories', 'blog', 'news', 'faq', 'help', 'support', 'contact', 'about',
  'terms', 'privacy', 'dmca', '2257', 'legal', 'cookies', 'sitemap', 'feed', 'rss',
  'login', 'register', 'signup', 'auth', 'api', 'xhr', 'static', 'assets', 'cdn-cgi'
]);

const LOCALE_SUBDOMAIN_RE = /^(?:www|m|mobile|[a-z]{2}(?:-[a-z]{2})?)\./;
const LOCALE_PATH_PREFIX_RE = /^\/(?:en|es|pt|de|fr|it|ja|jp|ko|zh|cn|nl|pl|ru|tr|sv|no|da|fi|cs|cz|hu|ro|el|he|hi|id|ms|th|vi|uk|ar|fil|rt)(?:-[a-z]{2})?(?=\/)/i;

export function stripLocalePathPrefix(pathname) {
  return String(pathname || '').replace(LOCALE_PATH_PREFIX_RE, '');
}

function extractHostname(value) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  let host = '';
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
    try {
      const parsed = new URL(trimmed);
      if (!/^https?:$/i.test(parsed.protocol)) return '';
      host = parsed.hostname;
    } catch {
      return '';
    }
  } else {
    host = trimmed.replace(/^\/+/, '').split('/')[0].split(':')[0];
  }
  return host.toLowerCase().replace(/^\.+|\.+$/g, '');
}

function matchKnownBaseHost(candidate) {
  if (KNOWN_PLAYER_HOSTS.has(candidate)) return candidate;
  if (/^pornhub\.(?:com|org)$|^pornhubpremium\.com$/.test(candidate)) return 'pornhub.com';
  if (/^(?:xvideos\.com|xvv1deos\.com)$/.test(candidate)) return 'xvideos.com';
  if (/^xnxx\.(?:com|es)$/.test(candidate)) return 'xnxx.com';
  if (/^xhamster\d*\.(?:com|desi)$/.test(candidate)) return 'xhamster.com';
  if (/^txxx\.(?:com|tube)$/.test(candidate)) return 'txxx.com';
  if (candidate === '91porn.com' || candidate.endsWith('.91porn.com')) return '91porn.com';
  return '';
}

export function normalizeSiteHost(hostname) {
  const host = extractHostname(hostname);
  if (!host) return '';
  let candidate = host;
  while (candidate) {
    const matched = matchKnownBaseHost(candidate);
    if (matched) return matched;
    const next = candidate.replace(LOCALE_SUBDOMAIN_RE, '');
    if (next === candidate) break;
    candidate = next;
  }
  return host.replace(/^www\./, '');
}

export function isTopVideoSite(urlOrHost) {
  return TOP_VIDEO_SITE_SET.has(normalizeSiteHost(urlOrHost));
}

export function isSupportedPlayerHost(urlOrHost) {
  return KNOWN_PLAYER_HOSTS.has(normalizeSiteHost(urlOrHost));
}

export function isListingOrNonWatchPath(pathname) {
  let raw = String(pathname || '').trim();
  if (/^https?:\/\//i.test(raw)) {
    try { raw = new URL(raw).pathname; } catch { return true; }
  }
  raw = raw.split(/[?#]/)[0];
  if (!raw || raw === '/' || /^\/[a-z]{2}(?:-[a-z]{2})?\/?$/i.test(raw)) return true;

  const stripped = raw.replace(LOCALE_PATH_PREFIX_RE, '');
  if (!stripped || stripped === '/') return true;
  if (/^\/(?:index|home|default)(?:\.[a-z0-9]+)?\/?$/i.test(stripped)) return true;
  if (/(?:^|\/)page\/\d+(?:\/|$)/i.test(stripped)) return true;
  if (/\.(?:css|js|mjs|json|xml|txt|rss|jpe?g|png|gif|webp|avif|svg|ico)$/i.test(stripped)) return true;

  const parts = stripped.split('/').filter(Boolean);
  if (!parts.length) return true;

  const first = parts[0].toLowerCase();
  if (NON_WATCH_PREFIXES.has(first)) return true;
  if (first === 'top' && (parts.length === 1 || /^\d+$/.test(parts[1]))) return true;
  if (first === 's' && parts[1]?.toLowerCase() !== 'video') return true;
  if (parts.length === 1 && /^(?:videos?|watch|v|hdporn|hd-porn|movies?|embed)$/i.test(first)) return true;
  if (parts.length >= 2 && /^(?:videos?|watch)$/i.test(first) && (NON_WATCH_PREFIXES.has(parts[1].toLowerCase()) || parts[1].toLowerCase() === 'top')) return true;
  if (parts.length >= 2 && /^playlists?$/i.test(parts[1])) return true;
  return false;
}

const SITE_WATCH_PATTERNS = {
  'pornhub.com': (path, url) => /^\/view_video\.php$/i.test(path) && Boolean(url.searchParams.get('viewkey')),
  '91porn.com': (_path, url) => /^\/view_video(?:_hd)?\.php$/i.test(url.pathname) && Boolean(url.searchParams.get('viewkey')),
  'xvideos.com': path => /^\/(?:video\.[a-z0-9_-]+|video\d+)(?:\/|$)/i.test(path),
  'xnxx.com': path => /^\/(?:video-[a-z0-9_-]+|video\.[a-z0-9_-]+|video\d+)(?:\/|$)/i.test(path),
  'redtube.com': path => /^\/\d+\/?$/i.test(path),
  'youporn.com': path => /^\/watch\/\d+(?:\/[^/]+)?\/?$/i.test(path),
  'tube8.com': path => /^\/(?:[^/]+\/[^/]+\/\d+|watch\/[^/]+|porn-video\/\d+(?:\/[^/]+)?)\/?$/i.test(path),
  'thumbzilla.com': path => /^\/video\/[a-z0-9_-]+(?:\/[^/]+)?\/?$/i.test(path),
  'spankbang.com': path => /^\/(?:[a-z0-9]+\/video(?:\/[^/]+)?|video\/[a-z0-9_-]+)\/?$/i.test(path),
  'eporner.com': path => /^\/(?:video-[a-z0-9_-]+|hd-porn\/[a-z0-9_-]+)(?:\/[^/]+)?\/?$/i.test(path),
  'beeg.com': path => /^\/(?:-?\d{6,}|video\/[^/]+)\/?$/i.test(path),
  'hqporner.com': path => /^\/hdporn\/[^/]+(?:\.html|\/)?$/i.test(path),
  'mydaddy.cc': path => /^\/video\/[a-z0-9_-]+\/?$/i.test(path),
  'tnaflix.com': path => /^\/(?:[^/]+\/[^/]+\/video\d+|video\d+(?:\/[^/]+)?|watch\/[^/]+)\/?$/i.test(path),
  'youjizz.com': path => /^\/videos\/(?:[^/]+\.html|[a-z0-9_-]+-\d+)\/?$/i.test(path),
  'xhamster.com': path => /^\/videos\/[^/]+\/?$/i.test(path),
  'txxx.com': path => /^\/videos?\/\d+(?:\/[^/]+)?\/?$/i.test(path),
  '123av.com': path => /^\/(?:dm\d+\/)?v\/[^/]+\/?$/i.test(path),
  'rou.video': path => /^\/v\/[^/]+\/?$/i.test(path),
  'tangxinvlog.app': path => /^\/v\/[^/]+\/?$/i.test(path),
  'huangguoai.com': path => /^\/(?:video|detail)\/\d+(?:\/ep-\d+)?\/?$/i.test(path),
  'pornone.com': path => /^\/(?:[^/]+\/[^/]+\/\d+|videos?\/[^/]+(?:\/[^/]+)?)\/?$/i.test(path),
  'anysex.com': path => /^\/(?:\d+|videos?\/\d+(?:\/[^/]+)?)\/?$/i.test(path),
  'theyarehuge.com': path => /^\/(?:v\/[^/]+|videos?\/[^/]+(?:\/[^/]+)?)\/?$/i.test(path),
  'iwank.tv': path => /^\/(?:\d+\/[^/]+|videos?\/[^/]+(?:\/[^/]+)?|watch\/[^/]+)\/?$/i.test(path),
  'anybunny.org': path => /^\/(?:videos?\/[^/]+(?:\/[^/]+)?|top\/\d+[^/]*\.html|watch\/[^/]+)\/?$/i.test(path),
  'perfectgirls.xxx': path => /^\/(?:gal\/\d+\/[^/]+|videos?\/[^/]+(?:\/[^/]+)?|watch\/[^/]+)\/?$/i.test(path),
  'xxxbunker.com': path => /^\/(?:videos?\/[^/]+(?:\/[^/]+)?|[a-z0-9]+(?:_[a-z0-9]+)+)\/?$/i.test(path),
  'porngrey.net': path => /^\/(?:videos?\/[^/]+(?:\/[^/]+)?|[^/]+-\d+(?:\.html)?)\/?$/i.test(path)
};

const GENERIC_TOP_WATCH_RE = /^\/(?:video[.\-][a-z0-9_-]+|video\d+|videos?\/[^/]+(?:\/[^/]+)?|watch\/[^/]+(?:\/[^/]+)?|v\/[^/]+|movies?\/[^/]+|hdporn\/[^/]+|hd-porn\/[^/]+|[^/]+-\d{4,}\.html|\d{4,}\/[^/]+)(?:\/|$)/i;

export function isRecognizedSiteWatchPage(url) {
  try {
    const parsed = new URL(url);
    if (!/^https?:$/i.test(parsed.protocol) || parsed.username || parsed.password) return false;
    const host = normalizeSiteHost(parsed.hostname);
    if (!KNOWN_PLAYER_HOSTS.has(host)) return false;
    if (isListingOrNonWatchPath(parsed.pathname)) return false;
    const pathNoLocale = parsed.pathname.replace(LOCALE_PATH_PREFIX_RE, '');
    const custom = SITE_WATCH_PATTERNS[host];
    if (custom) return custom(pathNoLocale, parsed);
    if (/view_video\.php/i.test(pathNoLocale)) return Boolean(parsed.searchParams.get('viewkey'));
    return GENERIC_TOP_WATCH_RE.test(pathNoLocale);
  } catch {
    return false;
  }
}
