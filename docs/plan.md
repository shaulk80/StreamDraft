# StreamDraft: plan

Milestones only. The current and next milestone are in detail; closed ones are one line each. The full text of M0 to M5 (task lists, results) is in `docs/history/plan-M0-M5.md`; it is not read at session start. Write a milestone's task list when it starts; plans written up front drift. Each task is one pull request, and each milestone ends with an updated `docs/status.md`. Keep this file under 8 KB.

## Closed milestones

- **M0: walking skeleton.** Build, test, package and smoke-test in CI, release path proven with `v0.0.1`. Done 2026-11-02 (PR #1).
- **M1: clickable UI skeleton.** Every screen with mock data, reviewed by the owner. Done 2026-11-06 (PR #2).
- **M2: detection and direct downloads.** Network and DOM detection, downloads API, settings that switch the button and the menu. Done 2026-11-07 (PR #3).
- **M3: HLS, DASH and audio-only.** Manifest parsers, segment fetch, flat MP4 and `.m4a` through OPFS, progress and Cancel, 1.1 GB stream with flat memory. Muxer decision 0004 and 0006. Done 2026-11-12 (PRs #5 to #19, #24).
- **M4: site extractors.** Extractor interface; the YouTube extractor dropped at the gate (decisions 0008, 0009) for a generic player capture, off by default and switchable. Done 2026-11-14 (PRs #25, #26).
- **M5: distribution.** Firefox build signed on AMO (unlisted), update manifest on GitHub Pages, install docs; `v0.1.0` and `v0.1.1`. Decision 0011. Done 2026-11-14 (PRs #27 to #33).
- **M6: hardening.** Stable smoke checks, product basics, storage cleanup, plain-words errors with "Try again", segment files kept out of the list, a 4.5 GB stream in both browsers, README limitations; hand-tests A to E pass in both browsers. Release `v0.2.0`. Full plan: `docs/history/plan-M6.md`. Open: #21 (`Referer`), #45 (Firefox low-disk smoke check).

## Next

The next milestone has no task list yet. Candidates, to be chosen by the owner after `v0.2.0` and some real-life use: #21 (the page's `Referer`, needs its own decision record), a real hour-long video, Chrome store listing, the overlay job panel. Write the task list when the milestone starts.
