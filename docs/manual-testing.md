# StreamDraft: manual testing

For the owner's hands-on review of a milestone. The smoke tests (`pnpm run smoke`, `pnpm run smoke:chrome`) already check the main paths in headless browsers (list below); this file is for looking at the real thing: how it looks, how it feels, and what a user would hit. Add a section per milestone and keep the checklists short.

## 1. Get a build

```
pnpm install --frozen-lockfile
pnpm run zip:firefox
pnpm run zip:chrome
```

(`.\scripts\build.ps1` does this too, plus all checks.) The unpacked builds are `.output/firefox-mv3` and `.output/chrome-mv3`.

## 2. Load it

**Firefox** (Developer Edition or normal Firefox):
1. Open `about:debugging#/runtime/this-firefox`.
2. "Load Temporary Add-on", pick `.output/firefox-mv3/manifest.json`. It stays until Firefox closes.
3. Pin the toolbar button if you do not see it (puzzle-piece menu, then the gear next to StreamDraft).
4. If detection finds nothing, open `about:addons`, StreamDraft, Permissions, and check that access to all websites is on.

To try the packaged zip instead (as a user would get it): Developer Edition, `xpinstall.signatures.required` set to `false` in `about:config`, then `about:addons`, gear, "Install Add-on From File", pick `dist/packages/streamdraft-<version>-firefox.zip`.

**Chrome**:
1. Open `chrome://extensions`, switch on "Developer mode".
2. "Load unpacked", pick `.output/chrome-mv3`.
3. Pin the toolbar button (puzzle-piece menu).
4. After you rebuild, press the reload icon on the extension card and reload the test page.

## 3. Start the test pages

```
pnpm run testpage
```

Leave it running. Pages, all on `http://127.0.0.1:8123/`:

| Page | Address | For |
|---|---|---|
| Overlay page | `/` | the in-page button and the right-click entry |
| Iframe page | `/iframe.html` | the overlay page inside an iframe (same-origin and cross-origin): the in-page button does not appear there, which is a known limit; checked by the owner on 2026-11-14, as is the missing button in fullscreen |
| Detection page | `/detect.html` | detection, the popup list, the badge, downloads |
| Streams page | `/streams.html` | HLS and DASH detection and the quality list (M3) |
| Silent stream page | `/silent.html` | a stream with a picture and no sound track: "Audio only" must fail with a clear message (M3) |
| Stream parts page | `/parts.html` | streams cut into `.mp4` segment files, one protected: the segments must not be listed (M3) |
| Stream download page | `/download.html` | two tiny streams with real segments that download (M3) |
| Job display page | `/jobs.html` | a slow and a broken stream: progress, Cancel, failure text (M3) |
| Large stream page | `/large.html` | one stream of 1.1 GB, built by the server as it is asked for (M3, large file check) |
| Player capture page | `/mse.html` | a 12 s video played through Media Source Extensions: the recording, with `?switch=1` (quality changes in the middle) and `?eme=1` (encrypted media) for the refusals (M4) |

The media files are filler bytes with the right content type. They do not play (the player shows an error), but they download. Sizes: `direct.mp4` 300 KB, `clip.webm` 250 KB, `song.mp3` 200 KB, `late.mp4` 220 KB, `hidden-stream` 400 KB, `tiny.mp4` 2 KB.

Downloads go to your normal download folder. The browser never overwrites: a second download of the same name gets `(1)`.

## 4. What to test

Three checklists follow, one per milestone: **5. M2** (finding videos and downloading plain files), **6. M3** (HLS, DASH, audio only, progress, large files) and **9. M4** (the player capture experiment, on the test page and on real sites). Do each in Firefox, then in Chrome.

- **M4: all of it, once** (section 9). It ends with your decision on whether the feature stays on, stays off by default, or goes.

- **M3: all of it** (done on 2026-11-12, see the results table in section 6; repeat it for a release). The last group, "Real streams", is the only way to learn whether the saved files play in a real player; the generated test pages make valid but made-up files.
- **M2: done.** The owner went through the whole M2 checklist by hand in Firefox and Chrome when M2 was merged (PR #3), and the smoke tests cover its main paths on every build (section 8). The lines marked (quick) are the ones to repeat after a change to the popup, the background script or detection (about 10 minutes); do the rest of M2 only if one of them looks wrong.
- **M1 sample screens**: only if you want to look at the popup states without a test page (see the end of section 5).

## 5. M2 checklist: detection and downloads

**Detection page** (`/detect.html`):
- [ ] (quick) The toolbar badge counts up to 5 within about 2 seconds (the last file is added by the page after 1 second).
- [ ] (quick) The popup lists 5 cards: `clip.webm`, `direct.mp4`, `hidden-stream`, `late.mp4`, `song.mp3`. Every card is titled "StreamDraft detection test page" (none named after the address). Each card has the line `127.0.0.1 · Direct file · <file name>`, a quality list with one entry (e.g. "MP4 (300 KB)"), a Download button. With 5 cards the list scrolls inside the popup (a scrollbar next to the cards); the popup itself has no scrollbar, and no horizontal one.
- [ ] `tiny.mp4` is not listed (the page fetches it, but it is too small).
- [ ] `hidden-stream` is listed although it is not in the page (only the network observer sees it).
- [ ] (quick) Download on `direct.mp4`: the card says `Saving as "StreamDraft detection test page [original].mp4".` and the file appears in the download folder with 300 KB. Try one more card; `hidden-stream` saves as `... [original].mp4`.
- [ ] Reload the page: the list and the badge reset and fill again.
- [ ] "Refresh" button (top of the popup, next to Settings): click it. A line appears under the title: "Checked the page again. N videos listed." and the list is redrawn (quality choices and result lines reset). It does not find a file the network observer missed earlier (that traffic is gone), but it re-reports everything the page itself contains. If you ever see a missing video again, note what the page was doing (just loaded, scrolled, a video added by script) and whether Refresh brought it back.
- [ ] Refresh on a page the extension cannot reach (for example a tab opened before you loaded the extension, or `about:debugging`): the line says it could not check the page and shows the saved list.
- [ ] Open the popup while the page is still loading: the list grows live.
- [ ] Open `/` in the same tab: the badge and the list change to that page's files.
- [ ] A page without videos (for example the options page): the popup says "No videos found on this page." and there is no badge.

**Overlay page** (`/`):
- [ ] The video without a file at the top has no button. The tiny 80 x 45 video has no button. The three normal videos have a "Download" button in the top-right corner, including the one added after 1.5 seconds.
- [ ] Scroll down: the button of the far-down video follows it, and buttons of videos scrolled out of view disappear.
- [ ] (quick) Click the button, then Download in the small panel: it says `Saving as "StreamDraft test page [original].mp4".` (or the song/late name for the others) and the file is saved.
- [ ] (quick) Right-click a video: the menu has "Download video with StreamDraft". Choosing it shows a toast and saves the file. The toast is a small dark box at the bottom right of the page with the same `Saving as ...` text; it stays 5 seconds and disappears. If the browser's "ask where to save" dialog is on, the toast may only appear after you close the dialog, so turn that setting off for this check.
- [ ] Right-click a video that has no file (the one at the top): the entry may show; choosing it says it could not tell which video this is, or downloads the only video; it must not download a wrong file.

**Options** (toolbar button, Settings):
- [ ] Untick "Show a download button on videos in the page" while the overlay page is open: the buttons vanish without reloading the page; switch on: they come back.
- [ ] Untick 'Add "Download video" to the right-click menu': the right-click entry is gone; tick it: it is back.
- [ ] File name: change it to `{site} {date}`; the line "Example: ..." under the File name field updates as you type, showing the name a sample video would get (for `{site} {date}` something like `example.com 2026-11-08.mp4`); the next download is named like `127.0.0.1 2026-11-08.mp4`.
- [ ] A bad template such as `{nope}` shows an error and is not saved; the old one keeps working.
- [ ] Default quality: plain files have one quality, so nothing changes for them; check that picking another one does not break a download.
- [ ] (quick) Browser setting "ask where to save files" (Firefox: Settings, General, Downloads; Chrome: Settings, Downloads, "Ask where to save each file"): with it on, a download from the popup, the button and the menu opens the save dialog, with the template name filled in; with it off, the file goes straight to the download folder.
- [ ] Settings survive closing and reopening the browser (not the temporary Firefox add-on: it is removed on exit).
- [ ] (M4, experimental) "Experimental: record from the player" is unticked after a fresh install and lists `youtube.com`. A bad line such as `https://youtube.com/watch` shows an error that says to write only the name, and is not saved. The site list is saved when you leave the box, not on every key. Ticking the box and removing a site both reach pages you open or reload afterwards. (Nothing visible happens yet: the recording itself comes with the next tasks of M4.)

**Sample screens** (M1, kept for review): add `?mock=1` to the popup address to see the four sample videos (direct, HLS, DASH, DRM-protected) and `?mock=empty` for the empty state. The popup address is `moz-extension://<id>/popup.html` in Firefox (id shown on `about:debugging`) and `chrome-extension://<id>/popup.html` in Chrome (id on `chrome://extensions`). Download on those only says what it would do.

## 6. M3 checklist: streams, audio only, progress and large files

### Results of the owner's run, 2026-11-12

Done by hand in Firefox and in Chrome, with the same results in both. The lines below the table keep their `[ ]`: they are the checklist for the next run.

| Group | Result | Notes |
|---|---|---|
| Streams page (`/streams.html`) | Passed | The badge showed 3 instead of 2 until the popup opened: fixed (PR #17), the owner re-checked. |
| Stream download page (`/download.html`) | Passed | The Firefox interruption of two same-name downloads did not appear. |
| Job display page (`/jobs.html`) | Passed | Private window in Firefox: works (the background page is not a private page). |
| Large stream page (`/large.html`) | Passed | Memory stayed flat; the storage check shows no leftover files; Cancel gave the space back. |
| Real streams: plain HLS and DASH, audio only | Passed | Saved files play in Firefox, Windows Media Player and VLC. |
| Real streams: protected (Shaka demo) | Passed after the fix | Found 50 segment cards (PR #17); one card marked protected now. |
| Chrome's offscreen document | Passed | Checked by hand (Chrome only). |
| Stream parts page (`/parts.html`) | Passed | Added after the Shaka run; also in both smoke tests. |
| Silent stream page (`/silent.html`) | Passed | "Audio only" fails with the no-sound message and saves nothing; 360p saves a picture-only file. Also in both smoke tests. |

M2 was checked completely when it was merged (PR #3), so nothing of it is open.

**Still open:**
- A real video from a site without a sound track: no public example is known. The generated one (`/silent.html`) passed by hand and in both smoke tests.

**Streams page** (`/streams.html`, M3):
- [ ] The popup shows two cards, briefly "Reading the stream..." and then the qualities: `127.0.0.1 · HLS stream · mp4` with 720p, 360p, Audio only; `127.0.0.1 · DASH stream · mp4` with 720p (8.9 MB), 360p (2.9 MB), Audio only (234 KB).
- [ ] The rendition playlist the page loads (`v720/index.m3u8`) is not a card of its own. The badge counts 2 right after the page loads, before the popup is opened. (Seen in Firefox on 2026-11-12: it showed 3 and dropped to 2 when the popup opened; fixed by reading the manifest as soon as it is found, see `docs/decisions/0007-read-manifests-when-found.md`. Check it again.)
- [ ] Download on these streams starts a job that fails (their segments do not exist on this page): the card ends with "Could not save the video." and the server's answer (e.g. "Segment 1 of 3: The server answered 404."; the numbers depend on the stream), the Download button comes back, nothing is saved. Use the download page below for a download that works.
- [ ] Stop `pnpm run testpage`, reload the popup on a fresh tab of the page: the cards say the playlist could not be loaded, and read fine again after you restart the server and press Refresh.

**Silent stream page** (`/silent.html`, M3): one DASH stream with a picture and no sound track at all.
- [ ] The popup shows one card, `127.0.0.1 · DASH stream · mp4`, with 360p and "Audio only".
- [ ] Pick "Audio only" and press Download: the card ends with "Could not save the video. This video has no sound to save.", the Download button comes back, and no file is saved.
- [ ] Pick 360p and press Download: a picture-only MP4 is saved (made-up bytes, it does not play).

**Stream parts page** (`/parts.html`, M3; added after the Shaka demo filled the list with 50 segment files):
- [ ] The badge shows 3 within about a second, without the popup being opened, and stays 3.
- [ ] The popup shows three cards: `127.0.0.1 · DASH stream · mp4` with a 360p quality and a Download button; a second `127.0.0.1 · DASH stream · mp4` that says "Protected (Widevine DRM). StreamDraft does not download protected videos." and has no Download button; and `127.0.0.1 · Direct file · direct.mp4`. None of the `seg-1.mp4` to `seg-4.mp4` files of the two streams is listed.

**Stream download page** (`/download.html`, M3 task 9):
- [ ] The popup shows two cards: `127.0.0.1 · DASH stream · mp4` (360p, Audio only) and `127.0.0.1 · HLS stream · mp4`.
- [ ] Download on the DASH card: the Download button waits, the card shows "Starting..." or a progress bar (it is over quickly), then "Saved to your downloads folder.", the button comes back, and the file `StreamDraft stream download test page [360p].mp4` is in the download folder, a few KB. The HLS card saves `... [original].mp4`. (The pictures are made-up bytes: the files are valid MP4 structure but do not play.)
- [ ] Chrome only, optional: the engine runs in an "offscreen document", a hidden page of the extension that Chrome needs because a service worker cannot hold the file. You never see it; it exists only while a download runs and the smoke test already checks that it opens and closes. By hand: on `/large.html` (a download of about a minute) press Shift+Esc to open Chrome's Task Manager, start the download and look for a second "Extension: StreamDraft" row that appears during the download and is gone after "Saved".
- [ ] Pick "Audio only" on the DASH card and press Download: the file `... [audio].m4a` is saved (a sound track of 4 samples, a few KB). On the HLS card the sound is cut out of the video segments: `... [audio].m4a` again, named with `(1)` after the first. (Made-up bytes: the files have valid structure but do not play.)
- [ ] Download the same card twice: the second file is named with `(1)`; nothing is overwritten. Press the two downloads one after the other: two downloads of one name started in the same instant sometimes make Firefox interrupt one of them (seen in the smoke test); the card then says "Could not save the video. The browser could not save the finished video."

**Job display page** (`/jobs.html`, M3 task 11): the popup lists two HLS streams of the same title; the first has 40 parts of 0.4 seconds each, in the second the second part is missing.
- [ ] Download on the first card: the button is disabled, a progress bar fills and the line says "Downloading: 12% (...)" with a growing size; a Cancel button sits next to it.
- [ ] While it runs, close the popup and open it again: the card shows the running job again (bar, text, Cancel), and the Download button is disabled.
- [ ] Press Cancel: the line says "Cancelled.", the bar and Cancel disappear, the Download button comes back, nothing is saved. (In Chrome the offscreen document closes too; see the optional line above for how to look.)
- [ ] Download on the second card: the line says "Could not save the video." with the server's answer ("Segment 2 of 2: The server answered 404."); the Download button comes back.
- [ ] Let the first card run to the end (about 5 seconds): the bar fills, "Joining the parts and saving..." (no Cancel), then "Saved to your downloads folder."
- [ ] A job whose background was killed (close the browser during a download, start it again, open the popup): the card does not show a stale job forever; after 10 minutes without news it is forgotten.
- [ ] Firefox private window (allow StreamDraft there first: `about:addons`, StreamDraft, "Run in Private Windows"): the owner's run on 2026-11-12 downloaded fine. Expected: the extension's background page is not a private page, so its storage works. If Download ever says the browser would not give the extension space, note the Firefox version.

**Large stream page** (`/large.html`, M3 task 13): one DASH stream, 720p and Audio only, of 68 parts of 16 MB. Needs about 3 GB of free disk space for a minute or two, and a task manager open next to the browser. (`SMOKE_LARGE=1` runs the same download in the smoke tests and measures the memory for you; this is the by-hand version.)
- [ ] Download the 720p card: the bar fills in a minute or less and the card ends with "Saved to your downloads folder."; `StreamDraft large stream test page [720p].mp4` is about 1.1 GB. (Made-up bytes: it does not play.)
- [ ] While it runs, watch the memory of the browser in the task manager (Firefox: the extension's tab process; Chrome: the "Extension" renderer, there is one more while the offscreen document lives). It should climb by a few hundred MB and stay there, not follow the bar up to 1.1 GB. Measured with the smoke tests: Firefox +150 to +380 MB, Chrome +400 to +590 MB.
- [ ] Afterwards the temporary files are gone. The browser's own screens do not list an extension's storage, so ask the extension's background code (the smoke test asks the same question): Firefox: `about:debugging#/runtime/this-firefox`, StreamDraft, "Inspect", tab Console. Chrome: `chrome://extensions`, StreamDraft, "service worker" next to Inspect views, tab Console. Type `navigator.storage.estimate().then((e) => console.log(Math.round(e.usage / 1048576) + " MB"))` (Firefox may ask you to type `allow pasting` first) and press Enter. Expected: a few MB at most, not hundreds. Run it once before and once after the download.
- [ ] Press Cancel half way: "Cancelled.", the memory falls back, and the disk space is given back (same console line: back to a few MB).

**Real streams** (public player demo pages; the made-up test pages cannot show this). On each page press play first, then open the popup. If a card says the playlist could not be loaded, the host probably checks the `Referer` (known gap below): try another page.
- Plain HLS: `https://hls-js.netlify.app/demo/` (hls.js demo; it starts Big Buck Bunny from `test-streams.mux.dev`, several qualities, with sound).
- Plain DASH: `https://reference.dashif.org/dash.js/latest/samples/dash-if-reference-player/index.html` (DASH-IF reference player; pick a Big Buck Bunny stream from the list, e.g. the Akamai one with separate video and audio).
- Protected: the Shaka Player demo, `https://shaka-project.github.io/shaka-player/demo/` (the old appspot address redirects there), Content tab: pick an asset tagged Widevine or PlayReady and load it. (These test assets use real DRM and play only where the browser has it; the card should say protected either way.) Owner's run of 2026-11-12 (Firefox): after Load the popup listed 50 "Direct file" cards (the cap) named like `v-0480p-1000k-libx264-s45.mp4`: the single segments of the stream, which are separate `.mp4` files served as `video/mp4`, were taken for videos. Fixed in branch `m3-stream-parts` (`/parts.html` reproduces it); the owner ran the Shaka demo again and confirmed the fix (Firefox, 2026-11-12).
- [ ] On the HLS and the DASH page, download the lowest quality (shortest wait) and play the file in Firefox, Windows Media Player and VLC.
- [ ] Audio only: on the same pages pick "Audio only", save, and play the `.m4a` in Firefox, Windows Media Player and VLC. (A video without a sound track should end with "Could not save the video. This video has no sound to save."; try it on `/silent.html`, no public page for it is known.)
- [ ] The protected stream is listed as protected, with the reason, and nothing is saved. On the Shaka demo only the one manifest of the loaded asset should appear (no "Direct file" cards named like `v-0480p-1000k-libx264-s45.mp4`).

## 7. Known gaps (do not report again)

- The in-page button appears only for a video whose own address is a recognisable media file. A `blob:` stream or an address without extension and type gets no button; the popup still lists what the network observer saw.
- No button or toast for videos inside iframes; no button in fullscreen.
- Downloads do not send the page's `Referer`: hosts that check it refuse.
- A download that fails after it started (server error) is not reported yet (M6).
- Cancel works while the parts are being fetched; the last step (joining the parts and handing the file to the browser) cannot be stopped from the popup. Protected videos are never downloaded.
- Temporary files of a stream download that was cut off by a browser crash stay in the extension's private storage until a later version cleans them (M6).
- Live streams and DASH with several periods are listed with an error for now.
- A stream's manifest is read by the extension without the page's `Referer`: hosts that check it make the card say the playlist could not be loaded.
- Segment files of an HLS stream whose segments are `.mp4` files, and of a DASH stream with several periods, can still be listed as videos: their segments are named only in playlists or manifests that are not read (`docs/decisions/0007-read-manifests-when-found.md`).
- A page's manifests are fetched by the extension as soon as the page loads them, not only when the popup opens.
- The extension asks for access to all sites (detection needs it; see `docs/decisions/0002-detection-permissions.md`).
- The right-click entry has not been run in Chrome by the automated tests (headless Chrome cannot operate the menu): check it by hand there.

- Player capture (M4, accepted costs of decision 0009): a recording starts at page load, so Record reloads the page; the video has to play through while the tab stays open (a background, covered or minimised tab recorded fine on YouTube in both browsers); the player is steered to H.264/AAC, so quality stops at what H.264 offers (up to 1080p on YouTube, no 4K); the recording is lost when the page is left or reloaded; only the newest video of a page is recorded; encrypted (DRM) media is never recorded.

## 8. What the automated tests already cover

So you can skip it, or look only at how it feels:

- Firefox smoke (`pnpm run smoke`, packaged zip, headless): popup and background answer; the four sample cards and their Download text; overlay button shown, hidden and shown again by the setting; right-click entry downloads and follows the setting; detection lists the 5 files and not the tiny one; popup, in-page button and menu downloads save files of the right size and name; the two generated streams of `/download.html` download, are readable MP4 files (DASH: picture and sound) and end as "Saved to your downloads folder."; on `/silent.html` "Audio only" on a stream without sound ends with the failure text and saves nothing; on `/jobs.html` a slow stream shows its progress (also in a popup opened again) and is cancelled, a stream with a missing part ends with the failure text; options page keeps a setting and rejects a bad template.
- Chrome smoke (`pnpm run smoke:chrome`, packaged zip, headless Chrome): the service worker starts; the popup lists the same 5 files; popup Download and the in-page button save files of the right size and name; the two generated streams of `/download.html` download through the offscreen document and the document closes afterwards; the same silent-stream check, and the same progress, Cancel and failure checks on `/jobs.html`.
- Player capture (M4, both smoke tests, `/mse.html`, the setting switched on for `127.0.0.1`): an ordinary load is still offered VP9; the real popup (in a frame) offers Record, pressing it reloads the page, the section reaches "The whole video is recorded", "Save audio only" saves a readable `.m4a` under a job panel, "Cancel recording" leaves the page with nothing recorded; the armed load is offered H.264 only and its recording saves as MP4 and `.m4a`; a quality switch and encrypted media are refused with a reason. The checklist for real sites is written in task 11.
- Large file check (opt-in, `SMOKE_LARGE=1` before `pnpm run smoke` or `pnpm run smoke:chrome`; about a minute each, 3 GB of disk): the 1.1 GB stream of `/large.html` downloads, the saved file has every sample with the right bytes, the memory of the browser grows by less than 768 MB, and the extension's storage is empty afterwards. Not run by `build.ps1` or in CI.
- Not covered by any test: how it looks, the toolbar badge, the right-click entry in Chrome, loading the way a user does (Firefox signed install, Chrome Load unpacked).

## 9. M4 checklist: the player capture (experiment)

The feature is off by default. It records what a page's own player plays and joins it into an MP4 (decisions 0009 and 0010). This run decides whether it stays. Do the groups in order; A and B first, on the test page, so that you know the basics work before you go to a real site. Owner's run of 2026-11-14 is in the table (the notes say what was different from the plan). Mark each line, and write anything odd (what the page was doing, what the popup said) in the notes column of the results table.

Real sites: use YouTube (it is on the site list by default) and, if you like, one more site with an ordinary player. Use public videos only. Using this on a site whose terms forbid downloading is your choice (decision 0009).

### Results

| Group | Firefox | Chrome | Notes |
|---|---|---|---|
| A. Switches and the popup | pass | pass |  |
| B. Test page (`/mse.html`) | pass | pass | Includes `?switch=1` and `?eme=1`. |
| C. A short real video | pass | pass | Real site. Nothing cut off at either end. |
| D. A long real video | pass | pass | First run: 5:46 video, recording took about 3 min, paced by how fast the player buffers; file about 25 MB; memory stayed flat. A video of 10 minutes or more also passed (owner, 2026-11-14). |
| E. Quality: locked and switching | pass | pass | Quality kept after the reload; on Auto the player never switched (the refusal is checked on the test page only); a manual change during recording was reported. The popup has no quality choice by design (the quality is the one in the player menu); the top quality is 1080p or lower (owner, 2026-11-14). |
| F. An advertisement at the start | pass | pass | Pre-roll ads played; the recording took the main video, not the ad. Mid-roll ads not tried (open, left for real use). |
| G. Pause, seek, speed | pass | pass | Side note: seeking to the end of the grey (buffered) part of the timeline makes the player buffer further and speeds the recording up at any speed. |
| H. Background tab | pass | pass | Another tab, another window in front, browser minimised: the recording went on as if nothing had happened. No "tab hidden" message needed. |
| I. Protected video | pass (test page only) | pass (test page only) | `?eme=1` refused. No real DRM page tried (none found; left as is). |
| J. The files play | pass | pass | Video and `.m4a` in Firefox, WMP and VLC. |

### A. Switches and the popup

- [ ] A fresh profile (or the setting never touched): options page, section "Experimental: record from the player". The box is off, and the list holds `youtube.com`.
- [ ] With the box off, open YouTube and the popup: there is no "Record this page" section.
- [ ] Switch it on, reload YouTube, open the popup: the section shows "Record", with a line that the page is reloaded.
- [ ] Open the popup on a site that is not on the list: no section. Add that site to the list, reload the site: the section appears. Remove the line again: after a reload it is gone.
- [ ] Switch the box off again, reload YouTube: no section, and the player is offered the usual formats (nothing is hidden from it).

### B. Test page (`/mse.html`, add `127.0.0.1` to the list first)

- [ ] Press Record: the page reloads, the video plays 12 seconds, the section goes from "The video has not started yet..." to "Recording: 0:0x of 0:12." to "The whole video is recorded (0:12)."
- [ ] "Save" saves `StreamDraft player capture test page [original].mp4`; it has picture and sound. "Save audio only" saves a `.m4a`. A job panel with progress shows while it saves, and it ends with "Saved to your downloads folder."
- [ ] Close the popup while saving and open it again: the job panel is back and ends the same way.
- [ ] "Cancel recording": the section goes back to "Record" and Save is gone. Open the popup on another tab: no leftovers.
- [ ] `/mse.html?switch=1` with Record: the section says the player changed the quality, and Save stays disabled. "Record again" starts over.
- [ ] `/mse.html?eme=1` with Record: the section says the video is protected, and nothing can be saved.

### C. A short real video (one to two minutes, a plain public video)

- [ ] Open the video page, press Record in the popup. The page reloads. Start the video if it does not start by itself, and leave the tab alone.
- [ ] The section shows the covered time and a bar that moves while the video plays. At the end it says "The whole video is recorded".
- [ ] Save. The file name follows your template and the page title. The saved video has the same length as the page says.
- [ ] Look at the first seconds and the last seconds of the saved video: nothing is cut off at either end.

### D. A long real video (10 minutes or more)

- [ ] Record it to the end. The popup stays correct when you close and open it during the run.
- [ ] Watch the memory of the browser (Task Manager) now and then: it must not grow with the length of the video (the parts are written to the page's private storage as they come).
- [ ] The saved file plays to the end, and picture and sound stay together at the end (no drift).
- [ ] Note the time it took and the size of the file.

### E. Quality: locked and switching

- [ ] Set the quality by hand in the player (for example 720p) before you press Record. The page reloads; check that the player kept the quality, then let it play: the recording completes.
- [ ] Leave the quality on "Auto" and record a video long enough for the player to switch: either it never switches (fine), or the section says the quality changed and Record again is offered. Note which of the two happened, and what the section said.
- [ ] Open the player's settings during the recording and change the quality by hand: the section says so, nothing wrong is saved.
- [ ] The highest quality offered is 1080p or lower (H.264 only; no 4K).

### F. An advertisement at the start

- [ ] If you can, switch your ad blocker off for the site (or use a video that has an ad) and record. Say what the section did while the ad played and after it: it may say "The page started another video. Only the newest one is recorded.", which is fine if the saved file is the real video and not the ad. Anything else, write down.
- [ ] With the ad blocker on (your normal state), nothing special happens.

### G. Pause, seek, speed

- [ ] Pause in the middle for half a minute, then play: the recording goes on and completes.
- [ ] Skip forward in the player, then go back to the skipped part and play it: while the part is skipped the section says which part of the video was skipped, and after you have played it, it goes away and "The whole video is recorded" shows.
- [ ] Set the player speed to 2 (or higher): the recording finishes sooner and is complete. (Firefox kept 8 and 16 times speed in an earlier check; Chrome has not been tried.)
- [ ] Save before the end: Save is disabled and the section says what is missing.

### H. Background tab (decides whether a "tab hidden" message is needed)

- [ ] Start a recording, switch to another tab for a minute, and come back. Does the video go on, did it stop, is there a gap? What does the section say when you come back? Write the answer in the notes.
- [ ] Do the same with another window in front of the browser.
- [ ] Minimise the browser for a minute, come back and look at the section.

### I. Protected video

- [ ] On a page with encrypted media (the Shaka demo's DRM assets, or any site that needs Widevine) press Record: the section says it is protected, and nothing can be saved.

### J. The files play

- [ ] A saved video from groups C and D plays in Firefox, Windows Media Player and VLC (VLC is the strictest). The `.m4a` from "Save audio only" plays in the same three.

### Decision

**Decided by the owner on 2026-11-14: the feature stays, off by default** (an option the user switches on, globally and per site). All groups passed in Firefox and Chrome; the open points (mid-roll ads, real DRM) will be learned from real use.

## 10. M5 checklist: install and update (from a real release)

Tests what a user does, with files from the Releases page and not from your own build. It needs two published releases, because an update needs a newer version to find: `0.1.0` and a later test version (such as `0.1.1`) that you publish only for this check. Setup that only you can do: the AMO secrets, Pages enabled with GitHub Actions as the source (`docs/plan.md`, M5). Use Firefox release (not Developer Edition) for group B, so that the signature is really checked. Results go in the table; write what the browser said word for word when something is odd.

### Results

| Group | Firefox | Chrome | Notes |
|---|---|---|---|
| A. The release page and its files | | n/a | |
| B. Install in Firefox | | n/a | |
| C. Update in Firefox | | n/a | |
| D. Install and update in Chrome | n/a | | |
| E. The update manifest | | n/a | |

### A. The release page and its files

- [ ] The release has the signed `.xpi`, the Chrome zip, the sources zip and `SHA256SUMS.txt`, and no unsigned Firefox zip.
- [ ] `Get-FileHash -Algorithm SHA256` of each downloaded file matches its line in `SHA256SUMS.txt`.

### B. Install in Firefox

- [ ] Click the `.xpi` on the Releases page. Firefox asks to add the extension and lists the permissions (read your data on all sites, downloads, and so on). Write down if it is saved instead of installed (then use "Install Add-on From File...").
- [ ] After **Add**, `about:addons` shows StreamDraft with no "could not be verified" or "corrupt" warning. The extension's page shows version `0.1.0`.
- [ ] Open `pnpm run testpage` (or any page with a video): the popup lists the video and the download works.
- [ ] Restart Firefox: the extension is still there and its settings (Options) are as you left them.

### C. Update in Firefox

- [ ] With `0.1.0` installed, publish the later test version. The "Update manifest" workflow succeeds, and `https://shaulk80.github.io/StreamDraft/updates.json` lists the new version (group E).
- [ ] In `about:addons` choose the gear, **Check for Updates**. The extension updates to the new version without a prompt (or with one; write down which). Its settings are kept.
- [ ] Leave Firefox open for a day, or restart it, on a second profile with `0.1.0`: it updates on its own.
- [ ] Switch **Automatic Updates** off for the extension: a published newer version is not installed by itself.

### D. Install and update in Chrome

- [ ] Unzip the Chrome zip into a folder and **Load unpacked** from `chrome://extensions`: the popup lists a video and the download works.
- [ ] Change a setting. Unzip the later version over the same folder, click reload on the extension's card: the new version number shows and the setting is still there.

### E. The update manifest

- [ ] `updates.json` opens in the browser, lists one version, and its `update_link` opens (redirects to a download) the `.xpi` of that release.
- [ ] Its `update_hash` equals the hash of that `.xpi` in `SHA256SUMS.txt`.
- [ ] Publishing a pre-release does not change `updates.json`.
