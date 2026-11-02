# StreamDraft: status

Updated: 2026-11-02. Keep this file under 40 lines. History belongs in git and pull requests, not here.

## Now

M0 walking skeleton is built on branch `m0` and `.\scripts\build.ps1` passes locally (not committed yet). Next: commit, push `m0`, open the PR, watch `build-windows`, then apply the rulesets, merge, dry run and tag `v0.0.1`.

## Releases

| Version | Date | Assets | Notes |
|---|---|---|---|
| (none yet) | | | |

## Open

- Trademark search (USPTO, TMview, WIPO) not done; do before any public promotion.
- Whether to keep the YouTube extractor in v1: decided at the M4 gate.
- Chrome is checked statically only (manifest); a runtime check in Chrome is not built.
- Source-upload option for `web-ext sign` (M5) is unchecked.

## How things are set up

- CI: `build-windows` (windows-2022, Node 26, pnpm from `packageManager`), `release.yml` for tags and dry runs.
- Branch protection: not set up (apply after the first green CI run on the `m0` PR).
- Verified: on this PC (Windows PowerShell 5.1, Node 26.13, pnpm 12.16, Firefox Developer Edition/Release): typecheck, lint, 19 unit tests, license check, web-ext lint (0 errors, 0 warnings), packaging, checksums, headless Firefox popup-to-background round trip.
- Not verified: anything on GitHub Actions (pwsh 7, Firefox and geckodriver on the runner), `release.yml`, Chrome at runtime, all Firefox/Chrome API assumptions in docs/architecture.md.

## Decisions worth remembering

- See `docs/decisions/`.
