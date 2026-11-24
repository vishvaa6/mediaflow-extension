import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TOP_VIDEO_SITES,
  normalizeSiteHost,
  isSupportedPlayerHost,
  isTopVideoSite,
  isListingOrNonWatchPath,
  isRecognizedSiteWatchPage
} from '../assets/js/top-sites-registry.js';
import {recognizedVideoPage, videoKey} from '../assets/js/video-details.js';
import {
  computeKvsLicenseToken,
  decodeKvsUrl,
  extractKvsDefinitions
} from '../assets/js/kvs-media.js';
import {extractMedia, mediaHeight} from '../assets/js/media-extraction.js';

function scrambleKvsHash(realHash, licenseCode) {
  const token = computeKvsLicenseToken(licenseCode);
  const chars = [...realHash.slice(0, 32)];
  const prefixSums = Array(32).fill(0);
  let sum = 0;
  for (let k = 31; k >= 0; k--) {
    sum += Number(token[k]);
    prefixSums[k] = sum;
  }
  for (let k = 0; k < 32; k++) {
    const swap = (k + prefixSums[k]) % 32;
    [chars[k], chars[swap]] = [chars[swap], chars[k]];
  }
  return chars.join('') + realHash.slice(32);
}

const SAMPLE_WATCH_PATHS = {
  '4tube.com': '/videos/123456/sample-video',
  'anybunny.org': '/top/123456-sample_video.html',
  'anyporn.com': '/videos/123456/sample-video/',
  'anysex.com': '/123456/',
  'assoass.com': '/video/sample-video-123456.html',
  'beeg.com': '/-123456789',
  'bigporn.com': '/video/123456/sample-video',
  'colliderporn.com': '/video/sample-video-123456',
  'dinotube.com': '/video/123456/sample-video',
  'eporner.com': '/video-AbC123xYz/sample-video/',
  'fpo.xxx': '/videos/123456/sample-video/',
  'fuq.com': '/video/123456/sample-video',
  'hello.porn': '/video/123456/sample-video',
  'hotporntubes.com': '/videos/123456/sample-video',
  'hqporner.com': '/hdporn/123456-sample_video.html',
  'iwank.tv': '/en/123456/sample-video',
  'ixxx.com': '/video/123456/sample-video',
  'justporn.com': '/videos/123456/sample-video/',
  'largehdtube.com': '/videos/123456/sample-video',
  'letsporn.com': '/videos/123456/sample-video',
  'lobstertube.com': '/video/123456/sample-video',
  'megatube.xxx': '/videos/123456/sample-video',
  'melonstube.com': '/videos/123456/sample-video',
  'ok.xxx': '/video/123456/',
  'ozeex.com': '/videos/123456/sample-video/',
  'perfectgirls.xxx': '/gal/123456/sample-video',
  'porn.com': '/videos/sample-video-123456',
  'porn300.com': '/video/sample-video/',
  'porndoe.com': '/video/123456/sample-video',
  'porndroids.com': '/videos/123456/sample-video',
  'porngrey.net': '/videos/123456/sample-video',
  'pornhat.com': '/video/sample-video/',
  'pornheed.com': '/video/123456/sample-video',
  'pornhub.com': '/view_video.php?viewkey=ph64abc123',
  'pornid.xxx': '/videos/123456/sample-video',
  'pornone.com': '/amateur/sample-video/123456/',
  'porntrex.com': '/video/123456/sample-video',
  'porzo.com': '/videos/123456/sample-video',
  'pussyspace.com': '/video/123456/sample-video',
  'qorno.com': '/videos/123456/sample-video',
  'redtube.com': '/123456',
  'sexvid.xxx': '/video/123456/sample-video',
  'shameless.com': '/videos/sample-video/',
  'spankbang.com': '/7abc1/video/sample+video',
  'stocking-tease.com': '/videos/123456/sample-video/',
  'superporn.com': '/video/sample-video',
  'theyarehuge.com': '/v/sample-video/',
  'thisvid.com': '/videos/sample-video/',
  'thumbzilla.com': '/video/ph5f123abc/sample-video',
  'tiava.com': '/video/123456/sample-video',
  'tnaflix.com': '/amateur-porn/sample-video/video123456',
  'tube8.com': '/amateur/sample-video/123456/',
  'tubegalore.com': '/video/123456/sample-video',
  'tubesafari.com': '/video/123456/sample-video',
  'tubev.sex': '/video/123456/sample-video',
  'txxx.com': '/videos/123456/sample-video/',
  'usersporn.com': '/videos/123456/sample-video/',
  'vipwank.com': '/videos/123456/sample-video/',
  'viviporn.tv': '/videos/123456/sample-video/',
  'xfuntaxy.com': '/video/123456/sample-video',
  'xgroovy.com': '/videos/123456/sample-video/',
  'xhamster.com': '/videos/sample-video-123456',
  'xnxx.com': '/video-abc123/sample-video',
  'xvideos.com': '/video.abc123/sample-video',
  'xxxbunker.com': '/sample_video_clip',
  'youjizz.com': '/videos/sample-video-123456.html',
  'youporn.com': '/watch/123456/sample-video/',
  'youramateurporn.com': '/videos/123456/sample-video/',
  'youx.xxx': '/video/123456/sample-video',
  'zbporn.com': '/videos/123456/sample-video/'
};

test('TOP_VIDEO_SITES exports a frozen unique list of all 70 domains', () => {
  assert.equal(Object.isFrozen(TOP_VIDEO_SITES), true);
  assert.equal(TOP_VIDEO_SITES.length, 70);
  assert.equal(new Set(TOP_VIDEO_SITES).size, 70);
  for (const domain of TOP_VIDEO_SITES) {
    assert.ok(SAMPLE_WATCH_PATHS[domain], `missing sample watch path for ${domain}`);
  }
});

test('normalizeSiteHost, isTopVideoSite, and isSupportedPlayerHost handle locales, mobile, and aliases safely', () => {
  for (const domain of TOP_VIDEO_SITES) {
    assert.equal(normalizeSiteHost(domain), domain);
    assert.equal(normalizeSiteHost(`www.${domain}`), domain);
    assert.equal(normalizeSiteHost(`m.${domain}`), domain);
    for (const locale of ['pt', 'es', 'de', 'fr', 'it', 'jp', 'nl', 'pl', 'ru']) {
      assert.equal(normalizeSiteHost(`https://${locale}.${domain}/watch`), domain);
    }
    assert.equal(isTopVideoSite(domain), true);
    assert.equal(isSupportedPlayerHost(domain), true);
  }

  for (const [input, expected] of [
    ['pornhub.org', 'pornhub.com'],
    ['www.pornhubpremium.com', 'pornhub.com'],
    ['es.pornhub.org', 'pornhub.com'],
    ['m.xvv1deos.com', 'xvideos.com'],
    ['pt.xnxx.es', 'xnxx.com'],
    ['xhamster42.desi', 'xhamster.com'],
    ['de.xhamster.desi', 'xhamster.com'],
    ['xhamster19.com', 'xhamster.com'],
    ['www.txxx.tube', 'txxx.com']
  ]) {
    assert.equal(normalizeSiteHost(input), expected);
    assert.equal(isTopVideoSite(input), true);
    assert.equal(isSupportedPlayerHost(input), true);
  }

  for (const [input, expected] of [
    ['www.mydaddy.cc', 'mydaddy.cc'],
    ['f.91porn.com', '91porn.com'],
    ['www.123av.com', '123av.com'],
    ['rou.video', 'rou.video'],
    ['tangxinvlog.app', 'tangxinvlog.app'],
    ['huangguoai.com', 'huangguoai.com']
  ]) {
    assert.equal(normalizeSiteHost(input), expected);
    assert.equal(isTopVideoSite(input), false);
    assert.equal(isSupportedPlayerHost(input), true);
  }

  // Unknown or spoofed hosts must not collapse to known sites or strip unknown locale prefixes
  assert.equal(normalizeSiteHost('es.example.test'), 'es.example.test');
  assert.equal(normalizeSiteHost('www.example.test'), 'example.test');
  for (const bad of ['pornhub.com.evil.test', '91porn.com.evil.test', 'txxx.com.attacker.test', 'javascript:alert(1)', '']) {
    assert.equal(isTopVideoSite(bad), false, bad);
    assert.equal(isSupportedPlayerHost(bad), false, bad);
  }
});

test('all 70 top video sites match watch routes and reject listing/category/profile URLs', () => {
  const nonWatchPaths = [
    '/', '/index.php', '/categories', '/categories/featured', '/tags/amateur',
    '/models/jane-doe', '/pornstars/alex', '/channels/studio', '/users/member',
    '/profiles/alice', '/creators/bob', '/search?q=test', '/playlists/123',
    '/trending', '/top-rated', '/most-viewed', '/new', '/popular',
    '/page/2', '/videos/page/3', '/en/categories/hd', '/videos/popular'
  ];

  for (const path of nonWatchPaths) {
    assert.equal(isListingOrNonWatchPath(path.split('?')[0]), true, `expected non-watch path: ${path}`);
  }

  for (const domain of TOP_VIDEO_SITES) {
    const watchUrl = `https://www.${domain}${SAMPLE_WATCH_PATHS[domain]}`;
    assert.equal(isRecognizedSiteWatchPage(watchUrl), true, `watch route must match: ${watchUrl}`);
    assert.equal(recognizedVideoPage(watchUrl), true, `recognizedVideoPage must match: ${watchUrl}`);

    for (const badPath of nonWatchPaths) {
      const badUrl = `https://${domain}${badPath}`;
      assert.equal(isRecognizedSiteWatchPage(badUrl), false, `listing route must be excluded: ${badUrl}`);
      assert.equal(recognizedVideoPage(badUrl), false, `recognizedVideoPage must exclude: ${badUrl}`);
    }
  }

  // Aliases and locale subdomains also work cleanly
  assert.equal(isRecognizedSiteWatchPage('https://txxx.tube/videos/9876/title/'), true);
  assert.equal(isRecognizedSiteWatchPage('https://de.eporner.com/hd-porn/AbC123/title/'), true);
  assert.equal(isRecognizedSiteWatchPage('https://es.xnxx.es/video-xyz99/title'), true);
  assert.equal(isRecognizedSiteWatchPage('https://la.spankbang.com/en/7abc1/video/title'), true);
  assert.equal(isRecognizedSiteWatchPage('https://m.tube8.com/amateur/title/987654/'), true);
  assert.equal(isRecognizedSiteWatchPage('https://tube8.com/amateur/page/2/'), false);
  assert.equal(isRecognizedSiteWatchPage('https://spankbang.com/7abc1/playlist/favs'), false);
  assert.equal(isRecognizedSiteWatchPage('https://spankbang.com/s/amateur/'), false);
  assert.equal(isRecognizedSiteWatchPage('https://pornhub.com/view_video.php'), false);
});

test('videoKey normalizes new site routes and aliases while preserving existing outputs', () => {
  // Existing exact outputs preserved
  assert.equal(videoKey('https://pornhub.org/view_video.php?viewkey=abc'), 'pornhub:viewkey:abc');
  assert.equal(videoKey('https://www.xvideos.com/video.abcd/old-slug'), 'xvideos:video:abcd');
  assert.equal(videoKey('https://xhamster42.desi/videos/same-123'), 'xhamster/videos/same-123');
  assert.equal(videoKey('https://www.redtube.com/123'), 'redtube.com/123');
  assert.equal(videoKey('https://es.redtube.com/es/123'), 'redtube.com/123');
  assert.equal(videoKey('https://example.test/videos/first-123'), 'example.test/videos/first-123');

  // New site normalizations
  assert.equal(
    videoKey('https://www.youporn.com/watch/12345/old-slug/'),
    videoKey('https://fr.youporn.com/watch/12345/new-slug/?from=1')
  );
  assert.notEqual(
    videoKey('https://www.youporn.com/watch/12345/slug/'),
    videoKey('https://www.youporn.com/watch/12346/slug/')
  );

  assert.equal(
    videoKey('https://www.tube8.com/amateur/old-title/987654/'),
    videoKey('https://m.tube8.com/hd/new-title/987654/')
  );
  assert.equal(
    videoKey('https://www.thumbzilla.com/video/ph5f123abc/old-title'),
    videoKey('https://es.thumbzilla.com/video/ph5f123abc/new-title')
  );
  assert.equal(
    videoKey('https://spankbang.com/7AbC1/video/old+title'),
    videoKey('https://la.spankbang.com/en/7abc1/video/new+title')
  );
  assert.equal(
    videoKey('https://www.eporner.com/video-XyZ123/old-slug/'),
    videoKey('https://de.eporner.com/hd-porn/XyZ123/new-slug/')
  );
  assert.equal(
    videoKey('https://beeg.com/-123456789'),
    videoKey('https://www.beeg.com/123456789?t=30')
  );
  assert.equal(
    videoKey('https://txxx.com/videos/555123/old-slug/'),
    videoKey('https://txxx.tube/videos/555123/new-slug/')
  );
  assert.equal(
    videoKey('https://xnxx.com/video-abc123/old-slug'),
    videoKey('https://es.xnxx.es/video-abc123/new-slug')
  );
  for (const host of ['porntrex.com', 'anyporn.com', 'xgroovy.com', 'fpo.xxx', 'zbporn.com']) {
    assert.equal(
      videoKey(`https://${host}/videos/444555/slug-one/`),
      videoKey(`https://www.${host}/videos/444555/slug-two/`),
      host
    );
    assert.notEqual(
      videoKey(`https://${host}/videos/444555/slug/`),
      videoKey(`https://${host}/videos/444556/slug/`),
      host
    );
  }
});

test('KVS decoder handles 16-digit and 32-digit BigInt license codes and flashvars extraction', () => {
  const realHash = '0123456789abcdef0123456789abcdef';
  for (const licenseCode of ['$7049281635490128', '$90817263541234567890123456780123']) {
    const token = computeKvsLicenseToken(licenseCode);
    assert.ok(token.length >= 32, `token length for ${licenseCode}`);
    assert.match(token, /^\d+$/);

    const scrambledHash = scrambleKvsHash(realHash, licenseCode);
    assert.notEqual(scrambledHash, realHash);

    const encodedUrl = `function/0/https://cdn.kvs.test/get_file/1/${scrambledHash}ff99/12345/12345_720p.mp4/?br=1200`;
    const decoded = decodeKvsUrl(encodedUrl, licenseCode);
    assert.equal(decoded, `https://cdn.kvs.test/get_file/1/${realHash}ff99/12345/12345_720p.mp4/?br=1200`);
  }

  assert.equal(decodeKvsUrl('https://cdn.kvs.test/direct.mp4', '$7049281635490128'), 'https://cdn.kvs.test/direct.mp4');
  assert.equal(decodeKvsUrl('function/0/https://cdn.kvs.test/get_file/1/' + realHash + '/1.mp4', ''), '');

  const licenseCode = '$5182930475618293';
  const scrambled4k = scrambleKvsHash('fedcba9876543210fedcba9876543210', licenseCode);
  const scrambled720 = scrambleKvsHash(realHash, licenseCode);
  const kvsHtml = `<script>
    var flashvars = {
      // comment with } brace
      video_title: 'KVS Sample Video',
      license_code: '${licenseCode}',
      video_url: 'function/0/https://cdn.kvs.test/get_file/1/${scrambled720}/99/99.mp4/',
      video_url_text: '720p',
      "video_alt_url": "function/0/https://cdn.kvs.test/get_file/1/${scrambled4k}/99/99_4k.mp4/",
      "video_alt_url_text": "4K",
      'video_hls': 'https://cdn.kvs.test/hls/99/master.m3u8',
      preview_url: 'https://cdn.kvs.test/contents/99_preview.mp4',
      video_alt_url2: 'https://cdn.kvs.test/contents/99_preview.mp4',
    };
  </script>`;
  const defs = extractKvsDefinitions(kvsHtml);
  assert.equal(defs.length, 3);
  assert.deepEqual(defs[0], {
    videoUrl: `https://cdn.kvs.test/get_file/1/${realHash}/99/99.mp4/`,
    quality: 720,
    format: 'mp4'
  });
  assert.deepEqual(defs[1], {
    videoUrl: 'https://cdn.kvs.test/get_file/1/fedcba9876543210fedcba9876543210/99/99_4k.mp4/',
    quality: 2160,
    format: 'mp4'
  });
  assert.deepEqual(defs[2], {
    videoUrl: 'https://cdn.kvs.test/hls/99/master.m3u8',
    quality: 0,
    format: 'm3u8'
  });
  assert.ok(defs.every(def => !def.videoUrl.includes('_preview.mp4')));

  const extracted = extractMedia(kvsHtml);
  assert.equal(extracted.title, 'KVS Sample Video');
  assert.equal(extracted.definitions.length, 3);
});

test('mediaHeight and extractMedia handle 4k/2k labels, FluidPlayer/JWPlayer/Video.js tags and configs', () => {
  assert.equal(mediaHeight('4k'), 2160);
  assert.equal(mediaHeight('UHD'), 2160);
  assert.equal(mediaHeight('2k'), 1440);
  assert.equal(mediaHeight('QHD'), 1440);
  assert.equal(mediaHeight('1080p'), 1080);

  const html = `
    <video id="fluid" title="Summer 2025 Clip">
      <source src="https://cdn.test/fluid-1080.mp4" type="video/mp4" title="1080p" data-fluid-hd>
      <source src="https://cdn.test/fluid-4k.mp4" type="video/mp4" data-quality="4K">
      <source src="https://cdn.test/vjs-720.mp4" type="video/mp4" res="720" label="720p">
    </video>
    <script>
      jwplayer('player').setup({
        sources: [
          { file: 'https://cdn.test/jw-1440.mp4', label: 'QHD', type: 'video/mp4' },
          { file: 'https://cdn.test/jw-hls-stream', label: '480p', type: 'application/x-mpegURL' }
        ]
      });
    </script>`;
  const {definitions} = extractMedia(html);
  assert.deepEqual(
    definitions.map(d => [d.videoUrl, mediaHeight(d.quality), d.format]),
    [
      ['https://cdn.test/fluid-1080.mp4', 1080, 'mp4'],
      ['https://cdn.test/fluid-4k.mp4', 2160, 'mp4'],
      ['https://cdn.test/vjs-720.mp4', 720, 'mp4'],
      ['https://cdn.test/jw-1440.mp4', 1440, 'mp4'],
      ['https://cdn.test/jw-hls-stream', 480, 'm3u8']
    ]
  );
});
