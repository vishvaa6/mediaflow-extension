# Restore cool neutral surfaces and indigo accents

Written against: dcc8546da9463b9f8bc8d29b22a1af31fe9cd571 plus the existing local v1.2.0 work.

## Design language

- Audited surface: MediaFlow's attached popup and its creator-selection/download-status overlays on source pages.
- Design sources: the user's explicit rejection of the emerald theme; `src/pages/popup/index.html`; `assets/css/popup.chunk.css`; `assets/css/workspace.css`; the injected styles in `assets/js/profile-page-selector.js` and `assets/js/download-badges.js`.
- Documented decisions: keep the larger creator library, attached popup, rounded selection controls, local typography and icons. Replace the emerald colour treatment.
- Governing owners and consumers: popup HTML loads `workspace.css` after the base stylesheet. `src/pages/contentInjected/index.js` installs the profile picker; `src/pages/contentDetection/index.js` installs download badges. Each injected style owns its respective page overlay.
- Explicit exceptions: None documented.

## Findings

| # | Problem | Evidence | Proposed change | Scope | Confidence |
| --- | --- | --- | --- | --- | --- |
| 1 | The rejected emerald treatment still controls the extension's primary surfaces and selection states. | The user requests its replacement. The final popup stylesheet sets green surfaces and mint actions; the injected picker and downloaded badge styles also contain emerald fills and borders. The entry points above load these owners at runtime. | Replace this treatment using the product's existing cool dark surfaces and indigo colour family. | Popup, creator selection overlays, downloaded badges. | High |

## Improve first

Replace the palette in its three existing owners so the same profile-selection task does not retain green controls on the website.

## Evidence chain

- Surface: `src/pages/popup/index.html?surface=popup`, full-view tab, and installed website overlays.
- Problem: the user rejected the emerald palette added in v1.2.0.
- Design evidence: base stylesheet already defines `#0b0f19`, `#111827`, `#172033`, `#1e293b`; the picker already uses `#4f46e5`, `#818cf8` and `#a5b4fc`.
- Owner: `assets/css/workspace.css` for popup presentation; the two overlay modules for their injected styles.
- Scope and affected surfaces: all popup views inherit the tokens, while card selection and history badges inherit their respective overlay styles.
- Uncertainty: colour preference is subjective; use the existing indigo family without changing the accepted layout.

## Design decision

Reuse cool dark surfaces and indigo accents, with white text on saturated primary buttons. Retain rose and amber for error/warning meaning. Selection uses a restrained indigo border and tint; downloaded status retains its check icon and text. No new UI component or theme setting is needed.

## Reuse

- Existing popup CSS variables and component selectors.
- Exemplar: the cool dark base palette in `assets/css/popup.chunk.css` and indigo primary action in `assets/js/profile-page-selector.js`.

## Changes

1. `assets/css/workspace.css`: replace green tokens and component literals with cool neutrals/indigo. Preserve dimensions, spacing, responsiveness and focus styling.
2. `assets/js/profile-page-selector.js`: replace emerald selection fills/borders with indigo. Preserve one selection control, rounded corners and all selection behavior.
3. `assets/js/download-badges.js`: replace the downloaded badge's emerald colours. Preserve downloaded/not-downloaded text and history identities.
4. Update the current README and release notes after verification; regenerate the versioned release ZIP/checksum.

## Scope

- Inherit: navigation, forms, primary actions, queue progress, profile cards and extension-owned website overlays.
- Verify: popup sizes 720×600 and 480×360; full-view columns; range selection and downloaded labels.
- Exclude: queue engines, transport/conversion behavior, source-site media and content colours.

## Validation

- Product: the popup stays attached and the profile library retains eight full fixture cards at its default size.
- Interface: exercise existing Chrome fixture checks for loaded/empty libraries, selection, source disclosure, minimum size and saved resizing.
- System: no remaining emerald colour literals in the three current styling owners; reuse existing layout and controls.
- Repository: `node tests/browser.test.cjs` and `node tests/profile-selection-browser.test.cjs` must pass. Check syntax and archive runtime files.

## Stop conditions

- Stop if the change requires altering download engines or replacing the attached popup.

## Design documentation

- After validation: README documents cool neutral/indigo presentation and the locally installed improve-ui skill. Release notes describe the palette replacement.
