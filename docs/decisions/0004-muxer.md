# 0004: Muxer

Date: 2026-11-07. Status: accepted (the owner's player check passed on the flat files, see the end).

## Decision

- **HLS with MPEG-TS segments: mux.js 6.3.0** (Apache-2.0, 73 KB minified, dependencies `@babel/runtime` and `global`, both MIT) turns each segment into a fragmented MP4 fragment. Segments are pushed one at a time and each result is written to OPFS at once.
- **DASH and HLS with fMP4 segments: our own box-level code** (about 100 lines, no library). Init segment of video and audio are merged into one `moov` (audio track renumbered), `styp` and `sidx` are dropped, and the fragments are written interleaved by segment number. A single stream (video only, audio only) is the same code with one track.
- **Output container: flat MP4** (`.mp4`, audio only `.m4a`), written by a last pass from the fragmented working file (see "Flat MP4 pass"). The first plan was to ship the fragmented file with a duration fix (real durations patched into `mvhd`, `tkhd`, `mdhd`); VLC played it badly, so that is now only the fallback and the working format.
- **Not used: mp4box.js** (BSD-3-Clause, 100 KB). It parses and segments, but has no operation that joins two separate files, so merging would go through `addTrack`/`addSample`, which holds the samples in memory. It reads our outputs fine, so it stays useful as a checker in tests if wanted.
- **Not used: ffmpeg.wasm.** The core package is GPL-2.0-or-later (the license policy denies GPL in a bundled Apache-2.0 extension) and 64 MB unpacked, with a 32-bit memory ceiling that conflicts with the over-1-GB goal. Not run, ruled out by license and size.

## What the spike measured

Samples: Apple's public bipbop HLS (12 TS segments, 15 MB, H.264 + AAC) and Akamai's public Big Buck Bunny DASH (15 video and 15 audio segments of 4 s, H.264 + AAC), downloaded into the scratchpad, not committed. Browsers: Firefox 160 and Chrome 157, headless, `<video>` over HTTP with Range requests: metadata, play 3 s, seek to the middle, play through to the end at 16x.

| Output | Result |
|---|---|
| mux.js TS to fMP4, as it comes out | Plays, but see "mux.js finding 1" and "2": 126 duplicate frames, durations wrong. |
| mux.js plus duplicate trim plus duration fix | Chrome and Firefox: correct duration (119.72 s) at once, seek works, plays to the end, audio decoded, 0 dropped frames. |
| Own DASH merge (video + audio) plus duration fix | Same checks pass in both browsers (60.16 s). Merge takes 16 ms, heap 5 MB. |
| DASH init + segments concatenated, nothing else | Plays in both. Firefox shows the whole presentation length (634 s) of the original from the init segment, not the 60 s that was downloaded: a partial download needs the duration fix too. |
| 843 MB of TS through mux.js | 6.5 s, peak JS heap 31 MB: memory follows one segment, not the file. |

### mux.js finding 1: duplicate frames (needs our code)

When a segment does not start on a keyframe, mux.js prepends the previous GOP ("gop fusion") and relies on a browser's Media Source Extensions to overwrite the overlap. Written to a file as is, the video has 3714 samples with only 3588 distinct presentation times, and fragments overlap in time. mux.js reports the prepended length in the `videoSegmentTimingInfo` event (`prependedContentDuration`, 90 kHz ticks); the writer must drop that many leading samples of the video fragment (shrink `trun`, cut the `mdat` start, advance `tfdt`). The prototype does it in about 70 lines and the result has 3588 unique samples. Apple's sample triggers this; segments that start on an IDR frame (most modern streams) do not.

### mux.js finding 2: durations (needs our code)

The `mvhd`/`mdhd` durations come out as `0xFFFFFFFF` (13 hours at 90 kHz); only some players compute the real length. The duration fix above corrects it. It handles version-0 boxes (what mux.js and the DASH samples use); version 1 (very long files) must be handled in the real code.

### Raw AAC (ADTS) audio-only HLS

Some audio-only HLS renditions are bare `.aac` files, each starting with an ID3 tag. Concatenated as they are, Firefox refuses the file (metadata error); with the ID3 tags stripped both play, but the duration is only a guess from the bit rate (Firefox said 327 s for 120 s of audio, Chrome 125 s). Audio-only from ADTS therefore needs a small wrapper that writes the AAC frames into an `.m4a` (own code, decided in task 10). Audio-only from DASH, HLS-fMP4 and HLS-TS needs no wrapper beyond the above.

## Rules for the real code (tasks 8 to 10)

- Read segments, write output, one segment at a time; never hold the output. The fragment writer takes a segment and returns the bytes to append.
- Drop gop-fusion duplicates by the reported duration; verify in a unit test that the number of distinct presentation times equals the number of samples.
- Write the duration fix last, in place; refuse nothing, but report a file whose `moov` it cannot patch.
- A `tfhd` with an absolute base-data-offset is not handled by the merge and is reported as unsupported (the spike throws; the real code returns a `Result` error).
- Encrypted streams: AES-128 decrypts before muxing; SAMPLE-AES and DRM stay "protected".

## Not verified

- Other players than the two browsers (see "Waiting for"), and TS segments with several audio tracks, subtitles or discontinuities.
- Audio-only TS through mux.js (no sample; the library documents support).
- HEVC, AV1 and Opus in TS or fMP4 (the samples are H.264 and AAC only); unsupported codecs must be reported, not written.
- Files above 4 GB (32-bit sizes in the fix-up and the `mdat` sizes).

## Owner's player check of the fragmented files (2026-11-07)

- Firefox: all four play well.
- Windows Media Player (Windows 10): the three MP4/M4A files are fine; the raw `.aac` stops at about 2:10 instead of the real length (the bit-rate guess described above).
- VLC: bad. Random freezes, visual artifacts and long delays when seeking; other videos on the same PC play well in VLC. Cause not confirmed (VLC cannot be run here). The likely one is the missing index: a fragmented MP4 has no sample table, so VLC has to scan the file to seek. Timestamp quirks of the source (frame durations alternate 3000/3150 ticks in the Apple sample) are the other suspect.

So fragmented MP4 is not good enough as the final file. **Output container becomes a flat MP4** (see below); fragmented MP4 stays the working format inside the engine.

## Flat MP4 pass (prototype `flatten.mjs`, about 250 lines)

A last pass reads the finished fragmented file and writes a flat MP4: `ftyp`, a `moov` with the full sample tables (`stts`, `ctts`, `stsc`, `stsz`, `stco` or `co64` above 4 GB, `stss`, an edit list for a late start), then one `mdat` that is the fragments' payloads copied in file order. It holds only the sample tables in memory (55 KB for the 2-minute sample), copies the payloads in 4 MB blocks, and takes 14 ms on the samples. It replaces the duration fix, because it writes the real durations itself. Chrome and Firefox: correct duration at once, seek, play to the end, audio decoded, 0 dropped frames, for HLS, DASH and audio-only. mp4box.js reads it as a non-fragmented file with 3588 video and 2575 audio samples.

Disk cost: the pass writes a second copy of the file (the 2x already counted in 0003 becomes 3x at the last step unless the fragmented file is deleted as the copy proceeds; a 5 GB limit becomes about 3.3 GB). Decide in task 8 whether to accept that or to build the sample tables during muxing and write the flat file once.

## Owner's player check of the flat files (2026-11-07)

All three flat files play well in VLC and Windows Media Player. The owner added that with the fragmented files VLC was bad on all four (artifacts and freezes in every one, including the DASH merge that uses no mux.js), so the container was the cause, not mux.js and not the stream timestamps. Decision accepted: the flat MP4 is the output.

Open for task 8: write the flat file once while muxing (sample tables built as segments arrive, payloads appended, `moov` written at the end and moved to the front) or keep the second pass and its extra disk copy. The recommendation is to build the tables while muxing.
