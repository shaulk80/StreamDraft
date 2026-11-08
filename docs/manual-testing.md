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
| Detection page | `/detect.html` | detection, the popup list, the badge, downloads |
| Streams page | `/streams.html` | HLS and DASH detection and the quality list (M3) |
| Stream download page | `/download.html` | two tiny streams with real segments that download (M3) |
| Job display page | `/jobs.html` | a slow and a broken stream: progress, Cancel, failure text (M3) |
| Large stream page | `/large.html` | one stream of 1.1 GB, built by the server as it is asked for (M3, large file check) |

The media files are filler bytes with the right content type. They do not play (the player shows an error), but they download. Sizes: `direct.mp4` 300 KB, `clip.webm` 250 KB, `song.mp3` 200 KB, `late.mp4` 220 KB, `hidden-stream` 400 KB, `tiny.mp4` 2 KB.

Downloads go to your normal download folder. The browser never overwrites: a second download of the same name gets `(1)`.

## 4. M2 checklist: detection and downloads

Do each in Firefox, then in Chrome.

**Detection page** (`/detect.html`):
- [ ] The toolbar badge counts up to 5 within about 2 seconds (the last file is added by the page after 1 second).
- [ ] The popup lists 5 cards: `clip.webm`, `direct.mp4`, `hidden-stream`, `late.mp4`, `song.mp3`. Every card is titled "StreamDraft detection test page" (none named after the address). Each card has the line `127.0.0.1 · Direct file · <file name>`, a quality list with one entry (e.g. "MP4 (300 KB)"), a Download button. With 5 cards the list scrolls inside the popup (a scrollbar next to the cards); the popup itself has no scrollbar, and no horizontal one.
- [ ] `tiny.mp4` is not listed (the page fetches it, but it is too small).
- [ ] `hidden-stream` is listed although it is not in the page (only the network observer sees it).
- [ ] Download on `direct.mp4`: the card says `Saving as "StreamDraft detection test page [original].mp4".` and the file appears in the download folder with 300 KB. Try one more card; `hidden-stream` saves as `... [original].mp4`.
- [ ] Reload the page: the list and the badge reset and fill again.
- [ ] "Refresh" button (top of the popup, next to Settings): click it. A line appears under the title: "Checked the page again. N videos listed." and the list is redrawn (quality choices and result lines reset). It does not find a file the network observer missed earlier (that traffic is gone), but it re-reports everything the page itself contains. If you ever see a missing video again, note what the page was doing (just loaded, scrolled, a video added by script) and whether Refresh brought it back.
- [ ] Refresh on a page the extension cannot reach (for example a tab opened before you loaded the extension, or `about:debugging`): the line says it could not check the page and shows the saved list.
- [ ] Open the popup while the page is still loading: the list grows live.
- [ ] Open `/` in the same tab: the badge and the list change to that page's files.
- [ ] A page without videos (for example the options page): the popup says "No videos found on this page." and there is no badge.

**Overlay page** (`/`):
- [ ] The video without a file at the top has no button. The tiny 80 x 45 video has no button. The three normal videos have a "Download" button in the top-right corner, including the one added after 1.5 seconds.
- [ ] Scroll down: the button of the far-down video follows it, and buttons of videos scrolled out of view disappear.
- [ ] Click the button, then Download in the small panel: it says `Saving as "StreamDraft test page [original].mp4".` (or the song/late name for the others) and the file is saved.
- [ ] Right-click a video: the menu has "Download video with StreamDraft". Choosing it shows a toast and saves the file. The toast is a small dark box at the bottom right of the page with the same `Saving as ...` text; it stays 5 seconds and disappears. If the browser's "ask where to save" dialog is on, the toast may only appear after you close the dialog, so turn that setting off for this check.
- [ ] Right-click a video that has no file (the one at the top): the entry may show; choosing it says it could not tell which video this is, or downloads the only video; it must not download a wrong file.

**Options** (toolbar button, Settings):
- [ ] Untick "Show a download button on videos in the page" while the overlay page is open: the buttons vanish without reloading the page; switch on: they come back.
- [ ] Untick 'Add "Download video" to the right-click menu': the right-click entry is gone; tick it: it is back.
- [ ] File name: change it to `{site} {date}`; the line "Example: ..." under the File name field updates as you type, showing the name a sample video would get (for `{site} {date}` something like `example.com 2026-11-08.mp4`); the next download is named like `127.0.0.1 2026-11-08.mp4`.
- [ ] A bad template such as `{nope}` shows an error and is not saved; the old one keeps working.
- [ ] Default quality: plain files have one quality, so nothing changes for them; check that picking another one does not break a download.
- [ ] Browser setting "ask where to save files" (Firefox: Settings, General, Downloads; Chrome: Settings, Downloads, "Ask where to save each file"): with it on, a download from the popup, the button and the menu opens the save dialog, with the template name filled in; with it off, the file goes straight to the download folder.
- [ ] Settings survive closing and reopening the browser (not the temporary Firefox add-on: it is removed on exit).

**Streams page** (`/streams.html`, M3):
- [ ] The popup shows two cards, briefly "Reading the stream..." and then the qualities: `127.0.0.1 · HLS stream · mp4` with 720p, 360p, Audio only; `127.0.0.1 · DASH stream · mp4` with 720p (8.9 MB), 360p (2.9 MB), Audio only (234 KB).
- [ ] The rendition playlist the page loads (`v720/index.m3u8`) is not a card of its own. The badge counts 2.
- [ ] Download on these streams starts a job that fails (their segments do not exist on this page): the card ends with "Could not save the video." and the server's answer (e.g. "Segment 1 of 3: The server answered 404."; the numbers depend on the stream), the Download button comes back, nothing is saved. Use the download page below for a download that works.
- [ ] Stop `pnpm run testpage`, reload the popup on a fresh tab of the page: the cards say the playlist could not be loaded, and read fine again after you restart the server and press Refresh.

**Stream download page** (`/download.html`, M3 task 9):
- [ ] The popup shows two cards: `127.0.0.1 · DASH stream · mp4` (360p, Audio only) and `127.0.0.1 · HLS stream · mp4`.
- [ ] Download on the DASH card: the Download button waits, the card shows "Starting..." or a progress bar (it is over quickly), then "Saved to your downloads folder.", the button comes back, and the file `StreamDraft stream download test page [360p].mp4` is in the download folder, a few KB. The HLS card saves `... [original].mp4`. (The pictures are made-up bytes: the files are valid MP4 structure but do not play.)
- [ ] Chrome only: the engine runs in an offscreen document that exists only while a download runs (the smoke test sees it open and then closed; whether `chrome://extensions` lists it under Inspect views is not checked).
- [ ] Pick "Audio only" on the DASH card and press Download: the file `... [audio].m4a` is saved (a sound track of 4 samples, a few KB). On the HLS card the sound is cut out of the video segments: `... [audio].m4a` again, named with `(1)` after the first. (Made-up bytes: the files have valid structure but do not play.)
- [ ] Download the same card twice: the second file is named with `(1)`; nothing is overwritten. Press the two downloads one after the other: two downloads of one name started in the same instant sometimes make Firefox interrupt one of them (seen in the smoke test); the card then says "Could not save the video. The browser could not save the finished video."
- [ ] Real streams, audio only: on a public page with a plain HLS or DASH video, pick "Audio only", save, and play the `.m4a` in Firefox, Windows Media Player and VLC. A video without a sound track should end with "Could not save the video. This video has no sound to save."
**Job display page** (`/jobs.html`, M3 task 11): the popup lists two HLS streams of the same title; the first has 40 parts of 0.4 seconds each, in the second the second part is missing.
- [ ] Download on the first card: the button is disabled, a progress bar fills and the line says "Downloading: 12% (...)" with a growing size; a Cancel button sits next to it.
- [ ] While it runs, close the popup and open it again: the card shows the running job again (bar, text, Cancel), and the Download button is disabled.
- [ ] Press Cancel: the line says "Cancelled.", the bar and Cancel disappear, the Download button comes back, nothing is saved. In Chrome the offscreen document closes.
- [ ] Download on the second card: the line says "Could not save the video." with the server's answer ("Segment 2 of 2: The server answered 404."); the Download button comes back.
- [ ] Let the first card run to the end (about 5 seconds): the bar fills, "Joining the parts and saving..." (no Cancel), then "Saved to your downloads folder."
- [ ] A job whose background was killed (close the browser during a download, start it again, open the popup): the card does not show a stale job forever; after 10 minutes without news it is forgotten.
- [ ] Firefox private window: Download says the browser would not give the extension space (OPFS is not available there). Not verified yet.
- [ ] Real streams: on a public page with a plain (not protected) HLS or DASH video, download a low quality and play the file in Firefox, Windows Media Player and VLC.

**Large stream page** (`/large.html`, M3 task 13): one DASH stream, 720p and Audio only, of 68 parts of 16 MB. Needs about 3 GB of free disk space for a minute or two, and a task manager open next to the browser. (`SMOKE_LARGE=1` runs the same download in the smoke tests and measures the memory for you; this is the by-hand version.)
- [ ] Download the 720p card: the bar fills in a minute or less and the card ends with "Saved to your downloads folder."; `StreamDraft large stream test page [720p].mp4` is about 1.1 GB. (Made-up bytes: it does not play.)
- [ ] While it runs, watch the memory of the browser in the task manager (Firefox: the extension's tab process; Chrome: the "Extension" renderer, there is one more while the offscreen document lives). It should climb by a few hundred MB and stay there, not follow the bar up to 1.1 GB. Measured with the smoke tests: Firefox +150 to +380 MB, Chrome +400 to +590 MB.
- [ ] Afterwards the temporary files are gone: in Firefox `about:preferences#privacy` > Cookies and Site Data, or in Chrome the site data of the extension, shows nothing large. (The smoke test reads the storage use of the extension after the job: 0 MB.)
- [ ] Press Cancel half way: "Cancelled.", the memory falls back, and the disk space is given back.

**Sample screens** (M1, kept for review): add `?mock=1` to the popup address to see the four sample videos (direct, HLS, DASH, DRM-protected) and `?mock=empty` for the empty state. The popup address is `moz-extension://<id>/popup.html` in Firefox (id shown on `about:debugging`) and `chrome-extension://<id>/popup.html` in Chrome (id on `chrome://extensions`). Download on those only says what it would do.

## 5. Known gaps (do not report again)

- The in-page button appears only for a video whose own address is a recognisable media file. A `blob:` stream or an address without extension and type gets no button; the popup still lists what the network observer saw.
- No button or toast for videos inside iframes; no button in fullscreen.
- Downloads do not send the page's `Referer`: hosts that check it refuse.
- A download that fails after it started (server error) is not reported yet (M6).
- Cancel works while the parts are being fetched; the last step (joining the parts and handing the file to the browser) cannot be stopped from the popup. Protected videos are never downloaded.
- Temporary files of a stream download that was cut off by a browser crash stay in the extension's private storage until a later version cleans them (M6).
- Live streams and DASH with several periods are listed with an error for now.
- A stream's manifest is read by the extension without the page's `Referer`: hosts that check it make the card say the playlist could not be loaded.
- The extension asks for access to all sites (detection needs it; see `docs/decisions/0002-detection-permissions.md`).
- The right-click entry has not been run in Chrome by the automated tests (headless Chrome cannot operate the menu): check it by hand there.

## 6. What the automated tests already cover

So you can skip it, or look only at how it feels:

- Firefox smoke (`pnpm run smoke`, packaged zip, headless): popup and background answer; the four sample cards and their Download text; overlay button shown, hidden and shown again by the setting; right-click entry downloads and follows the setting; detection lists the 5 files and not the tiny one; popup, in-page button and menu downloads save files of the right size and name; the two generated streams of `/download.html` download, are readable MP4 files (DASH: picture and sound) and end as "Saved to your downloads folder."; on `/jobs.html` a slow stream shows its progress (also in a popup opened again) and is cancelled, a stream with a missing part ends with the failure text; options page keeps a setting and rejects a bad template.
- Chrome smoke (`pnpm run smoke:chrome`, packaged zip, headless Chrome): the service worker starts; the popup lists the same 5 files; popup Download and the in-page button save files of the right size and name; the two generated streams of `/download.html` download through the offscreen document and the document closes afterwards; the same progress, Cancel and failure checks on `/jobs.html`.
- Large file check (opt-in, `SMOKE_LARGE=1` before `pnpm run smoke` or `pnpm run smoke:chrome`; about a minute each, 3 GB of disk): the 1.1 GB stream of `/large.html` downloads, the saved file has every sample with the right bytes, the memory of the browser grows by less than 768 MB, and the extension's storage is empty afterwards. Not run by `build.ps1` or in CI.
- Not covered by any test: how it looks, the toolbar badge, the right-click entry in Chrome, loading the way a user does (Firefox signed install, Chrome Load unpacked).
