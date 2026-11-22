import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createDetector,
  runDetectors,
  detectDocumentMedia,
  installMediaDetection,
  documentDetector,
  SITE_DETECTORS,
  DETECTORS
} from '../assets/js/media-detection.js';
import {xDetector, installXDetection} from '../assets/js/x-detection.js';
import {missavDetector, visibleMissavEntries, installMissavDetection} from '../assets/js/missav-detection.js';
import {genericPlayerDetector, collectGenericPlayers, installGenericPlayerDetection} from '../assets/js/generic-player-detection.js';

function makeView({width = 1280, height = 800} = {}) {
  const view = {
    innerWidth: width,
    innerHeight: height,
    getComputedStyle: node => node._style || {display: 'block', visibility: 'visible', opacity: '1', overflowX: 'visible', overflowY: 'visible', pointerEvents: 'auto'}
  };
  view.top = view;
  return view;
}

function makeNode({
  tag = 'div',
  attrs = {},
  classes = [],
  id = '',
  textContent = '',
  rect = {left: 0, top: 0, right: 640, bottom: 360, width: 640, height: 360},
  parent = null,
  ownerDocument = null,
  style = null,
  extra = {}
} = {}) {
  const node = {
    tagName: tag.toUpperCase(),
    id,
    textContent,
    parentElement: parent,
    ownerDocument,
    _attrs: attrs,
    _classes: new Set(classes),
    _children: [],
    _style: style,
    classList: {contains: cls => node._classes.has(cls)},
    getAttribute: name => (name in node._attrs ? node._attrs[name] : null),
    getBoundingClientRect: () => rect,
    matches: selector => selector.split(',').some(part => {
      const s = part.trim();
      if (s === tag) return true;
      if (s.startsWith('.') && node._classes.has(s.slice(1))) return true;
      const attrMatch = s.match(/^\[([^=\]]+)="([^"]+)"\]$/);
      if (attrMatch) return node.getAttribute(attrMatch[1]) === attrMatch[2];
      if (s === 'video:not(.preview):not([id^="preview-"])') return tag === 'video' && !node._classes.has('preview') && !node.id.startsWith('preview-');
      return false;
    }),
    closest: selector => {
      for (let cur = node; cur; cur = cur.parentElement) {
        if (cur.matches(selector)) return cur;
      }
      return null;
    },
    querySelector: selector => node.querySelectorAll(selector)[0] || null,
    querySelectorAll: selector => {
      const out = [];
      const visit = cur => {
        for (const child of cur._children) {
          if (child.matches(selector) || (selector === 'a[href]' && child.tagName === 'A' && child.getAttribute('href') != null) || (selector === 'source[src]' && child.tagName === 'SOURCE' && child.getAttribute('src') != null)) {
            out.push(child);
          }
          visit(child);
        }
      };
      visit(node);
      return out;
    },
    ...extra
  };
  if (parent) parent._children.push(node);
  return node;
}

function makeDocument({title = 'Test Page', outerHTML = '<html></html>'} = {}) {
  const doc = {title, documentElement: {outerHTML}, scrollingElement: null, body: null, _children: []};
  doc.scrollingElement = doc.documentElement;
  doc.body = makeNode({tag: 'body', ownerDocument: doc});
  doc._children.push(doc.body);
  doc.querySelector = selector => doc.body.querySelector(selector);
  doc.querySelectorAll = selector => doc.body.querySelectorAll(selector);
  return doc;
}

test('createDetector validates contract shape, freezes detector, and guards matches()', () => {
  assert.throws(() => createDetector({id: '', matches: () => true, collect: () => []}), TypeError);
  assert.throws(() => createDetector({id: 'bad', matches: null, collect: () => []}), TypeError);
  assert.throws(() => createDetector({id: 'bad', matches: () => true, collect: null}), TypeError);

  const throwing = createDetector({
    id: ' throwing ',
    matches: url => {
      if (url === 'boom') throw Error('parse failed');
      return url.startsWith('https://ok.test/');
    },
    collect: (doc, url, ctx) => ({title: doc.title, url, tag: ctx?.tag})
  });

  assert.equal(Object.isFrozen(throwing), true);
  assert.equal(throwing.id, 'throwing');
  assert.equal(throwing.matches('boom'), false);
  assert.equal(throwing.matches('https://ok.test/v'), true);
  assert.deepEqual(throwing.collect({title: 'Hi'}, 'https://ok.test/v', {tag: 1}), {title: 'Hi', url: 'https://ok.test/v', tag: 1});
});

test('runDetectors dispatches only matching detectors and supports firstOnly', () => {
  const calls = [];
  const d1 = createDetector({id: 'first', matches: u => u.includes('alpha'), collect: (_doc, url) => { calls.push('first'); return [url + '#1']; }});
  const d2 = createDetector({id: 'second', matches: u => u.includes('alpha'), collect: (_doc, url) => { calls.push('second'); return [url + '#2']; }});
  const d3 = createDetector({id: 'third', matches: u => u.includes('beta'), collect: () => { calls.push('third'); return ['beta']; }});

  const all = runDetectors([d1, d2, d3], {doc: {}, url: 'https://example.test/alpha'});
  assert.deepEqual(all.map(r => [r.id, r.items]), [['first', ['https://example.test/alpha#1']], ['second', ['https://example.test/alpha#2']]]);
  assert.deepEqual(calls, ['first', 'second']);

  calls.length = 0;
  const first = runDetectors([d1, d2, d3], {doc: {}, url: 'https://example.test/alpha', firstOnly: true});
  assert.deepEqual(first.map(r => r.id), ['first']);
  assert.deepEqual(calls, ['first']);

  assert.deepEqual(runDetectors([d1, d2, d3], {doc: {}, url: 'https://example.test/none'}), []);
});

test('all built-in detectors preserve legacy exports and expose the shared detector contract', () => {
  assert.equal(typeof installXDetection, 'function');
  assert.equal(typeof visibleMissavEntries, 'function');
  assert.equal(typeof installMissavDetection, 'function');
  assert.equal(typeof collectGenericPlayers, 'function');
  assert.equal(typeof installGenericPlayerDetection, 'function');
  assert.equal(typeof detectDocumentMedia, 'function');
  assert.equal(typeof installMediaDetection, 'function');

  assert.deepEqual(SITE_DETECTORS.map(d => d.id), ['x', 'missav']);
  assert.deepEqual(DETECTORS.map(d => d.id), ['x', 'missav', 'generic-player', 'document']);

  for (const detector of [xDetector, missavDetector, genericPlayerDetector, documentDetector, ...DETECTORS]) {
    assert.equal(Object.isFrozen(detector), true);
    assert.equal(typeof detector.id, 'string');
    assert.equal(typeof detector.matches, 'function');
    assert.equal(typeof detector.collect, 'function');
  }

  // URL matching matrix
  assert.equal(xDetector.matches('https://x.com/alice/status/2050000000000000001'), true);
  assert.equal(xDetector.matches('https://twitter.com/home'), true);
  assert.equal(xDetector.matches('https://x.com.evil.test/home'), false);
  assert.equal(genericPlayerDetector.matches('https://x.com/alice/status/2050000000000000001'), false);

  assert.equal(missavDetector.matches('https://missav.ws/en/abc-123'), true);
  assert.equal(missavDetector.matches('https://missav123.com/dm36/en/abc-123'), true);
  assert.equal(missavDetector.matches('https://missav.ws.evil.test/en/abc-123'), false);
  assert.equal(genericPlayerDetector.matches('https://missav.ws/en/abc-123'), false);

  assert.equal(genericPlayerDetector.matches('https://example.test/watch/1'), true);
  assert.equal(documentDetector.matches('https://example.test/watch/1'), true);

  for (const invalid of ['', 'chrome://settings', 'javascript:alert(1)']) {
    for (const detector of DETECTORS) assert.equal(detector.matches(invalid), false, `${detector.id} must reject ${invalid}`);
  }
});

test('xDetector.collect collects visible X player entries through the shared contract', () => {
  const url = 'https://x.com/alice/status/2050000000000000001';
  const view = makeView();
  const doc = makeDocument({title: 'Alice on X'});
  const article = makeNode({tag: 'article', parent: doc.body, ownerDocument: doc});
  const link = makeNode({tag: 'a', attrs: {href: '/alice/status/2050000000000000001'}, parent: article, ownerDocument: doc});
  makeNode({tag: 'time', parent: link, ownerDocument: doc});
  makeNode({tag: 'div', attrs: {'data-testid': 'tweetText'}, textContent: 'Clip caption', parent: article, ownerDocument: doc});
  const player = makeNode({tag: 'div', attrs: {'data-testid': 'videoPlayer'}, parent: article, ownerDocument: doc});
  makeNode({
    tag: 'video',
    attrs: {
      src: 'https://video.twimg.com/amplify_video/123/vid/avc1/1280x720/video.mp4?tag=12',
      poster: 'https://pbs.twimg.com/ext_tw_video_thumb/123/pu/img/poster.jpg'
    },
    parent: player,
    ownerDocument: doc,
    extra: {currentSrc: 'https://video.twimg.com/amplify_video/123/vid/avc1/1280x720/video.mp4?tag=12', paused: false, ended: false}
  });

  const [matched] = runDetectors(SITE_DETECTORS, {doc, url, context: {view}, firstOnly: true});
  assert.equal(matched.id, 'x');
  assert.equal(matched.items.length, 1);
  assert.equal(matched.items[0].postId, '2050000000000000001');
  assert.equal(matched.items[0].index, 1);
  assert.equal(matched.items[0].title, 'Clip caption');
  assert.match(matched.items[0].direct, /1280x720\/video\.mp4/);
});

test('missavDetector.collect collects visible MissAV main player and thumbnail cards', () => {
  const url = 'https://missav.ws/en/abc-123';
  const view = makeView();
  const doc = makeDocument({title: 'ABC-123'});
  makeNode({tag: 'h1', textContent: 'ABC-123 Main Title', parent: doc.body, ownerDocument: doc});
  makeNode({tag: 'video', id: 'player', parent: doc.body, ownerDocument: doc});
  const card = makeNode({tag: 'div', classes: ['thumbnail'], parent: doc.body, ownerDocument: doc});
  makeNode({tag: 'a', attrs: {href: '/en/def-456'}, textContent: 'DEF-456 Card', parent: card, ownerDocument: doc});
  makeNode({tag: 'img', attrs: {'data-src': 'https://cdn.missav.test/def-456.jpg'}, parent: card, ownerDocument: doc});

  const [matched] = runDetectors(SITE_DETECTORS, {doc, url, context: {view}, firstOnly: true});
  assert.equal(matched.id, 'missav');
  assert.equal(matched.items.length, 2);
  assert.equal(matched.items[0].main, true);
  assert.equal(matched.items[0].title, 'ABC-123 Main Title');
  assert.equal(matched.items[1].main, false);
  assert.equal(matched.items[1].title, 'DEF-456 Card');
  assert.equal(matched.items[1].thumbnail, 'https://cdn.missav.test/def-456.jpg');
});

test('genericPlayerDetector.collect and documentDetector.collect work through runDetectors', () => {
  const url = 'https://example.test/watch/demo';
  const view = makeView();
  const doc = makeDocument({title: 'Demo Clip'});
  const video = makeNode({
    tag: 'video',
    attrs: {poster: 'https://cdn.example.test/poster.jpg'},
    parent: doc.body,
    ownerDocument: doc,
    extra: {currentSrc: '', videoHeight: 720}
  });
  makeNode({
    tag: 'source',
    attrs: {src: 'https://cdn.example.test/demo-720p.mp4', size: '720'},
    parent: video,
    ownerDocument: doc,
    extra: {type: 'video/mp4'}
  });
  // Hidden / tiny video should be ignored.
  makeNode({
    tag: 'video',
    attrs: {src: 'https://cdn.example.test/tiny.mp4'},
    rect: {left: 0, top: 0, right: 20, bottom: 20, width: 20, height: 20},
    parent: doc.body,
    ownerDocument: doc
  });

  const timing = {getEntriesByType: type => type === 'resource' ? [{name: 'https://cdn.example.test/stream_1080p.m3u8'}] : []};
  const results = runDetectors(DETECTORS, {doc, url, context: {view, timing}});
  assert.deepEqual(results.map(r => r.id), ['generic-player', 'document']);

  const genericEntries = results[0].items;
  assert.equal(genericEntries.length, 1);
  assert.equal(genericEntries[0].title, 'Demo Clip');
  assert.equal(genericEntries[0].direct[0].videoUrl, 'https://cdn.example.test/demo-720p.mp4');
  assert.equal(genericEntries[0].direct[0].quality, 720);

  const docMedia = results[1].items;
  assert.equal(docMedia.pageUrl, url);
  assert.ok(docMedia.videoInfos.some(v => v.videoUrl === 'https://cdn.example.test/stream_1080p.m3u8'));
});
