# StreamDraft: plan

Milestones only. The current and next milestone are in detail; closed ones are one line each. The full text of M0 to M5 (task lists, results) is in `docs/history/plan-M0-M5.md`; it is not read at session start. Write a milestone's task list when it starts; plans written up front drift. Each task is one pull request, and each milestone ends with an updated `docs/status.md`. Keep this file under 8 KB.

## Closed milestones

- **M0: walking skeleton.** Build, test, package and smoke-test in CI, release path proven with `v0.0.1`. Done 2026-11-02 (PR #1).
- **M1: clickable UI skeleton.** Every screen with mock data, reviewed by the owner. Done 2026-11-06 (PR #2).
- **M2: detection and direct downloads.** Network and DOM detection, downloads API, settings that switch the button and the menu. Done 2026-11-07 (PR #3).
- **M3: HLS, DASH and audio-only.** Manifest parsers, segment fetch, flat MP4 and `.m4a` through OPFS, progress and Cancel, 1.1 GB stream with flat memory. Muxer decision 0004 and 0006. Done 2026-11-12 (PRs #5 to #19, #24).
- **M4: site extractors.** Extractor interface; the YouTube extractor dropped at the gate (decisions 0008, 0009) for a generic player capture, off by default and switchable. Done 2026-11-14 (PRs #25, #26).
- **M5: distribution.** Firefox build signed on AMO (unlisted), update manifest on GitHub Pages, install docs; `v0.1.0` and `v0.1.1`. Decision 0011. Done 2026-11-14 (PRs #27 to #33).

## M6: hardening

Goal: reliable enough for daily use.

Done when: errors reach the user in plain words; cancel and retry work; memory and disk behaviour is checked on long videos; README has the limitations and the legal notice; known issues are filed as GitHub issues.

Product basics, checked against the list in the `newproject` skill (an icon was missing until 0.1.1, so check the rest now): a privacy statement in the README (the manifest already declares that no data is collected), a plain-words reason for the all-sites access, the version visible in the UI, store-listing text if a store listing is ever wanted. Add what is missing.

Out of scope: #21 (the page's `Referer` is not sent). It needs its own decision record and may be larger than hardening; it stays open and is planned separately.

### Tasks

Each task is one pull request. Order matters only for task 1.

1. **Stabilise the Firefox smoke checks (#31, #34).** Find the cause of the 30 s script timeout and of the context-menu entry that does not come back after switching it on; fix the cause, or add one logged retry in the script as the project rules allow. Done when 10 consecutive local Firefox smoke runs pass. If it passes about 60 tool calls with no result, write `docs/spikes/firefox-smoke-flaky.md` and start a fresh session.
2. **Product basics.** Privacy statement and the all-sites reason in the README; version shown in the popup or options page; draft store-listing text in `docs/`; check the rest of the `newproject` list and add what is missing. Done when the README and the UI show each item and `docs/manual/m6.md` lists the checks.
3. **Storage cleanup (#22).** Remove OPFS files left by cancelled or failed jobs; sweep orphaned files when the background starts. Done when a smoke check shows empty storage after a cancel and after a failed job, in both browsers.
4. **Errors in plain words, cancel and retry.** Go through the failure paths: network error, expired or forbidden segment address, unsupported or protected stream, out of disk, tab closed during a job. Each returns a `Result` with a message the user can act on, shown in the popup and the overlay; add Retry where a retry can help. Parameterized tests per failure path.
5. **Segment files listed as videos (#20).** Detect HLS master and multi-period DASH segment files and keep them out of the list. Done when the detection test page has a case for each and its unit tests pass.
6. **Long videos.** Run a multi-GB generated stream (more than the 1.1 GB check) in both browsers and a low-disk case; record memory, disk use and the result in `docs/manual/m6.md`. Fix what the run shows or file it as an issue.
7. **README limitations and close-out.** Limitations and legal notice up to date, remaining known issues filed, `docs/status.md` and this plan updated, release `v0.2.0` with `/release`.

