# StreamDraft

A browser extension that downloads videos from the page you are on. Firefox is the primary browser, Chrome is secondary. It runs entirely in the browser: no helper program, no server, no telemetry.

## Status

Early development (version 0.x). It finds direct video and audio files (mp4, webm, mp3 and similar), HLS and DASH streams, and downloads them from the popup, the in-page button or the right-click entry. Streams are joined into one MP4 (or an `.m4a` for "Audio only") in the browser. Protected (DRM) streams are listed as protected and are not downloaded. An experimental recorder of the page's own player is built in and is off by default (Options). What works and what does not: `docs/status.md`, and the known issues below.

## Installing

Every release is on the [Releases page](https://github.com/shaulk80/StreamDraft/releases). Download only from there. `SHA256SUMS.txt` lists the hash of each file; to check one in PowerShell: `Get-FileHash -Algorithm SHA256 .streamdraft-<version>-firefox.xpi` and compare.

### Firefox (primary)

1. Open the Releases page in Firefox and click `streamdraft-<version>-firefox.xpi`.
2. Firefox asks to add the extension and lists its permissions. Choose **Add**.
3. If Firefox saves the file instead of asking, open `about:addons`, click the gear, choose **Install Add-on From File...** and pick the downloaded `.xpi`.

The `.xpi` is signed by Mozilla as a self-distributed (unlisted) add-on. It is not listed on addons.mozilla.org, so there is no store page. Releases marked as pre-release (such as `0.0.1`) are not signed and install only in Firefox Developer Edition, Nightly or ESR with `xpinstall.signatures.required` set to false.

**Updates.** Firefox checks for a newer signed version about once a day and installs it, as for any add-on; to check now, open `about:addons`, click the gear and choose **Check for Updates**. It is Firefox, not the extension, that asks `https://shaulk80.github.io/StreamDraft/updates.json` and then downloads the `.xpi` from GitHub; the extension itself still contacts only the sites you download from. Turn this off per add-on in `about:addons` (the extension's page, "Automatic Updates").

### Chrome (secondary)

There is no Chrome store listing and no automatic update.

1. Download `streamdraft-<version>-chrome.zip` from the Releases page and unzip it into a folder you keep, such as `C:ToolsStreamDraft`.
2. Open `chrome://extensions`, turn on **Developer mode** and choose **Load unpacked**, then pick that folder.
3. Chrome reminds you at startup that a developer-mode extension is loaded.

**Updates.** Download the newer zip, unzip it into the same folder (replace the files), then click the reload arrow on the extension's card in `chrome://extensions`. Keeping the folder keeps the extension's settings.

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
