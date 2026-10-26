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

The 60-test core/site fixture suite and background startup check pass. Previous Chrome checks covered detection, creator ranges, and browser restart/resume. The latest Clear results browser check has not been run because local Chrome-test permission was declined.

Compatibility checks use synthetic fixtures, not every live page. DRM-protected media, DASH/separate-track muxing, live HLS, CAPTCHA/access restrictions, and custom encrypted player APIs are not universally supported. See the README for compatibility details.
