# StreamDraft: store listing text (draft)

StreamDraft is distributed from the Releases page and signed as an unlisted add-on (decision 0011), so no store listing exists. This is the text to paste if one is ever wanted (addons.mozilla.org or the Chrome Web Store). Keep it in step with the README.

## Name and summary

Name: StreamDraft

Summary (132 characters or fewer, the Chrome limit): Download videos from the page you are on: files, HLS and DASH streams, joined into one MP4 in your browser. No server, no tracking.

## Description

StreamDraft finds the videos and audio on the page you are on and lets you save them to your downloads folder. Nothing is downloaded until you ask for it. It works in the browser alone: there is no helper program, no account and no server.

- Finds direct video and audio files, HLS streams and DASH streams, on any page.
- Download from the toolbar popup, a button on the video, or the right-click menu.
- Streams are joined into one flat MP4 file (or an `.m4a` for "Audio only"), with progress and a Cancel button.
- Pick the quality, and the file name template, in Options.
- Protected (DRM) streams are shown as protected and are not downloaded.
- Experimental, off by default: record the video a page plays, for sites that give no download address.

Privacy: StreamDraft collects nothing. It contacts only the sites you download from.

Download only what you have the right to download. StreamDraft does not circumvent DRM or access controls.

## Other fields

- Category: Photos, Music and Videos (AMO); Productivity (Chrome).
- Support and homepage: https://github.com/shaulk80/StreamDraft (issues are the support channel).
- Privacy policy: https://github.com/shaulk80/StreamDraft#privacy
- License: Apache-2.0.
- Permission reasons (the store asks for each one): the table in the README, section "Permissions".
- Source code for the reviewer: the sources zip of the release, built with `.\scripts\build.ps1`.

## Screenshots

Taken by the owner on 2026-11-15 from `pnpm run testpage` in Firefox (light theme), kept outside the repository (`C:\Vibe\z_tmp\screenshots`, 1 to 4): the popup listing videos, the button on a video, a download in progress with Cancel, the Options page. They are usable for AMO. Before a real listing, retake these:

- Size: the Chrome Web Store takes only 1280 by 800 or 640 by 400 (PNG without transparency). The four are 935 by 609, 877 by 611 and 951 by 815. AMO takes any size.
- Download in progress (3): the blank lower half of the window, the test page's text behind the popup ("large stream test page", the stray word "fetched"). Crop it, or use a page that looks like a video page.
- Options (4): the player capture is ticked with `youtube.com` listed. The capture is off by default and experimental; show the defaults (unticked, empty list).
- Browser toolbar (1 to 3): other extensions and the profile icon show. Use a clean profile or crop to the page and the popup.
