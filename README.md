# MediaFlow extension

This folder is the runnable, unpacked browser extension. There is no build step.

## Install v1.0.0

Download the extension ZIP from [GitHub Releases](https://github.com/vishvaa6/mediaflow-extension/releases), extract it into a permanent folder, then enable Developer mode on `chrome://extensions` (Chrome) or `brave://extensions` (Brave). Click **Load unpacked** and select the folder containing `manifest.json`.

To create the release ZIP and checksum locally, run `python scripts/package_release.py`. The browser-ready package is written to `dist/`; tests and generated project maps are excluded.

After changing the files, reload MediaFlow on the browser's Extensions page, then refresh the creator/video tab. Existing queue and history storage is preserved.

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
- Batch resolution expands MP4 metadata endpoints and HLS variants before choosing quality. Batch failures are counted instead of being silently skipped.
- **Cancel batch & downloads** in Profile Videos aborts the resolving request and cancels that creator's queued, paused, active, and final-save batch tasks. Single-video downloads and other creators' batches remain in place. Cancellation also catches enqueues already in progress.
- Detected qualities are sorted by resolution from lowest to highest across formats. Single-video previews use the page's video poster, social metadata, or structured video metadata.
- The History tab retains completed downloads with titles, creator, completion date, quality/format, size, source page, thumbnail URL, and browser download ID. It supports search, file/source actions, and removal. Old history records remain readable. Video-page identities drive **Already downloaded** labels even when stream signatures change.
- **Show thumbnails** in Settings persists across sessions and controls previews in detection, profiles, and history.
- Profile scans select only videos missing from download history. **Select new** excludes completed videos, and background batches recheck history before fetching, enqueuing, and starting queued items. The batch summary reports skipped downloads.
- **Clear results** beside Fetch Videos stops the current scan and removes the saved profile list, page counts and selection. Cleared results stay empty when the popup reopens until Fetch Videos is clicked again. Downloads, history and active batch cancellation controls are preserved.
- **Select range** is available on the creator webpage in the MediaFlow toolbar and in the popup's Profile Videos tab. Click the first video, navigate to another listing page if needed, then click the last video. Both endpoints and all new videos between them are selected in listing order, with **✓ Selected**, **Start**, and **End** labels. The shared selection survives page navigation and popup reopening. **Batch download** waits for the full creator scan and downloads only the selection; already downloaded videos are skipped. Use the tick buttons to adjust individual videos, **Clear** to remove the selection, or **Select new** to restore the default.

## Verification

Run `npm test` for the core regression suite and the bundled background startup check.

Run `npm run test:browser` for the Chrome popup/DOM, webpage range selection, and native worker tests. The selection test clicks endpoints across creator pages, reloads the page, checks popup synchronization and dynamic cards, and verifies that the real background coordinator batches only the selected new videos. The worker tests close and reopen Chrome with the same browser profile, verify pause/close/reopen/resume with expired HTTP 472 links, assert that completed HLS segments are never requested again, and check direct resume output. The browser tests use the Codex bundled Playwright package; set `CODEX_NODE_MODULES` and `CHROME_PATH` to use another local installation. Screenshots are written to `test-results/`.

The tests use synthetic pages and video data. Account-specific pages, CAPTCHA responses, and creators whose pagination is exposed only through a site-specific JavaScript API require testing with that site. A failed page is reported with partial results retained.

## Compatibility checks

`tests/site-compat.test.mjs` exercises the following extraction/refresh paths and their existing domain aliases. These are reproducible fixture checks, not a claim that every live page on each site works.

| Site family | Checked path |
| --- | --- |
| 123av | Embedded player ID/token, stream API, HLS variants, player headers |
| Pornhub | Flashvars, MP4 metadata endpoints, HLS variants |
| XVideos / XNXX | High/Low/HLS player sources |
| XHamster | JSON player sources |
| Redtube | JSON configuration and MP4 metadata endpoints |
| MissAV | Packed HLS IDs, explicit playlists and fallback qualities |
| Tangxin / Rou | Structured sources, cover-based source and HLS API |
| Huangguo | Current-episode API with matching-episode fallback |
| Other sites | HTML5 video/source, JSON-LD, common player fields and observed playback resources |

The existing Huangdou runtime player bridge is retained; generic frame detection supplements it. DRM, DASH/separate-track muxing, live HLS, CAPTCHA/access restrictions and sites with custom encrypted APIs are not universally supported. An HTTP 403 may still require a valid site session or playback on the original page. Cached downloads are preserved when access is denied.

The current unfinished HLS segment may be fetched again after interruption; completed segments are retained. If refreshed playlist contents no longer match the checkpoint, the app reports the change and keeps the cache instead of restarting the download. Old downloads created before durable HLS checkpoints cannot recover segment metadata that was never saved. Existing browser file saves are recovered by download ID.
