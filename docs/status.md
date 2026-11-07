# StreamDraft: status

Updated: 2026-11-08. Keep this file under 40 lines. History belongs in git and pull requests, not here.

## Now

M2 (detection and direct downloads) is merged (PR #3): direct mp4/webm/mp3 files are found, listed per tab and downloaded; the owner checked it in Firefox and Chrome. M3 (HLS, DASH, audio-only) is in progress on branch `m3`: the task list is in `docs/plan.md`; tasks 1 to 3 are done. The spikes are decided: OPFS plus a Blob URL for storage and hand-off (`docs/decisions/0003-storage-and-engine-host.md`); mux.js for TS, own box code for fMP4, output is a flat MP4 because VLC froze on fragmented files (`docs/decisions/0004-muxer.md`). Core has the stream variant model and the quality ladder. Next: task 4, the HLS parser.

## Releases

| Version | Date | Assets | Notes |
|---|---|---|---|
| v0.0.1 | 2026-11-06 | firefox.zip, chrome.zip, sources.zip, SHA256SUMS.txt | Public pre-release on `a96b6b3` (merge of PR #1). Firefox zip unsigned. Hashes checked by hand and from the public URLs. |

## Open

- Trademark search (USPTO, TMview, WIPO) not done; do before any public promotion.
- Whether to keep the YouTube extractor in v1: decided at the M4 gate.
- Chrome 137 and later ignore `--load-extension`; the Chrome smoke test loads the folder with the DevTools command `Extensions.loadUnpacked`. The right-click menu cannot be operated in headless Chrome and is checked in Firefox only.
- Source-upload option for `web-ext sign` (M5) is unchecked.

## How things are set up

- CI: `build-windows` (windows-2022, Node 26, pnpm from `packageManager`), `release.yml` for tags and dry runs. Both green on GitHub Actions (CI on `main` and the PR, Release dry run and tag run).
- Rulesets (active): `protect-main` (no deletion, no force push, pull request required, status checks required); `protect-release-tags` (`v*` cannot be deleted or moved).
- Verified: GitHub Actions end to end (build, smoke, release with 4 assets, published); release asset hashes match `SHA256SUMS.txt`; on this PC typecheck, lint, 19 unit tests, license check, web-ext lint, packaging, checksums, headless Firefox popup-to-background round trip.
- Verified by hand: M1 screens (popup, options, in-page button, right-click entry) reviewed by the owner in Firefox, no changes; `streamdraft-0.0.1-firefox.zip` installs in Firefox Developer Edition (signatures check off), icon and popup work, no errors.
- Verified in M2 (smoke tests, real Firefox and real Chrome 157, headless): the network observer (`webRequest`, also in the Chrome service worker) and the page scanner list the same five files of the test page and skip the 2 KB one; the popup, the in-page button and (Firefox) the right-click entry save the file under the template name with the right size.
- Verified by hand in M2 (owner): the M2 checklist in Firefox Developer Edition (add-on installed from the zip, settings survive a restart) and in Chrome (Load unpacked), including the right-click entry in Chrome.
- Verified in the M3 spikes (Firefox 160 and Chrome 157, headless): 1.5 GiB through OPFS and a Blob URL to the downloads API with flat memory; the muxed samples play in Firefox, Windows Media Player and VLC (owner) once written as a flat MP4.
- Not verified: Firefox private windows (OPFS), the Chrome offscreen document on long jobs, MAIN-world scripts (M4).
- Known M2 gaps: the in-page button appears only for a video whose own address is a recognisable file (a `blob:` or extension-less address gets none; the popup still lists what the network observer saw); the downloads API sends cookies but not the page's `Referer`, so hosts that check it refuse; a download that fails after it started (server error) is not reported yet (M6).
- Known M1 gaps for the review: no button or toast for videos inside iframes; no overlay in fullscreen; the extension asks for all-sites access (content script on `<all_urls>`).

## Decisions worth remembering

- See `docs/decisions/`.
