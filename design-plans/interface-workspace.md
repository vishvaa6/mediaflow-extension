# Improve the complete MediaFlow workspace

Written against: dcc8546da9463b9f8bc8d29b22a1af31fe9cd571 plus the local v1.2.1 implementation.

## Design language

- Audited surface: the four views rendered by `src/pages/popup/index.js`, and the creator-selection toolbar installed by `src/pages/contentInjected/index.js`.
- Design sources: the user's explicit request to improve the entire interface and devote more space to loaded profile videos; the supplied screenshots; `src/pages/popup/index.html`, `assets/css/workspace.css`, the popup render functions and `assets/js/profile-page-selector.js`.
- Documented decisions: retain the browser-attached, resizable popup, local Poppins/Montserrat/Lucide assets, cool neutral/indigo palette and independent selection/download status.
- Governing owners and consumers: popup HTML loads the base stylesheet, fonts and then workspace styles. `render()` owns shared navigation; the four render functions own their view layouts. The injected selector owns its shadow toolbar.
- Explicit exceptions: None documented.

## Findings

| # | Problem | Evidence | Proposed change | Scope | Confidence |
| --- | --- | --- | --- | --- | --- |
| 1 | Stacked navigation and source controls consume space the user explicitly wants for loaded videos. | `render()` produces a two-line header and separate nav; `renderProfileTab()` adds a two-line source summary, selection row and pagination. Their CSS fixes the associated heights before allocating the grid. The user reports inadequate viewing space. | Compact the shared chrome and library header, keep actions pinned, and reduce card chrome without reducing title legibility. | Shared header, library. | High |
| 2 | Detected-media presentation pushes the queue down with a full-width preview and vertically stacked quality choices. | `renderVideoQueueTab()` emits the 180px preview before every quality row and only then the queue. The same task requires choosing a source and seeing its download state. User requests the entire UI be improved. | Use a compact media summary and a responsive quality grid above clearer queue rows. | Downloads view. | High |
| 3 | Settings and history repeat equal-weight boxes/details without grouping primary tasks. | `renderSettingsTab()` emits six sibling cards; `renderHistoryTab()` displays both title and filename plus actions for every record. These structures are loaded directly by the same popup. | Group preferences by purpose and give history a search toolbar, concise rows and disclosed file details. | Settings and history. | High |

## Improve first

Reclaim vertical library space while preserving attached-popup behavior and selection continuity.

## Evidence chain

- Surface: `src/pages/popup/index.html?surface=popup`, its full-view browser tab, and the installed webpage creator toolbar.
- Problem: the user requests changes to the full interface, beyond its palette, with more room for loaded profile videos.
- Design evidence: supplied screenshots show the viewing-space problem; the render functions and final loaded stylesheet prove ownership of the stacked layout.
- Owner: `src/pages/popup/index.js`, `assets/css/workspace.css`, `assets/js/profile-page-selector.js`.
- Uncertainty: exact visible-card count depends on title length and active notices; verify using neutral long-title fixtures at real popup sizes.

## Design decision and reuse

Reuse native buttons, inputs, selects and details; existing icons/fonts/tokens; source-tab tracking; and the accepted indigo palette. Keep the four existing navigation destinations and existing download message types. Preserve one list scroller, pinned download actions, global library selection and pagination. Add title search to the loaded library without altering the selection or downloads. Apply consistent compact row/group styling to the website toolbar.

## Changes

1. Shared chrome: a single-line app header and compact navigation, retaining language and explicit full-tab controls.
2. Library: compact creator/source row, inline tools/search/pagination, readable two-line titles, retained thumbnails/status, and persistent download footer. Search must preserve selection and make its scope clear.
3. Downloads: compact thumbnail/title/status summary, labelled filename, responsive quality grid, structured queue summary and progress cards.
4. Settings: Download behavior, Files and folders, and Display groups using existing controls and saved settings.
5. History: clear heading/search, concise record rows, native disclosed filename details and existing file/source/remove actions.
6. Website toolbar: group its selection and download actions, retain collapse control and one selection button per video.

## Scope

- Inherit: all popup views and the creator webpage toolbar.
- Verify: popup 720×600 and 480×360; 1000px/1400px full view; loaded/empty/filter states; long titles, thumbnails, progress updates, scrolling and focus.
- Exclude: network engines, queue scheduling, conversion and source-tab/window behavior.

## Validation

- `npm.cmd test`: existing regression suite and background startup pass.
- `npm.cmd run test:browser`: all existing browser fixtures plus focused library search and density checks pass.
- Confirm the manifest retains `action.default_popup`, no detached window is created, and source tracking remains unchanged.
- Regenerate the versioned extension ZIP/checksum and verify runtime file equality.

## Stop conditions

Stop if UI work requires changing download engines or replacing the attached popup.

## Design documentation

After validation, update current README/release notes for the reorganized views and measured library capacity. Preserve earlier release history.

## Implementation result

Implemented on gpt-1 as v1.3.0. The attached 720×600 fixture library shows ten full cards in a 359px scrolling region. All 89 unit tests, background startup and six Chrome fixture suites passed, including selection-preserving search, typing focus, grouped settings and source/queue layout.
