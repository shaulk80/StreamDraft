# StreamDraft: plan

Milestones only. Write a milestone's task list when it starts; plans written up front drift. Each milestone ends with a merged pull request and an updated `docs/status.md`.

## M0: walking skeleton (fixed)

Goal: an extension that builds, tests, packages and smoke-tests in CI, with the release path proven while the code is one file.

Done when:
- WXT project with a background script, a popup that says "StreamDraft", one unit test, `packageManager` set, Firefox add-on ID in the manifest.
- `scripts/build.ps1` passes locally and in the `build-windows` job; the smoke test loads the packaged Firefox build and sees the background start.
- GitHub repo created, rulesets applied after the first CI run, a pull request merged through the protected `main`.
- `v0.0.1` pre-release produced by `release.yml` (dry run first, then the tag, then the draft is checked and published by the owner).
- The first Firefox load in Developer Edition by hand, to learn what the install flow looks like.

## M1: clickable UI skeleton

Goal: the owner reviews every screen with mock data before any real logic exists.

Done when: popup (list of detected videos, quality picker, download button), in-page button overlay on a test page, context-menu entry, and options page (toggle in-page button, toggle context menu, filename template, default quality) are all clickable with fake data; the owner has reviewed and listed changes; settings persist and apply live.

Tasks (written 2026-11-06, work in this order, one commit per task):
1. Core model: settings schema with defaults and forgiving validation, filename template check and rendering, media model and the mock videos the screens use (`src/core`, unit tests).
2. Settings store over `storage.sync` (falls back to `local`) with a change listener, behind a small storage-area interface so it tests without a browser.
3. Options page: the two toggles, filename template with live preview and error text, default quality; saves on change.
4. Popup: list of the mock videos for the tab, quality picker per video, download button (fake: shows the filename it would use); empty and unsupported (protected) states.
5. Content script and a static test page (`tests/pages/`): in-page button overlay in a Shadow DOM over each `<video>`, shown or hidden live by the setting.
6. Background context-menu entry on video, added or removed live by the setting; click shows the fake download.
7. Smoke test extended (popup lists mock items, options page loads); `docs/status.md` updated; pull request; owner reviews every screen and lists changes in the PR.

## M2: detection and direct downloads

Goal: real videos found and downloaded.

Done when: network and DOM detection find direct mp4/webm files and list them per tab; the download starts through the downloads API with the filename template; settings really switch the button and the menu; works in Firefox and in the Chrome zip build on a set of test pages.

Tasks (written 2026-11-07, work in this order, one commit per task):
1. Core: `MediaItem` gets the source `url`; classify a response or element as a direct file (content type `video/*`, `audio/*`, extension fallback for `.mp4`, `.webm`, `.m4a`, `.mp3`), derive title and site, drop tiny files (tracking pixels, ads) and dedupe by URL (`src/detect`, unit tests). HLS and DASH are recognised but not listed until M3.
2. Per-tab registry: add, list and clear on navigation, kept in `storage.session` behind a small storage-area interface so it tests without a browser; capped per tab.
3. Network observer in the background: `webRequest.onHeadersReceived`, observe only, feeds the registry. Adds the `webRequest` permission and all-sites host access; record the permission choice in `docs/decisions/`.
4. DOM scanner in the content script: `<video>`, `<audio>` and `<source>` with `src`/`currentSrc`, mutation-watched; reports to the background. `blob:` sources are skipped (MSE, M3).
5. Popup shows the real items of the current tab (the mock list stays behind `?mock=` for review); toolbar badge shows the count; empty state when nothing is found.
6. Download: `downloads` permission, `downloads.download` with the filename template and the chosen quality, errors returned as `Result` and shown in the popup. Known limit to document: the downloads API sends cookies but not the page's `Referer`, so hosts that check it will refuse.
7. Overlay and context menu use the real items: the overlay resolves its item from the video's source, the menu click uses `info.srcUrl` and falls back to the tab's registry; both start the real download; the two settings still switch them live.
8. (Done second, right after task 5, to test detection early.) Test pages and smoke: `tests/pages/` serves small mp4 and webm files (a page with `<video src>`, one with `<source>`, one fetching a file the network observer sees but the DOM does not); smoke test extended to check the popup lists them.
9. Chrome: build the zip and check it with a runtime check if a Chrome binary exists, otherwise list the manual steps for the owner; fix what differs (service worker lifetime, `webRequest` in MV3). Done as `tests/smoke/chrome-smoke.ts` (headless Chrome over the DevTools protocol).
10. `docs/status.md` updated, pull request, owner reviews on the test pages in Firefox and Chrome.

## M3: HLS, DASH and audio-only

Goal: streamed videos become a single playable file.

Done when: a short spike decides the muxer (own code with mux.js/mp4box.js, or ffmpeg.wasm) and the disk-backed storage (OPFS) with a recorded decision; HLS and DASH manifests are parsed, quality selectable, segments fetched with retries and progress, output plays in a normal player; audio-only extraction works; a file larger than 1 GB downloads without running out of memory.

Tasks (written 2026-11-07, work in this order, one commit per task):
1. Spike, storage and hand-off: in Firefox and Chrome check that an extension page can write a large file to OPFS, and that `downloads.download` accepts a Blob URL made from that file without loading it into memory. Chrome needs an offscreen document, Firefox does not. Record the result and the engine host design in `docs/decisions/0003-storage-and-engine-host.md`. Done: both work at 1.5 GiB with flat memory.
2. Spike, muxer: with a small TS-segment HLS sample and a fragmented-MP4 DASH sample, try mux.js and mp4box.js (bundled, no remote code); check licenses with `pnpm run check:licenses`, bundle size, memory, and that the output plays. ffmpeg.wasm only if both fail. Record the choice in `docs/decisions/0004-muxer.md`. Done: mux.js for TS plus own box-level code for fMP4, output is a flat MP4 (fragmented files froze in VLC; the owner checked the flat ones in Firefox, WMP and VLC).
3. Core: `MediaItem` gets stream qualities (bandwidth, resolution, codecs, audio-only flag) and a `protected` reason; `Result` errors for unsupported manifests (`src/core`, unit tests).
4. HLS parser (`src/formats`): master and media playlists, relative URLs, byte ranges, init segments, AES-128 key info; SAMPLE-AES and DRM key formats reported as protected, never downloaded. Fixtures from real-looking playlists, `test.each`. Done: `src/formats/hls*.ts` (`parseHlsPlaylist` returns a master or media playlist as a `Result`; a protected playlist keeps `protectedReason` and lists no segments); `drm.ts` and `resolve-url.ts` are shared with the DASH parser.
5. DASH parser (`src/formats`): static MPD with `SegmentTemplate`, `SegmentTimeline`, `SegmentList` and `BaseURL`; video and audio adaptation sets; `ContentProtection` reported as protected. Done: `src/formats/dash*.ts` and an own XML reader (`xml.ts`, decision 0005; `DOMParser` is missing in the Chrome service worker and in Node). `parseDashManifest` returns video and audio representations with init segment and segment list as a `Result`; one period only (several periods give an error); a `SegmentBase` file is one segment that starts after the index and runs to the end of the file (the engine splits it if it needs to).
6. Detection: the network observer and the page scanner list `.m3u8` and `.mpd` as streams (until now only recognised), fetch and parse the manifest lazily when the popup opens, show qualities. Done: `classifyCandidate` gives a stream item without qualities; the popup asks the background (`resolve-streams`), `StreamResolver` (`src/detect`) fetches each manifest with the user's cookies (5 MB and 15 s limits), parses it and stores the qualities, the protection or the error on the item; the playlists of a master's renditions are `partUrls`, dropped and never listed. Live streams give an error for now. Test page `/streams.html` and a check in both smoke tests; the Download button of a stream still says it cannot download yet (tasks 7 to 9).
7. Engine core (`src/engine`): segment fetcher with limited concurrency, retries with backoff, progress and cancel; storage behind a small interface (OPFS in the browser, memory in tests); job state in `storage.local` so a suspended background can resume reporting. Done: `src/engine/segment-fetcher.ts` (cookies, per-attempt timeout, exponential backoff; 408, 425, 429 and 5xx are retried, other 4xx are final; byte ranges, also when the server ignores them), `segment-job.ts` (`runSegmentJob`: limited concurrency, progress, cancel through an `AbortSignal`, first failure aborts the rest and names the segment, segments already stored are skipped so a run can continue), `segment-store.ts` (the interface) with `opfs-store.ts` (one OPFS folder per job, a segment is visible only when complete) and a memory store in `tests/engine/`, `job-state.ts` (`JobStateStore` in `storage.local`, `JobProgressReporter` saves at most twice a second and always the final state, in order). Not wired to anything yet: task 9 does that.
8. Muxing (decisions 0003 and 0004): HLS TS through mux.js with gop-fusion duplicates dropped; DASH and fMP4 merged by own box code; the result is a flat MP4 (sample tables built while muxing, so no second copy); `.m4a` wrapper for raw ADTS audio; AES-128 decryption through `crypto.subtle`; output written to OPFS. Unit tests use small fixtures and check that distinct presentation times equal the sample count. Done (decision 0006): `src/engine/mp4/` (box helpers, init and fragment readers, `FlatMp4Writer` with the sample tables built while writing, ADTS wrapper), `ts-segment-muxer.ts` (mux.js plus the duplicate trim), `segment-decryptor.ts`, `fragment-sources.ts` and `mux-job.ts` (`muxStreams`: one or more streams joined segment by segment, video and audio alternating), `opfs-sink.ts` (output file in the job folder). The movie box is written last so the file is written once; the owner still has to check such a file in VLC and Windows Media Player. Checked on real bipbop (TS, ADTS) and Big Buck Bunny (DASH) segments in headless Chrome and Firefox. Audio-only from a stream with video (task 10) will drop the video track in the writer; not wired to any entry point yet (task 9).
9. Engine host: one interface; Firefox runs in the background page, Chrome in an offscreen document; the finished file goes to `downloads.download` through a Blob URL, cleaned up after.
10. Audio-only: extract the audio track of a stream or download an audio-only rendition as `.m4a`; popup offers it next to the qualities.
11. Popup: real quality picker for streams, progress bar, cancel, error text in plain words.
12. Test pages and smoke: local HLS and DASH sample streams under `tests/pages/` (small, generated or checked in), smoke tests download and check the output with `ffprobe` when present, otherwise by the MP4 box structure.
13. Large file check: a generated stream over 1 GB, memory stays flat (measured and written in the PR); `docs/manual-testing.md` and `docs/status.md` updated; pull request; owner reviews in Firefox and Chrome.

## M4: site extractors (YouTube first) with a go/no-go gate

Goal: one extractor interface and one working site extractor, or an explicit decision not to ship it.

Done when: the extractor interface is in place and the generic detector uses it; the YouTube extractor works for ordinary public videos, or the owner decides at the gate (store policy, upkeep cost, reviewer risk) to drop it and records that.

## M5: distribution

Goal: a user can install from GitHub Releases and receive updates.

Done when: `release.yml` signs the Firefox build on AMO as unlisted using repository secrets (skipped with a warning when secrets are missing); `update_url` and the update manifest are hosted; the release carries signed `.xpi`, Chrome zip, sources zip and `SHA256SUMS.txt`; the install steps for both browsers are in the README; first real release `0.1.0`.

## M6: hardening

Goal: reliable enough for daily use.

Done when: errors reach the user in plain words; cancel and retry work; memory and disk behaviour is checked on long videos; README has the limitations and the legal notice; known issues are filed as GitHub issues.
