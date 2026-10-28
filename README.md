# MediaFlow extension

This folder is the runnable, unpacked browser extension. There is no build step.

## Install v1.3.0

Download the extension ZIP from [GitHub Releases](https://github.com/vishvaa6/mediaflow-extension/releases), extract it into a permanent folder, then enable Developer mode on `chrome://extensions` (Chrome) or `brave://extensions` (Brave). Click **Load unpacked** and select the folder containing `manifest.json`.

To create the release ZIP and checksum locally, run `python scripts/package_release.py`. The browser-ready package is written to `dist/`; tests and generated project maps are excluded.

After changing the files, reload MediaFlow on the browser's Extensions page, then refresh the creator/video tab. Existing queue and history storage is preserved.

## Attached popup and MP4 output

- Click the toolbar icon to open MediaFlow attached to the browser toolbar. It opens at 720×600 by default. Drag the bottom-right grip to resize within Chrome's 800×600 popup limit; the popup size is remembered. Arrow keys resize the focused grip, and Home restores the default size. Smaller displays are respected. Use **Open full view in a browser tab** in the header for more space. MediaFlow does not open a separate window or resize the browser window. Detection follows the source website in the originating browser window.
- **Library** gives loaded profile videos most of the popup height and keeps selection totals and Download visible at the bottom. Source setup collapses after a scan; click **Source** to change the URL, fetch again or clear results. Compact cards show readable titles, thumbnails and separate download status. The default 720×600 fixture library now shows ten full cards (eight when a batch summary or range hint is present), with two columns from 640px and three in the full browser tab from 1100px. **Search loaded videos** searches titles across all loaded pages without changing the library selection; the footer reminds you when selection includes hidden videos. Selection, page, scroll position and keyboard focus survive progress updates. Selected cards have rounded indigo borders. Poppins, Montserrat and Lucide SVG icons are bundled locally with their licenses.
- **Downloads** shows a compact source preview and quality choices beside the queue from 640px wide, so transfer status stays in view. Narrow popups stack these panels. Queue rows keep pause, resume, retry, error details and progress together.
- **Settings** groups Download behavior, Files and folders, and Display. Native switches support keyboard use and changes save automatically. **History** has a search toolbar, concise saved-file rows, file/source actions and expandable file details. The website's MediaFlow selection toolbar uses the same compact controls and grouped download actions.
- **Download format** in Settings defaults to **MP4 preferred**. Native MP4 is preferred at the requested quality. Compatible H.264/AAC TS-based HLS is remuxed into actual MP4 in a local worker; fragmented MP4 is retained. Unsupported conversion uses a complete original-format TS/WebM file with an explicit format/reason. It never renames TS or WebM bytes to `.mp4`. Select **Original format** to disable remuxing. Existing tasks without the new setting retain their original behavior.
- Profile selections enter the queue before resolving their video pages. Resolution, transfer, conversion and final saving share the **Queue Concurrency Limit** (1–20, default 6). Waiting tasks stay queued. Lowering the limit allows existing tasks to finish before more start. Repeating a creator batch skips its pending downloads.
- Transfers and conversion run in offscreen-owned workers, independently of the visible window and background service-worker lifetime. Queue recovery adopts existing workers. HLS segment checkpoints and direct partial files remain available for retry; interrupted conversion can restart from the retained source segments.
- The initial response and each period of inactivity have a 60-second timeout; a response that continues delivering data can take longer. Transient network/timeout/429/5xx failures get up to three queued retries with backoff and bounded Retry-After delays. Waiting retries release capacity. Pausing/cancelling stops the request and retries. Expired media links are renewed without changing the checkpoint identity or requested quality/format.
- **Downloaded** and **Not downloaded** badges appear on recognized website cards/players and extension views. They follow local completed-download history and supported URL aliases, update after navigation/history changes, and remain separate from selection. A task is marked downloaded only after the browser finishes saving it. Clearing history resets its badge; this does not check whether files were manually moved or deleted.

Site access restrictions, unsupported separate-track/DRM streams, storage failures, and server outages can still require user action. Per-item errors explain the problem and preserve committed progress rather than creating a misleading completed file.

## UI development tool

`ui-skills` 0.2.4 is pinned as a development dependency, with `package-lock.json` recording the install. Run `npx ui-skills` in this repository to see the CLI commands, or `npx ui-skills start` to fetch its UI-skill routing guide. The CLI is a development tool and is excluded from the browser extension ZIP.

The v1.2 interface applies [Baseline UI](https://www.ui-skills.com/skills/ibelick/baseline-ui) and [Subtractive Design](https://www.ui-skills.com/skills/kemiljk/subtractive-design): restrained surfaces, native accessible controls, and source options disclosed only when needed. Version 1.2.1 replaces the emerald treatment with cool dark neutrals and indigo actions, selection controls and downloaded badges. The layout uses the existing vanilla JavaScript and bundled fonts/icons.

The requested [improve-ui skill](https://github.com/ibelick/ui-skills/tree/main/skills/improve-ui) is installed locally for Codex under `.agents/skills/improve-ui`, with `skills-lock.json` recording its source. Install it with `npx skills add https://github.com/ibelick/ui-skills --skill improve-ui`. Its source-tracing audit informed the colour replacement documented in `design-plans/replace-emerald-theme.md`; the user explicitly requested implementation. Skill files are development tools and are excluded from the extension ZIP.

The v1.3.0 interface redesign follows the full-workspace audit and implementation plan in `design-plans/interface-workspace.md`, covering navigation, library density/search, source/queue layout, grouped preferences, history and the website selection toolbar.

## Repairs

- Download speed uses numeric samples with a consistent B/s, KB/s or MB/s display.
- Queue writes and task controls are serialized. Queued downloads can be paused. Resumes respect concurrency, and final saves use the browser's pause/resume controls. If a browser file save cannot resume, the app saves the committed cache again.
- MP4/WebM pauses commit partial files before resuming. Resume verifies up to 64 KiB of overlap before appending, including after browser restarts. A changed file or a server ignoring Range reports an error and preserves the partial file. Stalled connections report an error.
- HLS downloads commit every completed segment and a playlist checkpoint to OPFS. After a browser or background-worker restart, the downloader restores those files and requests only missing segments. Retry preserves the same task and cache. AES-128 keys, initialization fragments, byte ranges, and refreshed signed URLs are supported.
- Rejected media links (including HTTP 472) are renewed from the original video page for both direct and HLS downloads, using the same quality and format. Fresh page/metadata requests bypass stale browser caches. Renewed direct URLs are saved to the existing queue task; HLS keeps its original checkpoint identity and stores the refreshed source separately. A repeated rejection retains the cache with a retry message.
- Embedded-player Origin/Referer headers are preserved from detection through enqueue, quality expansion, batch resolution, playlist fetches, segment fetches, and link renewal. This repairs the 123av path that used to replace `javplayer.cc` headers with the outer page's headers. Exact, escaped URL filters limit header rules to the intended signed resource.
- Generic detection runs in top-level pages and embedded frames. It finds HTML5 MP4/WebM sources, JSON-LD media, common player configurations, and HLS/direct media URLs observed during playback. **Refresh video detection** updates the popup. Site-specific detection takes precedence over unrelated/preloaded resources. Per-tab discovery is held in memory and excludes cookies.
- Profile scanning follows linked pagination in the creator's videos listing, deduplicates videos, and reports pages scanned. Scans and batch resolution run in the background after closing the popup. Stop scan cancels the current page request.
- Thumbnails resolve relative and lazy image URLs, try alternate sources, then retry through the background fetcher. Failed images show a placeholder.
- Queue updates and selection changes preserve the profile grid. Large profiles show 60 videos per view while scanning all linked creator pages.
- Batch resolution expands MP4 metadata endpoints and HLS variants before choosing quality. Resolution failures appear on their individual queued tasks with Retry controls; enqueue failures are counted in the batch summary.
- **Cancel batch & downloads** in Profile Videos aborts the resolving request and cancels that creator's queued, paused, active, and final-save batch tasks. Single-video downloads and other creators' batches remain in place. Cancellation also catches enqueues already in progress.
- Detected qualities are sorted by resolution from lowest to highest across formats. Single-video previews use the page's video poster, social metadata, or structured video metadata.
- The History tab retains completed downloads with titles, creator, completion date, quality/format, size, source page, thumbnail URL, and browser download ID. It supports search, file/source actions, and removal. Old history records remain readable. Video-page identities drive **Already downloaded** labels even when stream signatures change.
- **Show thumbnails** in Settings persists across sessions and controls previews in detection, profiles, and history.
- Profile scans select only videos missing from download history. **Select new** excludes completed videos, and background batches recheck history before enqueueing and starting queued items and after source resolution. The batch summary reports skipped downloads.
- **Clear results** beside Fetch Videos stops the current scan and removes the saved profile list, page counts and selection. Cleared results stay empty when the popup reopens until Fetch Videos is clicked again. Downloads, history and active batch cancellation controls are preserved.
- **Select range** is available on the creator webpage in the MediaFlow toolbar and in the popup's Profile Videos tab. Click the first video, navigate to another listing page if needed, then click the last video. Both endpoints and all new videos between them are selected in listing order, with **Selected**, **Start**, and **End** labels. The shared selection survives page navigation and popup reopening. **Batch download** waits for the full creator scan and downloads only the selection; already downloaded videos are skipped. Use the tick buttons to adjust individual videos, **Clear** to remove the selection, or **Select new** to restore the default.

## X / Twitter videos

On the `gpt-1` branch, MediaFlow automatically detects video and animated-GIF media visible in the viewport on `x.com` and `twitter.com`, including timelines.

1. Reload MediaFlow on the browser's Extensions page, then refresh the X tab so the new page observer is installed.
2. Scroll a video into view on a timeline or open an individual post. MediaFlow updates automatically as visible players change; playback is not required when the page has already loaded its media variants.
3. Choose an **MP4** quality and download. The existing queue, pause/resume, download subdirectory and history controls apply.
4. Visible videos are grouped separately in the popup. Multi-video cards are matched by their poster so each download keeps the correct post/video identity. Opening a URL ending in `/video/2` is also supported.

Detection reads video variants from responses already received by the X page and can fall back to X's public embed metadata. It does not require an API key. The observer forwards only post text, thumbnail and media URLs; it does not forward account credentials or request headers. Results follow scrolling, resize, DOM changes and navigation. Hidden, clipped and offscreen players are excluded. X and Twitter URL aliases share history identities, with a separate identity for each video in a post.

MP4 is recommended because some X HLS streams use separate audio, which the existing downloader does not mux. Public metadata is also used to renew expired media URLs at the same quality and format. If the post is unavailable through that endpoint, retry reports an error and retains the committed cache. Media visible only while signed in depends on the original X page loading its variants. Profile-wide batch downloads and live broadcasts on X are not included.

The X regression and browser checks use synthetic API responses, including fetch/XHR observation, viewport scrolling, recycled cards, hidden/clipped players, navigation, public-fallback races, popup enqueue and expired MP4 renewal. They do not certify every live or account-specific X post. The public metadata format/token is cross-checked against the [yt-dlp Twitter extractor](https://github.com/yt-dlp/yt-dlp/blob/master/yt_dlp/extractor/twitter.py).

## MissAV catalogue and player detection

The `gpt-1` branch supports the catalogue at `https://missav.ws/dm265/en`, individual video pages, and the existing MissAV domain aliases. Reload the extension and refresh an open MissAV tab after updating.

- Scroll catalogue thumbnails into view. MediaFlow resolves their full video pages automatically and groups each video's available HLS qualities in the popup. Preview/trailer MP4 clips are excluded.
- On a video page, the visible main player is resolved from its page configuration. Packed source strings are decoded as data; page scripts are never evaluated by the extension. Known sources remain available if the master playlist cannot be expanded.
- Source-page Origin/Referer headers, per-video filenames, thumbnails, history, queue controls, persistent HLS segments and same-quality link renewal use the existing downloader.
- Only visible cards are requested, at most two at a time. Scrolling away cancels pending requests, stale results leave the popup, and failed requests are cached briefly to prevent retry loops.

MissAV can require browser verification. Detection first fetches visible video pages with the active page's normal session and falls back to the extension fetcher. If verification is still required, the popup explains that the video must be opened and verified in the browser before retrying. Verification/access checks are not bypassed, and failed requests are not offered as playable files.

The catalogue markup and current packed source format were inspected on the live site. Automated checks use neutral synthetic videos and cover catalogue/player detection, scrolling, real master variants, preview filtering, verification failures and popup enqueue. They do not guarantee every future site change or network response.

## Verification

Run `npm test` for the core regression suite and the bundled background startup check.

Run `npm run test:browser` for the Chrome popup/DOM, webpage range selection, and native worker tests. The selection test clicks endpoints across creator pages, reloads the page, checks popup synchronization and dynamic cards, and verifies that the real background coordinator batches only the selected new videos. The worker tests close and reopen Chrome with the same browser profile, verify pause/close/reopen/resume with expired HTTP 472 links, assert that completed HLS segments are never requested again, and check direct resume output. The browser tests use the Codex bundled Playwright package; set `CODEX_NODE_MODULES` and `CHROME_PATH` to use another local installation. Screenshots are written to `test-results/`. The offscreen media integration test also requires `ffmpeg` and `ffprobe` on PATH; these are test tools only. It verifies deferred source resolution, the task limit, a background restart, automatic 503 retry, expired HLS renewal across worker replacements, MP4 video/audio/duration and discontinuities, playable TS/WebM fallback, and saving again from cache. Run it alone with `npm run test:offscreen`.

The tests use synthetic pages and video data. Account-specific pages, CAPTCHA responses, and creators whose pagination is exposed only through a site-specific JavaScript API require testing with that site. A failed page is reported with partial results retained.

## Compatibility checks

`tests/site-compat.test.mjs` exercises the following extraction/refresh paths and their existing domain aliases. These are reproducible fixture checks, not a claim that every live page on each site works.

| Site family | Checked path |
| --- | --- |
| X / Twitter | Post-scoped API variants, public embed metadata, MP4/GIF/HLS sources, quality selection, video index, stable history and expired MP4 renewal |
| 123av | Embedded player ID/token, stream API, HLS variants, player headers |
| Pornhub | Flashvars, MP4 metadata endpoints, HLS variants |
| XVideos / XNXX | High/Low/HLS player sources |
| XHamster | JSON player sources |
| Redtube | JSON configuration and MP4 metadata endpoints |
| MissAV | Catalogue viewport resolution, packed source assignments, actual HLS variants, player headers, preview filtering and verification handling |
| Tangxin / Rou | Structured sources, cover-based source and HLS API |
| Huangguo | Current-episode API with matching-episode fallback |
| Other sites | HTML5 video/source, JSON-LD, common player fields and observed playback resources |

The existing Huangdou runtime player bridge is retained; generic frame detection supplements it. DRM, DASH/separate-track muxing, live HLS, CAPTCHA/access restrictions and sites with custom encrypted APIs are not universally supported. An HTTP 403 may still require a valid site session or playback on the original page. Cached downloads are preserved when access is denied.

The current unfinished HLS segment may be fetched again after interruption; completed segments are retained. If refreshed playlist contents no longer match the checkpoint, the app reports the change and keeps the cache instead of restarting the download. Old downloads created before durable HLS checkpoints cannot recover segment metadata that was never saved. Existing browser file saves are recovered by download ID.
