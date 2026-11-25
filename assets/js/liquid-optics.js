// Physically-based Apple Liquid Glass optical refraction, chromatic dispersion,
// CSP-safe bezel SVG filter generation, and 2nd-order viscous spring physics.

const SVG_NS = 'http://www.w3.org/2000/svg';
const DISPLACEMENT_CACHE_LIMIT = 24;
const displacementCache = new Map();

function quantize(value, step = 2) {
  return Math.max(step, Math.round(value / step) * step);
}

// Convex degree-4 squircle bevel profile h(t) = (1 - (1 - t)^4)^(1/4).
// Smooth plateau at t = 1 (dh/dt = 0) keeps interior text crystal-clear while
// bending rays strongly near the outer rim (t -> 0).
function squircleProfile(t) {
  const u = Math.max(0, Math.min(1, t));
  return Math.pow(Math.max(0, 1 - Math.pow(1 - u, 4)), 0.25);
}

/**
 * Generates an sRGB PNG data URL encoding exact Snell's Law refraction vectors
 * for a rounded-box / capsule squircle bezel.
 * Red channel = X displacement (128 = 0), Green channel = Y displacement (128 = 0).
 */
export function createLiquidGlassDisplacementMap({
  width,
  height,
  radius = 24,
  bevel = 18,
  ior = 1.5,
  slopeScale = 1.35
}) {
  const w = Math.max(12, Math.min(960, quantize(Number(width) || 120, 2)));
  const h = Math.max(12, Math.min(480, quantize(Number(height) || 40, 2)));
  const r = Math.min(Math.max(2, Math.round(radius)), w / 2, h / 2);
  const bw = Math.max(3, Math.min(Math.round(bevel), r, Math.floor(Math.min(w, h) / 2)));
  const key = `${w}x${h}:${r}:${bw}:${ior}:${slopeScale}`;
  const cached = displacementCache.get(key);
  if (cached) {
    displacementCache.delete(key);
    displacementCache.set(key, cached);
    return cached;
  }

  if (typeof document === 'undefined') return '';
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  const img = ctx.createImageData(w, h);
  const data = img.data;
  const eta = 1.0 / ior;
  const halfW = w / 2;
  const halfH = h / 2;
  const innerX = halfW - r;
  const innerY = halfH - r;

  const dxArr = new Float32Array(w * h);
  const dyArr = new Float32Array(w * h);
  let maxDisp = 1e-5;

  for (let py = 0; py < h; py++) {
    const y = py + 0.5 - halfH;
    const ay = Math.abs(y);
    const qy = ay - innerY;
    for (let px = 0; px < w; px++) {
      const x = px + 0.5 - halfW;
      const ax = Math.abs(x);
      const qx = ax - innerX;

      const outLen = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
      const inMax = Math.min(Math.max(qx, qy), 0);
      const sdf = outLen + inMax - r; // < 0 inside

      if (sdf >= 0 || -sdf >= bw) continue;

      const t = -sdf / bw;
      const dt = 1e-3;
      const dhdt = (squircleProfile(Math.min(1, t + dt)) - squircleProfile(Math.max(0, t - dt))) / (2 * dt);

      // Analytical outward gradient of the rounded-box SDF.
      let gx = 0;
      let gy = 0;
      if (qx > 0 || qy > 0) {
        const mx = Math.max(qx, 0);
        const my = Math.max(qy, 0);
        const len = Math.hypot(mx, my) || 1;
        gx = Math.sign(x) * (mx / len);
        gy = Math.sign(y) * (my / len);
      } else if (qx > qy) {
        gx = Math.sign(x);
      } else {
        gy = Math.sign(y);
      }

      const dhdx = -gx * dhdt * slopeScale;
      const dhdy = -gy * dhdt * slopeScale;

      // Unit 3D surface normal N = normalize(-dhdx, -dhdy, 1)
      const invLen = 1 / Math.hypot(dhdx, dhdy, 1);
      const nx = -dhdx * invLen;
      const ny = -dhdy * invLen;
      const nz = invLen;

      // Vector Snell's Law for orthographic incident ray I = (0, 0, -1)
      const cosI = nz;
      const k = 1 - eta * eta * (1 - cosI * cosI);
      if (k <= 0) continue;
      const refractCoeff = eta * cosI - Math.sqrt(k);
      const rx = refractCoeff * nx;
      const ry = refractCoeff * ny;
      const rz = -eta + refractCoeff * nz;

      const heightFactor = squircleProfile(t);
      const dispX = (rx / -rz) * heightFactor;
      const dispY = (ry / -rz) * heightFactor;

      const idx = py * w + px;
      dxArr[idx] = dispX;
      dyArr[idx] = dispY;
      maxDisp = Math.max(maxDisp, Math.abs(dispX), Math.abs(dispY));
    }
  }

  for (let i = 0; i < w * h; i++) {
    const p = i * 4;
    const nx = dxArr[i] / maxDisp;
    const ny = dyArr[i] / maxDisp;
    data[p] = Math.round(Math.max(0, Math.min(255, 128 + nx * 127)));
    data[p + 1] = Math.round(Math.max(0, Math.min(255, 128 + ny * 127)));
    data[p + 2] = 128;
    data[p + 3] = 255;
  }

  ctx.putImageData(img, 0, 0);
  const url = canvas.toDataURL('image/png');
  displacementCache.set(key, url);
  while (displacementCache.size > DISPLACEMENT_CACHE_LIMIT) {
    displacementCache.delete(displacementCache.keys().next().value);
  }
  return url;
}

function buildChromaticImageFilterMarkup(id, {preBlur = 11, scale = 14, dispersion = 0.08} = {}) {
  const sR = (scale * (1 - dispersion)).toFixed(2);
  const sG = scale.toFixed(2);
  const sB = (scale * (1 + dispersion)).toFixed(2);
  return `<filter id="${id}" x="0%" y="0%" width="100%" height="100%" color-interpolation-filters="sRGB">` +
    `<feGaussianBlur in="SourceGraphic" stdDeviation="${preBlur}" edgeMode="duplicate" result="pre"/>` +
    `<feImage data-role="map" href="" x="0" y="0" width="100%" height="100%" preserveAspectRatio="none" result="dispMap"/>` +
    `<feDisplacementMap data-channel="r" in="pre" in2="dispMap" scale="${sR}" xChannelSelector="R" yChannelSelector="G" result="dR"/>` +
    `<feDisplacementMap data-channel="g" in="pre" in2="dispMap" scale="${sG}" xChannelSelector="R" yChannelSelector="G" result="dG"/>` +
    `<feDisplacementMap data-channel="b" in="pre" in2="dispMap" scale="${sB}" xChannelSelector="R" yChannelSelector="G" result="dB"/>` +
    `<feComposite in="dR" in2="pre" operator="over" result="cR"/>` +
    `<feComposite in="dG" in2="pre" operator="over" result="cG"/>` +
    `<feComposite in="dB" in2="pre" operator="over" result="cB"/>` +
    `<feColorMatrix in="cR" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="r"/>` +
    `<feColorMatrix in="cG" type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" result="g"/>` +
    `<feColorMatrix in="cB" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" result="b"/>` +
    `<feBlend in="r" in2="g" mode="screen" result="rg"/>` +
    `<feBlend in="rg" in2="b" mode="screen"/>` +
    `</filter>`;
}

/**
 * Pure-SVG filter-primitive bezel refraction + RGB chromatic dispersion.
 * Uses zero <feImage> URLs so it is 100% immune to strict host-page CSP
 * (including `Content-Security-Policy: default-src 'none'`) and adapts
 * automatically as elements resize or morph width.
 */
export function buildCspSafeGlassFilterMarkup(id, {
  erode = 3,
  blur = 8,
  preBlur = 0.8,
  scale = 22,
  dispersion = 0.14
} = {}) {
  const sR = (scale * (1 - dispersion)).toFixed(2);
  const sG = scale.toFixed(2);
  const sB = (scale * (1 + dispersion)).toFixed(2);
  return `<filter id="${id}" x="0%" y="0%" width="100%" height="100%" color-interpolation-filters="sRGB">` +
    `<feFlood flood-color="#000" flood-opacity="1" x="0%" y="0%" width="100%" height="100%" result="mask"/>` +
    `<feMorphology in="mask" operator="erode" radius="${erode}" result="eroded"/>` +
    `<feGaussianBlur in="eroded" stdDeviation="${blur}" result="height"/>` +
    `<feOffset in="height" dx="2" dy="0" result="hx1"/>` +
    `<feOffset in="height" dx="-2" dy="0" result="hx2"/>` +
    `<feComposite in="hx1" in2="hx2" operator="arithmetic" k1="0" k2="0.5" k3="-0.5" k4="0.5" result="dxAlpha"/>` +
    `<feOffset in="height" dx="0" dy="2" result="hy1"/>` +
    `<feOffset in="height" dx="0" dy="-2" result="hy2"/>` +
    `<feComposite in="hy1" in2="hy2" operator="arithmetic" k1="0" k2="0.5" k3="-0.5" k4="0.5" result="dyAlpha"/>` +
    `<feColorMatrix in="dxAlpha" type="matrix" values="0 0 0 1 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0 1" result="dxR"/>` +
    `<feColorMatrix in="dyAlpha" type="matrix" values="0 0 0 0 0  0 0 0 1 0  0 0 0 0 0  0 0 0 0 1" result="dyG"/>` +
    `<feBlend in="dxR" in2="dyG" mode="screen" result="dispMap"/>` +
    `<feGaussianBlur in="SourceGraphic" stdDeviation="${preBlur}" edgeMode="duplicate" result="pre"/>` +
    `<feDisplacementMap in="pre" in2="dispMap" scale="${sR}" xChannelSelector="R" yChannelSelector="G" result="dR"/>` +
    `<feDisplacementMap in="pre" in2="dispMap" scale="${sG}" xChannelSelector="R" yChannelSelector="G" result="dG"/>` +
    `<feDisplacementMap in="pre" in2="dispMap" scale="${sB}" xChannelSelector="R" yChannelSelector="G" result="dB"/>` +
    `<feComposite in="dR" in2="pre" operator="over" result="cR"/>` +
    `<feComposite in="dG" in2="pre" operator="over" result="cG"/>` +
    `<feComposite in="dB" in2="pre" operator="over" result="cB"/>` +
    `<feColorMatrix in="cR" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0" result="r"/>` +
    `<feColorMatrix in="cG" type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0" result="g"/>` +
    `<feColorMatrix in="cB" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0" result="b"/>` +
    `<feBlend in="r" in2="g" mode="screen" result="rg"/>` +
    `<feBlend in="rg" in2="b" mode="screen"/>` +
    `</filter>`;
}

function svgNode(doc, tag, attrs = {}) {
  const el = doc.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

function buildCspSafeGlassFilterElement(doc, id, {
  erode = 3,
  blur = 8,
  preBlur = 0.8,
  scale = 22,
  dispersion = 0.14
} = {}) {
  const sR = (scale * (1 - dispersion)).toFixed(2);
  const sG = scale.toFixed(2);
  const sB = (scale * (1 + dispersion)).toFixed(2);
  const filter = svgNode(doc, 'filter', {id, x: '0%', y: '0%', width: '100%', height: '100%', 'color-interpolation-filters': 'sRGB'});
  filter.append(
    svgNode(doc, 'feFlood', {'flood-color': '#000', 'flood-opacity': '1', x: '0%', y: '0%', width: '100%', height: '100%', result: 'mask'}),
    svgNode(doc, 'feMorphology', {in: 'mask', operator: 'erode', radius: erode, result: 'eroded'}),
    svgNode(doc, 'feGaussianBlur', {in: 'eroded', stdDeviation: blur, result: 'height'}),
    svgNode(doc, 'feOffset', {in: 'height', dx: '2', dy: '0', result: 'hx1'}),
    svgNode(doc, 'feOffset', {in: 'height', dx: '-2', dy: '0', result: 'hx2'}),
    svgNode(doc, 'feComposite', {in: 'hx1', in2: 'hx2', operator: 'arithmetic', k1: '0', k2: '0.5', k3: '-0.5', k4: '0.5', result: 'dxAlpha'}),
    svgNode(doc, 'feOffset', {in: 'height', dx: '0', dy: '2', result: 'hy1'}),
    svgNode(doc, 'feOffset', {in: 'height', dx: '0', dy: '-2', result: 'hy2'}),
    svgNode(doc, 'feComposite', {in: 'hy1', in2: 'hy2', operator: 'arithmetic', k1: '0', k2: '0.5', k3: '-0.5', k4: '0.5', result: 'dyAlpha'}),
    svgNode(doc, 'feColorMatrix', {in: 'dxAlpha', type: 'matrix', values: '0 0 0 1 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0 1', result: 'dxR'}),
    svgNode(doc, 'feColorMatrix', {in: 'dyAlpha', type: 'matrix', values: '0 0 0 0 0  0 0 0 1 0  0 0 0 0 0  0 0 0 0 1', result: 'dyG'}),
    svgNode(doc, 'feBlend', {in: 'dxR', in2: 'dyG', mode: 'screen', result: 'dispMap'}),
    svgNode(doc, 'feGaussianBlur', {in: 'SourceGraphic', stdDeviation: preBlur, edgeMode: 'duplicate', result: 'pre'}),
    svgNode(doc, 'feDisplacementMap', {in: 'pre', in2: 'dispMap', scale: sR, xChannelSelector: 'R', yChannelSelector: 'G', result: 'dR'}),
    svgNode(doc, 'feDisplacementMap', {in: 'pre', in2: 'dispMap', scale: sG, xChannelSelector: 'R', yChannelSelector: 'G', result: 'dG'}),
    svgNode(doc, 'feDisplacementMap', {in: 'pre', in2: 'dispMap', scale: sB, xChannelSelector: 'R', yChannelSelector: 'G', result: 'dB'}),
    svgNode(doc, 'feComposite', {in: 'dR', in2: 'pre', operator: 'over', result: 'cR'}),
    svgNode(doc, 'feComposite', {in: 'dG', in2: 'pre', operator: 'over', result: 'cG'}),
    svgNode(doc, 'feComposite', {in: 'dB', in2: 'pre', operator: 'over', result: 'cB'}),
    svgNode(doc, 'feColorMatrix', {in: 'cR', type: 'matrix', values: '1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0', result: 'r'}),
    svgNode(doc, 'feColorMatrix', {in: 'cG', type: 'matrix', values: '0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0', result: 'g'}),
    svgNode(doc, 'feColorMatrix', {in: 'cB', type: 'matrix', values: '0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0', result: 'b'}),
    svgNode(doc, 'feBlend', {in: 'r', in2: 'g', mode: 'screen', result: 'rg'}),
    svgNode(doc, 'feBlend', {in: 'rg', in2: 'b', mode: 'screen'})
  );
  return filter;
}

function buildChromaticImageFilterElement(doc, id, {preBlur = 11, scale = 14, dispersion = 0.08} = {}) {
  const sR = (scale * (1 - dispersion)).toFixed(2);
  const sG = scale.toFixed(2);
  const sB = (scale * (1 + dispersion)).toFixed(2);
  const filter = svgNode(doc, 'filter', {id, x: '0%', y: '0%', width: '100%', height: '100%', 'color-interpolation-filters': 'sRGB'});
  filter.append(
    svgNode(doc, 'feGaussianBlur', {in: 'SourceGraphic', stdDeviation: preBlur, edgeMode: 'duplicate', result: 'pre'}),
    svgNode(doc, 'feImage', {'data-role': 'map', href: '', x: '0', y: '0', width: '100%', height: '100%', preserveAspectRatio: 'none', result: 'dispMap'}),
    svgNode(doc, 'feDisplacementMap', {'data-channel': 'r', in: 'pre', in2: 'dispMap', scale: sR, xChannelSelector: 'R', yChannelSelector: 'G', result: 'dR'}),
    svgNode(doc, 'feDisplacementMap', {'data-channel': 'g', in: 'pre', in2: 'dispMap', scale: sG, xChannelSelector: 'R', yChannelSelector: 'G', result: 'dG'}),
    svgNode(doc, 'feDisplacementMap', {'data-channel': 'b', in: 'pre', in2: 'dispMap', scale: sB, xChannelSelector: 'R', yChannelSelector: 'G', result: 'dB'}),
    svgNode(doc, 'feComposite', {in: 'dR', in2: 'pre', operator: 'over', result: 'cR'}),
    svgNode(doc, 'feComposite', {in: 'dG', in2: 'pre', operator: 'over', result: 'cG'}),
    svgNode(doc, 'feComposite', {in: 'dB', in2: 'pre', operator: 'over', result: 'cB'}),
    svgNode(doc, 'feColorMatrix', {in: 'cR', type: 'matrix', values: '1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0', result: 'r'}),
    svgNode(doc, 'feColorMatrix', {in: 'cG', type: 'matrix', values: '0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0', result: 'g'}),
    svgNode(doc, 'feColorMatrix', {in: 'cB', type: 'matrix', values: '0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0', result: 'b'}),
    svgNode(doc, 'feBlend', {in: 'r', in2: 'g', mode: 'screen', result: 'rg'}),
    svgNode(doc, 'feBlend', {in: 'rg', in2: 'b', mode: 'screen'})
  );
  return filter;
}

/**
 * Ensures the CSP- & Trusted-Types-safe SVG filter definitions exist in a document or ShadowRoot.
 */
export function ensureCspSafeGlassDefs(root, defsId, specs) {
  if (!root) return null;
  const selector = `svg[data-mediaflow-glass-defs="${defsId}"]`;
  const existing = root.querySelector?.(selector);
  if (existing) return existing;
  const doc = root.ownerDocument || document;
  const svg = svgNode(doc, 'svg', {
    class: 'mediaflow-optics-defs',
    'data-mediaflow-glass-defs': defsId,
    'aria-hidden': 'true',
    width: '0',
    height: '0'
  });
  svg.style.position = 'fixed';
  svg.style.width = '0';
  svg.style.height = '0';
  svg.style.pointerEvents = 'none';
  svg.style.overflow = 'hidden';
  const defs = svgNode(doc, 'defs');
  for (const spec of specs) defs.append(buildCspSafeGlassFilterElement(doc, spec.id, spec));
  svg.append(defs);
  root.append(svg);
  return svg;
}

const WORKSPACE_FILTERS = [
  {id: 'mf-nav-bar-lens', preBlur: 14, scale: 14, dispersion: 0.08},
  {id: 'mf-switcher-lens', preBlur: 12, scale: 12, dispersion: 0.08},
  {id: 'mf-footer-bar-lens', preBlur: 14, scale: 14, dispersion: 0.08},
  {id: 'mf-toast-lens', preBlur: 12, scale: 13, dispersion: 0.08}
];

/**
 * Installs and manages exact Snell's Law squircle SVG filters inside
 * extension-origin pages (popup/index.html and popup/overlay.html).
 */
export function ensureWorkspaceGlassFilters(doc = document) {
  let svg = doc.querySelector('svg[data-mediaflow-glass-defs="workspace"]');
  if (!svg) {
    svg = svgNode(doc, 'svg', {
      class: 'mediaflow-optics-defs',
      'data-mediaflow-glass-defs': 'workspace',
      'aria-hidden': 'true',
      width: '0',
      height: '0'
    });
    svg.style.position = 'fixed';
    svg.style.width = '0';
    svg.style.height = '0';
    svg.style.pointerEvents = 'none';
    svg.style.overflow = 'hidden';
    const defs = svgNode(doc, 'defs');
    for (const spec of WORKSPACE_FILTERS) defs.append(buildChromaticImageFilterElement(doc, spec.id, spec));
    svg.append(defs);
    (doc.documentElement || doc.body).append(svg);
  }
  const lastHref = new Map();
  return {
    svg,
    updateMap(filterId, options) {
      const filter = svg.querySelector(`#${filterId}`);
      const feImage = filter?.querySelector('feImage[data-role="map"]');
      if (!feImage) return '';
      const href = createLiquidGlassDisplacementMap(options);
      if (href && lastHref.get(filterId) !== href) {
        feImage.setAttribute('href', href);
        lastHref.set(filterId, href);
      }
      return href;
    },
    setScale(filterId, baseScale, dispersion = 0.08) {
      const filter = svg.querySelector(`#${filterId}`);
      if (!filter) return;
      const r = filter.querySelector('feDisplacementMap[data-channel="r"]');
      const g = filter.querySelector('feDisplacementMap[data-channel="g"]');
      const b = filter.querySelector('feDisplacementMap[data-channel="b"]');
      if (r) r.setAttribute('scale', (baseScale * (1 - dispersion)).toFixed(2));
      if (g) g.setAttribute('scale', baseScale.toFixed(2));
      if (b) b.setAttribute('scale', (baseScale * (1 + dispersion)).toFixed(2));
    }
  };
}

/**
 * 2nd-order underdamped mass-spring-damper solver with velocity preservation.
 */
export function createSpring({stiffness = 340, damping = 26, mass = 1, precision = 0.2} = {}) {
  let value = 0;
  let target = 0;
  let velocity = 0;
  return {
    get value() { return value; },
    get target() { return target; },
    get velocity() { return velocity; },
    snap(next) {
      value = next;
      target = next;
      velocity = 0;
    },
    setTarget(next) {
      target = next;
    },
    step(dtSec) {
      const dt = Math.min(Math.max(dtSec, 0.001), 0.032);
      const force = -stiffness * (value - target) - damping * velocity;
      const accel = force / mass;
      velocity += accel * dt;
      value += velocity * dt;
      const settled = Math.abs(target - value) < precision && Math.abs(velocity) < precision * 4;
      if (settled) {
        value = target;
        velocity = 0;
      }
      return {value, velocity, settled};
    }
  };
}

/**
 * Attaches radial tap illumination ("energizing with light") on press to a
 * Liquid Glass control surface without hover pointer-tracking shimmer.
 */
export function attachInteractiveGlassLight(element, {reducedMotion, reducedTransparency} = {}) {
  if (!element) return () => {};
  let tapTimer = 0;

  const isDisabled = () => Boolean(reducedMotion?.matches || reducedTransparency?.matches);

  const onPointerDown = event => {
    if (isDisabled()) return;
    const rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const nx = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    const ny = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));
    element.style.setProperty('--tap-x', `${(nx * 100).toFixed(1)}%`);
    element.style.setProperty('--tap-y', `${(ny * 100).toFixed(1)}%`);
    element.classList.remove('is-glass-energized');
    void element.offsetWidth;
    element.classList.add('is-glass-energized');
    clearTimeout(tapTimer);
    tapTimer = setTimeout(() => {
      element.classList.remove('is-glass-energized');
    }, 420);
  };

  element.addEventListener('pointerdown', onPointerDown, {passive: true});

  return () => {
    clearTimeout(tapTimer);
    element.removeEventListener('pointerdown', onPointerDown);
    element.classList.remove('is-glass-energized');
  };
}
