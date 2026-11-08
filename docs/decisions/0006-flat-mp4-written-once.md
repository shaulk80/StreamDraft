# 0006: Flat MP4 written once, movie box last

Date: 2026-11-08. Status: accepted for the engine; the owner's check in VLC and Windows Media Player is still open (see the end).

Settles the question left open in 0004 ("write the flat file once while muxing, or keep the second pass").

## Decision

- **The flat MP4 is written once, front to back**: `ftyp`, one `mdat`, then the `moov` with the full sample tables. Sample tables are collected while segments are muxed (a few bytes per sample; runs for durations and composition offsets), the sample bytes go straight to the output and are never held. The `mdat` header uses the 64-bit size form, so its length is known up front; its size is patched in at the very end (the last write).
- **Why the `moov` is last**: a front `moov` needs the final table size before the first sample is written, which means a second copy of the file (the 3x disk cost in 0004). With the `moov` last the file costs segments plus output (2x), as planned in 0003. Cameras write files this way; players read them from disk without trouble.
- **Chunk offsets** are `stco`, or `co64` when any offset is past 4 GiB. Media durations are 64-bit (`mdhd` version 1) when they do not fit in 32 bits. The edit list uses 32-bit movie ticks (milliseconds): good for 49 days, clamped beyond.
- **Timing**: sample durations are summed; the `tfdt` of the first fragment of each track only gives where the track starts. All tracks are shifted so the earliest one starts at 0, a later one gets an empty edit. The edit list also skips the first composition offset, so the first picture shows at time 0. Gaps inside a stream (a discontinuity that skips time) are not represented, the tracks stay back to back.
- **Interleaving**: the stream that is furthest behind on the clock is written next, so video and audio advance together; one chunk per segment and track.
- **Tracks**: only audio and video. Subtitle tracks are left out. Sample entries written: `avc1`, `avc3`, `hvc1`, `hev1`, `av01`, `vp09`, `mp4a`, `ac-3`, `ec-3`, `Opus` (only `avc1` and `mp4a` have been played so far). `encv`/`enca` (common encryption) are reported as protected, anything else as "cannot save yet"; nothing is written for them.
- **Raw ADTS audio** (task 8, not task 10 as 0004 said): a small wrapper turns the AAC frames into an `.m4a` track (`esds` built from the ADTS header, one sample per 1024-sample frame, the sample rate as clock). The real length is exact, unlike the bit-rate guess of the raw file.
- **TS**: mux.js 6.3 per segment; the `prependedContentDuration` it reports is dropped from the front of the video run (samples, bytes and start time), so every sample has its own presentation time and the timeline has no gap or overlap. Checked by a test on two cut-down segments of Apple's bipbop stream (`tests/engine/fixtures/*.mpegts`, 12 KB and 28 KB): without the trim the same input shows repeated pictures.
- **A cut-off segment is an error** (bytes at its end that do not form a box), never silently skipped. A `tfhd` with an absolute base data offset is reported as unsupported.
- **Bundle size**: the mux job with mux.js and its two small dependencies bundles to 176 KB minified (Vite library build), no `eval` and no `new Function`.

## What was measured

Real streams, muxed in Node and played over HTTP with Range requests in headless Chrome 157 and Firefox 160 (the play check from the M3 spike: metadata, play 3 s, seek to the middle, play to the end at 16x):

| Input | Output | Chrome | Firefox |
|---|---|---|---|
| Apple bipbop gear1, 2 TS segments | 558 KB, 598 video and 427 audio samples, 19.95 s | duration right, seek, plays to the end, audio decoded, 0 dropped | same, `mozHasAudio` true |
| Akamai Big Buck Bunny DASH, 320x180 video + audio, 3 segments each | 407 KB, 360 video and 282 audio samples, 12.03 s | same | same |
| Apple bipbop gear0, 3 raw ADTS segments | `.m4a`, 21 KB, 645 frames, 29.95 s | same | not run |

## Not verified

- VLC and Windows Media Player on a file with the movie box last (0004's check was on files with the box first). **Owner to check before M3 is closed.** If either struggles, add an optional last pass that moves the `moov` to the front (costs one more copy), or reserve space at the front.
- Streams with a jump in time inside them, several audio tracks, HEVC/AV1/Opus (written, never played), AES-128 against a real encrypted stream (tested with `crypto.subtle` round trips only).
- Output past 4 GiB (the `co64` path is unit-tested with a stub sink, not with a real file).
- The OPFS sink in a real browser (unit-tested against a fake directory); task 9 wires it and the smoke test in task 12 exercises it.
