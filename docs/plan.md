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

## M3: HLS, DASH and audio-only

Goal: streamed videos become a single playable file.

Done when: a short spike decides the muxer (own code with mux.js/mp4box.js, or ffmpeg.wasm) and the disk-backed storage (OPFS) with a recorded decision; HLS and DASH manifests are parsed, quality selectable, segments fetched with retries and progress, output plays in a normal player; audio-only extraction works; a file larger than 1 GB downloads without running out of memory.

## M4: site extractors (YouTube first) with a go/no-go gate

Goal: one extractor interface and one working site extractor, or an explicit decision not to ship it.

Done when: the extractor interface is in place and the generic detector uses it; the YouTube extractor works for ordinary public videos, or the owner decides at the gate (store policy, upkeep cost, reviewer risk) to drop it and records that.

## M5: distribution

Goal: a user can install from GitHub Releases and receive updates.

Done when: `release.yml` signs the Firefox build on AMO as unlisted using repository secrets (skipped with a warning when secrets are missing); `update_url` and the update manifest are hosted; the release carries signed `.xpi`, Chrome zip, sources zip and `SHA256SUMS.txt`; the install steps for both browsers are in the README; first real release `0.1.0`.

## M6: hardening

Goal: reliable enough for daily use.

Done when: errors reach the user in plain words; cancel and retry work; memory and disk behaviour is checked on long videos; README has the limitations and the legal notice; known issues are filed as GitHub issues.
