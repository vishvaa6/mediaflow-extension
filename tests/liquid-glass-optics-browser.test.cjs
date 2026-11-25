const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const runtime = process.env.CODEX_NODE_MODULES || 'C:/Users/vishv/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules';
const {chromium} = require(path.join(runtime, 'playwright'));
const {PNG} = require(path.join(runtime, 'pngjs'));
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

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true
  });

  const shotDir = process.env.OPTICS_SCREENSHOT_DIR || '';
  if (shotDir) fs.mkdirSync(shotDir, {recursive: true});

  try {
    // ---- 1. Extension Popup: Snell's Law maps, viscous spring droplet, scroll-edge, ambient stage & specular tracking ----
    const page = await browser.newPage({viewport: {width: 720, height: 600}});
    await page.emulateMedia({colorScheme: 'dark'});
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));

    await page.addInitScript(({origin}) => {
      const now = Date.now();
      const values = {
        downloadQueueState: {
          tasks: Array.from({length: 12}, (_, i) => ({
            id: 't-' + i,
            fileName: 'Sample Clip ' + i + '.mp4',
            status: i === 0 ? 'downloading' : 'queued',
            progress: i === 0 ? 42 : 0,
            format: 'mp4',
            thumbnail: origin + '/thumb.png'
          }))
        },
        m3u8DownloadHistory: {
          records: Array.from({length: 10}, (_, i) => ({
            id: 'hist-' + i,
            title: 'Saved Documentary Clip ' + (i + 1),
            fileName: 'Studio North/Saved Documentary Clip ' + (i + 1) + '.mp4',
            creator: 'Studio North',
            pageUrl: 'https://example.test/watch?v=hist-' + i,
            url: 'https://cdn.test/hist-' + i + '.mp4',
            quality: '1080',
            format: 'mp4',
            bytes: (24 + i * 5) * 1024 * 1024,
            completedAt: now - (i + 1) * 60000,
            downloadId: 600 + i,
            thumbnail: origin + '/thumb.png'
          }))
        },
        profileScanState: {
          status: 'complete',
          profileName: 'Studio North',
          profileUrl: 'https://example.test/model/studio-north/videos',
          pagesScanned: 2,
          videos: Array.from({length: 10}, (_, i) => ({
            id: 'vid-' + i,
            url: 'https://example.test/watch?v=vid-' + i,
            title: 'Library Clip ' + (i + 1),
            thumbnail: origin + '/thumb.png',
            duration: '2:1' + (i % 9)
          }))
        }
      };
      const local = {
        onChanged: {addListener() {}},
        async get(keys) {
          return Object.fromEntries(
            (Array.isArray(keys) ? keys : [keys])
              .map(k => [k, structuredClone(values[k])])
              .filter(([, v]) => v !== undefined)
          );
        },
        async set() {}
      };
      window.chrome = {
        i18n: {getMessage: () => ''},
        storage: {local, onChanged: {addListener() {}}},
        runtime: {
          id: 'optics-test',
          getURL: p => origin + '/' + p,
          getManifest: () => ({version: '1.3.0'}),
          onMessage: {addListener() {}},
          sendMessage(_msg, cb) {
            const res = {success: true};
            cb?.(res);
            return Promise.resolve(res);
          }
        },
        tabs: {
          query: (_q, cb) => cb([{id: 1, url: 'https://example.test/watch', title: 'Optics Fixture'}]),
          sendMessage: (_id, _msg, cb) => cb({videoInfos: []})
        },
        windows: {getCurrent: async () => ({id: 1})}
      };
    }, {origin});

    await page.goto(origin + '/src/pages/popup/index.html?surface=popup');
    await page.waitForSelector('.popup-tabs-bar[data-liquid-ready]');

    // Verify Snell's Law SVG filters + populated PNG displacement maps (Backdrop Root compliant: no nested droplet filters)
    const opticsState = await page.evaluate(async () => {
      const {createLiquidGlassDisplacementMap} = await import('/assets/js/liquid-optics.js');
      const mapUrl = createLiquidGlassDisplacementMap({width: 120, height: 40, radius: 20, bevel: 14, ior: 1.5});
      const svg = document.querySelector('svg[data-mediaflow-glass-defs="workspace"]');
      const navMap = svg?.querySelector('#mf-nav-bar-lens feImage[data-role="map"]')?.getAttribute('href') || '';
      const switcherMap = svg?.querySelector('#mf-switcher-lens feImage[data-role="map"]')?.getAttribute('href') || '';
      const hasLegacyNavDropletFilter = Boolean(svg?.querySelector('#mf-nav-droplet-lens'));
      const hasLegacySwitcherDropletFilter = Boolean(svg?.querySelector('#mf-switcher-droplet-lens'));
      const navLens = document.querySelector('.popup-tabs-bar .liquid-nav-lens');
      const switcherLens = document.querySelector('.download-switcher .liquid-switcher-lens');
      const navBackdrop = getComputedStyle(document.querySelector('.popup-tabs-bar')).backdropFilter;
      const navLensBackdrop = navLens ? getComputedStyle(navLens).backdropFilter : '';
      const switcherLensBackdrop = switcherLens ? getComputedStyle(switcherLens).backdropFilter : '';
      const ambientOrbs = document.querySelectorAll('.liquid-ambient-stage .liquid-ambient-orb').length;
      return {
        mapUrlPrefix: mapUrl.slice(0, 22),
        navMapLoaded: navMap.startsWith('data:image/png;base64,'),
        switcherMapLoaded: switcherMap.startsWith('data:image/png;base64,'),
        hasLegacyNavDropletFilter,
        hasLegacySwitcherDropletFilter,
        hasSwitcherLens: Boolean(switcherLens),
        navBackdrop,
        navLensBackdrop,
        switcherLensBackdrop,
        ambientOrbs
      };
    });
    assert.equal(opticsState.mapUrlPrefix, 'data:image/png;base64,', 'Snell displacement map encodes PNG data URL');
    assert.equal(opticsState.navMapLoaded, true, 'nav bar SVG filter receives Snell displacement map');
    assert.equal(opticsState.switcherMapLoaded, true, 'switcher SVG filter receives Snell displacement map');
    assert.equal(opticsState.hasLegacyNavDropletFilter, false, 'nested #mf-nav-droplet-lens filter is removed for Backdrop Root compliance');
    assert.equal(opticsState.hasLegacySwitcherDropletFilter, false, 'nested #mf-switcher-droplet-lens filter is removed for Backdrop Root compliance');
    assert.equal(opticsState.hasSwitcherLens, true, 'download-switcher mounts a gel droplet lens');
    assert.match(opticsState.navBackdrop, /url\("#mf-nav-bar-lens"\)/, 'nav bar applies SVG refraction backdrop-filter');
    assert.equal(opticsState.navLensBackdrop, 'none', 'inner nav droplet avoids nested backdrop-filter');
    assert.equal(opticsState.switcherLensBackdrop, 'none', 'inner switcher droplet avoids nested backdrop-filter');
    assert.equal(opticsState.ambientOrbs, 3, 'ambient background light-spill stage renders 3 fluid orbs');

    // Verify interior plateau has zero displacement (128, 128) while bezel has non-zero Snell displacement
    const mapBytes = await page.evaluate(async () => {
      const {createLiquidGlassDisplacementMap} = await import('/assets/js/liquid-optics.js');
      const url = createLiquidGlassDisplacementMap({width: 120, height: 48, radius: 24, bevel: 14, ior: 1.5});
      return url.replace(/^data:image\/png;base64,/, '');
    });
    const mapPng = PNG.sync.read(Buffer.from(mapBytes, 'base64'));
    const mapPx = (x, y) => {
      const i = (mapPng.width * y + x) * 4;
      return [mapPng.data[i], mapPng.data[i + 1]];
    };
    const centerRG = mapPx(60, 24);
    const bezelLeftRG = mapPx(4, 24);
    const bezelTopRG = mapPx(60, 4);
    assert.deepEqual(centerRG, [128, 128], `interior plateau must be neutral (128,128), got ${centerRG}`);
    assert.ok(Math.abs(bezelLeftRG[0] - 128) > 20, `left bezel must refract X strongly, got ${bezelLeftRG}`);
    assert.ok(Math.abs(bezelTopRG[1] - 128) > 20, `top bezel must refract Y strongly, got ${bezelTopRG}`);

    // Verify pointer hover does not trigger moving specular shimmer (--light-x / --specular-angle stay unset)
    const navBox = await page.locator('.popup-tabs-bar').boundingBox();
    await page.mouse.move(navBox.x + navBox.width * 0.78, navBox.y + navBox.height * 0.45);
    await page.waitForTimeout(80);
    const specular = await page.locator('.popup-tabs-bar').evaluate(el => ({
      lightX: el.style.getPropertyValue('--light-x'),
      angle: el.style.getPropertyValue('--specular-angle')
    }));
    assert.equal(specular.lightX, '', `hover must not set --light-x (got ${specular.lightX})`);
    assert.equal(specular.angle, '', `hover must not set --specular-angle (got ${specular.angle})`);

    // Click History tab -> triggers energized tap glow + viscous spring transit
    await page.locator('#tab-history').click();
    await page.waitForTimeout(45);
    const midFlight = await page.locator('.liquid-nav-lens').evaluate(el => ({
      transform: el.style.transform
    }));
    assert.match(midFlight.transform, /translate3d\(/, 'spring droplet animates with GPU translate3d + scale');

    // Switch to Queue view and verify scroll-edge physics when scrolling under floating nav
    await page.locator('#tab-video').click();
    await page.locator('[data-download-view="queue"]').click();
    await page.waitForSelector('[data-task-id="t-0"]');
    const beforeScroll = await page.locator('.App').evaluate(el => Number(el.style.getPropertyValue('--scroll-edge') || 0));
    assert.equal(beforeScroll, 0, 'scroll-edge starts at 0 at top');
    await page.locator('.popup-scroll').evaluate(el => { el.scrollTop = 120; el.dispatchEvent(new Event('scroll')); });
    const afterScroll = await page.locator('.App').evaluate(el => ({
      edge: Number(el.style.getPropertyValue('--scroll-edge') || 0),
      attr: el.hasAttribute('data-scroll-under-nav'),
      scrollMask: getComputedStyle(document.querySelector('.App[data-scroll-under-nav] .popup-scroll')).maskImage ||
        getComputedStyle(document.querySelector('.App[data-scroll-under-nav] .popup-scroll')).webkitMaskImage || ''
    }));
    assert.ok(afterScroll.edge >= 0.99 && afterScroll.attr, `scrolling under nav sets --scroll-edge=1 (got ${JSON.stringify(afterScroll)})`);
    assert.match(afterScroll.scrollMask, /linear-gradient/, `scrolled .popup-scroll activates progressive mask-image (got ${afterScroll.scrollMask})`);

    if (shotDir) {
      await page.waitForTimeout(120);
      await page.screenshot({path: path.join(shotDir, '1-queue-scrolled-dark-720x600.png')});
    }

    // ---- Regression 1 & 2: Strong diffusion over scrolled checkerboard (< 20 contrast) & zero brown R-B fringe (|R - B| <= 8) ----
    await page.evaluate(() => {
      const style = document.createElement('style');
      style.id = 'mf-optics-audit-probe';
      style.textContent = `
        .liquid-ambient-stage { display: none !important; }
        .popup-tabs-bar .liquid-nav-lens, .download-switcher .liquid-switcher-lens { opacity: 0 !important; }
        .popup-tabs-bar::after, .download-switcher::after { opacity: 0 !important; }
        .popup-tabs-bar button, .download-switcher button { opacity: 0 !important; }
        .popup-scroll {
          background-color: #000 !important;
          background-image:
            linear-gradient(45deg, #fff 25%, transparent 25%, transparent 75%, #fff 75%, #fff),
            linear-gradient(45deg, #fff 25%, transparent 25%, transparent 75%, #fff 75%, #fff) !important;
          background-size: 16px 16px !important;
          background-position: 0 0, 8px 8px !important;
        }
        .popup-scroll > * { opacity: 0 !important; }
      `;
      document.head.appendChild(style);
    });
    await page.waitForTimeout(80);

    const tabsBox = await page.locator('.popup-tabs-bar').boundingBox();
    const switcherBox = await page.locator('.download-switcher').boundingBox();
    const checkerBuf = await page.screenshot();
    const checkerPng = PNG.sync.read(checkerBuf);
    const sampleRect = (png, box, insetX = 16, insetY = 6) => {
      const x0 = Math.max(0, Math.round(box.x + insetX));
      const x1 = Math.min(png.width - 1, Math.round(box.x + box.width - insetX));
      const y0 = Math.max(0, Math.round(box.y + insetY));
      const y1 = Math.min(png.height - 1, Math.round(box.y + box.height - insetY));
      let minLuma = 255;
      let maxLuma = 0;
      let maxRB = 0;
      const midY = Math.round((y0 + y1) / 2);
      for (let x = x0; x <= x1; x++) {
        const i = (png.width * midY + x) * 4;
        const luma = 0.2126 * png.data[i] + 0.7152 * png.data[i + 1] + 0.0722 * png.data[i + 2];
        if (luma < minLuma) minLuma = luma;
        if (luma > maxLuma) maxLuma = luma;
      }
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const i = (png.width * y + x) * 4;
          const rb = Math.abs(png.data[i] - png.data[i + 2]);
          if (rb > maxRB) maxRB = rb;
        }
      }
      return {contrast: maxLuma - minLuma, maxRB};
    };

    const tabsProbe = sampleRect(checkerPng, tabsBox, 18, 6);
    assert.ok(tabsProbe.contrast < 20, `scrolled black/white checkerboard behind .popup-tabs-bar must diffuse strongly (contrast < 20, got ${tabsProbe.contrast.toFixed(1)})`);

    // Neutral grayscale backdrop behind .popup-tabs-bar and .download-switcher -> zero brown R-B fringe (|R - B| <= 8)
    await page.evaluate(() => {
      const scrollEl = document.querySelector('.popup-scroll');
      if (scrollEl) {
        scrollEl.scrollTop = 0;
        scrollEl.dispatchEvent(new Event('scroll'));
      }
      const style = document.getElementById('mf-optics-audit-probe');
      style.textContent = `
        .liquid-ambient-stage { display: none !important; }
        html, body, .App, .popup-scroll { background: #808080 !important; background-image: none !important; }
        .popup-scroll > *:not(.download-switcher) { opacity: 0 !important; }
        .popup-tabs-bar button, .download-switcher button { opacity: 0 !important; }
      `;
    });
    await page.waitForTimeout(80);
    const neutralTabsBox = await page.locator('.popup-tabs-bar').boundingBox();
    const neutralSwitcherBox = await page.locator('.download-switcher').boundingBox();
    const neutralPng = PNG.sync.read(await page.screenshot());
    const navNeutral = sampleRect(neutralPng, neutralTabsBox, 12, 3);
    const switcherNeutral = sampleRect(neutralPng, neutralSwitcherBox, 12, 3);
    assert.ok(navNeutral.maxRB <= 8, `.popup-tabs-bar must have zero brown R-B fringe on neutral backdrop (max |R-B| <= 8, got ${navNeutral.maxRB})`);
    assert.ok(switcherNeutral.maxRB <= 8, `.download-switcher must have zero brown R-B fringe on neutral backdrop (max |R-B| <= 8, got ${switcherNeutral.maxRB})`);
    await page.evaluate(() => document.getElementById('mf-optics-audit-probe')?.remove());

    // ---- Regression 3: Creator Library .profile-video-grid extends underneath floating .profile-download-bar ----
    await page.locator('#tab-profile').click();
    await page.waitForSelector('.profile-video-grid .profile-video-card');
    await page.waitForSelector('.profile-download-bar');
    const libraryLayout = await page.evaluate(() => {
      const gridEl = document.querySelector('.profile-video-grid');
      const footerEl = document.querySelector('.profile-download-bar');
      const grid = gridEl.getBoundingClientRect();
      const footer = footerEl.getBoundingClientRect();
      const paddingBottom = parseFloat(getComputedStyle(gridEl).paddingBottom || '0');
      return {gridBottom: grid.bottom, footerTop: footer.top, paddingBottom};
    });
    assert.ok(
      libraryLayout.gridBottom > libraryLayout.footerTop,
      `.profile-video-grid must extend underneath .profile-download-bar (grid.bottom=${libraryLayout.gridBottom} > footer.top=${libraryLayout.footerTop})`
    );
    assert.ok(
      libraryLayout.paddingBottom >= 50,
      `.profile-video-grid must reserve paddingBottom >= 50px for floating footer (got ${libraryLayout.paddingBottom})`
    );
    if (shotDir) {
      await page.waitForTimeout(120);
      await page.screenshot({path: path.join(shotDir, '2-library-floating-footer-dark-720x600.png')});
    }

    // ---- Regression 4 & 5: Light-mode Settings neutral luminance + distinct Lucide `image` SVG icon ----
    await page.emulateMedia({colorScheme: 'light'});
    await page.locator('#tab-settings').click();
    await page.waitForSelector('#settings-display-title');
    await page.waitForTimeout(120);

    const displayIcon = await page.evaluate(() => {
      const heading = document.querySelector('#settings-display-title')?.closest('.settings-section-heading');
      const svg = heading?.querySelector('svg');
      return {
        hasSvg: Boolean(svg),
        hasRect: Boolean(svg?.querySelector('rect')),
        hasCircle: Boolean(svg?.querySelector('circle')),
        hasPath: Boolean(svg?.querySelector('path'))
      };
    });
    assert.deepEqual(
      displayIcon,
      {hasSvg: true, hasRect: true, hasCircle: true, hasPath: true},
      `Settings -> Display heading must render the distinct Lucide image SVG icon (rect + circle + path), got ${JSON.stringify(displayIcon)}`
    );

    const lightSettingsPng = PNG.sync.read(await page.screenshot());
    const rs = [];
    const gs = [];
    const bs = [];
    for (let y = Math.floor(lightSettingsPng.height * 0.55); y < lightSettingsPng.height - 8; y += 2) {
      for (let x = 8; x < lightSettingsPng.width - 8; x += 4) {
        const i = (lightSettingsPng.width * y + x) * 4;
        rs.push(lightSettingsPng.data[i]);
        gs.push(lightSettingsPng.data[i + 1]);
        bs.push(lightSettingsPng.data[i + 2]);
      }
    }
    const median = arr => {
      arr.sort((a, b) => a - b);
      return arr[Math.floor(arr.length / 2)];
    };
    const medR = median(rs);
    const medG = median(gs);
    const medB = median(bs);
    assert.ok(
      medR > 220 && medG > 220 && medB > 220 && Math.abs(medR - medG) < 20,
      `Light-mode Settings lower half must keep neutral luminance (R,G,B > 220 & |R-G| < 20), got RGB(${medR},${medG},${medB})`
    );

    if (shotDir) {
      await page.locator('#tab-history').click();
      await page.waitForSelector('.history-item, .download-item, .popup-scroll');
      await page.locator('.popup-scroll').evaluate(el => { el.scrollTop = 120; el.dispatchEvent(new Event('scroll')); });
      await page.waitForTimeout(150);
      await page.screenshot({path: path.join(shotDir, '3-history-scrolled-light-720x600.png')});
    }

    // ---- 2. Strict CSP (`default-src 'none'`) Host-Page Optics Verification ----
    const cspPage = await browser.newPage({viewport: {width: 1000, height: 800}});
    await cspPage.emulateMedia({colorScheme: 'dark'});
    const cspConsoleErrors = [];
    cspPage.on('console', msg => { if (msg.type() === 'error') cspConsoleErrors.push(msg.text()); });
    cspPage.on('pageerror', err => errors.push(err.message));

    await cspPage.route('https://strict-csp.test/**', route => {
      const name = new URL(route.request().url()).pathname;
      if (name === '/') {
        return route.fulfill({
          contentType: 'text/html',
          headers: {'Content-Security-Policy': "default-src 'none'; img-src 'none'; script-src 'self'; frame-src https://strict-csp.test; style-src 'self'"},
          body: '<!doctype html><title>Strict CSP</title><body>Strict CSP Host</body>'
        });
      }
      const file = path.resolve(root, '.' + name);
      if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) return route.abort();
      const ext = path.extname(file);
      const type = ext === '.js' ? 'text/javascript' : ext === '.css' ? 'text/css' : ext === '.html' ? 'text/html' : 'application/octet-stream';
      return route.fulfill({contentType: type, body: fs.readFileSync(file)});
    });

    await cspPage.addInitScript(() => {
      const listeners = [];
      window.overlayListeners = listeners;
      const session = {
        set: async values => Object.entries(values).forEach(([k, v]) => localStorage.setItem(k, JSON.stringify(v))),
        get: async key => ({[key]: JSON.parse(localStorage.getItem(key) || 'null')}),
        remove: async key => localStorage.removeItem(key)
      };
      const local = {get: async () => ({}), set: async () => {}, onChanged: {addListener() {}}};
      window.chrome = {
        i18n: {getMessage: () => ''},
        storage: {session, local, onChanged: {addListener() {}}},
        runtime: {
          id: 'csp-fixture',
          getURL: v => 'https://strict-csp.test/' + v,
          onMessage: {addListener: fn => listeners.push(fn)},
          sendMessage: (_m, cb) => { const r = {success: true}; cb?.(r); return Promise.resolve(r); }
        },
        tabs: {
          query: (_q, cb) => cb([{id: 1, url: 'https://strict-csp.test/', title: 'Strict CSP'}]),
          sendMessage: (_id, _m, cb) => cb({videoInfos: []})
        },
        windows: {getCurrent: async () => ({id: 1})}
      };
    });

    await cspPage.goto('https://strict-csp.test/');
    await cspPage.addScriptTag({url: 'https://strict-csp.test/src/pages/overlay-host.js'});
    const opened = await cspPage.evaluate(async () => {
      const token = 'csp-optics-grant';
      await chrome.storage.session.set({['mediaflowOverlayGrant:' + token]: Date.now() + 10000});
      return await new Promise(resolve => overlayListeners[0]({type: 'mediaflow-overlay-toggle', token}, {id: 'csp-fixture'}, resolve));
    });
    assert.equal(opened.success, true, 'overlay opens cleanly under strict CSP');
    const hostFilter = await cspPage.locator('html > div').evaluate(el => getComputedStyle(el).backdropFilter);
    assert.match(hostFilter, /url\("#mf-overlay-bezel-lens"\)/, 'overlay host applies CSP-safe bezel SVG filter');
    assert.match(hostFilter, /blur\(28px\)/, 'overlay host preserves blur(28px) contract');
    assert.equal(await cspPage.locator('svg[data-mediaflow-glass-defs="overlay"]').count(), 1, 'overlay SVG defs mounted on documentElement');
    await cspPage.keyboard.press('Escape');
    await cspPage.waitForFunction(() => !document.querySelector('[data-mediaflow-glass-panel]'));
    assert.equal(await cspPage.locator('svg[data-mediaflow-glass-defs="overlay"]').count(), 0, 'overlay SVG defs cleaned up on close');

    assert.deepEqual(cspConsoleErrors, [], `strict CSP page must log zero CSP console errors, got: ${cspConsoleErrors}`);
    assert.deepEqual(errors, [], 'no uncaught page errors');
    console.log('PASS: Liquid Glass Snell refraction maps, viscous spring droplets, scroll-edge physics, ambient light stage, and strict-CSP bezel optics verified.');
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => server.close());
