# Liquid Glass implementation notes

Reviewed Apple's official design guidance:

- [Meet Liquid Glass, WWDC25 (Session 219)](https://developer.apple.com/videos/play/wwdc2025/219/): Snell's Law lensing, interaction light, fluid spring/gel transitions, regular versus clear material, scroll-edge adaptivity, and accessibility.
- [Get to know the new design system, WWDC25 (Session 356)](https://developer.apple.com/videos/play/wwdc2025/356/): navigation hierarchy, concentric shapes, and platform continuity.
- [Materials (Human Interface Guidelines)](https://developer.apple.com/design/human-interface-guidelines/materials): control-layer materials versus quiet content surfaces.
- [Adopting Liquid Glass](https://developer.apple.com/documentation/technologyoverviews/adopting-liquid-glass): regular/clear variants, background extension, and scroll edge effects.

## Dual-Engine Optical Refraction Architecture

1. **Extension-Origin Snell's Law Squircle Pipeline (`assets/js/liquid-optics.js`, `assets/js/liquid-workspace.js`)**:
   - Generates per-pixel `sRGB` displacement maps on `<canvas>` (cached in a 24-entry LRU map and updated via `ResizeObserver`) using a rounded-box/capsule SDF and degree-4 convex squircle bevel profile $h(t) = (1 - (1 - t)^4)^{1/4}$ with vector Snell's Law ($\eta = 1 / 1.50$).
   - Interior plateau pixels encode neutral `rgb(128, 128, 128)` so labels remain sharp while curved perimeter bezels bend and refract background pixels with 3-channel RGB chromatic dispersion (`<feDisplacementMap>` + `<feColorMatrix>` screen blend).
   - Drives `.liquid-nav-lens` and `.liquid-switcher-lens` with a 2nd-order underdamped mass-spring-damper solver that preserves velocity across mid-flight retargeting, applies area-conserving viscous gel stretch (`scaleX` / `scaleY`), and boosts refractive scale during transit.
   - Floats `.popup-tabs-bar` and `.profile-download-bar` over scrolling content with `--scroll-edge` shadow/contrast adaptation and an ambient light-spill / artwork background stage (`.liquid-ambient-stage`, disabled in `overlay` mode so the live webpage shines through).

2. **Host-Page CSP-Safe Pure-SVG Bezel Pipeline (`src/pages/overlay-host.js`, `assets/js/player-download-button.js`, `assets/js/profile-page-selector.js`)**:
   - Computes real-time bezel normal gradients purely from SVG filter primitives (`<feFlood>` → `<feMorphology>` → `<feGaussianBlur>` → finite-difference `<feOffset>`/`<feComposite>` → 3-channel RGB `<feDisplacementMap>`), avoiding `<feImage data:...>` URLs so zero CSP violations occur even on pages with `Content-Security-Policy: default-src 'none'`.
   - Applies Clear Liquid Glass (`blur(4px)` + `#mf-clear-pill-lens` + tap illumination bloom) to `.mediaflow-download-pill` over live video, and thicker Regular Liquid Glass (`blur(24px–28px)`) to `.mediaflow-quality-menu`, `overlay-host.js`, and `#mediaflow-profile-picker`.

3. **Hierarchy & Accessibility**:
   - Content cards (`.card-section`, `.video-detected-box`, `.task-card-modern`, `.history-record`, `.settings-panel`) use quiet concentric surfaces underneath the floating Liquid Glass control layer (no competing glass-on-glass stacks).
   - `prefers-reduced-motion: reduce` stops spring RAF loops, velocity stretch, ambient orb drift, and pointer specular tracking.
   - `prefers-reduced-transparency: reduce`, `prefers-contrast: more`, and `forced-colors: active` disable SVG refraction and `backdrop-filter`, falling back to opaque high-contrast surfaces.
   - No Apple fonts or SF Symbols are redistributed; system fonts and existing Lucide icon assets are retained.
