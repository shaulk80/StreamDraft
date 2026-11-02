# StreamDraft: architecture

Status: proposal on 2026-11-02. Nothing here has been built or tested. Items marked **verify** are assumptions about browser APIs that M0 to M3 must check before relying on them.

## Shape

One WXT project (Manifest V3) builds a Firefox package and a Chrome package from the same source. Code is split so the logic has no browser dependency and can be unit-tested with Vitest.

```
content script (every page)           background (event page FF / service worker Chrome)
  finds <video>/<source>, shows  --->   media registry per tab (storage.session)
  the in-page button (Shadow DOM)       network observer (webRequest, observe-only)
  site extractors that need the         context menu, settings, job queue
  page's own JS (MAIN world)               |
                                           v
popup / options pages  <------------  engine host (runs where a DOM exists:
  list, quality picker, settings         Firefox: the background page
                                         Chrome: an offscreen document)
                                           fetch segments -> OPFS -> mux -> Blob -> downloads API
```

## Components

| Part | Job |
|---|---|
| `core` | `Result<T>` (value or error message), media model (`MediaItem`: url, kind, container, qualities, protected flag), settings schema with defaults and validation. |
| `detect` | Network observer picks up media responses by content type and by `.m3u8`/`.mpd`; DOM scanner finds video elements and mutation-watches for new ones. Both feed the per-tab registry. |
| `formats` | HLS and DASH parsers turn a manifest into qualities and a segment list. Prefer a maintained library over writing a parser. |
| `engine` | Download jobs: fetch segments with limited concurrency, retries, progress and cancel; store them in OPFS; mux to one file; hand a Blob URL to `downloads.download`. |
| `extractors` | `Extractor { id, matches(url), extract(context) -> Result<MediaItem[]> }`. The generic extractor is built from `detect`. Site extractors register next to it. |
| `ui` | Popup (detected media for the current tab) and options (toggle in-page button, toggle context menu, filename template, default quality). |

## Settings

Stored in `storage.sync` (falls back to `local`). The background rebuilds the context menu and content scripts react to `storage.onChanged`, so toggles apply without a reload.

## Key technical questions

1. **Memory for large files.** Plan: write segments to OPFS, mux into an OPFS file, pass a File-backed Blob URL to the downloads API so nothing is held in RAM. **Verify** OPFS in Firefox and Chrome extension pages and that `downloads.download` accepts the Blob URL (M3 spike).
2. **Muxing.** HLS (MPEG-TS) to MP4, and DASH video-only plus audio-only into one file. Candidates: mux.js / mp4box.js, or ffmpeg.wasm (large, memory-limited, bundled locally). Decide in the M3 spike; record in `docs/decisions/`.
3. **Where the engine runs.** Chrome's service worker has no DOM or Blob URLs, so Chrome needs an offscreen document; Firefox's event page has a DOM. Hide this behind one "engine host" interface. **Verify** the Chrome offscreen reasons available.
4. **Site extractors.** YouTube needs data from the page's own JS (and the player's signature code), so it runs in the MAIN world of the page. **Verify** Firefox MAIN-world content scripts. This is the highest-risk part: it breaks whenever the site changes, may conflict with store reviewer expectations, and sits behind the M4 gate.
5. **Permissions.** `webRequest` (observe only), `downloads`, `contextMenus`, `storage`, `activeTab`, plus host access to all sites for detection. Firefox shows host access at install. Request the minimum and explain each in the README.
6. **Lifetime.** Both background types can be suspended. Keep the registry in `storage.session` and job state in `storage.local`; never rely on module variables.
7. **Signing and source review.** Mozilla may ask for the source of a bundled build; WXT's sources zip is released with each version. **Verify** the `web-ext sign` option for source upload in M5.

## Out of scope

DRM-protected streams (detected, reported as unsupported), live-stream recording, other browsers, any server or account.
