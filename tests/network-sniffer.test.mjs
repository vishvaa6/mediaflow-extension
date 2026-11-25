import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyNetworkStream, installNetworkStreamObserver} from '../assets/js/network-stream-observer.js';
import {createMediaDiscovery} from '../assets/js/media-discovery.js';
import {createMessageRouter, buildQueueRoutes} from '../assets/js/message-router.js';
import {installQueueManager} from '../assets/js/queue-manager.js';

function createEvent() {
  const listeners = new Set();
  return {
    addListener: fn => listeners.add(fn),
    removeListener: fn => listeners.delete(fn),
    emit: (...args) => {
      for (const fn of [...listeners]) fn(...args);
    },
    listeners
  };
}

function createWebRequestMock() {
  return {
    onBeforeSendHeaders: createEvent(),
    onHeadersReceived: createEvent(),
    onCompleted: createEvent(),
    onErrorOccurred: createEvent()
  };
}

const flushMicrotasks = () => new Promise(resolve => setTimeout(resolve, 0));

test('classifyNetworkStream matches HLS playlists including extensionless Content-Type and path matches', () => {
  assert.deepEqual(
    classifyNetworkStream({url: 'https://cdn.test/videos/master.m3u8?token=abc+1'}),
    {videoUrl: 'https://cdn.test/videos/master.m3u8?token=abc+1', format: 'm3u8', quality: 'Auto'}
  );
  assert.deepEqual(
    classifyNetworkStream({url: 'https://cdn.test/videos/720p/index.m3u8'}),
    {videoUrl: 'https://cdn.test/videos/720p/index.m3u8', format: 'm3u8', quality: 720}
  );
  assert.deepEqual(
    classifyNetworkStream({url: 'https://cdn.test/stream/1280x720/list.m3u8'}),
    {videoUrl: 'https://cdn.test/stream/1280x720/list.m3u8', format: 'm3u8', quality: 720}
  );
  assert.deepEqual(
    classifyNetworkStream({url: 'https://cdn.test/hls/998877/playlist', type: 'xmlhttprequest'}),
    {videoUrl: 'https://cdn.test/hls/998877/playlist', format: 'm3u8', quality: 'Auto'}
  );
  for (const mime of [
    'application/vnd.apple.mpegurl; charset=utf-8',
    'application/x-mpegurl',
    'audio/mpegurl',
    'audio/x-mpegurl'
  ]) {
    assert.deepEqual(
      classifyNetworkStream({url: 'https://api.site.test/stream/12345', contentType: mime, type: 'xmlhttprequest'}),
      {videoUrl: 'https://api.site.test/stream/12345', format: 'm3u8', quality: 'Auto'}
    );
  }
  assert.equal(classifyNetworkStream({url: 'https://site.test/hls/playlist', type: 'main_frame'}), null);
  assert.equal(classifyNetworkStream({url: 'https://site.test/video.m3u8', contentType: 'text/html'}), null);
});

test('classifyNetworkStream handles MP4/WebM size threshold and excludes segments, previews, and ads', () => {
  // Explicit MP4/WebM with unknown contentLength is allowed.
  assert.deepEqual(
    classifyNetworkStream({url: 'https://cdn.test/video_1080p.mp4'}),
    {videoUrl: 'https://cdn.test/video_1080p.mp4', format: 'mp4', quality: 1080}
  );
  assert.deepEqual(
    classifyNetworkStream({url: 'https://cdn.test/video_4k.webm', contentType: 'video/webm'}),
    {videoUrl: 'https://cdn.test/video_4k.webm', format: 'webm', quality: 2160}
  );

  // Extensionless video/mp4 requires media request or > 512 KiB.
  assert.deepEqual(
    classifyNetworkStream({url: 'https://cdn.test/play?id=1', contentType: 'video/mp4', type: 'media'}),
    {videoUrl: 'https://cdn.test/play?id=1', format: 'mp4', quality: 'Auto'}
  );
  assert.equal(
    classifyNetworkStream({url: 'https://cdn.test/play?id=1', contentType: 'video/mp4', type: 'xmlhttprequest'}),
    null
  );
  assert.deepEqual(
    classifyNetworkStream({url: 'https://cdn.test/play?id=1', contentType: 'video/mp4', contentLength: 524289, type: 'xmlhttprequest'}),
    {videoUrl: 'https://cdn.test/play?id=1', format: 'mp4', quality: 'Auto'}
  );

  // Small preview MP4 (<= 512 KiB) is ignored.
  assert.equal(classifyNetworkStream({url: 'https://cdn.test/hover.mp4', contentType: 'video/mp4', contentLength: 524288}), null);
  assert.equal(classifyNetworkStream({url: 'https://cdn.test/hover.mp4', contentType: 'video/mp4', contentLength: 150000}), null);

  // HLS segments excluded unless extensionless HLS playlist.
  for (const segmentUrl of [
    'https://cdn.test/seg-1.ts',
    'https://cdn.test/init.m4s',
    'https://cdn.test/video.cmfv',
    'https://cdn.test/audio.cmfa',
    'https://cdn.test/hls/seg-42.mp4',
    'https://cdn.test/hls/chunk-7.mp4',
    'https://cdn.test/hls/frag-3'
  ]) {
    assert.equal(
      classifyNetworkStream({url: segmentUrl, contentType: 'video/mp4', contentLength: 2_000_000}),
      null,
      `segment must be excluded: ${segmentUrl}`
    );
  }
  assert.deepEqual(
    classifyNetworkStream({
      url: 'https://cdn.test/hls/chunk-playlist',
      contentType: 'application/vnd.apple.mpegurl',
      type: 'xmlhttprequest'
    }),
    {videoUrl: 'https://cdn.test/hls/chunk-playlist', format: 'm3u8', quality: 'Auto'}
  );

  // Ad/tracker domains and VAST/preroll URLs excluded.
  for (const adUrl of [
    'https://syndication.exoclick.com/video.mp4',
    'https://ads.juicyads.com/clip.m3u8',
    'https://cdn.trafficjunky.net/ad.mp4',
    'https://media.tsyndicate.com/ad.mp4',
    'https://pubads.g.doubleclick.net/video.mp4',
    'https://tpc.googlesyndication.com/video.mp4',
    'https://adservice.google.com/video.mp4',
    'https://c1.popads.net/video.mp4',
    'https://cdn.test/vast/spot.mp4',
    'https://cdn.test/videos/preroll_720p.mp4'
  ]) {
    assert.equal(classifyNetworkStream({url: adUrl, contentType: 'video/mp4', contentLength: 2_000_000}), null, `ad must be excluded: ${adUrl}`);
  }

  // Preview/sprite/thumb clips excluded.
  for (const previewUrl of [
    'https://cdn.test/preview/123.mp4',
    'https://cdn.test/videos/123_preview.mp4',
    'https://cdn.test/thumbs/123.mp4',
    'https://cdn.test/thumb_vids/123.mp4',
    'https://cdn.test/sprites/123.mp4',
    'https://cdn.test/teaser.m3u8'
  ]) {
    assert.equal(classifyNetworkStream({url: previewUrl, contentType: 'video/mp4', contentLength: 2_000_000}), null, `preview must be excluded: ${previewUrl}`);
  }

  // Non-http(s) / credentials / non-media content-types excluded.
  assert.equal(classifyNetworkStream({url: 'blob:https://site.test/uuid'}), null);
  assert.equal(classifyNetworkStream({url: 'file:///tmp/video.mp4'}), null);
  assert.equal(classifyNetworkStream({url: 'https://user:pass@cdn.test/video.mp4'}), null);
  assert.equal(classifyNetworkStream({url: 'https://cdn.test/video.mp4', contentType: 'application/json'}), null);
});

test('installNetworkStreamObserver safely no-ops without chrome.webRequest', () => {
  const prevChrome = globalThis.chrome;
  try {
    globalThis.chrome = {};
    assert.equal(installNetworkStreamObserver({discovery: createMediaDiscovery(), notify() {}}), null);
    globalThis.chrome = undefined;
    assert.equal(installNetworkStreamObserver({discovery: createMediaDiscovery(), notify() {}}), null);
  } finally {
    globalThis.chrome = prevChrome;
  }
});

test('installNetworkStreamObserver captures Referer/Origin, enforces cleanup/LRU, ignores tabId < 0, and notifies', async () => {
  const prevChrome = globalThis.chrome;
  const webRequest = createWebRequestMock();
  const tabs = new Map([[7, {id: 7, url: 'https://outer.test/watch'}]]);
  globalThis.chrome = {
    webRequest,
    tabs: {get: async id => tabs.get(id) || null}
  };

  const reported = [];
  const notifications = [];
  const discovery = {
    reportNetworkStream(payload) {
      reported.push(payload);
      return true;
    }
  };

  try {
    const observer = installNetworkStreamObserver({
      discovery,
      notify: msg => notifications.push(msg)
    });
    assert.ok(observer);

    // tabId < 0 is ignored across both listeners.
    webRequest.onBeforeSendHeaders.emit({
      requestId: 'neg-1',
      tabId: -1,
      url: 'https://cdn.test/master.m3u8',
      requestHeaders: [{name: 'Referer', value: 'https://offscreen.test/'}]
    });
    webRequest.onHeadersReceived.emit({
      requestId: 'neg-1',
      tabId: -1,
      frameId: 0,
      statusCode: 200,
      url: 'https://cdn.test/master.m3u8',
      responseHeaders: [{name: 'Content-Type', value: 'application/vnd.apple.mpegurl'}]
    });
    await flushMicrotasks();
    assert.equal(reported.length, 0);
    assert.equal(notifications.length, 0);

    // Normal iframe request captures Referer/Origin and resolves top tab pageUrl.
    webRequest.onBeforeSendHeaders.emit({
      requestId: 'req-1',
      tabId: 7,
      frameId: 3,
      url: 'https://cdn.test/720p/master.m3u8',
      requestHeaders: [
        {name: 'referer', value: 'https://embed.test/player/1'},
        {name: 'origin', value: 'https://embed.test'}
      ]
    });
    webRequest.onHeadersReceived.emit({
      requestId: 'req-1',
      tabId: 7,
      frameId: 3,
      statusCode: 200,
      type: 'xmlhttprequest',
      url: 'https://cdn.test/720p/master.m3u8',
      responseHeaders: [{name: 'Content-Type', value: 'application/vnd.apple.mpegurl'}]
    });
    // Simulate immediate completion before async tabs.get resolves.
    webRequest.onCompleted.emit({requestId: 'req-1', tabId: 7});
    await flushMicrotasks();

    assert.equal(reported.length, 1);
    assert.equal(reported[0].tabId, 7);
    assert.equal(reported[0].frameId, 3);
    assert.equal(reported[0].pageUrl, 'https://outer.test/watch');
    assert.equal(reported[0].frameUrl, 'https://embed.test/player/1');
    assert.deepEqual(reported[0].stream, {
      videoUrl: 'https://cdn.test/720p/master.m3u8',
      format: 'm3u8',
      quality: 720,
      headers: {Referer: 'https://embed.test/player/1', Origin: 'https://embed.test'}
    });
    assert.deepEqual(notifications, [{type: 'media-detection-updated', tabId: 7}]);

    // After onCompleted cleaned up req-1, reusing req-1 does not leak old embed headers.
    webRequest.onHeadersReceived.emit({
      requestId: 'req-1',
      tabId: 7,
      frameId: 0,
      statusCode: 206,
      type: 'media',
      url: 'https://cdn.test/full.mp4',
      responseHeaders: [
        {name: 'Content-Type', value: 'video/mp4'},
        {name: 'Content-Length', value: '65536'},
        {name: 'Content-Range', value: 'bytes 0-65535/2097152'}
      ]
    });
    webRequest.onErrorOccurred.emit({requestId: 'req-1', tabId: 7});
    await flushMicrotasks();

    assert.equal(reported.length, 2);
    assert.equal(reported[1].stream.videoUrl, 'https://cdn.test/full.mp4');
    assert.deepEqual(reported[1].stream.headers, {
      Referer: 'https://outer.test/watch',
      Origin: 'https://outer.test'
    });

    // Bounded LRU cap (512): oldest entry is evicted when 513th distinct request arrives.
    for (let i = 0; i < 513; i++) {
      webRequest.onBeforeSendHeaders.emit({
        requestId: `lru-${i}`,
        tabId: 7,
        url: 'https://cdn.test/video.m3u8',
        requestHeaders: [{name: 'Referer', value: `https://ref-${i}.test/watch`}]
      });
    }
    // lru-0 should have been evicted; lru-512 should still retain its Referer.
    webRequest.onHeadersReceived.emit({
      requestId: 'lru-0',
      tabId: 7,
      frameId: 0,
      statusCode: 200,
      url: 'https://cdn.test/evicted.m3u8',
      responseHeaders: [{name: 'Content-Type', value: 'application/vnd.apple.mpegurl'}]
    });
    webRequest.onHeadersReceived.emit({
      requestId: 'lru-512',
      tabId: 7,
      frameId: 0,
      statusCode: 200,
      url: 'https://cdn.test/kept.m3u8',
      responseHeaders: [{name: 'Content-Type', value: 'application/vnd.apple.mpegurl'}]
    });
    await flushMicrotasks();

    assert.equal(reported.at(-2).stream.headers.Referer, 'https://outer.test/watch');
    assert.equal(reported.at(-1).stream.headers.Referer, 'https://ref-512.test/watch');

    observer.uninstall();
  } finally {
    globalThis.chrome = prevChrome;
  }
});

test('media-discovery merges DOM and network streams, prioritizes master m3u8, resets on navigation, and enforces X/MissAV rules', () => {
  const discovery = createMediaDiscovery();
  const events = [];
  const unsubscribe = discovery.subscribe(event => events.push(event));

  // Network arrives before DOM report for tab 1.
  assert.equal(discovery.reportNetworkStream({
    tabId: 1,
    frameId: 2,
    pageUrl: 'https://site.test/watch/1',
    frameUrl: 'https://player.test/embed',
    stream: {
      videoUrl: 'https://cdn.test/720p/chunklist.m3u8',
      format: 'm3u8',
      quality: 720,
      headers: {Referer: 'https://player.test/embed', Origin: 'https://player.test'}
    }
  }), true);
  assert.equal(discovery.reportNetworkStream({
    tabId: 1,
    frameId: 2,
    pageUrl: 'https://site.test/watch/1',
    frameUrl: 'https://player.test/embed',
    stream: {
      videoUrl: 'https://cdn.test/master.m3u8',
      format: 'm3u8',
      quality: 'Auto',
      headers: {Referer: 'https://player.test/embed', Origin: 'https://player.test'}
    }
  }), true);
  // Duplicate network stream with identical metadata returns false and does not re-notify.
  const countBeforeDup = events.length;
  assert.equal(discovery.reportNetworkStream({
    tabId: 1,
    frameId: 2,
    pageUrl: 'https://site.test/watch/1',
    frameUrl: 'https://player.test/embed',
    stream: {
      videoUrl: 'https://cdn.test/master.m3u8',
      format: 'm3u8',
      quality: 'Auto',
      headers: {Referer: 'https://player.test/embed', Origin: 'https://player.test'}
    }
  }), false);
  assert.equal(events.length, countBeforeDup);

  // Calling with empty pageUrl must not clobber existing pageUrl.
  assert.equal(discovery.reportNetworkStream({
    tabId: 1,
    frameId: 0,
    pageUrl: '',
    stream: {videoUrl: 'https://cdn.test/480p.mp4', format: 'mp4', quality: 480}
  }), true);
  assert.equal(discovery.snapshot(1, 'https://site.test/watch/1').length, 3);
  assert.equal(discovery.snapshot(1, 'https://site.test/other').length, 0);

  // DOM report on same page preserves network streams and deduplicates same videoUrl.
  discovery.report({
    videoInfos: [
      {videoUrl: 'https://cdn.test/480p.mp4', format: 'mp4', quality: 480},
      {videoUrl: 'https://cdn.test/1080p.mp4', format: 'mp4', quality: 1080}
    ]
  }, {tab: {id: 1, url: 'https://site.test/watch/1'}, url: 'https://site.test/watch/1', frameId: 0});

  const merged = discovery.snapshot(1, 'https://site.test/watch/1');
  assert.deepEqual(
    merged.map(v => v.videoUrl),
    [
      'https://cdn.test/master.m3u8',
      'https://cdn.test/1080p.mp4',
      'https://cdn.test/480p.mp4',
      'https://cdn.test/720p/chunklist.m3u8'
    ]
  );

  // Navigation to a new pageUrl clears both DOM and network streams.
  discovery.reportNetworkStream({
    tabId: 1,
    frameId: 0,
    pageUrl: 'https://site.test/watch/2',
    stream: {videoUrl: 'https://cdn.test/next.mp4', format: 'mp4', quality: 720}
  });
  assert.equal(discovery.snapshot(1, 'https://site.test/watch/1').length, 0);
  assert.deepEqual(discovery.snapshot(1, 'https://site.test/watch/2').map(v => v.videoUrl), ['https://cdn.test/next.mp4']);

  // X and MissAV checks reject unrelated/preview URLs and non-watch pages.
  assert.equal(discovery.reportNetworkStream({
    tabId: 2,
    pageUrl: 'https://x.com/user/status/1234567890',
    stream: {videoUrl: 'https://ads.test/clip.mp4', format: 'mp4'}
  }), false);
  assert.equal(discovery.reportNetworkStream({
    tabId: 2,
    pageUrl: 'https://x.com/home',
    stream: {videoUrl: 'https://video.twimg.com/ext_tw_video/1/pu/vid/720x1280/a.mp4', format: 'mp4'}
  }), false);
  assert.equal(discovery.reportNetworkStream({
    tabId: 2,
    pageUrl: 'https://x.com/user/status/1234567890',
    stream: {videoUrl: 'https://video.twimg.com/ext_tw_video/1/pu/vid/1280x720/a.mp4', format: 'mp4', quality: 720}
  }), true);
  assert.equal(discovery.snapshot(2)[0].site, 'x');

  assert.equal(discovery.reportNetworkStream({
    tabId: 3,
    pageUrl: 'https://missav.ws/en/sample-101',
    stream: {videoUrl: 'https://fourhoi.com/sample-101/preview.mp4', format: 'mp4'}
  }), false);
  assert.equal(discovery.reportNetworkStream({
    tabId: 3,
    pageUrl: 'https://missav.ws/en/sample-101',
    stream: {videoUrl: 'https://surrit.com/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/playlist.m3u8', format: 'm3u8'}
  }), true);
  assert.equal(discovery.snapshot(3)[0].site, 'missav');

  unsubscribe();
  const afterUnsub = events.length;
  discovery.remove(1);
  assert.equal(events.length, afterUnsub);
  assert.equal(discovery.snapshot(1).length, 0);
});

test('message-router media-detection-snapshot falls back to sender.tab.id and sender.tab.url', async () => {
  const prevChrome = globalThis.chrome;
  const discovery = createMediaDiscovery();
  discovery.reportNetworkStream({
    tabId: 12,
    frameId: 0,
    pageUrl: 'https://watch.test/video/1',
    stream: {videoUrl: 'https://cdn.test/master.m3u8', format: 'm3u8', quality: 'Auto'}
  });
  discovery.reportNetworkStream({
    tabId: 15,
    frameId: 0,
    pageUrl: 'https://x.com/user/status/999',
    stream: {videoUrl: 'https://video.twimg.com/amplify_video/1/pl/master.m3u8', format: 'm3u8'}
  });

  globalThis.chrome = {
    runtime: {id: 'ext-test'},
    tabs: {
      get: async id => (id === 12 ? {id: 12, url: 'https://watch.test/video/1'} : null)
    }
  };

  try {
    const routes = buildQueueRoutes({
      getReady: async () => {},
      active: new Map(),
      windowManager: {source: () => null},
      discovery,
      headerRules: {},
      offscreen: {},
      profileBatch: {},
      queueStorage: {get: async () => ({tasks: []})},
      historyStorage: {get: async () => ({records: []})},
      settingsStorage: {get: async () => ({})},
      admit: async () => '1',
      serial: async (_id, fn) => fn(),
      pause: async () => {},
      resume: async () => {},
      remove: async () => {},
      patch: async () => {},
      schedule: async () => {},
      getSchedulingPromise: () => null,
      fetchResource: async () => '',
      fetchText: async () => '',
      notify: () => {}
    });
    const router = createMessageRouter(routes);

    // Content script omits message.tabId -> uses sender.tab.id & resolved tab.url.
    const fromContent = await new Promise(resolve => {
      assert.equal(
        router({type: 'media-detection-snapshot'}, {id: 'ext-test', tab: {id: 12, url: 'https://watch.test/video/1'}}, resolve),
        true
      );
    });
    assert.equal(fromContent.success, true);
    assert.equal(fromContent.pageUrl, 'https://watch.test/video/1');
    assert.equal(fromContent.videoInfos.length, 1);
    assert.equal(fromContent.videoInfos[0].videoUrl, 'https://cdn.test/master.m3u8');

    // When chrome.tabs.get returns null, falls back to sender.tab.url.
    const fromFallbackUrl = await new Promise(resolve => {
      assert.equal(
        router({type: 'media-detection-snapshot'}, {id: 'ext-test', tab: {id: 15, url: 'https://x.com/user/status/999'}}, resolve),
        true
      );
    });
    assert.equal(fromFallbackUrl.success, true);
    assert.equal(fromFallbackUrl.site, 'x');
    assert.equal(fromFallbackUrl.videoInfos.length, 1);

    // Popup caller passing message.tabId continues to work.
    const fromPopup = await new Promise(resolve => {
      assert.equal(
        router({type: 'media-detection-snapshot', tabId: 12, pageUrl: 'https://watch.test/video/1'}, {id: 'ext-test'}, resolve),
        true
      );
    });
    assert.equal(fromPopup.success, true);
    assert.equal(fromPopup.videoInfos.length, 1);
  } finally {
    globalThis.chrome = prevChrome;
  }
});

test('installQueueManager wires network stream observer on a single onMessage listener', async () => {
  const prevChrome = globalThis.chrome;
  const webRequest = createWebRequestMock();
  const runtimeListeners = new Set();
  const sentMessages = [];
  const local = {
    get: async () => ({}),
    set: async () => {},
    onChanged: createEvent()
  };

  globalThis.chrome = {
    runtime: {
      id: 'queue-sniffer-test',
      onMessage: {addListener: fn => runtimeListeners.add(fn)},
      sendMessage: async msg => {
        sentMessages.push(msg);
        return {ok: true};
      }
    },
    storage: {local, onChanged: createEvent()},
    downloads: {onChanged: createEvent(), search: async () => []},
    offscreen: {hasDocument: async () => false},
    tabs: {
      onRemoved: createEvent(),
      get: async id => (id === 9 ? {id: 9, url: 'https://video.test/watch/9'} : null)
    },
    webRequest
  };

  try {
    const manager = installQueueManager({
      queueStorage: {get: async () => ({tasks: []}), updateTask: async () => {}, removeTask: async () => {}},
      historyStorage: {get: async () => ({records: []}), addRecord: async () => {}},
      settingsStorage: {get: async () => ({maxConcurrentTasks: 2}), subscribe() {}},
      registerBlob() {},
      bindBlob() {},
      clearBlob() {},
      formatFilename: n => n,
      withSubdir: n => n
    });
    await manager.ready;

    assert.equal(runtimeListeners.size, 1, 'queue manager must keep exactly one onMessage listener');

    webRequest.onBeforeSendHeaders.emit({
      requestId: 'qm-1',
      tabId: 9,
      frameId: 0,
      url: 'https://cdn.test/api/hls/stream-9',
      requestHeaders: [{name: 'Referer', value: 'https://video.test/watch/9'}]
    });
    webRequest.onHeadersReceived.emit({
      requestId: 'qm-1',
      tabId: 9,
      frameId: 0,
      statusCode: 200,
      type: 'xmlhttprequest',
      url: 'https://cdn.test/api/hls/stream-9',
      responseHeaders: [{name: 'Content-Type', value: 'application/vnd.apple.mpegurl'}]
    });
    await flushMicrotasks();

    assert.ok(sentMessages.some(m => m.type === 'media-detection-updated' && m.tabId === 9));

    const snapshot = await new Promise(resolve => {
      for (const fn of runtimeListeners) {
        fn({type: 'media-detection-snapshot'}, {id: 'queue-sniffer-test', tab: {id: 9, url: 'https://video.test/watch/9'}}, resolve);
      }
    });
    assert.equal(snapshot.success, true);
    assert.equal(snapshot.videoInfos.length, 1);
    assert.equal(snapshot.videoInfos[0].videoUrl, 'https://cdn.test/api/hls/stream-9');
    assert.equal(snapshot.videoInfos[0].format, 'm3u8');
  } finally {
    globalThis.chrome = prevChrome;
  }
});
