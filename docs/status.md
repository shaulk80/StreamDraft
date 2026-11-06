# StreamDraft: status

Updated: 2026-11-06. Keep this file under 40 lines. History belongs in git and pull requests, not here.

## Now

M0 is done: merged (PR #1), tagged `v0.0.1`, published as a pre-release (2026-11-06), and the Firefox package installed by hand in Developer Edition (icon, popup, no errors). Next: M1 clickable UI skeleton. Create branch `m1`, write its task list in `docs/plan.md`, then build the mock-data screens.

## Releases

| Version | Date | Assets | Notes |
|---|---|---|---|
| v0.0.1 | 2026-11-06 | firefox.zip, chrome.zip, sources.zip, SHA256SUMS.txt | Public pre-release on `a96b6b3` (merge of PR #1). Firefox zip unsigned. Hashes checked by hand and from the public URLs. |

## Open

- Trademark search (USPTO, TMview, WIPO) not done; do before any public promotion.
- Whether to keep the YouTube extractor in v1: decided at the M4 gate.
- Chrome is checked statically only (manifest); a runtime check in Chrome is not built.
- Source-upload option for `web-ext sign` (M5) is unchecked.

## How things are set up

- CI: `build-windows` (windows-2022, Node 26, pnpm from `packageManager`), `release.yml` for tags and dry runs. Both green on GitHub Actions (CI on `main` and the PR, Release dry run and tag run).
- Rulesets (active): `protect-main` (no deletion, no force push, pull request required, status checks required); `protect-release-tags` (`v*` cannot be deleted or moved).
- Verified: GitHub Actions end to end (build, smoke, release with 4 assets, published); release asset hashes match `SHA256SUMS.txt`; on this PC typecheck, lint, 19 unit tests, license check, web-ext lint, packaging, checksums, headless Firefox popup-to-background round trip.
- Verified by hand: `streamdraft-0.0.1-firefox.zip` installs in Firefox Developer Edition (signatures check off), icon and popup work, no errors.
- Not verified: Chrome at runtime, the Firefox/Chrome API assumptions in docs/architecture.md.

## Decisions worth remembering

- See `docs/decisions/`.
