import test from 'node:test';
import assert from 'node:assert/strict';
import {createHeaderRules, HEADER_RULE_MIN, HEADER_RULE_MAX, stripRestrictedHeaders} from '../assets/js/header-rules.js';
import {createMessageRouter, sameExtension, offscreenOnly, tabOnly} from '../assets/js/message-router.js';
import {createFileSaver} from '../assets/js/file-saver.js';
import {createOffscreenManager, removeTaskCache} from '../assets/js/offscreen-manager.js';
import {installQueueManager} from '../assets/js/queue-manager.js';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(fn) {
  for (let i = 0; i < 200; i++) {
    if (await fn()) return;
    await sleep(5);
  }
  throw Error('Condition timed out');
}

function createEvent() {
  const listeners = new Set();
  return {
    addListener: fn => listeners.add(fn),
    removeListener: fn => listeners.delete(fn),
    emit: (...args) => { for (const fn of [...listeners]) fn(...args); },
    listeners
  };
}

function createChromeMock({sessionRules = [], offscreenRuns = null} = {}) {
  const values = {};
  const rules = new Map(sessionRules.map(rule => [rule.id, rule]));
  const sentMessages = [];
  const downloadsOnChanged = createEvent();
  const runtimeOnMessage = createEvent();
  const local = {
    onChanged: createEvent(),
    async get(keys) {
      return Object.fromEntries(
        (Array.isArray(keys) ? keys : [keys])
          .map(key => [key, structuredClone(values[key])])
          .filter(([, v]) => v !== undefined)
      );
    },
    async set(patch) {
      for (const [k, v] of Object.entries(patch)) values[k] = structuredClone(v);
    }
  };
  const chromeMock = {
    runtime: {
      id: 'ext-test-id',
      lastError: null,
      getURL: path => `chrome-extension://ext-test-id/${path}`,
      onMessage: runtimeOnMessage,
      sendMessage: async message => {
        sentMessages.push(message);
        if (message.type === 'mf-offscreen-command' && message.command === 'snapshot') {
          return {ok: true, runs: offscreenRuns || []};
        }
        return {ok: true};
      }
    },
    storage: {local, onChanged: createEvent()},
    offscreen: {
      hasDocument: async () => offscreenRuns !== null,
      createDocument: async () => {}
    },
    downloads: {
      onChanged: downloadsOnChanged,
      download: (_opts, cb) => cb(1),
      search: async () => [],
      pause: async () => {},
      resume: async () => {},
      cancel: async () => {}
    },
    declarativeNetRequest: {
      getSessionRules: async () => [...rules.values()],
      updateSessionRules: async ({addRules = [], removeRuleIds = []} = {}) => {
        for (const r of addRules) rules.set(r.id, r);
        for (const id of removeRuleIds) rules.delete(id);
      }
    }
  };
  return {chromeMock, rules, sentMessages, values};
}

async function createQueueHarness(initialTasks = [], {limit = 2, sessionRules = [], offscreenRuns = null, savedState = {}} = {}) {
  const {chromeMock, rules, sentMessages, values} = createChromeMock({sessionRules, offscreenRuns});
  globalThis.chrome = chromeMock;
  if (Object.keys(savedState).length) await chromeMock.storage.local.set(savedState);
  let list = structuredClone(initialTasks);
  const engines = [];
  const patches = [];
  class MockHls {
    constructor(cb) {
      this.cb = cb;
      this.tsUrlList = ['seg'];
      this.pauses = 0;
      this.resumes = 0;
      this.destroyed = null;
      engines.push(this);
    }
    start() { this.started = true; }
    async pauseSoft() { this.pauses++; }
    resume() { this.resumes++; }
    getBytesReceived() { return 500; }
    destroy(removeFile) { this.destroyed = removeFile; }
  }
  const queueListeners = [];
  const queueStorage = {
    get: async () => ({tasks: structuredClone(list)}),
    getSnapshot: () => ({tasks: list}),
    subscribe: fn => queueListeners.push(fn),
    enqueue: async value => {
      const id = String(list.length + 100);
      list.push({...value, id, status: 'queued', createdAt: Number(id), opfsCacheFileName: id});
      queueListeners.forEach(fn => fn());
      return id;
    },
    updateTask: async (id, value) => {
      patches.push({id, value: structuredClone(value)});
      list = list.map(t => t.id === id ? {...t, ...value} : t);
      queueListeners.forEach(fn => fn());
    },
    removeTask: async id => {
      list = list.filter(t => t.id !== id);
      queueListeners.forEach(fn => fn());
    }
  };
  const subscribers = [];
  const manager = installQueueManager({
    queueStorage,
    historyStorage: {get: async () => ({records: []}), addRecord: async () => {}},
    settingsStorage: {
      get: async () => ({maxConcurrentTasks: limit, maxPendingTasks: 0}),
      subscribe: fn => subscribers.push(fn)
    },
    HlsDownloader: MockHls,
    registerBlob() {},
    bindBlob() {},
    clearBlob() {},
    formatFilename: n => n,
    withSubdir: n => n
  });
  await manager.ready;
  return {
    manager,
    engines,
    patches,
    rules,
    sentMessages,
    values,
    chromeMock,
    tasks: () => list,
    setLimit: async nextLimit => {
      limit = nextLimit;
      for (const fn of subscribers) fn();
      await manager.schedule();
    }
  };
}

function sendRuntime(chromeMock, message, sender) {
  return new Promise(resolve => {
    let responded = false;
    let isAsync = false;
    const respond = value => {
      if (!responded) {
        responded = true;
        resolve({handled: true, value});
      }
    };
    for (const listener of chromeMock.runtime.onMessage.listeners) {
      if (listener(message, sender, respond) === true) isAsync = true;
    }
    if (!isAsync && !responded) resolve({handled: false, value: undefined});
  });
}

// --- header-rules.js tests ---

test('header-rules adds, filters, releases, and cleans up rules via withHeaders', async () => {
  const {chromeMock, rules} = createChromeMock();
  globalThis.chrome = chromeMock;
  const headerRules = createHeaderRules();

  await assert.rejects(() => headerRules.addHeaders('javascript:alert(1)', {Referer: 'https://a.test'}), /Invalid request URL/);
  assert.equal(await headerRules.addHeaders('https://cdn.test/v.mp4', {'X-Safe': 'ok', Referer: 'bad\r\ninject'}), 0);
  assert.equal(rules.size, 0);

  const id = await headerRules.addHeaders('https://cdn.test/v.mp4', {
    Referer: 'https://site.test/watch',
    Origin: 'https://site.test',
    Cookie: 'a=1',
    'User-Agent': 'ignored'
  });
  assert.ok(id >= HEADER_RULE_MIN && id < HEADER_RULE_MAX);
  assert.equal(headerRules.activeIds.has(id), true);
  assert.equal(rules.size, 1);
  assert.deepEqual(rules.get(id).action.requestHeaders.map(h => h.header), ['Referer', 'Origin', 'Cookie']);

  await headerRules.releaseHeaders(id);
  assert.equal(rules.size, 0);
  assert.equal(headerRules.activeIds.has(id), false);

  // Releasing unknown/already-released IDs is a safe no-op.
  await headerRules.releaseHeaders(id);
  await headerRules.releaseHeaders(0);

  // withHeaders strips restricted headers and always releases on throw.
  const stripped = stripRestrictedHeaders({Referer: 'https://site.test', Origin: 'https://site.test', Cookie: 'a=1', Accept: '*/*'});
  assert.equal(stripped.has('Referer'), false);
  assert.equal(stripped.has('Origin'), false);
  assert.equal(stripped.has('Cookie'), false);
  assert.equal(stripped.get('Accept'), '*/*');

  let seenRuleId = 0;
  await assert.rejects(
    headerRules.withHeaders('https://cdn.test/fail.mp4', {Referer: 'https://site.test', Accept: 'text/plain'}, async (clean, ruleId) => {
      seenRuleId = ruleId;
      assert.equal(clean.has('Referer'), false);
      assert.equal(clean.get('Accept'), 'text/plain');
      assert.equal(rules.has(ruleId), true);
      throw Error('network boom');
    }),
    /network boom/
  );
  assert.ok(seenRuleId >= HEADER_RULE_MIN);
  assert.equal(rules.has(seenRuleId), false);
  assert.equal(headerRules.activeIds.has(seenRuleId), false);
});

test('header-rules sweepOrphanRules removes only stale rules in range and tolerates missing DNR APIs', async () => {
  const stale1 = HEADER_RULE_MIN + 10;
  const stale2 = HEADER_RULE_MIN + 20;
  const adoptedId = HEADER_RULE_MIN + 30;
  const foreignRuleId = 42;
  const upperOutOfRange = HEADER_RULE_MAX;

  const {chromeMock, rules} = createChromeMock({
    sessionRules: [
      {id: stale1},
      {id: stale2},
      {id: adoptedId},
      {id: foreignRuleId},
      {id: upperOutOfRange}
    ]
  });
  globalThis.chrome = chromeMock;
  const headerRules = createHeaderRules();
  const activeId = await headerRules.addHeaders('https://cdn.test/active.mp4', {Referer: 'https://site.test'});
  headerRules.adopt([adoptedId]);

  const removed = await headerRules.sweepOrphanRules();
  assert.deepEqual(removed.sort((a, b) => a - b), [stale1, stale2]);
  assert.equal(rules.has(stale1), false);
  assert.equal(rules.has(stale2), false);
  assert.equal(rules.has(activeId), true);
  assert.equal(rules.has(adoptedId), true);
  assert.equal(rules.has(foreignRuleId), true);
  assert.equal(rules.has(upperOutOfRange), true);

  // Adopted rule can be released cleanly later.
  await headerRules.releaseHeaders(adoptedId);
  assert.equal(rules.has(adoptedId), false);

  // Missing declarativeNetRequest or getSessionRules safely no-ops.
  globalThis.chrome = {};
  assert.deepEqual(await createHeaderRules().sweepOrphanRules(), []);
  globalThis.chrome = {declarativeNetRequest: {updateSessionRules: async () => {}}};
  assert.deepEqual(await createHeaderRules().sweepOrphanRules(), []);
});

test('queue-manager startup sweeps orphaned DNR session rules while keeping active offscreen rules', async () => {
  const orphanId = HEADER_RULE_MIN + 55;
  const externalId = 99;
  const h = await createQueueHarness([], {
    limit: 1,
    sessionRules: [{id: orphanId}, {id: externalId}]
  });
  assert.equal(h.rules.has(orphanId), false, 'stale rule in queue range must be swept on startup');
  assert.equal(h.rules.has(externalId), true, 'rules outside queue range must not be removed');
});

// --- message-router.js tests ---

test('message-router sender guards enforce sameExtension, offscreenOnly, and tabOnly', async () => {
  const {chromeMock} = createChromeMock();
  globalThis.chrome = chromeMock;

  assert.equal(sameExtension({id: 'ext-test-id'}), true);
  assert.equal(sameExtension({}), true);
  assert.equal(sameExtension({id: 'other-ext'}), false);

  assert.equal(offscreenOnly({url: 'chrome-extension://ext-test-id/src/pages/offscreen/index.html'}), true);
  assert.equal(offscreenOnly({url: 'chrome-extension://ext-test-id/src/pages/offscreen/index.html', tab: {id: 1}}), false);
  assert.equal(offscreenOnly({url: 'chrome-extension://ext-test-id/src/pages/popup/index.html'}), false);
  assert.equal(offscreenOnly({url: 'https://evil.test/src/pages/offscreen/index.html'}), false);
  assert.equal(offscreenOnly({}), false);

  assert.equal(tabOnly({tab: {id: 5}}), true);
  assert.equal(tabOnly({tab: {id: '5'}}), false);
  assert.equal(tabOnly({}), false);

  // Missing getURL fails closed for offscreenOnly.
  globalThis.chrome = {runtime: {id: 'ext-test-id'}};
  assert.equal(offscreenOnly({url: 'chrome-extension://ext-test-id/src/pages/offscreen/index.html'}), false);
  globalThis.chrome = chromeMock;

  const calls = [];
  const router = createMessageRouter({
    'offscreen-secret': {guard: offscreenOnly, handle: async msg => { calls.push(msg); return {secret: 1}; }},
    'tab-only': {guard: tabOnly, handle: async (_msg, sender) => ({tabId: sender.tab.id})},
    'sync-op': {sync: true, handle: () => ({success: true, fast: true})},
    'raw-ok': {raw: true, handle: async () => ({text: 'hello'})},
    'raw-fail': {raw: true, handle: async () => { throw Error('raw boom'); }},
    'sync-throw': () => { throw Error('sync failure'); }
  });

  // Foreign extension blocked.
  let responded = false;
  assert.equal(router({type: 'sync-op'}, {id: 'foreign'}, () => { responded = true; }), false);
  assert.equal(responded, false);

  // Non-offscreen blocked on offscreenOnly route.
  assert.equal(router({type: 'offscreen-secret'}, {id: 'ext-test-id', url: 'chrome-extension://ext-test-id/src/pages/popup/index.html'}, () => { responded = true; }), false);
  assert.equal(router({type: 'offscreen-secret'}, {id: 'ext-test-id', tab: {id: 1}, url: 'chrome-extension://ext-test-id/src/pages/offscreen/index.html'}, () => { responded = true; }), false);
  assert.equal(calls.length, 0);
  assert.equal(responded, false);

  // Valid offscreen accepted.
  const offRes = await new Promise(resolve => {
    const ret = router({type: 'offscreen-secret'}, {id: 'ext-test-id', url: 'chrome-extension://ext-test-id/src/pages/offscreen/index.html'}, resolve);
    assert.equal(ret, true);
  });
  assert.deepEqual(offRes, {success: true, secret: 1});
  assert.equal(calls.length, 1);

  // Sync route responds synchronously and returns false.
  let syncVal;
  assert.equal(router({type: 'sync-op'}, {id: 'ext-test-id'}, v => { syncVal = v; }), false);
  assert.deepEqual(syncVal, {success: true, fast: true});

  // Raw routes preserve {ok: true/false}.
  const rawOk = await new Promise(resolve => {
    assert.equal(router({type: 'raw-ok'}, {id: 'ext-test-id'}, resolve), true);
  });
  assert.deepEqual(rawOk, {ok: true, text: 'hello'});

  const rawFail = await new Promise(resolve => {
    assert.equal(router({type: 'raw-fail'}, {id: 'ext-test-id'}, resolve), true);
  });
  assert.deepEqual(rawFail, {ok: false, error: 'raw boom'});

  // Sync throw inside async route is caught and converted to {success: false}.
  const syncErr = await new Promise(resolve => {
    assert.equal(router({type: 'sync-throw'}, {id: 'ext-test-id'}, resolve), true);
  });
  assert.equal(syncErr.success, false);
  assert.equal(syncErr.error, 'sync failure');

  // Unknown type returns false.
  assert.equal(router({type: 'does-not-exist'}, {id: 'ext-test-id'}, () => { responded = true; }), false);
  assert.equal(responded, false);
});

test('queue-manager message router rejects non-offscreen senders on privileged offscreen commands', async () => {
  const h = await createQueueHarness([]);
  const popupSender = {id: 'ext-test-id', url: 'chrome-extension://ext-test-id/src/pages/popup/index.html'};
  const tabSender = {id: 'ext-test-id', tab: {id: 7}, url: 'chrome-extension://ext-test-id/src/pages/offscreen/index.html'};
  const offscreenSender = {id: 'ext-test-id', url: 'chrome-extension://ext-test-id/src/pages/offscreen/index.html'};
  const foreignSender = {id: 'attacker-ext', url: 'chrome-extension://ext-test-id/src/pages/offscreen/index.html'};

  for (const type of ['mf-header-add', 'mf-header-release', 'mf-run-rpc', 'mf-run-event']) {
    assert.equal((await sendRuntime(h.chromeMock, {type, url: 'https://cdn.test/a.mp4', headers: {Referer: 'https://site.test'}}, popupSender)).handled, false);
    assert.equal((await sendRuntime(h.chromeMock, {type, url: 'https://cdn.test/a.mp4', headers: {Referer: 'https://site.test'}}, tabSender)).handled, false);
    assert.equal((await sendRuntime(h.chromeMock, {type, url: 'https://cdn.test/a.mp4', headers: {Referer: 'https://site.test'}}, foreignSender)).handled, false);
  }
  assert.equal((await sendRuntime(h.chromeMock, {type: 'download-queue-snapshot'}, foreignSender)).handled, false);

  const added = await sendRuntime(h.chromeMock, {type: 'mf-header-add', url: 'https://cdn.test/a.mp4', headers: {Referer: 'https://site.test'}}, offscreenSender);
  assert.equal(added.handled, true);
  assert.equal(added.value.success, true);
  assert.ok(added.value.result >= HEADER_RULE_MIN);

  const released = await sendRuntime(h.chromeMock, {type: 'mf-header-release', id: added.value.result}, offscreenSender);
  assert.equal(released.handled, true);
  assert.equal(released.value.success, true);
  assert.equal(h.rules.size, 0);
});

// --- file-saver.js tests ---

test('file-saver always revokes blob URL, clears blob registry, and removes onChanged listener in a single finally', async () => {
  async function runSaveCase({downloadImpl, searchImpl, entry, formatFilename = (n, ext) => `${n}.${ext}`}) {
    const {chromeMock, sentMessages} = createChromeMock();
    chromeMock.runtime.sendMessage = async msg => {
      sentMessages.push(msg);
      if (msg.type === 'OPFS_TO_BLOB_URL') return {ok: true, blobUrl: 'blob:ext/video-1'};
      return {ok: true};
    };
    const cancelled = [];
    chromeMock.downloads.download = downloadImpl;
    chromeMock.downloads.search = searchImpl || (async () => [{id: 10, state: 'in_progress'}]);
    chromeMock.downloads.cancel = async id => cancelled.push(id);
    globalThis.chrome = chromeMock;

    const registered = [], bound = [], cleared = [], progresses = [];
    const saver = createFileSaver({
      ensureOffscreen: async () => {},
      registerBlob: (url, name) => registered.push([url, name]),
      bindBlob: (id, url) => bound.push([id, url]),
      clearBlob: url => cleared.push(url),
      formatFilename,
      withSubdir: name => name,
      notify: msg => chromeMock.runtime.sendMessage(msg)
    });
    return {saver, chromeMock, sentMessages, registered, bound, cleared, progresses, cancelled};
  }

  // 1. Complete via onChanged.
  {
    const ctx = await runSaveCase({
      downloadImpl: (_opts, cb) => {
        cb(10);
        setTimeout(() => ctx.chromeMock.downloads.onChanged.emit({id: 10, state: {current: 'complete'}}), 5);
      }
    });
    await ctx.saver.saveFile({opfsFileName: 'cache-1', fileName: 'clip', format: 'mp4', downloadSubdir: '', bytesReceived: 100, onProgress: p => ctx.progresses.push(p)});
    assert.deepEqual(ctx.registered, [['blob:ext/video-1', 'clip.mp4']]);
    assert.deepEqual(ctx.bound, [[10, 'blob:ext/video-1']]);
    assert.deepEqual(ctx.cleared, ['blob:ext/video-1']);
    assert.equal(ctx.chromeMock.downloads.onChanged.listeners.size, 0);
    assert.deepEqual(ctx.sentMessages.filter(m => m.type === 'revoke-blob-url'), [{type: 'revoke-blob-url', blobUrl: 'blob:ext/video-1'}]);
    assert.equal(ctx.progresses[0].chromeDownloadId, 10);
  }

  // 2. Interrupted via onChanged.
  {
    const ctx = await runSaveCase({
      downloadImpl: (_opts, cb) => {
        cb(11);
        setTimeout(() => ctx.chromeMock.downloads.onChanged.emit({id: 11, state: {current: 'interrupted'}, error: {current: 'USER_CANCELED'}}), 5);
      }
    });
    await assert.rejects(ctx.saver.saveFile({opfsFileName: 'cache-2', fileName: 'clip', format: 'mp4'}), /USER_CANCELED/);
    assert.deepEqual(ctx.cleared, ['blob:ext/video-1']);
    assert.equal(ctx.chromeMock.downloads.onChanged.listeners.size, 0);
    assert.equal(ctx.sentMessages.filter(m => m.type === 'revoke-blob-url').length, 1);
  }

  // 3. chrome.runtime.lastError during download().
  {
    const ctx = await runSaveCase({
      downloadImpl: (_opts, cb) => {
        ctx.chromeMock.runtime.lastError = {message: 'Download blocked'};
        cb(undefined);
        ctx.chromeMock.runtime.lastError = null;
      }
    });
    await assert.rejects(ctx.saver.saveFile({opfsFileName: 'cache-3', fileName: 'clip', format: 'mp4'}), /Download blocked/);
    assert.deepEqual(ctx.cleared, ['blob:ext/video-1']);
    assert.equal(ctx.chromeMock.downloads.onChanged.listeners.size, 0);
    assert.equal(ctx.sentMessages.filter(m => m.type === 'revoke-blob-url').length, 1);
  }

  // 4. Synchronous throw from downloads.download().
  {
    const ctx = await runSaveCase({
      downloadImpl: () => { throw Error('sync download failure'); }
    });
    await assert.rejects(ctx.saver.saveFile({opfsFileName: 'cache-4', fileName: 'clip', format: 'mp4'}), /sync download failure/);
    assert.deepEqual(ctx.cleared, ['blob:ext/video-1']);
    assert.equal(ctx.chromeMock.downloads.onChanged.listeners.size, 0);
    assert.equal(ctx.sentMessages.filter(m => m.type === 'revoke-blob-url').length, 1);
  }

  // 5. Entry deleted while download callback is pending.
  {
    const entry = {deleted: false};
    const ctx = await runSaveCase({
      entry,
      downloadImpl: (_opts, cb) => {
        entry.deleted = true;
        cb(12);
      }
    });
    await assert.rejects(ctx.saver.saveFile({opfsFileName: 'cache-5', fileName: 'clip', format: 'mp4', entry}), /Batch cancelled/);
    assert.deepEqual(ctx.cancelled, [12]);
    assert.deepEqual(ctx.cleared, ['blob:ext/video-1']);
    assert.equal(ctx.chromeMock.downloads.onChanged.listeners.size, 0);
    assert.equal(ctx.sentMessages.filter(m => m.type === 'revoke-blob-url').length, 1);
  }
});

test('file-saver handleDownloadChange handles recovered download pause, interrupt, and complete', async () => {
  let tasks = [
    {id: 't1', format: 'mp4', chromeDownloadId: 77, cachedBytes: 128, status: 'downloading', retryAt: 9999, retryAttempt: 1},
    {id: 't2', format: 'mp4', chromeDownloadId: 88, cachedBytes: 256, status: 'downloading'}
  ];
  const patched = [], failedCalls = [], recorded = [], removedCaches = [];
  let scheduled = 0;
  const active = new Map();
  const saver = createFileSaver({
    ensureOffscreen: async () => {},
    formatFilename: n => n,
    withSubdir: n => n,
    notify: async () => {},
    queueStorage: {
      get: async () => ({tasks: structuredClone(tasks)}),
      removeTask: async id => { tasks = tasks.filter(t => t.id !== id); }
    },
    active,
    useOffscreen: false,
    patch: async (id, val) => { patched.push({id, val}); tasks = tasks.map(t => t.id === id ? {...t, ...val} : t); },
    completed: async () => {},
    failed: async (task, entry, error) => failedCalls.push({id: task.id, error: error.message, hasEntry: active.get(task.id) === entry}),
    recordCompletion: async task => recorded.push(task.id),
    removeTaskCache: async task => removedCaches.push(task.id),
    schedule: () => { scheduled++; }
  });

  await saver.handleDownloadChange({id: 77, paused: {current: true}});
  assert.equal(tasks.find(t => t.id === 't1').status, 'paused');
  assert.equal(tasks.find(t => t.id === 't1').retryAt, undefined);

  await saver.handleDownloadChange({id: 77, state: {current: 'interrupted'}, error: {current: 'DISK_FULL'}});
  assert.deepEqual(failedCalls, [{id: 't1', error: 'DISK_FULL', hasEntry: true}]);

  await saver.handleDownloadChange({id: 88, state: {current: 'complete'}});
  assert.deepEqual(recorded, ['t2']);
  assert.deepEqual(removedCaches, ['t2']);
  assert.equal(tasks.some(t => t.id === 't2'), false);
  assert.equal(scheduled, 1);
});

// --- offscreen-manager.js tests ---

test('offscreen-manager deduplicates ensureOffscreen and cleans task caches', async () => {
  let creates = 0;
  let releaseCreate;
  globalThis.chrome = {
    offscreen: {
      hasDocument: async () => false,
      createDocument: () => new Promise(resolve => { creates++; releaseCreate = resolve; })
    }
  };
  const mgr = createOffscreenManager();
  const p1 = mgr.ensureOffscreen();
  const p2 = mgr.ensureOffscreen();
  await until(() => creates === 1);
  releaseCreate();
  await Promise.all([p1, p2]);
  assert.equal(creates, 1);

  const removed = [];
  const prevStorage = Object.getOwnPropertyDescriptor(navigator, 'storage');
  Object.defineProperty(navigator, 'storage', {
    configurable: true,
    value: {getDirectory: async () => ({removeEntry: async name => removed.push(name)})}
  });
  try {
    await removeTaskCache({format: 'mp4', opfsCacheFileName: 'raw.mp4', outputCacheFileName: 'converted.mp4'});
    assert.deepEqual(removed, ['converted.mp4', 'raw.mp4']);
  } finally {
    if (prevStorage) Object.defineProperty(navigator, 'storage', prevStorage);
    else delete navigator.storage;
  }
});

// --- queue-manager.js retrying transitions & needsSourceRefresh ---

const makeTask = (id, extra = {}) => ({
  id,
  url: `https://example.test/${id}.m3u8`,
  pageUrl: `https://example.test/watch/${id}`,
  format: 'm3u8',
  status: 'queued',
  createdAt: Number(id),
  opfsCacheFileName: id,
  ...extra
});

test('queue-manager retrying progress flushes immediately, preserves progress, and clears on active progress', async () => {
  const h = await createQueueHarness([makeTask('1')], {limit: 1});
  assert.equal(h.tasks()[0].status, 'downloading');

  // Seed normal progress first (let debounce flush).
  h.engines[0].cb.onProgress({progress: 45, finishNum: 9, targetSegment: 20, bytesReceived: 4096});
  await until(() => h.tasks()[0].progress === 45);

  // Trigger retrying without passing progress/finishNum/targetSegment/bytesReceived.
  const retryAt = Date.now() + 8000;
  h.engines[0].cb.onProgress({
    retrying: true,
    retryAt,
    retryAttempt: 1,
    retryMax: 4,
    retryError: 'HTTP 429: Too Many Requests'
  });

  // Must flush immediately (critical), not after 200ms debounce.
  await sleep(10);
  const retryingTask = h.tasks()[0];
  assert.equal(retryingTask.status, 'retrying');
  assert.equal(retryingTask.retryAt, retryAt);
  assert.equal(retryingTask.retryAttempt, 1);
  assert.equal(retryingTask.retryMax, 4);
  assert.equal(retryingTask.retryError, 'HTTP 429: Too Many Requests');
  assert.equal(retryingTask.progress, 45, 'retrying event must preserve existing progress');
  assert.equal(retryingTask.finishNum, 9, 'retrying event must preserve existing finishNum');
  assert.equal(retryingTask.targetSegment, 20, 'retrying event must preserve existing targetSegment');
  assert.equal(retryingTask.cachedBytes, 4096, 'retrying event must preserve existing bytes');
  assert.equal(retryingTask.downloadSpeed, 0);
  assert.equal(retryingTask.speedFormatted, '');

  // Second retry attempt updates metadata immediately.
  const retryAt2 = Date.now() + 16000;
  h.engines[0].cb.onProgress({
    retrying: true,
    retryAt: retryAt2,
    retryAttempt: 2,
    retryMax: 4,
    retryError: 'HTTP 503'
  });
  await sleep(10);
  assert.equal(h.tasks()[0].status, 'retrying');
  assert.equal(h.tasks()[0].retryAttempt, 2);
  assert.equal(h.tasks()[0].retryAt, retryAt2);
  assert.equal(h.tasks()[0].retryError, 'HTTP 503');

  // Normal active progress restores status to downloading and clears retry fields immediately.
  h.engines[0].cb.onProgress({progress: 50, finishNum: 10, targetSegment: 20, bytesReceived: 5120});
  await sleep(10);
  const resumedTask = h.tasks()[0];
  assert.equal(resumedTask.status, 'downloading');
  assert.equal(resumedTask.retryAt, undefined);
  assert.equal(resumedTask.retryAttempt, undefined);
  assert.equal(resumedTask.retryMax, undefined);
  assert.equal(resumedTask.retryError, undefined);
  assert.equal(resumedTask.progress, 50);

  await h.manager.remove('1');
});

test('queue-manager treats retrying as active for concurrency, pause, limit reduction, cancel, and batch pause', async () => {
  const h = await createQueueHarness([makeTask('1'), makeTask('2')], {limit: 1});
  assert.equal(h.engines.length, 1);
  h.engines[0].cb.onProgress({retrying: true, retryAt: Date.now() + 5000, retryAttempt: 1, retryMax: 4, retryError: 'HTTP 503'});
  await sleep(10);
  assert.equal(h.tasks().find(t => t.id === '1').status, 'retrying');

  // Concurrency: task 2 must NOT start while task 1 is retrying under limit=1.
  await h.manager.schedule();
  assert.equal(h.engines.length, 1);
  assert.equal(h.tasks().find(t => t.id === '2').status, 'queued');

  // Lowering limit to 0 suspends retrying task to queued and clears retry fields.
  await h.setLimit(0);
  assert.equal(h.tasks().find(t => t.id === '1').status, 'queued');
  assert.equal(h.tasks().find(t => t.id === '1').retryAt, undefined);
  assert.equal(h.tasks().find(t => t.id === '1').retryAttempt, undefined);
  assert.equal(h.tasks().find(t => t.id === '1').retryMax, undefined);
  assert.equal(h.tasks().find(t => t.id === '1').retryError, undefined);

  // Restore limit=1, re-enter retrying, then manually pause.
  await h.setLimit(1);
  await until(() => h.tasks().find(t => t.id === '1').status === 'downloading');
  h.engines[0].cb.onProgress({retrying: true, retryAt: Date.now() + 5000, retryAttempt: 2, retryMax: 4, retryError: 'TIMEOUT'});
  await sleep(10);
  assert.equal(h.tasks().find(t => t.id === '1').status, 'retrying');

  await h.manager.pause('1');
  const paused1 = h.tasks().find(t => t.id === '1');
  assert.equal(paused1.status, 'paused');
  assert.equal(paused1.retryAt, undefined);
  assert.equal(paused1.retryAttempt, undefined);
  assert.equal(paused1.retryMax, undefined);
  assert.equal(paused1.retryError, undefined);

  // Late retrying progress while paused must NOT flip paused task to retrying.
  h.engines[0].cb.onProgress({retrying: true, retryAt: Date.now() + 9000, retryAttempt: 3, retryMax: 4, retryError: 'late'});
  await sleep(10);
  assert.equal(h.tasks().find(t => t.id === '1').status, 'paused');

  // Task 2 started when task 1 paused; put task 2 into retrying and remove it.
  await until(() => h.engines.length === 2);
  h.engines[1].cb.onProgress({retrying: true, retryAt: Date.now() + 5000, retryAttempt: 1, retryMax: 4, retryError: 'HTTP 429'});
  await sleep(10);
  assert.equal(h.tasks().find(t => t.id === '2').status, 'retrying');
  await h.manager.remove('2');
  assert.equal(h.tasks().some(t => t.id === '2'), false);
  await h.manager.remove('1');
});

test('batch pause pauses retrying batch tasks and clears their retry metadata', async () => {
  const batch = {id: 'batch-retry', profileKey: 'creator', status: 'complete', total: 1, processed: 1, enqueued: 1, skipped: 0, failed: 0};
  const h = await createQueueHarness([makeTask('1', {batchId: 'batch-retry'})], {limit: 1, savedState: {profileBatchState: batch}});
  h.engines[0].cb.onProgress({retrying: true, retryAt: Date.now() + 5000, retryAttempt: 1, retryMax: 4, retryError: 'HTTP 429'});
  await sleep(10);
  assert.equal(h.tasks()[0].status, 'retrying');

  const res = await sendRuntime(h.chromeMock, {type: 'profile-batch-pause', batchId: 'batch-retry'}, {id: 'ext-test-id'});
  assert.equal(res.value.success, true);
  assert.equal(h.tasks()[0].status, 'paused');
  assert.equal(h.tasks()[0].batchPausedBy, 'batch-retry');
  assert.equal(h.tasks()[0].retryAt, undefined);
  assert.equal(h.tasks()[0].retryAttempt, undefined);
  await h.manager.remove('1');
});

test('failed() clears retry fields and records needsSourceRefresh without altering error messages', async () => {
  const h = await createQueueHarness([makeTask('1'), makeTask('2')], {limit: 2});
  h.engines[0].cb.onProgress({retrying: true, retryAt: Date.now() + 5000, retryAttempt: 2, retryMax: 4, retryError: 'HTTP 503'});
  await sleep(10);
  assert.equal(h.tasks().find(t => t.id === '1').status, 'retrying');

  // Source-refresh error (403 / explicit needsSourceRefresh).
  h.engines[0].cb.onError(Object.assign(Error('HTTP 403: access denied'), {status: 403, code: 'HTTP', needsSourceRefresh: true}));
  await until(() => h.tasks().find(t => t.id === '1')?.status === 'error');
  const t1 = h.tasks().find(t => t.id === '1');
  assert.equal(t1.error, 'HTTP 403: access denied');
  assert.equal(t1.needsSourceRefresh, true);
  assert.equal(t1.retryAt, undefined);
  assert.equal(t1.retryAttempt, undefined);
  assert.equal(t1.retryMax, undefined);
  assert.equal(t1.retryError, undefined);

  // Generic permanent error must NOT set needsSourceRefresh.
  h.engines[1].cb.onError(Error('Unsupported container'));
  await until(() => h.tasks().find(t => t.id === '2')?.status === 'error');
  const t2 = h.tasks().find(t => t.id === '2');
  assert.equal(t2.error, 'Unsupported container');
  assert.equal(t2.needsSourceRefresh, undefined);

  // Resuming clears needsSourceRefresh.
  await h.manager.resume('1');
  assert.equal(h.tasks().find(t => t.id === '1').needsSourceRefresh, undefined);

  await h.manager.remove('1');
  await h.manager.remove('2');
});

test('startup recovery resets orphaned retrying tasks to queued and clears stale retry metadata', async () => {
  const h = await createQueueHarness([
    makeTask('1', {
      status: 'retrying',
      retryAt: Date.now() + 10000,
      retryAttempt: 3,
      retryMax: 4,
      retryError: 'HTTP 503'
    })
  ], {limit: 0});
  const recovered = h.tasks()[0];
  assert.equal(recovered.status, 'queued');
  assert.equal(recovered.retryAt, undefined);
  assert.equal(recovered.retryAttempt, undefined);
  assert.equal(recovered.retryMax, undefined);
  assert.equal(recovered.retryError, undefined);
});

test('completed() clears retry fields on active entry and removes task from queue', async () => {
  const h = await createQueueHarness([makeTask('1')], {limit: 1});
  const entry = h.manager.active.get('1');
  h.engines[0].cb.onProgress({retrying: true, retryAt: Date.now() + 5000, retryAttempt: 1, retryMax: 4, retryError: 'HTTP 429'});
  await sleep(10);
  assert.equal(entry.task.status, 'retrying');
  h.engines[0].cb.onComplete();
  await until(() => h.tasks().length === 0);
  assert.equal(entry.task.retryAt, undefined);
  assert.equal(entry.task.retryAttempt, undefined);
  assert.equal(entry.task.retryMax, undefined);
  assert.equal(entry.task.retryError, undefined);
});

test('startup recovery adopts a live offscreen run in retrying state and preserves its adopted DNR rules', async () => {
  const adoptedRuleId = HEADER_RULE_MIN + 77;
  const orphanRuleId = HEADER_RULE_MIN + 88;
  const retryAt = Date.now() + 12000;
  const {chromeMock, rules} = createChromeMock({
    sessionRules: [{id: adoptedRuleId}, {id: orphanRuleId}],
    offscreenRuns: [{
      taskId: '1',
      runId: 'run-retrying-1',
      state: 'running',
      bytes: 2048,
      ruleIds: [adoptedRuleId],
      task: {format: 'm3u8', downloadSubdir: ''},
      progress: {phase: 'retrying', retrying: true, retryAt, retryAttempt: 2, retryMax: 4, retryError: 'HTTP 429', progress: 35}
    }]
  });
  globalThis.chrome = chromeMock;

  let tasks = [makeTask('1', {status: 'downloading'})];
  const manager = installQueueManager({
    queueStorage: {
      get: async () => ({tasks: structuredClone(tasks)}),
      updateTask: async (id, patch) => { tasks = tasks.map(t => t.id === id ? {...t, ...patch} : t); },
      removeTask: async id => { tasks = tasks.filter(t => t.id !== id); }
    },
    historyStorage: {get: async () => ({records: []}), addRecord: async () => {}},
    settingsStorage: {get: async () => ({maxConcurrentTasks: 2}), subscribe() {}},
    registerBlob() {},
    bindBlob() {},
    clearBlob() {},
    formatFilename: n => n,
    withSubdir: n => n
  });
  await manager.ready;

  assert.equal(rules.has(adoptedRuleId), true, 'live offscreen rule must be adopted and kept');
  assert.equal(rules.has(orphanRuleId), false, 'stale orphaned rule must be swept');
  assert.equal(tasks[0].status, 'retrying');
  assert.equal(tasks[0].retryAt, retryAt);
  assert.equal(tasks[0].retryAttempt, 2);
  assert.equal(tasks[0].retryMax, 4);
  assert.equal(tasks[0].retryError, 'HTTP 429');

  // Subsequent non-retrying progress from offscreen restores downloading and clears retry fields.
  const offscreenSender = {id: 'ext-test-id', url: 'chrome-extension://ext-test-id/src/pages/offscreen/index.html'};
  await sendRuntime(chromeMock, {
    type: 'mf-run-event',
    taskId: '1',
    runId: 'run-retrying-1',
    event: 'progress',
    data: {phase: 'downloading', retrying: false, progress: 40, bytesReceived: 3072}
  }, offscreenSender);
  await until(() => tasks[0].status === 'downloading');
  assert.equal(tasks[0].retryAt, undefined);
  assert.equal(tasks[0].retryAttempt, undefined);
  assert.equal(tasks[0].retryMax, undefined);
  assert.equal(tasks[0].retryError, undefined);
});
