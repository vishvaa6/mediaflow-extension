const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const runtime = process.env.CODEX_NODE_MODULES || 'C:/Users/vishv/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const {chromium} = require(path.join(runtime, 'playwright'));
const root = path.resolve(__dirname, '..');

const server = http.createServer((req, res) => {
  const requested = new URL(req.url, 'http://localhost').pathname;
  if (requested === '/thumb.png') {
    res.setHeader('Content-Type', 'image/svg+xml');
    res.end(fs.readFileSync(path.join(root, 'tests/fixtures/library-thumb.svg')));
    return;
  }
  const file = path.resolve(root, '.' + decodeURIComponent(requested));
  if (!file.startsWith(root + path.sep)) {
    res.writeHead(403);
    res.end();
    return;
  }
  try {
    const type = file.endsWith('.js')
      ? 'text/javascript'
      : file.endsWith('.css')
        ? 'text/css'
        : file.endsWith('.png')
          ? 'image/png'
          : 'text/html';
    res.setHeader('Content-Type', type);
    res.end(fs.readFileSync(file));
  } catch {
    res.writeHead(404);
    res.end();
  }
});

function isOpaqueColor(color) {
  if (!color || color === 'transparent') return false;
  const rgba = color.match(/^rgba\(\s*\d+,\s*\d+,\s*\d+,\s*([0-9.]+)\s*\)$/);
  if (rgba) return Number(rgba[1]) >= 0.99;
  return /^rgb\(/.test(color);
}

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true
  });
  const shotDir = process.env.POLISH_SCREENSHOT_DIR || '';
  if (shotDir) fs.mkdirSync(shotDir, {recursive: true});

  try {
    // ---- Part 1: Popup retrying countdown, error actions, accessibility, empty states, reduced motion & transparency ----
    const page = await browser.newPage({viewport: {width: 720, height: 600}});
    await page.emulateMedia({colorScheme: 'dark'});
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));

    await page.addInitScript(({origin}) => {
      // Track 1000ms intervals to verify retry countdown timer lifecycle
      const origSetInterval = window.setInterval.bind(window);
      const origClearInterval = window.clearInterval.bind(window);
      window.__retryIntervals = new Set();
      window.setInterval = (fn, delay, ...args) => {
        const id = origSetInterval(fn, delay, ...args);
        if (delay === 1000) window.__retryIntervals.add(id);
        return id;
      };
      window.clearInterval = id => {
        window.__retryIntervals.delete(id);
        return origClearInterval(id);
      };

      const onChanged = [];
      const localChanged = [];
      const now = Date.now();
      const values = {
        downloadQueueState: {
          tasks: [
            {
              id: 'task-retrying',
              fileName: 'Creator/Ocean Timelapse 4K.mp4',
              status: 'retrying',
              progress: 46,
              fetchedBytes: 18 * 1024 * 1024,
              format: 'm3u8',
              outputFormat: 'mp4',
              retryAt: now + 3400,
              retryAttempt: 2,
              retryMax: 4,
              retryError: 'HTTP 429: rate limited by server — retrying automatically'
            },
            {
              id: 'err-refresh-flag',
              fileName: 'Creator/Expired Signed Stream.mp4',
              status: 'error',
              progress: 62,
              cachedBytes: 24 * 1024 * 1024,
              format: 'mp4',
              outputFormat: 'mp4',
              needsSourceRefresh: true,
              pageUrl: 'https://example.test/watch?v=expired-flag',
              error: 'Signed media link rejected. Open the original video page to renew the link.'
            },
            {
              id: 'err-474-text',
              fileName: 'Creator/HTTP 474 Stream.mp4',
              status: 'error',
              progress: 15,
              format: 'm3u8',
              outputFormat: 'mp4',
              pageUrl: 'https://example.test/watch?v=474-case',
              error: 'HTTP 474: unable to fetch this resource. Open the original video page and retry.'
            },
            {
              id: 'err-no-page-url',
              fileName: 'Creator/Expired Without PageUrl.mp4',
              status: 'error',
              progress: 10,
              format: 'mp4',
              needsSourceRefresh: true,
              error: 'Expired link with no source page attached'
            },
            {
              id: 'err-generic-net',
              fileName: 'Creator/Network Reset Clip.mp4',
              status: 'error',
              progress: 33,
              cachedBytes: 9 * 1024 * 1024,
              format: 'mp4',
              pageUrl: 'https://example.test/watch?v=generic-net',
              error: 'Connection reset by peer while streaming segment'
            }
          ]
        },
        m3u8DownloadHistory: {
          records: [
            {
              id: 'hist-1',
              title: 'Saved Sunset Documentary',
              fileName: 'Creator/Saved Sunset Documentary.mp4',
              creator: 'Studio North',
              pageUrl: 'https://example.test/watch?v=saved-1',
              url: 'https://cdn.test/saved-1.mp4',
              quality: '1080',
              format: 'mp4',
              bytes: 42 * 1024 * 1024,
              completedAt: now - 60000,
              downloadId: 501,
              thumbnail: origin + '/thumb.png'
            }
          ]
        },
        profileScanState: {
          status: 'complete',
          profileName: 'Studio North',
          profileUrl: 'https://example.test/model/studio-north/videos',
          pagesScanned: 2,
          videos: Array.from({length: 6}, (_, i) => ({
            id: 'vid-' + i,
            url: 'https://example.test/watch?v=vid-' + i,
            title: 'Library Clip ' + i,
            thumbnail: origin + '/thumb.png',
            duration: '2:10'
          }))
        }
      };

      const local = {
        onChanged: {addListener: fn => localChanged.push(fn)},
        async get(keys) {
          return Object.fromEntries(
            (Array.isArray(keys) ? keys : [keys])
              .map(key => [key, structuredClone(values[key])])
              .filter(([, value]) => value !== undefined)
          );
        },
        async set(patch) {
          const changes = {};
          for (const [key, value] of Object.entries(patch)) {
            changes[key] = {oldValue: structuredClone(values[key]), newValue: structuredClone(value)};
            values[key] = structuredClone(value);
          }
          for (const fn of localChanged) fn(changes);
          for (const fn of onChanged) fn(changes, 'local');
        }
      };

      window.sentMessages = [];
      window.testStorage = local;
      window.chrome = {
        i18n: {getMessage: () => ''},
        storage: {local, onChanged: {addListener: fn => onChanged.push(fn)}},
        runtime: {
          id: 'polish-test',
          getURL: p => origin + '/' + p,
          getManifest: () => ({version: '1.3.0'}),
          onMessage: {addListener() {}},
          sendMessage(message, callback) {
            window.sentMessages.push(message);
            const result = message.type === 'download-queue-snapshot'
              ? {success: true, state: values.downloadQueueState}
              : {success: true};
            callback?.(result);
            return Promise.resolve(result);
          }
        },
        tabs: {
          query: (_query, cb) => cb([{id: 1, url: 'https://example.test/watch?v=current', title: 'Current Video'}]),
          sendMessage: (_id, _msg, cb) => cb({videoInfos: []}),
          create: async options => ({id: 99, ...options})
        },
        windows: {getCurrent: async () => ({id: 1})}
      };
    }, {origin});

    await page.goto(origin + '/src/pages/popup/index.html?surface=popup');
    await page.locator('[data-download-view="queue"]').click();
    await page.waitForSelector('[data-task-id="task-retrying"]');

    // 1. Retrying state + live countdown + active controls + in-place patching
    const retryingCard = page.locator('[data-task-id="task-retrying"]');
    assert.match(await page.locator('.queue-summary').innerText(), /1 active · 0 waiting · 4 need attention/);
    assert.equal(await retryingCard.locator('[data-action="pause"]').count(), 1, 'retrying card shows Pause button');
    assert.equal(await retryingCard.locator('[data-action="delete"]').count(), 1, 'retrying card shows Cancel button');
    assert.equal(await retryingCard.locator('[role="progressbar"]').getAttribute('aria-valuenow'), '46');
    assert.equal(await retryingCard.locator('[data-role="bar"]').evaluate(el => el.style.width), '46%');
    assert.equal(await retryingCard.locator('[data-role="status"]').evaluate(el => getComputedStyle(el).textTransform), 'none');

    const initialLabel = (await retryingCard.locator('[data-role="status"]').innerText()).trim();
    const initialMatch = initialLabel.match(/^Retrying in (\d+)s \(attempt 2\/4\)$/);
    assert.ok(initialMatch, `expected countdown label, got: ${initialLabel}`);
    const initialSeconds = Number(initialMatch[1]);
    assert.equal(await page.evaluate(() => window.__retryIntervals.size), 1, 'exactly one 1s retry countdown interval active');

    // Capture full-window screenshot of retrying countdown + contextual error action cards
    if (shotDir) {
      await page.evaluate(() => document.fonts.ready);
      await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('.downloads-workspace')).opacity) >= 0.99);
      await page.screenshot({path: path.join(shotDir, 'popup-retrying-and-errors.png')});
    }

    // Record DOM identity of progress element before 1s tick to verify in-place countdown update
    await page.evaluate(() => {
      window.__retryNumsChild = document.querySelector('[data-task-id="task-retrying"] [data-role="nums"]').firstElementChild;
    });
    await page.waitForFunction(
      prev => {
        const text = document.querySelector('[data-task-id="task-retrying"] [data-role="status"]')?.textContent?.trim() || '';
        const m = text.match(/^Retrying in (\d+)s \(attempt 2\/4\)$/);
        return (m && Number(m[1]) < prev) || text === 'Retrying… (attempt 2/4)';
      },
      initialSeconds,
      {timeout: 3000}
    );
    assert.equal(
      await page.evaluate(() => window.__retryNumsChild === document.querySelector('[data-task-id="task-retrying"] [data-role="nums"]').firstElementChild),
      true,
      'countdown ticks must patch status text in place without rebuilding progress DOM'
    );

    // Wait for retryAt to elapse -> fallback label and timer stop
    await page.waitForFunction(
      () => document.querySelector('[data-task-id="task-retrying"] [data-role="status"]')?.textContent?.trim() === 'Retrying… (attempt 2/4)',
      null,
      {timeout: 5000}
    );
    assert.equal(await page.evaluate(() => window.__retryIntervals.size), 0, '1s interval stops once countdown finishes');

    // Start a longer countdown, verify Pause/Cancel dispatch, and verify timer stops immediately when retrying ends
    await page.evaluate(async () => {
      const state = (await testStorage.get('downloadQueueState')).downloadQueueState;
      state.tasks[0].retryAt = Date.now() + 15000;
      state.tasks[0].retryAttempt = 3;
      await testStorage.set({downloadQueueState: state});
    });
    await page.waitForFunction(
      () => /Retrying in \d+s \(attempt 3\/4\)/.test(document.querySelector('[data-task-id="task-retrying"] [data-role="status"]')?.textContent || '')
    );
    assert.equal(await page.evaluate(() => window.__retryIntervals.size), 1, '1s interval restarts for new retryAt');

    await retryingCard.locator('[data-action="pause"]').click();
    assert.equal(
      await page.evaluate(() => sentMessages.some(m => m.type === 'download-queue-pause' && m.taskId === 'task-retrying')),
      true,
      'Pause on retrying task sends download-queue-pause'
    );

    await page.evaluate(async () => {
      const state = (await testStorage.get('downloadQueueState')).downloadQueueState;
      state.tasks[0].status = 'downloading';
      delete state.tasks[0].retryAt;
      delete state.tasks[0].retryAttempt;
      delete state.tasks[0].retryMax;
      await testStorage.set({downloadQueueState: state});
    });
    await page.waitForSelector('[data-task-id="task-retrying"].status-downloading');
    assert.equal(await page.evaluate(() => window.__retryIntervals.size), 0, '1s interval stops immediately when no task is retrying');

    // 2. Contextual error actions ("Open source page" vs "Retry")
    const errFlag = page.locator('[data-task-id="err-refresh-flag"] .task-error');
    assert.equal(await errFlag.locator('[data-action="open-source"]').count(), 1, 'needsSourceRefresh + pageUrl shows Open source page');
    assert.match(await errFlag.locator('[data-action="open-source"]').innerText(), /Open source page/);
    assert.equal(await errFlag.locator('[data-action="retry"]').count(), 1, 'secondary Retry button accompanies Open source page');

    const err474 = page.locator('[data-task-id="err-474-text"] .task-error');
    assert.equal(await err474.locator('[data-action="open-source"]').count(), 1, 'HTTP 474 / original video page text + pageUrl shows Open source page');
    assert.equal(await err474.locator('[data-action="retry"]').count(), 1);

    const errNoUrl = page.locator('[data-task-id="err-no-page-url"] .task-error');
    assert.equal(await errNoUrl.locator('[data-action="open-source"]').count(), 0, 'missing pageUrl falls back to Retry only');
    assert.equal(await errNoUrl.locator('.btn-error-primary[data-action="retry"]').count(), 1);

    const errNet = page.locator('[data-task-id="err-generic-net"] .task-error');
    assert.equal(await errNet.locator('[data-action="open-source"]').count(), 0, 'generic network error shows Retry primary action');
    assert.equal(await errNet.locator('.btn-error-primary[data-action="retry"]').count(), 1);

    await errFlag.locator('[data-action="open-source"]').click();
    assert.equal(
      await page.evaluate(() => sentMessages.some(m => m.type === 'open-video-page' && m.url === 'https://example.test/watch?v=expired-flag')),
      true,
      'Open source page sends open-video-page with task pageUrl'
    );
    await errNet.locator('[data-action="retry"]').click();
    assert.equal(
      await page.evaluate(() => sentMessages.some(m => m.type === 'download-queue-retry' && m.taskId === 'err-generic-net')),
      true,
      'Retry button sends download-queue-retry'
    );

    // 3. Accessibility: aria-label on all icon-only controls, aria-hidden="true" on all decorative SVGs, :focus-visible ring
    async function assertIconAccessibility(viewName) {
      const audit = await page.evaluate(() => {
        const missingLabels = [];
        const exposedSvgs = [];
        for (const button of document.querySelectorAll('button')) {
          const style = getComputedStyle(button);
          if (button.hidden || style.display === 'none' || style.visibility === 'hidden') continue;
          const text = button.textContent.trim();
          const ariaLabel = (button.getAttribute('aria-label') || '').trim();
          if (!text && !ariaLabel) {
            missingLabels.push(button.outerHTML.slice(0, 120));
          }
          for (const svg of button.querySelectorAll('svg.mf-icon')) {
            if (svg.getAttribute('aria-hidden') !== 'true') {
              exposedSvgs.push(svg.outerHTML.slice(0, 120));
            }
          }
        }
        return {missingLabels, exposedSvgs};
      });
      assert.deepEqual(audit.missingLabels, [], `${viewName}: every icon-only button needs descriptive aria-label`);
      assert.deepEqual(audit.exposedSvgs, [], `${viewName}: every decorative SVG icon needs aria-hidden="true"`);
    }

    await assertIconAccessibility('Queue view');
    // Keyboard Tab onto icon-only header button and verify visible :focus-visible outline
    await page.locator('#btn-open-browser-tab').focus();
    // Trigger keyboard modality so :focus-visible activates in Chromium
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    const headerFocus = await page.locator('#btn-open-browser-tab').evaluate(el => {
      const style = getComputedStyle(el);
      return {
        focused: document.activeElement === el,
        focusVisible: el.matches(':focus-visible'),
        outlineStyle: style.outlineStyle,
        outlineWidth: parseFloat(style.outlineWidth)
      };
    });
    assert.equal(headerFocus.focused, true, 'icon-only control receives keyboard focus');
    assert.equal(headerFocus.focusVisible, true, 'keyboard focus triggers :focus-visible');
    assert.notEqual(headerFocus.outlineStyle, 'none', 'focus ring has visible outline style');
    assert.ok(headerFocus.outlineWidth >= 2, `focus ring width >= 2px (got ${headerFocus.outlineWidth})`);

    // Also verify task card icon-only pause button receives visible focus ring
    await page.locator('[data-task-id="task-retrying"] [data-action="pause"]').focus();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    const taskBtnFocus = await page.locator('[data-task-id="task-retrying"] [data-action="pause"]').evaluate(el => {
      const style = getComputedStyle(el);
      return {focusVisible: el.matches(':focus-visible'), outlineStyle: style.outlineStyle, outlineWidth: parseFloat(style.outlineWidth)};
    });
    assert.equal(taskBtnFocus.focusVisible, true);
    assert.notEqual(taskBtnFocus.outlineStyle, 'none');
    assert.ok(taskBtnFocus.outlineWidth >= 2);

    // Check History, Profile, Settings icon-only controls too
    await page.locator('[data-tab="history"]').click();
    await assertIconAccessibility('History view');
    assert.equal(await page.locator('.history-remove').first().getAttribute('aria-label'), 'Remove from history');
    await page.locator('[data-tab="profile"]').click();
    await assertIconAccessibility('Library view');
    await page.locator('[data-tab="settings"]').click();
    await assertIconAccessibility('Settings view');

    // 4. Reduced motion & reduced transparency fallbacks (popup + glass workspace)
    await page.emulateMedia({reducedMotion: 'reduce'});
    await page.locator('[data-tab="video"]').click();
    const reducedMotionCheck = await page.evaluate(() => {
      const nav = document.querySelector('.popup-tabs-bar');
      const lens = nav.querySelector('.liquid-nav-lens');
      const btn = nav.querySelector('.popup-tab-btn');
      return {
        lensAnimations: lens.getAnimations().length,
        btnTransitionDuration: getComputedStyle(btn).transitionDuration
      };
    });
    assert.equal(reducedMotionCheck.lensAnimations, 0, 'reduced motion disables liquid nav lens animation');
    assert.equal(reducedMotionCheck.btnTransitionDuration, '0s', 'reduced motion disables button transitions');

    const navBox = await page.locator('.popup-tabs-bar').boundingBox();
    await page.mouse.move(navBox.x + navBox.width * 0.7, navBox.y + navBox.height / 2);
    assert.equal(
      await page.locator('.popup-tabs-bar').evaluate(el => el.style.getPropertyValue('--light-x')),
      '',
      'reduced motion disables pointer-tracking light shimmer'
    );
    await page.emulateMedia({reducedMotion: 'no-preference'});

    // Emulate prefers-reduced-transparency: reduce via CDP
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setEmulatedMedia', {
      features: [{name: 'prefers-reduced-transparency', value: 'reduce'}]
    });
    const reducedTransparencyCheck = await page.evaluate(() => {
      const nav = document.querySelector('.popup-tabs-bar');
      const card = document.querySelector('.card-section');
      const switcher = document.querySelector('.download-switcher');
      return {
        matches: matchMedia('(prefers-reduced-transparency: reduce)').matches,
        navBackdrop: getComputedStyle(nav).backdropFilter,
        navBg: getComputedStyle(nav).backgroundColor,
        cardBackdrop: getComputedStyle(card).backdropFilter,
        cardBg: getComputedStyle(card).backgroundColor,
        switcherBackdrop: getComputedStyle(switcher).backdropFilter,
        switcherBg: getComputedStyle(switcher).backgroundColor
      };
    });
    assert.equal(reducedTransparencyCheck.matches, true, 'CDP emulated prefers-reduced-transparency: reduce');
    assert.equal(reducedTransparencyCheck.navBackdrop, 'none', 'reduced transparency removes nav backdrop-filter');
    assert.equal(reducedTransparencyCheck.cardBackdrop, 'none', 'reduced transparency removes card backdrop-filter');
    assert.equal(reducedTransparencyCheck.switcherBackdrop, 'none', 'reduced transparency removes switcher backdrop-filter');
    assert.equal(isOpaqueColor(reducedTransparencyCheck.navBg), true, `nav background must be opaque (got ${reducedTransparencyCheck.navBg})`);
    assert.equal(isOpaqueColor(reducedTransparencyCheck.cardBg), true, `card background must be opaque (got ${reducedTransparencyCheck.cardBg})`);
    assert.equal(isOpaqueColor(reducedTransparencyCheck.switcherBg), true, `switcher background must be opaque (got ${reducedTransparencyCheck.switcherBg})`);

    await page.mouse.move(navBox.x + navBox.width * 0.3, navBox.y + navBox.height / 2);
    assert.equal(
      await page.locator('.popup-tabs-bar').evaluate(el => el.style.getPropertyValue('--light-x')),
      '',
      'reduced transparency disables pointer-tracking glass highlight'
    );
    await cdp.send('Emulation.setEmulatedMedia', {features: []});

    // 5. Empty states (Queue & History)
    // History search empty state first
    await page.locator('[data-tab="history"]').click();
    await page.locator('#history-search').fill('no-such-video-title');
    assert.equal(await page.locator('.history-empty').isVisible(), true);
    assert.match(await page.locator('.history-empty').innerText(), /No matching downloads/);
    await page.locator('#btn-clear-history-search').click();
    assert.equal(await page.locator('.history-record').count(), 1, 'Clear search restores history records');

    // Empty History state (0 records)
    await page.evaluate(() => testStorage.set({m3u8DownloadHistory: {records: []}}));
    await page.waitForSelector('.history-empty');
    assert.match(await page.locator('.history-empty').innerText(), /No completed downloads yet/);
    assert.equal(await page.locator('#btn-history-empty-downloads').isVisible(), true);
    if (shotDir) {
      await page.evaluate(() => document.fonts.ready);
      await page.screenshot({path: path.join(shotDir, 'popup-empty-history.png'), animations: 'disabled'});
    }
    await page.locator('#btn-history-empty-downloads').click();
    assert.equal(await page.locator('[data-tab="video"]').getAttribute('aria-pressed'), 'true', 'empty history CTA navigates to Downloads');

    // Empty Queue state (0 tasks)
    await page.evaluate(() => testStorage.set({downloadQueueState: {tasks: []}}));
    await page.locator('[data-download-view="queue"]').click();
    await page.waitForSelector('.queue-empty');
    assert.match(await page.locator('.queue-empty').innerText(), /No downloads in queue/);
    assert.equal(await page.locator('#btn-queue-empty-detected').isVisible(), true);
    assert.equal(await page.locator('#btn-queue-empty-library').isVisible(), true);
    if (shotDir) {
      await page.evaluate(() => document.fonts.ready);
      await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('.downloads-workspace')).opacity) >= 0.99);
      await page.screenshot({path: path.join(shotDir, 'popup-empty-queue.png')});
    }
    await page.locator('#btn-queue-empty-library').click();
    assert.equal(await page.locator('[data-tab="profile"]').getAttribute('aria-pressed'), 'true', 'empty queue Open library CTA navigates to Library');
    await page.locator('[data-tab="video"]').click();
    await page.locator('[data-download-view="queue"]').click();
    await page.locator('#btn-queue-empty-detected').click();
    assert.equal(await page.locator('[data-download-view="detected"]').getAttribute('aria-pressed'), 'true', 'empty queue Detected CTA switches to Detected videos');

    // ---- Part 2: overlay-host.js reduced-transparency & reduced-motion verification ----
    const overlayPage = await browser.newPage({viewport: {width: 1000, height: 800}});
    await overlayPage.emulateMedia({colorScheme: 'dark', reducedMotion: 'reduce'});
    overlayPage.on('pageerror', error => errors.push(error.message));
    const overlayCdp = await overlayPage.context().newCDPSession(overlayPage);
    await overlayCdp.send('Emulation.setEmulatedMedia', {
      features: [
        {name: 'prefers-color-scheme', value: 'dark'},
        {name: 'prefers-reduced-motion', value: 'reduce'},
        {name: 'prefers-reduced-transparency', value: 'reduce'}
      ]
    });
    await overlayPage.route('https://fixture.test/**', route => {
      const name = new URL(route.request().url()).pathname;
      if (name === '/') {
        return route.fulfill({
          contentType: 'text/html',
          body: '<!doctype html><title>Overlay fallback</title><body style="margin:0;background:#111"><p>Host page</p></body>'
        });
      }
      const file = path.resolve(root, '.' + name);
      if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) return route.abort();
      const ext = path.extname(file);
      const type = ext === '.js' ? 'text/javascript' : ext === '.css' ? 'text/css' : ext === '.html' ? 'text/html' : 'application/octet-stream';
      return route.fulfill({contentType: type, body: fs.readFileSync(file)});
    });
    await overlayPage.addInitScript(() => {
      const listeners = [];
      window.overlayListeners = listeners;
      const session = {
        set: async values => Object.entries(values).forEach(([k, v]) => localStorage.setItem(k, JSON.stringify(v))),
        get: async key => ({[key]: JSON.parse(localStorage.getItem(key) || 'null')}),
        remove: async key => localStorage.removeItem(key)
      };
      const local = {
        get: async () => ({}),
        set: async () => {},
        onChanged: {addListener() {}}
      };
      window.chrome = {
        i18n: {getMessage: () => ''},
        storage: {session, local, onChanged: {addListener() {}}},
        runtime: {
          id: 'fixture',
          getURL: value => 'https://fixture.test/' + value,
          onMessage: {addListener: fn => listeners.push(fn)},
          sendMessage: (_msg, cb) => { const r = {success: true}; cb?.(r); return Promise.resolve(r); }
        },
        tabs: {
          query: (_q, cb) => cb([{id: 1, url: 'https://fixture.test/', title: 'Overlay fallback'}]),
          sendMessage: (_id, _msg, cb) => cb({videoInfos: []})
        },
        windows: {getCurrent: async () => ({id: 1})}
      };
    });
    await overlayPage.goto('https://fixture.test/');
    await overlayPage.addScriptTag({url: 'https://fixture.test/src/pages/overlay-host.js'});
    const overlayResult = await overlayPage.evaluate(async () => {
      const token = 'reduced-transparency-token';
      await chrome.storage.session.set({['mediaflowOverlayGrant:' + token]: Date.now() + 10000});
      return await new Promise(resolve => overlayListeners[0]({type: 'mediaflow-overlay-toggle', token}, {id: 'fixture'}, resolve));
    });
    assert.equal(overlayResult.success, true, 'overlay opens cleanly under prefers-reduced-transparency: reduce');
    const hostStyles = await overlayPage.locator('[data-mediaflow-glass-panel]').evaluate(el => {
      const s = getComputedStyle(el);
      return {backdropFilter: s.backdropFilter, backgroundColor: s.backgroundColor, transitionDuration: s.transitionDuration};
    });
    assert.equal(hostStyles.backdropFilter, 'none', 'overlay host disables backdrop-filter under reduced transparency');
    assert.equal(hostStyles.backgroundColor, 'rgb(36, 36, 38)', 'overlay host uses opaque dark surface under reduced transparency');
    assert.equal(hostStyles.transitionDuration, '0s', 'overlay host disables transitions under reduced motion');

    assert.deepEqual(errors, [], 'no uncaught page errors');
    console.log('PASS: retrying countdown + timer cleanup, contextual error actions, icon aria-labels & :focus-visible rings, reduced-motion/transparency fallbacks (popup + overlay), and empty states.');
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => server.close());
