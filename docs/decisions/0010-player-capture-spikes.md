# 0010: Player capture spikes

Date: 2026-11-13. Status: automated part done and recorded; the check on real YouTube is the owner's and still open. The second gate (build or drop) comes after it.

Scripts: `docs/spikes/mse/` (`run.ts` drives headless Chrome 157 over the DevTools protocol and Firefox 153.7 ESR over WebDriver; `ext/` is the throwaway extension; `mse.html` is a toy player over real H.264/AAC fMP4 segments of Akamai's public Big Buck Bunny DASH stream, 32 s, 640x360, downloaded and not committed). All numbers are from this machine (Windows 10), memory is the working set of the whole browser process tree sampled every second, as in 0003.

## Results

| Question | Chrome 157 | Firefox 153.7 |
|---|---|---|
| (b) Does the hook run before the page's first script? Registered at run time with `scripting.registerContentScripts`, world `MAIN`, `document_start`. | Yes, 0 page scripts had run. | Yes, 0 page scripts had run. |
| (d) Can VP9, AV1 and WebM be hidden from the player? Wrapping `MediaSource.isTypeSupported`, `HTMLMediaElement.canPlayType` and `navigator.mediaCapabilities.decodingInfo`. | Yes; a player that prefers VP9 now takes the `avc1` type. | Yes, same. |
| (e) Is the use of encrypted media visible? Wrapping `requestMediaKeySystemAccess` and `setMediaKeys`. | Yes (tried with ClearKey). | Yes. |
| (c) Can the buffers be emptied from outside and refilled? `SourceBuffer.remove(0, Infinity)`, seek to 0, the toy player appends again. | Yes; the hook saw all 18 appends again. | Yes, same. |
| What the hook sees of a normal player: every `addSourceBuffer` (type) and every `appendBuffer` (bytes). | 2 buffers, 18 appends, 4.2 MB for 32 s, init segments found by their `ftyp`/`moov`. | Same. |

(c) says only that the mechanism works. Whether YouTube's real player copes with an emptied buffer and appends again is **not known**; that is the owner check below.

### (a) Getting gigabytes out of the page

Measured with 1 to 2 GiB sent as 1 MiB chunks at about 65 MiB/s (a fast network), at most 8 chunks on their way, every chunk checked on arrival.

| Route | Chrome | Firefox |
|---|---|---|
| Page world to the content script (`window.postMessage`, transferred `ArrayBuffer`s), then dropped | not measured | +123 MiB for 1 GiB |
| Content script to an extension page with `runtime.sendMessage` | **ArrayBuffers do not arrive** (JSON); base64 string works: 65 MiB/s, +123 MiB for 1 GiB | works as `ArrayBuffer`, but **memory is kept**: +2.0 GiB for 1 GiB, +3.7 GiB for 2 GiB, 1.3 to 1.6 GiB still held 10 s after the end. A `Blob` payload or 256 KiB chunks do not help. |
| **Content script writes into the page's own OPFS, then hands over the finished files** | 2 GiB in 32 part files of 64 MiB: +32 MiB. The extension page fetches each part by its `blob:` address, 1 GiB read in about 1 s. | 2 GiB: peak +758 MiB in the page's process (about 0.4 times the data), back to +40 to +400 MiB 10 s later. The extension page cannot fetch the `blob:` address of the page ("NetworkError"); sending the `File` objects in a message works (they stay on disk), 1 GiB read in about 1 s. |

Findings that cost an hour and belong in the real code:

- **Writes into one OPFS file must be chained.** The chunks arrive together; written in parallel, or with the writer created lazily by the first chunk that needs it, they lost 1 to 2 MiB per GiB silently. Create the writer before the first chunk and write one chunk after the other.
- Part files do not lower Firefox's peak; they are still the better shape (a part is closed and complete, a failed capture keeps what it has).

**Chosen route:** the isolated content script writes the chunks into part files in the page's OPFS and, when asked or finished, gives the extension the files: as `File` objects in Firefox, as `blob:` addresses in Chrome; the engine host reads them in slices and muxes as in M3. Nothing large goes through `runtime` messages. Known costs and open points:

- Firefox's page process holds about 0.4 times the recorded data while recording: a 2 GiB capture asks for roughly 0.8 GiB more in that tab. A very long video can be too much; M6 should limit the length or the size and say so.
- OPFS in a Firefox private window is not available to pages (not tried here); the capture will probably not work there. To be checked when the code exists.
- The files sit in the site's storage until they are handed over or cleaned. The capture needs a cleanup at the start of every page load for leftovers of an earlier crash.
- The page's own scripts can read and delete those files (same origin). The recording is of what the page plays anyway, but a page could spoil a capture on purpose.

## Owner check on real YouTube

The questions the toy player cannot answer: does the hook run before YouTube's player; which types does the player ask for and which does it append; does hiding VP9/AV1 make it take H.264 and keep playing; does it survive an emptied buffer; does it use encrypted media on an ordinary video; is the media pipeline used in the page at all (and not in a worker).

`docs/spikes/mse/youtube-check/` is a small extension for this. It only watches (nothing leaves the page, nothing is changed) unless you switch the codec hiding on. How to use it:

1. Firefox: `about:debugging` > This Firefox > Load Temporary Add-on > choose `docs/spikes/mse/youtube-check/firefox/manifest.json`. Chrome: `chrome://extensions`, Developer mode, Load unpacked, the folder `docs/spikes/mse/youtube-check/chrome`.
2. Open a public video on youtube.com and let it play for a few seconds. Open the console (F12).
3. `__playerCheck.report()` prints the first picture. Please send me the text. I look for: `hookRanBeforePageScripts: true`; the types asked; the buffers (types, appends, MiB, init segments); `eme` empty.
4. `__playerCheck.hide(true)`, reload the page, play, `__playerCheck.report()` again: the buffers should now be `avc1` and `mp4a`, no webm. Does the video play normally, and up to which quality can you pick in the player's menu?
5. `__playerCheck.hide(false)` and reload. While the video plays: `await __playerCheck.reset(10)` empties the buffers, goes to 0:00 and waits 10 seconds. It prints how many appends the player made again; the video should be playing again, or at least have buffered from 0.
6. Repeat 3 to 5 on a second, longer video and, if you have one, on a video with ads at the start.
7. Remove the add-on afterwards.

## Result of the owner check on real YouTube (2026-11-13)

Two public videos (2:39 and 44:03) in the owner's browser (Firefox, the owner's everyday browser). Raw texts: kept by the owner in `z_tmp`.

| Question | Result |
|---|---|
| The hook runs before YouTube's player | **Yes** (`hookRanBeforePageScripts: true`, both videos). |
| The media pipeline is used in the page, not in a worker | **Yes**: every append was seen. |
| What the player picks without help | Short video: Opus audio (WebM) and H.264 `avc1.4D401F` video. Long video: Opus (WebM) and **AV1** (`av01.0.05M.08`) video. |
| Hiding VP9, AV1 and WebM | **Works**: both videos fell back to AAC (`mp4a.40.2`) and H.264 in fragmented MP4, played normally, and the owner saw the same quality choices (the short video offered up to 720p either way). The player also asked for `avc1.640028` (High profile, level 4.0, the 1080p class), so it can be chosen. |
| Encrypted media (EME) | **Not used** on either video (`eme` empty). |
| Size of the appends | **Many small ones**: 559 appends for 8 MiB and 995 for 9 MiB, about 10 to 15 KB each. The capture must collect them into larger writes before they go to OPFS. |
| Emptying the buffers and going back to 0:00 | **Fails**: on both videos the player did not append again and stayed at 0:00, loading, without an error in the console. |

### What this changes

- **Option (c), starting the recording late by emptying the player's buffers, is dead.** YouTube's player keeps its own idea of what is buffered and does not notice that it was emptied.
- **The fallback becomes the design: record from the first append.** The page has to be loaded with the hook already told to record. The popup's Record button therefore *arms* the tab (a marker the page-world hook can read synchronously at `document_start`, for example in the page's `sessionStorage`, set by the content script) and **reloads the page**. From the first append on, the hook collects the media into the part files of the page's OPFS. Nothing is recorded for a page that was not armed, so ordinary watching costs no disk.
- **Finishing the recording:** the player has fetched the beginning during the reload; to get the rest the video has to play to the end. That is the point of speeding it up (`playbackRate`); if the player refuses a high rate, a 44-minute video takes 44 minutes, which is the one thing left to check (below). Parts the user skipped by seeking are filled by seeking back: the player appends what it does not have.
- A quality switch or an ad in the middle still has to be detected (new init segment, break in the timestamps) as in task 7.

## Speed check (owner, 2026-11-13, Firefox, 44-minute video)

`await __playerCheck.speed(8, 15)` on a long video (AV1 + Opus, codec hiding off): `rateAfterwards: 8` with one `ratechange` event (YouTube did not take the rate back), **116.7 seconds of video played in 15 seconds (7.8 times real time)**, the player appended 1307 video and 310 audio chunks in that time and had buffered up to 224 s. Visually the video ran fast. The owner stopped the video while the call waited, so `paused: true` at the end is the owner's, not YouTube's.

So the player keeps a raised rate and fetches fast enough: a 44-minute video would take about 6 minutes at 8 times. At 16 times the rate also held (`rateAfterwards: 16`, one `ratechange` event): **231.6 seconds of video in 15 seconds (15.4 times real time)**, 481 audio and 2203 video chunks, buffered up to 277 s, video still playing at the end. Not tried: longer runs (does the player slow down or stop after minutes), a video with an ad (the owner uses an ad blocker, so ads are **not tested**; the capture must detect a break in the stream and say so), Chrome (the check was only run in Firefox).

## What the second gate decides

The hook, the codec hiding and the OPFS hand-over are proven; the late start is not possible; so the build (tasks 7 to 11) is the armed-reload design above. It is worth building if the speed check shows that the video can be played through much faster than real time; if not, a capture takes as long as the video and the owner should decide whether that is acceptable for an experiment.
