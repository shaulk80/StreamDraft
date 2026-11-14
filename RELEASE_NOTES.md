# Release notes

## 0.1.0 (first usable release)

The first release that downloads videos. Firefox is the primary browser, Chrome the secondary one.

What it does:

- Finds direct video and audio files, HLS streams and DASH streams on the page you are on, and lists them with their qualities in the toolbar popup. The same download is also offered by an in-page button and a right-click entry (each can be switched off in Options).
- Downloads direct files through the browser's download manager. Streams are fetched and joined into one flat MP4 in the browser (nothing leaves your computer), with progress and Cancel; "Audio only" saves an `.m4a`. A 1.1 GB stream downloads with flat memory.
- Protected (DRM) streams are listed as protected and are never downloaded.
- Experimental, off by default: a recorder for the page's own player ("Record this page" in the popup), for sites that give no address to download. Switch it on in Options, globally and per site. It was checked by hand on YouTube in Firefox and Chrome.
- No telemetry and no server of ours. The extension contacts only the sites you download from.

Installing and updating (see the README):

- Firefox: the `.xpi` is signed by Mozilla as a self-distributed (unlisted) add-on; click it on the Releases page. Firefox then checks for newer versions by itself, using an update list on GitHub Pages.
- Chrome: the Chrome zip is unpacked and loaded in developer mode (no store listing, no automatic update). Chrome reminds you at startup that a developer-mode extension is loaded.
- `SHA256SUMS.txt` lists the hash of every file.

Known limitations (GitHub issues #20 to #23, and the README):

- For an HLS master playlist or a DASH stream with several periods, the popup can list a stream's segment files as extra "Direct file" cards (#20).
- The page's `Referer` is not sent, so hosts that check it refuse the download (#21).
- Once, 2.2 GB stayed in the extension's storage after a Firefox job (#22).
- Firefox can interrupt one of two same-name downloads started in the same instant; start it again (#23).
- The in-page button appears only for a video whose own address is a recognisable file, not inside iframes and not in fullscreen. The popup still lists what the network observer saw.
- The player capture has not been tried with mid-roll ads or real DRM pages.
- The extension asks for access to all sites, because detection watches the responses of every page.

## 0.0.1 (walking skeleton)

Pre-release that proves the build and release path. It does not download anything yet.

- Firefox package: not signed by Mozilla in this release, so it installs only in Firefox Developer Edition, Nightly or ESR with `xpinstall.signatures.required` set to false.
- Chrome package: load it unpacked in developer mode.
