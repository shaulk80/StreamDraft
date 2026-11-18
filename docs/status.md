# StreamDraft: status

Updated: 2026-11-18. Keep this file under 3 KB. History belongs in git, pull requests and the Releases page, not here.

## Now

M0 to M5 are done. `v0.1.1` (2026-11-14) is the latest release: signed Firefox `.xpi` with automatic updates through GitHub Pages, Chrome zip (manual update), sources zip, checksums. The owner checked install and update in both browsers.  
What works: direct files, HLS and DASH streams are found and listed with qualities and "Audio only", joined into one flat MP4 (or `.m4a`) through OPFS with progress and Cancel; protected streams are listed and never downloaded; a 1.1 GB stream downloads with flat memory. The player capture (decision 0009) records a page's video from page load; it is off by default and switchable globally and per site.  
Hand-test results per milestone: `docs/manual/`. Closed milestones: `docs/plan.md`; their full text: `docs/history/`.

## Next

- M6, hardening: the task list is in `docs/plan.md` (7 tasks, including the product-basics check). #21 (`Referer`) is left out of M6.
- Done, hand-tests A to D pass in both browsers: task 1 (flaky smoke checks #31, #34), task 2 (product basics), task 3 (storage cleanup #22, PRs #40, #41; the cause of the original 2.2 GB is still not proven), task 4 (plain-words errors in `src/core/failures.ts`, "Try again"; the overlay has no job panel and the context-menu toast never reports a later failure), task 5 (segment files #20, PR #43, decision 0007 addendum).
- Task 6, long videos: in progress on `feat/long-videos`. A 4.5 GB generated stream (`/huge.html`, `SMOKE_LARGE=huge`) and a low-disk check (`SMOKE_LOW_DISK=1`, opt-in, not in CI). Both browsers save 4.5 GB intact with storage empty afterwards (Firefox memory +85 MB, Chrome +936 MB); the low-disk check passes in Chrome. Open: the Firefox low-disk cut (`docs/spikes/firefox-low-disk.md`). Hand-test E (`docs/manual/m6.md`) is deferred until after `v0.2.0` (owner decision, 2026-11-18).

## Open

- Issues: #20 (segment files of an HLS master or multi-period DASH can be listed), #21 (the page's `Referer` is not sent), #22 (2.2 GB left in storage once after a Firefox job), #31 and #34 (flaky Firefox smoke checks; close them when CI has stayed green for a few runs).
- Mid-roll ads and real DRM pages with the player capture: not tried, to be learned from real use.
- Gaps of M1 and M2 (no overlay in iframes or fullscreen, no button for `blob:` addresses, the extension asks for all-sites access): `docs/manual-testing.md`, section 5.
- Chrome 137 and later ignore `--load-extension`; the Chrome smoke test uses `Extensions.loadUnpacked`. The right-click menu cannot be operated in headless Chrome and is checked in Firefox only.
