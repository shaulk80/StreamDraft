# StreamDraft

A browser extension that downloads videos from the page you are on. Firefox is the primary browser, Chrome is secondary. It runs entirely in the browser: no helper program, no server, no telemetry.

## Status

Early development: it finds direct video and audio files (mp4, webm, mp3 and similar) on a page and downloads them from the popup, the in-page button or the right-click entry. Streams (HLS, DASH) are not downloaded yet (see `docs/status.md`). Planned for v1: direct video files, HLS and DASH streams, audio-only extraction, and site-specific support starting with YouTube. DRM-protected streams are not supported.

Options planned: an in-page download button and a context-menu entry, each switchable.

## Installing (when releases exist)

- **Firefox:** click the signed `.xpi` on the Releases page. The build is signed by Mozilla as a self-distributed (unlisted) add-on; it is not listed on addons.mozilla.org.
- **Chrome:** download the Chrome zip, unzip it, open `chrome://extensions`, turn on Developer mode and choose "Load unpacked". Chrome will remind you at startup that a developer-mode extension is loaded.

## Building

Needs Node.js 26, pnpm 12 (`npm install -g pnpm`) and Firefox (the smoke test starts it headless).

```powershell
.\scripts\build.ps1
```

This installs dependencies, checks licenses, typechecks, lints, runs the tests, packages Firefox and Chrome builds into `dist\packages`, writes `SHA256SUMS.txt` and smoke-tests the packages.

To try a build by hand (load it in Firefox or Chrome, test pages, checklists), see `docs/manual-testing.md`.

## Known issues

These are filed as GitHub issues. Fixes are deferred until real-life examples show which ones matter.

- **Segment files can be listed as videos (#20).** For an HLS master playlist or a DASH stream with several periods, the popup can show up to 50 "Direct file" cards, one per segment, and the real card may be hard to find. Downloading the stream itself is not affected. Fix options: read the rendition playlists of an HLS master in the background, record the segment names of every DASH period, or treat many numbered `.mp4` files from one directory as segments.
- **The page's `Referer` is not sent (#21).** A host that checks the `Referer` header refuses the manifest read (the card says the playlist could not be loaded) and direct-file downloads; such sites cannot be downloaded from. Cookies are sent. Fix options: set the header for the duration of a job with `declarativeNetRequest` rules, fetch direct files in the extension instead of the downloads API, or only document it.
- **Storage left behind after a Firefox job (#22).** Once in about 12 runs of the 1.1 GB check, 2.2 GB stayed in the extension's storage after a job. The cause is unknown and it has not been reproduced. The space stays used until the extension's storage is cleared. Fix options: reproduce with repeated large jobs and Cancel at different moments, and clean up leftover job folders when the background starts.
- **Firefox can interrupt one of two same-name downloads (#23).** If two downloads get the same file name and start in the same instant (for example several streams of one page), Firefox can interrupt one and the card says "The browser could not save the finished video." Start that download again. Fix options: save finished files one at a time, or retry once when a download is interrupted at the start.

## Legal

Download only what you have the right to download. StreamDraft does not circumvent DRM or access controls. You are responsible for following the terms of the sites you use and the copyright law that applies to you.

## License

Apache-2.0, see `LICENSE`.
