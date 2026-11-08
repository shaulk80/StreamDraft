# 0003: Storage and engine host

Date: 2026-11-07. Status: accepted (spike measured in Firefox 160 and Chrome 157, headless, Windows 10).

## Decision

- **Storage: OPFS** (`navigator.storage.getDirectory()`), written in chunks with `createWritable()`. Downloaded segments and the muxed output live there, never in memory.
- **Hand-off: a Blob URL made from the finished OPFS `File`** (`URL.createObjectURL(await handle.getFile())`) given to `downloads.download`. The browser reads the file from disk.
- **Engine host: one interface, two hosts.** Firefox runs the engine in the background event page (it has a DOM and `downloads`). Chrome runs it in an offscreen document (`offscreen` permission, reason `BLOBS`); the offscreen document has no `downloads` API, so it sends the Blob URL to the service worker, which starts the download.
- After the download completes (`downloads.onChanged`): revoke the Blob URL, delete the OPFS file, and (Chrome) close the offscreen document. Closing it earlier would invalidate the URL.

## What the spike measured

A file of a deterministic pattern was written to OPFS in 8 MiB chunks, handed to `downloads.download`, and the saved file compared by SHA-256 with the expected bytes. Memory is the working set of the whole browser process tree, sampled every 0.7 s (growth = peak minus the value before the run).

| Browser | Route | Size | Result | Memory growth |
|---|---|---|---|---|
| Chrome 157 | extension page writes and downloads | 1.5 GiB | saved, hash matches | 104 MiB |
| Chrome 157 | offscreen document writes, service worker downloads | 1.5 GiB | saved, hash matches | 24 MiB |
| Firefox 160 | extension page writes and downloads | 1.5 GiB | saved, hash matches | 6 MiB |
| Firefox 160 | background page writes and downloads | 1.5 GiB | saved, hash matches | 126 MiB |

Same checks at 64 MiB passed too. Writing 1.5 GiB took 2 to 10 s. The growth is page cache and buffers, not the file: it did not scale with the file size. Both browsers report an OPFS quota of about 10 GB on a fresh profile.

## What it means

- A stream is limited by disk and quota, not RAM. Muxing needs the segments and the output at the same time (about twice the file size), so about 5 GB of video fits in 10 GB. Check `navigator.storage.estimate()` before a job and say so in plain words when it will not fit (M6).
- The muxer must read and write through streams or chunked reads (`File.slice`) rather than whole `ArrayBuffer`s, or the memory result above is lost. This is a requirement for the muxer spike (0004).

## Found while building the host (task 9)

- A Blob made from an OPFS file has no type, and Chrome then saved the download with a `.txt` extension whatever the file name said. The Blob URL is made from `file.slice(0, size, type)` (`video/mp4`, `audio/mp4` for sound only): still backed by the file on disk, but typed.
- The offscreen document has only the `runtime` API, so it cannot save job progress: it reports to the background with messages, and the background keeps the state in `storage.local`. The background can be stopped meanwhile, so the answer of a job is a message too, not the reply of the start command.
- The offscreen document tells the background when it holds no job; the background asks once more ("how many jobs?") before closing it, so a job started at that moment is not lost.

## Not verified

- Firefox private windows: OPFS has historically been unavailable there. A job started from a private window needs a clear error; check by hand in M3's review.
- Jobs longer than a few minutes in the Chrome offscreen document and service worker (the spike ran under 20 s).
- Real-profile quota (the spike used fresh profiles); a nearly full disk.
- Headless only; a visible browser may differ in the download UI, not in the APIs.
