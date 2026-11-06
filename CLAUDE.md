# StreamDraft

Browser extension (Firefox primary, Chrome secondary) that downloads videos from the current page. Browser-only, no helper program. Name cleared on 2026-11-02 (docs/decisions/0001-scope-and-name.md).

Your global rules in `~/.claude` (language, code quality, tests, commits, reviews) apply. This file only adds what is specific to this repository.

## Layout

```
entrypoints/        WXT entry points: background, content scripts, popup, options
src/core/           Result type, settings schema, media model (no browser APIs)
src/detect/         Network and DOM media detection
src/formats/        HLS and DASH manifest parsing
src/engine/         Segment fetching, muxing, OPFS storage, download jobs
src/extractors/     Site extractors behind one interface (generic first, YouTube later)
src/ui/             Settings store, popup/options views, in-page overlay, context menu (DOM or storage access behind small interfaces)
tests/              Vitest unit tests; tests/smoke/ loads the packaged build; tests/pages/ is a local test page with videos
scripts/build.ps1   The one build script, used by developers and CI
docs/               status, plan, architecture, decisions, brief
```

## Commands

```
pnpm install --frozen-lockfile        restore
.\scripts\build.ps1                   full pipeline: restore, licenses, typecheck, lint, test, package, checksums, smoke
pnpm run test                         unit tests (one test: pnpm exec vitest run -t "name")
pnpm run dev:firefox                  WXT dev mode with Firefox
pnpm run zip:firefox / zip:chrome     packages into .output/
pnpm run testpage                     serves tests/pages/video.html on http://127.0.0.1:8123/ to try the overlay and the menu by hand
pnpm run smoke                        extracts the packages, loads the Firefox one in headless Firefox (FIREFOX_BIN to choose a binary)
```

## Rules

- Language: TypeScript, strict mode, WXT, Manifest V3, Vitest. `package.json` sets `packageManager` (CI reads it).
- Expected failures (bad manifest, network error, unsupported site) return `Result<T>` with a message; do not throw. Log errors, never swallow them.
- Parameterized tests (`test.each`) for similar cases. No tests for log messages.
- No remotely hosted code and no `eval`: both stores forbid it. All libraries are bundled.
- No DRM circumvention. Protected streams are detected and reported as unsupported.
- No telemetry, no external servers. Network calls go only to the media hosts the user is downloading from.
- Commits: Conventional Commits, `type(scope): summary`, one logical change per commit. Commit per task, not per milestone.
- Tests run in CI on Windows. Coverage is a warning, never a gate.

## Git and CI

- `main` is protected: work on a branch, open a pull request, merge when all checks are green. Claude commits, pushes and opens the PR when told; the owner says when to merge.
- CI: one job, `build-windows` (windows-2022), runs `scripts/build.ps1`. Packages are uploaded from `main` and from `v*` tags.
- Release: `/release <version>`. The owner pushes the `v*` tag and publishes the draft; Claude never does. Firefox signing on AMO (unlisted) joins the release workflow in M5.

## Environment

- Windows 10. Default shell PowerShell 5.1 (scripts must also run on pwsh 7); Git Bash available. Keep `.ps1` files ASCII.
- Installed: git 2.33, gh (logged in as shaulk80), Node 26 (`C:\Service\NodeJs`), pnpm 12 (via `npm install -g pnpm`; Node 26 has no corepack), Firefox and Firefox Developer Edition. NOT installed: winget, pwsh 7, WSL. After an install, refresh PATH in the session from the Machine and User environment variables.

## Gotchas

- Paths: do not hardcode `\` or `/`; sort directory listings; `.gitattributes` forces LF.
- Pin runner images (`windows-2022`, `ubuntu-24.04`), not `-latest`.
- A called workflow shares `github.workflow` with its caller, so `ci.yml` prefixes its concurrency group with `ci-`.
- Chrome MV3 background is a service worker (no DOM); Firefox MV3 background is an event page (has DOM). Both can be stopped at any time: keep state in `storage`, not in variables.
- WXT builds Firefox as Manifest V2 by default; `manifestVersion: 3` is set in `wxt.config.ts`. The output folder must be `.output/firefox-mv3`.
- TypeScript is pinned to 6.0.x because typescript-eslint does not support 7 yet. Check `pnpm peers check` before upgrading.
- PowerShell 5.1 turns native stderr (pnpm echoes each script) into errors under `$ErrorActionPreference = 'Stop'`; `build.ps1` relaxes it around native commands.
- WebDriver cannot navigate to `moz-extension://`; the smoke test opens the popup from browser context (geckodriver `--allow-system-access`).
- The sources zip is built from the working tree; `zip.excludeSources` keeps `coverage/` and `dist/` out.

## Definition of done

- Build has no warnings; tests pass in CI.
- The changed feature was run (loaded in Firefox, or a smoke/integration test), and the summary lists what was exercised.
- PR description: what, why, test plan. `docs/status.md` updated in 2 to 5 lines.
- No TODO without an issue.

## Where to look

- `docs/status.md` - current state and next step. Start here.
- `docs/plan.md` - milestones and their Definition of Done.
- `docs/architecture.md` - components and the open technical questions.
- `docs/decisions/` - one short file per decision.
- GitHub Issues - bugs and backlog.
