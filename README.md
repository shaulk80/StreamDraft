# StreamDraft

A browser extension that downloads videos from the page you are on. Firefox is the primary browser, Chrome is secondary. It runs entirely in the browser: no helper program, no server, no telemetry.

## Status

Project set up, nothing built yet (see `docs/status.md`). Planned for v1: direct video files, HLS and DASH streams, audio-only extraction, and site-specific support starting with YouTube. DRM-protected streams are not supported.

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

## Legal

Download only what you have the right to download. StreamDraft does not circumvent DRM or access controls. You are responsible for following the terms of the sites you use and the copyright law that applies to you.

## License

Apache-2.0, see `LICENSE`.
