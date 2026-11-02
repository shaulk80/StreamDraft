# StreamDraft: status

Updated: 2026-11-02. Keep this file under 40 lines. History belongs in git and pull requests, not here.

## Now

Project set up, nothing built. Next: M0 walking skeleton (docs/plan.md). Node.js and pnpm must be installed first (see CLAUDE.md, Environment).

## Releases

| Version | Date | Assets | Notes |
|---|---|---|---|
| (none yet) | | | |

## Open

- Add-on ID for the manifest (proposed `streamdraft@shaulk80.github.io`), confirm in M0.
- Trademark search (USPTO, TMview, WIPO) not done; do before any public promotion.
- Whether to keep the YouTube extractor in v1: decided at the M4 gate.

## How things are set up

- CI: `build-windows` (windows-2022), `release.yml` for tags and dry runs.
- Branch protection: not set up (GitHub repo does not exist yet).
- Verified: nothing has been run.
- Not verified: CI workflows, `scripts/build.ps1`, release workflow, WXT and web-ext behaviour, all Firefox/Chrome API assumptions in docs/architecture.md.

## Decisions worth remembering

- See `docs/decisions/`.
