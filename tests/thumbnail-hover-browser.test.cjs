const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const runtime = process.env.CODEX_NODE_MODULES || 'C:/Users/vishv/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const {chromium} = require(path.join(runtime, 'playwright'));
const root = path.resolve(__dirname, '..');

(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true
  });
  try {
    const page = await browser.newPage({viewport: {width: 800, height: 600}});
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));

    const loader = '<link rel="stylesheet" href="/assets/css/player-download.css"><script type="module">import {installMediaDetection} from "/assets/js/media-detection.js";installMediaDetection();</script>';
    await page.route('**/*', async route => {
      const url = new URL(route.request().url());
      if (url.href === 'https://xhamster.com/categories/featured') {
        return route.fulfill({
          contentType: 'text/html',
          body: `<!doctype html><title>Browse</title>${loader}
            <style>
              body{margin:24px;background:#111;color:#fff}
              .thumb-list__item{position:relative;width:360px;height:210px;background:#222;overflow:hidden}
              .thumb-list__item a{display:block;width:100%;height:100%;position:relative}
              .thumb-list__item video{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}
            </style>
            <div class="thumb-list__item" id="hover-card">
              <a id="thumb-link" href="/videos/sample-12345">
                <div style="width:100%;height:100%;background:#333">Thumbnail</div>
              </a>
            </div>
            <script>
              window.__previewMounts = 0;
              window.__previewUnmounts = 0;
              const link = document.getElementById('thumb-link');
              link.addEventListener('mouseenter', () => {
                if (link.querySelector('video')) return;
                const v = document.createElement('video');
                v.className = 'thumb-image-container__video';
                v.muted = true; v.loop = true; v.src = 'https://cdn.test/previews/sample.mp4';
                link.append(v);
                window.__previewMounts++;
              });
              link.addEventListener('mouseleave', () => {
                const v = link.querySelector('video');
                if (v) { v.remove(); window.__previewUnmounts++; }
              });
            </script>`
        });
      }
      if (url.href === 'https://fixture.test/player-hover') {
        return route.fulfill({
          contentType: 'text/html',
          body: `<!doctype html><title>Stable Player</title>${loader}
            <style>
              body{margin:24px;background:#111;color:#fff}
              .player-wrap{position:relative;width:420px;height:240px;background:#222}
              .player-wrap:hover video{transform:scale(1.02)}
              video{display:block;width:420px;height:240px;transition:transform .12s ease}
            </style>
            <div class="player-wrap" id="wrap">
              <video id="real-video" width="420" height="240" preload="none" controls src="https://cdn.test/full-720p.mp4"></video>
            </div>`
        });
      }
      if (!/^\/assets\/(?:js|css)\/[\w.-]+\.(?:js|css)$/.test(url.pathname)) {
        return route.fulfill({status: 404, body: ''});
      }
      const file = path.join(root, url.pathname);
      try {
        return await route.fulfill({contentType: file.endsWith('.css') ? 'text/css' : 'text/javascript', body: fs.readFileSync(file)});
      } catch {
        return route.fulfill({status: 404, body: ''});
      }
    });

    await page.addInitScript(() => {
      window.chrome = {
        storage: {local: {get: async () => ({})}, onChanged: {addListener() {}}},
        runtime: {id: 'hover-test', onMessage: {addListener() {}}, sendMessage: async () => ({success: true})}
      };
    });

    // 1. Listing thumbnail hover-preview must NOT attach a flickering download pill
    await page.goto('https://xhamster.com/categories/featured');
    const cardBox = await page.locator('#hover-card').boundingBox();
    await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + cardBox.height / 2);
    await page.waitForSelector('#thumb-link video');
    // Move directly over the top-right corner where the pill used to spawn & flicker
    await page.mouse.move(cardBox.x + cardBox.width - 24, cardBox.y + 24);
    await page.waitForTimeout(450);
    const hoverStats = await page.evaluate(() => ({
      pills: document.querySelectorAll('.mediaflow-download-pill').length,
      mounts: window.__previewMounts,
      unmounts: window.__previewUnmounts
    }));
    assert.equal(hoverStats.pills, 0, 'hover-preview thumbnail clips must not spawn a download pill');
    assert.equal(hoverStats.mounts, 1, 'thumbnail preview must mount once without hover-teardown loops');
    assert.equal(hoverStats.unmounts, 0, 'thumbnail preview must stay mounted while pointer stays inside thumbnail');

    // 2. Real player pill: smooth monotonic hover expansion, no position jitter, and transient blip grace lock
    await page.goto('https://fixture.test/player-hover');
    const pill = page.locator('.mediaflow-download-pill');
    await pill.waitFor();

    await page.evaluate(() => {
      window.__pillRemovals = 0;
      window.__originalPill = document.querySelector('.mediaflow-download-pill');
      new MutationObserver(records => {
        for (const record of records) {
          for (const node of record.removedNodes) {
            if (node.classList?.contains('mediaflow-download-pill')) window.__pillRemovals++;
          }
        }
      }).observe(document.body, {subtree: true, childList: true});
    });

    const beforeHover = await pill.boundingBox();
    // Hover over the download icon button inside the pill
    await page.mouse.move(beforeHover.x + beforeHover.width / 2, beforeHover.y + beforeHover.height / 2);

    // Sample width across the expansion animation to verify monotonic growth with no overshoot bounce
    const widths = [];
    for (let i = 0; i < 14; i++) {
      await page.waitForTimeout(30);
      widths.push(await pill.evaluate(el => el.getBoundingClientRect().width));
    }
    const maxWidth = Math.max(...widths);
    const finalWidth = widths[widths.length - 1];
    assert.ok(finalWidth >= 145, `pill should expand on hover (got ${finalWidth})`);
    assert.ok(maxWidth <= 149, `width expansion must not overshoot past 148px (max=${maxWidth})`);
    assert.ok(widths.slice(-4).every(w => w >= 145), `expanded width must stay steady (tail=${widths.slice(-4)})`);

    // Momentary 100ms visibility blip on <video> while user hovers pill must NOT remove or recreate pill
    await page.evaluate(() => {
      document.getElementById('real-video').style.display = 'none';
    });
    await page.waitForTimeout(100);
    assert.equal(await page.evaluate(() => window.__pillRemovals), 0, 'hovered pill must survive transient visibility blips');
    assert.equal(await page.evaluate(() => document.querySelector('.mediaflow-download-pill') === window.__originalPill), true);

    // Restore video -> pill remains same DOM node
    await page.evaluate(() => {
      document.getElementById('real-video').style.display = 'block';
    });
    await page.waitForTimeout(100);
    assert.equal(await page.evaluate(() => window.__pillRemovals), 0);

    // Permanently hide video while hovered -> stays alive until pointer leaves, then cleans up cleanly
    await page.evaluate(() => {
      document.getElementById('real-video').style.display = 'none';
    });
    await page.waitForTimeout(320);
    assert.equal(await pill.count(), 1, 'pill stays alive while actively hovered');
    await page.mouse.move(4, 4);
    await page.waitForFunction(() => document.querySelectorAll('.mediaflow-download-pill').length === 0, null, {timeout: 2000});

    assert.deepEqual(errors, [], 'no uncaught page errors');
    console.log('PASS: thumbnail hover-preview exclusion, monotonic hover expansion, and transient hover-lock stability.');
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
