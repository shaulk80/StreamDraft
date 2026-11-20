# StreamDraft: status

Updated: 2026-11-20. Keep this file under 3 KB. History belongs in git, pull requests and the Releases page, not here.

## Now

M0 to M5 are done; M6 closes with `v0.2.0`. `v0.1.1` (2026-11-14) is the latest release: signed Firefox `.xpi` with automatic updates through GitHub Pages, Chrome zip (manual update), sources zip, checksums. The owner checked install and update in both browsers.  
What works: direct files, HLS and DASH streams are found and listed with qualities and "Audio only", joined into one flat MP4 (or `.m4a`) through OPFS with progress and Cancel; protected streams are listed and never downloaded; a 1.1 GB stream downloads with flat memory. The player capture (decision 0009) records a page's video from page load; it is off by default and switchable globally and per site.  
Hand-test results per milestone: `docs/manual/`. Closed milestones: `docs/plan.md`; their full text: `docs/history/`.

## Next

- M6, hardening: tasks 1 to 6 are merged and hand-tested in both browsers (`docs/manual/m6.md`, groups A to E, E passed 2026-11-20). Task 7 (README Limitations section, stale docs fixed, plan closed in `docs/history/plan-M6.md`) is in the pull request of `feat/m6-closeout`.
- Long videos: both browsers save a 4.5 GB generated stream with flat memory (Firefox +85 MB, Chrome +936 MB), empty storage afterwards, and report a full disk in plain words. The automated Firefox low-disk cut does not work (#45, `docs/spikes/firefox-low-disk.md`); the hand-test with a real small drive covers it. Not tried: a real hour-long video.
- Next: merge that pull request, then `v0.2.0` with `/release 0.2.0` (the owner pushes the tag and publishes the draft). The next milestone has no task list yet (`docs/plan.md`).

## Open

- Issues: #21 (the page's `Referer` is not sent), #45 (Firefox low-disk smoke check). The flaky Firefox smoke checks (#31, #34) are closed by the M6 close-out pull request: CI stayed green on every `main` run since the fix (PR #38).
- Mid-roll ads and real DRM pages with the player capture: not tried, to be learned from real use.
- Gaps of M1 and M2 (no overlay in iframes or fullscreen, no button for `blob:` addresses, the extension asks for all-sites access): `docs/manual-testing.md`, section 5.
- Chrome 137 and later ignore `--load-extension`; the Chrome smoke test uses `Extensions.loadUnpacked`. The right-click menu cannot be operated in headless Chrome and is checked in Firefox only.
