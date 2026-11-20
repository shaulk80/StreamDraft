# Spike: cutting the extension's storage room in Firefox (M6 task 6)

Written 2026-11-18 after about 60 tool calls on task 6. Start a fresh session from here.

## Goal

The low-disk case of task 6 needs a job to fail with the full-disk words (`DISK_FULL` in `src/core/failures.ts`) without writing hundreds of GB. The smoke check `tests/smoke/low-disk.ts` (opt-in, `SMOKE_LOW_DISK=1`) cuts the room of the extension to 256 MiB, presses Download on the 1.1 GiB stream, expects "Could not save the video." plus the `DISK_FULL` text, no saved file, no leftover storage and a "Try again" button; then it restores the room, presses "Try again" and expects the whole file.

## Chrome

`Storage.overrideQuotaForOrigin` on the popup page session (`chromeRoom` in `tests/smoke/chrome-smoke.ts`). Run on 2026-11-18 with `SMOKE_LOW_DISK=1`: **passes**, including "Try again" saving the whole 1.1 GiB stream afterwards.

## Firefox: what was tried

| Try | Result |
|---|---|
| `Services.prefs.setIntPref('dom.quotaManager.temporaryStorage.fixedLimit', KB)` from browser context while the browser runs (KB = room x 5, as a group may use 20 % of the limit) | The job saved the whole file: the limit is read when the quota manager starts, not live. |
| Same, then `Services.qms.reset()` | `NS_ERROR_UNEXPECTED`: reset works only with `dom.quotaManager.testing` true. |
| Set `dom.quotaManager.testing` true first, then the limit, then `Services.qms.reset()`, wait 2 s | The run did not end within 10 minutes (stopped by hand), somewhere after "job display" and before the low-disk result. Unknown whether `reset()` stalled the extension's storage or the job never failed. |

## Next steps (suggested)

1. Run the low-disk step alone with progress logging, to see which of the two it is (add a `console.log` before and after `room.cut`, and poll the popup text).
2. If a live reset is not usable: start Firefox with the pref in the profile (`options.setPreference(...)` in `tests/smoke/smoke.ts`) in a separate run, test the failure half only, and check the retry half in Chrome and by hand.
3. Do not spend more than about 20 tool calls; a hand test (a small RAM disk or VHD as the profile drive, needs the owner) is the fallback and goes into `docs/manual/m6.md` group E.

## Outcome (2026-11-20)

The fallback was used: the owner downloaded the 4.5 GB stream to a drive with too little room, in both browsers. Firefox gave the full-disk words, and saved no half file (`docs/manual/m6.md`, group E). The automated Firefox cut stays unsolved and is not needed for `v0.2.0`; pick the steps above up only if the check is wanted in a regular run.

## State of the rest of task 6 (uncommitted on `feat/long-videos`)

- `tests/pages/large-stream.ts`: two profiles, `large` (1.1 GiB) and `huge` (288 segments, 4.5 GiB, past 4 GiB); `huge.html`; the server route; unit tests per profile pass.
- `tests/smoke/large-stream.ts`: `SMOKE_LARGE=1|huge|all`; the saved file is checked through file reads (no 2 GiB limit of `readFileSync`), using `readMovie` added to `tests/engine/flat-mp4-reader.ts`.
- Firefox, `SMOKE_LARGE=huge`, Firefox ESR 153: 4613 MiB saved in 71 s, browser memory +97 MiB, extension storage 1 MiB after 6 s. The file check then failed in the test (head read too short, 32 bytes for `ftyp` plus `mdat`); fixed by reading 256 bytes; re-run: Firefox 4613 MiB in 70 s, memory +85 MiB, passes.
- Chrome, `SMOKE_LARGE=huge`: 4613 MiB in 90 s, memory +936 MiB (a renderer), storage 0 MiB, file intact. The memory limit of the check now grows with the file (a third of it, at least 768 MiB), because 902 to 936 MiB is a fifth of the file and the old fixed limit was tuned on files up to 2 GiB.
