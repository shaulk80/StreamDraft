# StreamDraft: status

Updated: 2026-11-08. Keep this file under 40 lines. History belongs in git and pull requests, not here.

## Now

M1 (clickable UI skeleton, all with mock data) is merged (PR #2): popup, options page, in-page button, right-click entry; settings persist and apply live; the owner reviewed every screen in Firefox, no changes requested. M2 (detection and direct downloads) is built on branch `m2` (pull request open): direct files are found by the network observer and the page scanner, listed per tab in the popup (badge shows the count), and downloaded through the downloads API from the popup, the in-page button and the right-click entry. `.scriptsuild.ps1` passes (266 unit tests, Firefox and Chrome smoke tests). Waiting for the owner's review on the test pages in Firefox and Chrome (`pnpm run testpage`, then `/detect.html`).

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
- Not verified: Chrome with the extension loaded the way a user does it (developer mode, Load unpacked), the right-click entry in Chrome, the other API assumptions in docs/architecture.md.
- Known M2 gaps: the in-page button appears only for a video whose own address is a recognisable file (a `blob:` or extension-less address gets none; the popup still lists what the network observer saw); the downloads API sends cookies but not the page's `Referer`, so hosts that check it refuse; a download that fails after it started (server error) is not reported yet (M6); items found by the network observer take the page title from the tab at that moment.
- Known M1 gaps for the review: no button or toast for videos inside iframes; no overlay in fullscreen; the extension asks for all-sites access (content script on `<all_urls>`).

## Decisions worth remembering

- See `docs/decisions/`.
