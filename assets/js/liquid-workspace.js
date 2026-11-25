// Navigation, segmented-switcher, scroll-edge, and ambient background optics.
// Download, selection, and focus behavior stay in the workspace.
import {
  ensureWorkspaceGlassFilters,
  createSpring,
  attachInteractiveGlassLight
} from './liquid-optics.js';

function createDropletController({
  filterId,
  baseScale,
  baseDispersion = 0.08,
  getFilters,
  reducedMotion,
  reducedTransparency
}) {
  const xSpring = createSpring({stiffness: 340, damping: 25, mass: 1, precision: 0.2});
  const wSpring = createSpring({stiffness: 340, damping: 25, mass: 1, precision: 0.2});
  let rafId = 0;
  let lastTime = 0;
  let lastKey = '';
  let initialized = false;
  let currentLens = null;

  const stop = () => {
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
    if (currentLens) {
      currentLens.style.removeProperty('--droplet-sx');
      currentLens.style.removeProperty('--droplet-sy');
      currentLens.classList.remove('is-in-flight');
    }
    if (!reducedTransparency.matches) {
      getFilters()?.setScale(filterId, baseScale, baseDispersion);
    }
  };

  const applyFrame = (x, width, velocity, inFlight) => {
    if (!currentLens) return;
    const speed = Math.min(1, Math.abs(velocity) / 950);
    const sx = inFlight ? 1 + speed * 0.14 : 1;
    const sy = inFlight ? 1 / (1 + speed * 0.08) : 1;
    currentLens.style.width = `${width.toFixed(2)}px`;
    currentLens.style.transform = `translate3d(${x.toFixed(2)}px, 0, 0) scale(${sx.toFixed(3)}, ${sy.toFixed(3)})`;
    currentLens.classList.toggle('is-in-flight', inFlight && speed > 0.04);
    if (!reducedTransparency.matches) {
      const dynamicScale = baseScale * (1 + speed * 0.25);
      getFilters()?.setScale(filterId, dynamicScale, baseDispersion + speed * 0.02);
    }
  };

  const tick = now => {
    rafId = 0;
    if (!currentLens?.isConnected || reducedMotion.matches) {
      stop();
      return;
    }
    const dt = lastTime ? (now - lastTime) / 1000 : 1 / 60;
    lastTime = now;
    const sx = xSpring.step(dt);
    const sw = wSpring.step(dt);
    const settled = sx.settled && sw.settled;
    applyFrame(sx.value, Math.max(12, sw.value), sx.velocity, !settled);
    if (!settled) {
      rafId = requestAnimationFrame(tick);
    } else {
      lastTime = 0;
      if (!reducedTransparency.matches) {
        getFilters()?.setScale(filterId, baseScale, baseDispersion);
      }
    }
  };

  return {
    stop,
    sync(lens, activeButton, key, allowAnimate = true) {
      currentLens = lens;
      if (!lens || !activeButton) return;
      const targetLeft = activeButton.offsetLeft;
      const targetWidth = activeButton.offsetWidth;

      const keyChanged = initialized && lastKey !== key;
      lastKey = key;

      if (!initialized || !allowAnimate || !keyChanged || reducedMotion.matches) {
        stop();
        xSpring.snap(targetLeft);
        wSpring.snap(targetWidth);
        initialized = true;
        applyFrame(targetLeft, targetWidth, 0, false);
        return;
      }

      xSpring.setTarget(targetLeft);
      wSpring.setTarget(targetWidth);
      if (!rafId) {
        lastTime = performance.now();
        rafId = requestAnimationFrame(tick);
      }
    }
  };
}

export function createLiquidWorkspace() {
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const reducedTransparency = matchMedia('(prefers-reduced-transparency: reduce)');
  let filters = null;
  let resizeObserver = null;
  let cleanups = [];
  let activeApp = null;
  let activeNav = null;
  let ambientFrame = 0;

  const getFilters = () => {
    if (reducedTransparency.matches) return null;
    if (!filters || !filters.svg?.isConnected) {
      filters = ensureWorkspaceGlassFilters(document);
    }
    return filters;
  };

  const navDroplet = createDropletController({
    filterId: 'mf-nav-bar-lens',
    baseScale: 14,
    baseDispersion: 0.08,
    getFilters,
    reducedMotion,
    reducedTransparency
  });

  const switcherDroplet = createDropletController({
    filterId: 'mf-switcher-lens',
    baseScale: 12,
    baseDispersion: 0.08,
    getFilters,
    reducedMotion,
    reducedTransparency
  });

  const clearOptics = () => {
    if (reducedMotion.matches) {
      navDroplet.stop();
      switcherDroplet.stop();
    }
    if (reducedMotion.matches || reducedTransparency.matches) {
      if (ambientFrame) {
        cancelAnimationFrame(ambientFrame);
        ambientFrame = 0;
      }
      if (activeNav) {
        activeNav.style.removeProperty('--light-x');
        activeNav.style.removeProperty('--light-y');
        activeNav.style.removeProperty('--specular-angle');
      }
      if (activeApp) {
        activeApp.style.removeProperty('--ambient-px');
        activeApp.style.removeProperty('--ambient-py');
      }
    }
  };

  reducedMotion.addEventListener?.('change', clearOptics);
  reducedTransparency.addEventListener?.('change', clearOptics);

  function updateElementMap(el, filterId, {radius, bevel, ior = 1.5} = {}) {
    if (!el || reducedTransparency.matches) return;
    const rect = el.getBoundingClientRect();
    if (rect.width < 12 || rect.height < 12) return;
    const r = radius ?? Math.min(rect.height / 2, 24);
    const bw = bevel ?? Math.min(18, rect.height * 0.42);
    getFilters()?.updateMap(filterId, {
      width: rect.width,
      height: rect.height,
      radius: r,
      bevel: bw,
      ior
    });
  }

  function bindScrollEdge(app, scroller, targetAttr) {
    if (!scroller || !app) return () => {};
    const isProfileGrid = scroller.classList.contains('profile-video-grid');
    const update = () => {
      const topProgress = Math.max(0, Math.min(1, scroller.scrollTop / 24));
      app.style.setProperty('--scroll-edge', topProgress.toFixed(3));
      app.toggleAttribute(targetAttr, topProgress > 0.05);

      if (isProfileGrid) {
        const remaining = scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop;
        app.toggleAttribute('data-scroll-under-footer', remaining > 4);
        const footer = app.querySelector('.profile-download-bar');
        if (footer) {
          const bottomProgress = Math.max(0, Math.min(1, remaining / 24));
          footer.style.setProperty('--scroll-edge-bottom', bottomProgress.toFixed(3));
        }
      }
    };
    update();
    scroller.addEventListener('scroll', update, {passive: true});
    return () => {
      scroller.removeEventListener('scroll', update);
      if (isProfileGrid) app.removeAttribute('data-scroll-under-footer');
    };
  }

  function bindAmbientStage(app, {surface, thumbnail} = {}) {
    const stage = app?.querySelector('.liquid-ambient-stage');
    if (!stage || surface === 'overlay') return () => {};

    const artLayer = stage.querySelector('.liquid-ambient-art');
    if (artLayer) {
      if (thumbnail && /^https?:|^data:image\//i.test(thumbnail)) {
        artLayer.style.backgroundImage = `url("${thumbnail.replace(/"/g, '%22')}")`;
        artLayer.classList.add('has-art');
      } else {
        artLayer.style.removeProperty('background-image');
        artLayer.classList.remove('has-art');
      }
    }

    return () => {};
  }

  return {
    bind(options = {}) {
      resizeObserver?.disconnect();
      for (const cleanup of cleanups) cleanup();
      cleanups = [];

      const app = document.querySelector('.App');
      const nav = document.querySelector('.popup-tabs-bar');
      activeApp = app;
      activeNav = nav;
      if (!nav) return;

      if (!reducedTransparency.matches) getFilters();

      // 1. Primary navigation capsule + viscous spring droplet lens
      const lens = document.createElement('span');
      lens.className = 'liquid-nav-lens';
      lens.setAttribute('aria-hidden', 'true');
      nav.prepend(lens);
      nav.dataset.liquidReady = '';

      const positionNav = (animate = false) => {
        const active = nav.querySelector('.popup-tab-btn.active');
        if (!active) return;
        navDroplet.sync(lens, active, active.dataset.tab || '', animate);
        updateElementMap(nav, 'mf-nav-bar-lens', {radius: 20, bevel: 16, ior: 1.5});
      };

      // 2. Downloads / Queue segmented switcher + viscous spring droplet lens
      const switcher = document.querySelector('.download-switcher');
      let switcherLens = null;
      const positionSwitcher = (animate = false) => {
        if (!switcher || !switcherLens) return;
        const active = switcher.querySelector('button[aria-pressed="true"]');
        if (!active) return;
        switcherDroplet.sync(switcherLens, active, active.dataset.downloadView || '', animate);
        updateElementMap(switcher, 'mf-switcher-lens', {radius: 16, bevel: 14, ior: 1.5});
      };

      if (switcher) {
        switcherLens = document.createElement('span');
        switcherLens.className = 'liquid-switcher-lens';
        switcherLens.setAttribute('aria-hidden', 'true');
        switcher.prepend(switcherLens);
        switcher.dataset.liquidReady = '';
        cleanups.push(attachInteractiveGlassLight(switcher, {reducedMotion, reducedTransparency}));
      }

      // 3. Floating footer batch bar & toasts
      const footerBar = document.querySelector('.profile-download-bar');
      if (footerBar) {
        cleanups.push(attachInteractiveGlassLight(footerBar, {reducedMotion, reducedTransparency}));
      }
      const firstToast = document.querySelector('.toast-item-modern');

      const syncAllOptics = (animate = false) => {
        positionNav(animate);
        positionSwitcher(animate);
        if (footerBar) updateElementMap(footerBar, 'mf-footer-bar-lens', {radius: 21, bevel: 16, ior: 1.5});
        if (firstToast) updateElementMap(firstToast, 'mf-toast-lens', {radius: 20, bevel: 14, ior: 1.5});
      };

      syncAllOptics(true);

      resizeObserver = new ResizeObserver(() => syncAllOptics(false));
      resizeObserver.observe(nav);
      if (switcher) resizeObserver.observe(switcher);
      if (footerBar) resizeObserver.observe(footerBar);

      cleanups.push(attachInteractiveGlassLight(nav, {reducedMotion, reducedTransparency}));
      cleanups.push(bindScrollEdge(app, document.querySelector('.popup-scroll'), 'data-scroll-under-nav'));
      const profileGrid = document.querySelector('.profile-video-grid');
      if (profileGrid) {
        cleanups.push(bindScrollEdge(app, profileGrid, 'data-scroll-under-grid'));
      }
      cleanups.push(bindAmbientStage(app, options));

      clearOptics();
    }
  };
}
