# StreamDraft: store listing text (draft)

StreamDraft is distributed from the Releases page and signed as an unlisted add-on (decision 0011), so no store listing exists. This is the text to paste if one is ever wanted (addons.mozilla.org or the Chrome Web Store). Keep it in step with the README.

## Name and summary

Name: StreamDraft

Summary (132 characters or fewer, the Chrome limit): Download videos from the page you are on: files, HLS and DASH streams, joined into one MP4 in your browser. No server, no tracking.

## Description

StreamDraft finds the videos and audio a page plays and saves them to your downloads folder. It works in the browser alone: there is no helper program, no account and no server.

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

## Screenshots (not taken yet)

Take them from `pnpm run testpage` in Firefox, 1280 by 800, light theme:

1. The popup listing the videos of the detection page, with a quality picker.
2. The button on a video on the overlay page.
3. A download in progress in the popup, with Cancel.
4. The Options page.
