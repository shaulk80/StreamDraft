# StreamDraft: status

Updated: 2026-11-13. Keep this file under 40 lines. History belongs in git and pull requests, not here.

## Now

M0 to M3 are done and merged. M3 (HLS, DASH, audio-only) met its Definition of Done on 2026-11-12: the owner checked it by hand in Firefox and Chrome (results per group in `docs/manual-testing.md`, section 6), CI is green.
What works: direct files, HLS and DASH streams are found and listed with their qualities and "Audio only"; a stream is fetched, joined into one flat MP4 (or an `.m4a`) through OPFS with progress and Cancel and saved through the downloads API; protected streams are listed as protected and never downloaded; a 1.1 GB stream downloads with flat memory. A manifest is read as soon as it is found and the files it names are not listed as videos (decision 0007).
M4 (branch `m4-site-extractors`, plan in `docs/plan.md`): decision 0008 found that YouTube's page gives no address to download; decision 0009 (owner, 2026-11-13) drops the YouTube extractor and goes for a generic player capture as an experiment, off by default and switchable globally and per site. Done and committed: extractor interface (task 1), MAIN-world reader (2), YouTube findings (3). Switches (task 5) committed. Task 6 (spikes, decision 0010): the automated part works in both browsers (hook timing, codec hiding, EME sight, buffer emptying; the way out for large data is the page's OPFS, not `runtime` messages), not yet committed. The owner's check on real YouTube is in: hook, codec hiding and H.264 fallback work, EME is not used, but emptying the player's buffers breaks it, so a recording must start from page load (the popup arms the tab and reloads it). The `speed` check passed in Firefox: YouTube kept 8 and 16 times speed (232 s of video in 15 s at 16). Second gate: build (owner, 2026-11-13). Task 7 (hook and capture core, `src/extractors/capture/`) done with unit tests, not yet committed; not wired to the content script and not run in a browser until tasks 8 and 9. Untested, to be checked at the end: ads (the owner blocks them), long runs, Chrome.
Known gaps of M3 are GitHub issues #20 to #23 and the list in `docs/manual-testing.md`, section 7.

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
- Verified by hand in M3 (owner, Firefox and Chrome, same results, 2026-11-12): all pages pass, saved video and `.m4a` play in Firefox, WMP and VLC, a Firefox private window works. The Shaka demo (DRM test assets) found 50 segment cards and a wrong badge; fixed in PR #17 (decision 0007) and re-checked by the owner. Results per group and what is still open: `docs/manual-testing.md`, section 6.
- Not verified: a real video from a site without sound (no public example; the generated `/silent.html` passed by hand in both browsers and in both smoke tests), MAIN-world scripts (M4). The Chrome offscreen document and the storage left after a download were checked by hand (2026-11-12).
- Known M3 gaps (issues): segment files of an HLS master or multi-period DASH can be listed (#20); the page's `Referer` is not sent (#21); 2.2 GB left in storage once after a Firefox job (#22); Firefox can interrupt one of two same-name downloads started in one instant (#23).
- Known M2 gaps: the in-page button appears only for a video whose own address is a recognisable file (a `blob:` or extension-less address gets none; the popup still lists what the network observer saw); the downloads API sends cookies but not the page's `Referer`, so hosts that check it refuse; a download that fails after it started (server error) is not reported yet (M6).
- Known M1 gaps for the review: no button or toast for videos inside iframes; no overlay in fullscreen; the extension asks for all-sites access (content script on `<all_urls>`).
- Decisions worth remembering: `docs/decisions/`.
