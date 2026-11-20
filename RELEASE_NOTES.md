# Release notes

## 0.2.0 (hardening: errors in plain words, storage cleanup, long videos)

No new way to download. This release makes what is there more reliable. Checked by hand in Firefox and Chrome, and with a generated 4.5 GB stream.

- When a download fails, the popup says why in plain words (connection failed, a part of the video is gone, the disk is full, the browser may not write to the folder) and offers "Try again" where a retry can help. Nothing half-written is left in your downloads folder.
- Leftover temporary files are cleaned up: after a cancelled or failed job, and at the next browser start after a crash (Firefox and Chrome). Fixes #22.
- The segment files of an HLS master playlist or of a DASH stream with several periods are no longer listed as extra "Direct file" cards. Fixes #20.
- Long videos: a 4.5 GB stream saves intact in both browsers with flat memory in Firefox (about +85 MB) and about a fifth of the file in Chrome (+936 MB), with storage empty afterwards. A full disk is reported in plain words. Not tried: a real video of an hour or more.
- The popup and Options show the version, with a plain-words privacy statement and the reason for the all-sites access (also in the README, which now has a Limitations section).
- Firefox smoke checks were made stable (#31, #34). Internal.
- Updating: Firefox offers this version as an update to 0.1.1 (`about:addons`, gear, "Check for Updates"). Chrome: unzip the new zip over the folder and reload the extension. The Firefox build is signed by Mozilla as unlisted; the Chrome build is unpacked. `SHA256SUMS.txt` lists the hash of every file.

Known limitations (GitHub issues #21 and #45, and the README, section Limitations):

- The page's `Referer` is not sent, so hosts that check it refuse the download (#21).
- Firefox: "Try again" is gone when the popup closes (it closes when the browser loses focus); download again from the card.
- Errors of a later failure show only in the popup, not in the in-page button or the right-click toast.
- The in-page button appears only for a video whose own address is a recognisable file, not inside iframes and not in fullscreen. The popup still lists what the network observer saw.
- Live streams and DASH with several periods are listed with a message and not downloaded; protected (DRM) streams are never downloaded.
- The player capture has not been tried with mid-roll ads or real DRM pages.
- The extension asks for access to all sites, because detection watches the responses of every page.

## 0.1.1 (icon and a download fix)

- A new icon, the same in Firefox and Chrome (toolbar button and extensions page). Before, Firefox showed its puzzle-piece placeholder and Chrome a grey letter.
- Fixed #23: when two downloads with the same file name were handed to the browser in the same instant (for example the "Audio only" files of two streams on one page), Firefox could interrupt one of them or, worse, report both as saved while keeping only one file. Finished files are now handed to the browser one at a time, and a save that the browser interrupts is tried once more.
- This is the first release that Firefox offers as an update to 0.1.0 (`about:addons`, gear, "Check for Updates"). Chrome: unzip the new zip over the folder and reload the extension.

Known limitations (GitHub issues #20 to #22, and the README): as in 0.1.0, except that #23 is fixed.

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
