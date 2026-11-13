# M3 spikes (reference, not product code)

Throwaway scripts from the M3 spikes, kept so task 8 (muxing) and the parser tests have something to start from. They are not linted, not type-checked and not part of any build. The results and the reasoning are in `docs/decisions/0003-storage-and-engine-host.md` and `docs/decisions/0004-muxer.md`.

They were run from a folder `spikes/<name>/` at the repository root (git-ignored), so `storage/run.ts` and `muxer/play-check.ts` import `../../tests/smoke/cdp.ts`; adjust the path if you run them from here. The muxer scripts need `mux.js@6.3.0` and `mp4box@2.5.0` installed next to them (`pnpm add mux.js@6.3.0 mp4box@2.5.0` in a scratch folder). The media segments they were run on are not stored here; see `samples/` for the sources.

## `storage/` (decision 0003)

A tiny extension (`ext/`, plain JavaScript, one manifest per browser) that writes a deterministic file to OPFS and hands it to `downloads.download` as a Blob URL, in an extension page, in the Firefox background page, and in a Chrome offscreen document. `run.ts <firefox|chrome> <MiB> [modes]` loads it in headless Firefox (geckodriver) or Chrome (DevTools protocol), checks the saved file by SHA-256 and samples the browser's memory.

## `muxer/` (decision 0004)

| Script | What it does |
|---|---|
| `hls-mux.mjs` | mux.js TS to fragmented MP4, one segment at a time (the plain version with the gop-fusion duplicates). |
| `hls-mux2.mjs` | The same with the duplicate samples trimmed using `prependedContentDuration`; `REPEAT=60` feeds the segments 60 times for the memory check. |
| `merge-own.mjs` | Merges a DASH video and audio stream (init plus fMP4 segments) into one fragmented MP4 by box-level code. |
| `flatten.mjs` | Rewrites a fragmented MP4 as a flat MP4 (full sample tables first, one `mdat`); the output the owner checked in VLC. |
| `fix-durations.mjs` | Patches the real durations into a fragmented file in place (the first plan, replaced by `flatten.mjs`). |
| `boxes.mjs`, `frag-times2.mjs`, `pts-unique.mjs`, `ts-pts.mjs` | Inspectors: box structure, fragment start and length, unique presentation times (duplicate frames), PTS values in raw TS. |
| `mp4box-parse.mjs` | Reads a file with mp4box.js as an independent check. |
| `strip-id3.mjs` | Concatenates ADTS `.aac` segments without their ID3 tags. |
| `play-check.ts` | Plays files in headless Chrome or Firefox over HTTP with Range requests: duration, seek, audio, play to the end. |

## `samples/`

Manifests only (small text files), from public test streams:

| File | Source | Shows |
|---|---|---|
| `apple-bipbop-master.m3u8`, `apple-bipbop-gear3-media.m3u8` | Apple bipbop HLS | Master and media playlist, TS segments (their video does not start on a keyframe: triggers gop fusion). |
| `apple-bipbop-gear0-audio-adts.m3u8` | Apple bipbop HLS | Audio-only rendition as raw ADTS `.aac` segments. |
| `apple-fmp4-master.m3u8` | Apple advanced fMP4 example | Master playlist with fMP4 renditions, separate audio groups and subtitles. |
| `akamai-bbb-30fps-segmented.mpd` | Akamai Big Buck Bunny | DASH `SegmentTemplate` with separate video and audio sets. |
| `dashif-netflix-ondemand.mpd` | DASH-IF test case 1a | DASH on-demand: one file per rendition, `SegmentBase` with byte ranges. |

## `mse/` (M4 task 6, decision 0010)

Spike of the player capture: a throwaway extension (`ext/`, plain JavaScript) with a page-world hook registered at run time, a toy MSE player (`mse.html`) and a runner (`run.ts <chrome|firefox> <MiB>`; environment: `MEDIA_DIR` for the downloaded Big Buck Bunny segments `v0..v8.m4v` and `a0..a8.m4a` of `https://dash.akamaized.net/akamai/bbb_30fps/` (`bbb_30fps_640x360_1000k`, `bbb_a64k`), `FIREFOX_BIN`, `STAGE` = `full`, `nowrite`, `blob`, `relay` or `opfs`, `PACE_MS`, `CHUNK_KIB`, `CHECK=1` to try `youtube-check/` instead). `youtube-check/` is the small extension the owner loads for the check on real sites. The runner imports `tests/smoke/cdp.ts` and `memory-sampler.ts`, so it runs from this place.
