# Unreleased - MP4 playback repair and queue memory control

- Finalize TS and fragmented HLS as conventional MP4 with complete sample tables, track durations, composition timing and keyframe indexes. Handle repeated AAC priming samples at discontinuities; preserve encoded audio/video and write media directly to disk. Release converter metadata when finished or paused.
- Invalidate the older fragmented-output cache so Retry rebuilds from retained source segments. Unsafe MP4 finalization reports an error with the cache retained; unsupported TS/WebM conversion keeps its original format.
- Add a remembered 0-12 queue limit beside the Downloads queue and in Settings. 0 holds all downloads; lowering the limit suspends excess transfers/saves and terminates their workers. Raising it resumes queued work while preserving manual pauses. Existing settings above 12 are clamped.
- Validation includes full video/audio decoding, decoded sample comparisons, seeking, native fragmented HLS, discontinuities, worker shutdown/resume, queue restart recovery and stale-output rebuilds.

## Earlier changes in this update

- Added remembered MP4 (fast) / Original format choices beside the single-video and creator-batch download controls. Requests capture the selected format explicitly.
- Compatible HLS segments now remux in playlist order while other segments download. The queue shows Downloading + MP4; output is committed only after conversion completes. Pause/retry retains source segments and completed MP4 can be saved again from cache.
- Load the local MP4 library only for HLS downloads requesting MP4. Native MP4 downloads save directly; WebM and unsupported codecs retain their playable original format with an explanation.
- Verified 92 unit tests, background startup, the Chrome popup fixture and offscreen worker integration. Chrome checks used in-process fixture responses because this environment blocks local socket connections. ffprobe verified H.264/AAC output, duration and discontinuity handling.

# MediaFlow v1.3.0 - complete interface redesign

- Reworked shared navigation into a compact single-line header and underlined tabs while keeping the toolbar-attached popup, saved resizing and explicit full-browser-tab action.
- Reclaimed profile space: ten full fixture cards at 720×600, compared with eight previously. Source options remain collapsible and download actions remain visible while the library scrolls.
- Added title search across loaded profile pages. Search preserves selection and warns when selected videos are hidden by the filter. Selection, page, scroll and typing focus are retained through updates.
- Redesigned Downloads with a compact media summary and source/queue panels side by side in wider popups. Queue cards keep statuses, progress, errors and controls together.
- Grouped settings into Download behavior, Files and folders, and Display; native keyboard-operable switches retain existing saved preferences.
- Redesigned history with clear saved states, search, concise rows, file/source actions and disclosed file details. Reworked the website selection toolbar into compact groups.
- Applied the installed improve-ui source-tracing audit across the complete workspace. Retained the accepted neutral/indigo palette, local fonts/icons and existing download engines.
- Verified 89 unit tests, background startup and all six Chrome fixture suites, including library search, ten-card density, grouped settings, keyboard controls, minimum sizing, webpage selection and download regressions.

# MediaFlow v1.2.1 — neutral and indigo interface

- Replaced the emerald theme with cool dark neutral surfaces and indigo accents across the popup, website selection controls and downloaded badges.
- Preserved the attached toolbar popup, remembered resizing and larger profile library with fixed download actions.
- Installed the requested `improve-ui` skill from `ibelick/ui-skills` for Codex and applied its source-tracing audit to the palette replacement.

# MediaFlow v1.2.0 — more room for profile videos

- Applied ui-skills Baseline UI and Subtractive Design with a quiet emerald palette, consistent Lucide icons and bundled Poppins/Montserrat typography.
- Collapsed source setup after loading, compacted navigation/selection controls, and gave the library the remaining height. Download and selection totals stay visible while videos scroll.
- Added two-column compact cards in the attached popup and three columns in a wide full browser tab. The default 720×600 fixture view shows eight full cards, or six with a batch summary/range hint.
- Retained list position, pagination, selection and keyboard focus through progress updates and view changes. Source editing, range selection, empty states and downloaded labels remain available.
- Kept the toolbar-attached popup and remembered cursor/keyboard resizing. Full view opens only when requested, in a normal browser tab.
- Verified narrow/minimum layouts and library density in Chrome fixture tests, alongside all 89 unit tests, background startup and existing browser/download regressions.

# MediaFlow v1.1.1 — attached browser popup

- Restored the toolbar-attached popup and removed the automatic separate-window launcher.
- Added remembered popup dimensions, cursor/keyboard resizing within Chrome's popup limits, and an explicit full view in a normal browser tab.
- Removed UI code that could resize the browser's own window. Source-tab lookup prioritizes the window that opened the popup.
- Installed ui-skills 0.2.4 as a pinned development dependency.
- Verified popup rendering, pointer/keyboard resize, saved dimensions, browser-tab opening, and absence of browser-window creation/resizing, alongside existing download regressions.

# MediaFlow v1.1.0 — gpt-1

- Genuine MP4 output for compatible H.264/AAC HLS using bundled mux.js; complete original TS/WebM fallback when conversion is unsupported. Source transport and saved format remain separate, preserving older task caches.
- One cursor-resizable workspace window with remembered bounds and explicit source-browser-tab tracking. Larger profile lists, two-column layout, compact scan details, and preserved selection/scroll/focus.
- One selection control per website card, rounded emerald selection styling, separate Downloaded/Not downloaded badges, local Poppins/Montserrat fonts, and Lucide SVG icons.
- Profile videos are queued before source resolution. One concurrency scheduler controls starts, resumes, retries, conversion and saving; overflow stays queued.
- Offscreen transfer/conversion workers, recovery after background restart, progress-based 60-second inactivity timeouts, three bounded transient retries, and retained-cache retries for failed saves.
- Expired HLS renewal preserves the checkpoint URL across worker replacement. Queue retry limits no longer disable link renewal. Duplicate pending creator downloads are skipped.
- Regression checks cover genuine MP4 video/audio/duration, discontinuities, playable original-format fallback, failed-save recovery, expired links, concurrency, duplicate controls, dynamic cards, fonts and layout. Tests use neutral fixtures; live-site access conditions can still vary.

- MissAV catalogue and player support, including `/dm265/en`, automatic resolution of visible cards to full HLS videos, packed-source decoding, player headers and verification messages.
- X viewport detection on timelines, automatic scroll/DOM updates, hidden/clipped-player filtering and separate quality groups for each visible video.
- X/Twitter post video and animated-GIF downloads with MP4 quality selection, existing queue controls and history.
- Post-scoped fetch/XHR media observation, public embed metadata fallback, navigation updates and individual selection for posts with multiple videos.
- Same-quality expired-link renewal through public post metadata and shared X/Twitter history identities.
- Added X extraction, discovery, direct renewal and browser regression coverage. Reload the extension and refresh existing X tabs before use. See README for access and stream limits.

# MediaFlow v1.0.0

Initial GitHub release of the MediaFlow browser extension.

- Persistent MP4/WebM partial-file downloads and HLS segment checkpoints, including resume after closing and reopening the browser.
- Pause, resume, retry, queue concurrency, live transfer speed, and recovery of interrupted file saves.
- Expired-link refresh for supported sites, including HTTP 403/472 recovery and embedded-player request headers.
- Generic HTML5/HLS detection in pages and frames, alongside site-specific detection.
- Creator scans across linked video pages, inclusive start/end range selection, persistent tick labels, and shared webpage/popup selection.
- Batch cancellation, automatic skipping of previously downloaded videos, and selection of new videos by default.
- Searchable download history, thumbnail settings, ascending quality ordering, and Clear results for fetched creator lists.

## Install

1. Download `mediaflow-extension-v1.0.0.zip` and extract it into a permanent folder.
2. Open `chrome://extensions` in Chrome or `brave://extensions` in Brave.
3. Enable Developer mode, choose **Load unpacked**, and select the folder containing `manifest.json`.
4. Refresh any video/creator tabs that were open before installation.

The release includes `SHA256SUMS.txt` for archive verification. Existing users should keep the same unpacked folder and reload the extension to retain its identity and saved queue data.

## Verification and limits

The current 89-test fixture suite and background startup check pass. Chrome checks cover the workspace/profile controls, webpage selection, X/MissAV viewport detection, persistent direct/HLS resume, and offscreen transfer/conversion. ffprobe checks real generated media, including audio and duration. See README for test dependencies and commands.

Compatibility checks use synthetic fixtures, not every live page. DRM-protected media, DASH/separate-track muxing, live HLS, CAPTCHA/access restrictions, and custom encrypted player APIs are not universally supported. See the README for compatibility details.
