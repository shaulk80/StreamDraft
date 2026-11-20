# StreamDraft: plan, M6

The full text of M6 as it stood when the milestone closed (2026-11-20). The one-line summary is in `docs/plan.md`.

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
6. **Long videos.** Run a multi-GB generated stream (more than the 1.1 GB check) in both browsers and a low-disk case; record memory, disk use and the result in `docs/manual/m6.md`. Fix what the run shows or file it as an issue. Done: both browsers save 4.5 GB with flat memory and empty storage; the hand-test (group E in `docs/manual/m6.md`) passed in both browsers on 2026-11-20. The Firefox low-disk smoke check stays unsolved (the hand-test with a real small drive covers it).
7. **README limitations and close-out.** Limitations and legal notice up to date, remaining known issues filed, `docs/status.md` and this plan updated, release `v0.2.0` with `/release`.

