# StreamDraft: manual testing

For the owner's hands-on review of a milestone. The smoke tests (`pnpm run smoke`, `pnpm run smoke:chrome`) already check the main paths in headless browsers (list below); this file is for looking at the real thing: how it looks, how it feels, and what a user would hit. Per-milestone checklists are in `docs/manual/`.

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

One checklist per milestone, in `docs/manual/`. Each is a record: the steps, and under them what the owner found and when. Do each in Firefox, then in Chrome.

- `docs/manual/m5.md`: install and update from a real release. Repeat for every release.
- `docs/manual/m4.md`: the player capture experiment, on the test page and on real sites.
- `docs/manual/m3.md`: HLS, DASH, audio only, progress, large files. Done 2026-11-12 (results table inside); repeat it for a release. The last group, "Real streams", is the only way to learn whether the saved files play in a real player.
- `docs/manual/m2.md`: finding videos and plain downloads. Done by the owner when M2 was merged (PR #3); the smoke tests cover its main paths on every build (section 6). The lines marked (quick) are the ones to repeat after a change to the popup, the background script or detection (about 10 minutes).
- M1 sample screens: only to look at the popup states without a test page (see the end of `docs/manual/m2.md`).

A new milestone gets its own `docs/manual/mN.md` when it starts (copy the table layout from the skill template: step, expected, result, date). Steps use the exact labels in the UI, read from the source.

## 5. Known gaps (do not report again)

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

## 6. What the automated tests already cover

So you can skip it, or look only at how it feels:

- Firefox smoke (`pnpm run smoke`, packaged zip, headless): popup and background answer; the four sample cards and their Download text; overlay button shown, hidden and shown again by the setting; right-click entry downloads and follows the setting; detection lists the 5 files and not the tiny one; popup, in-page button and menu downloads save files of the right size and name; the two generated streams of `/download.html` download, are readable MP4 files (DASH: picture and sound) and end as "Saved to your downloads folder."; on `/silent.html` "Audio only" on a stream without sound ends with the failure text and saves nothing; on `/jobs.html` a slow stream shows its progress (also in a popup opened again) and is cancelled, a stream with a missing part ends with the failure text; options page keeps a setting and rejects a bad template.
- Chrome smoke (`pnpm run smoke:chrome`, packaged zip, headless Chrome): the service worker starts; the popup lists the same 5 files; popup Download and the in-page button save files of the right size and name; the two generated streams of `/download.html` download through the offscreen document and the document closes afterwards; the same silent-stream check, and the same progress, Cancel and failure checks on `/jobs.html`.
- Player capture (M4, both smoke tests, `/mse.html`, the setting switched on for `127.0.0.1`): an ordinary load is still offered VP9; the real popup (in a frame) offers Record, pressing it reloads the page, the section reaches "The whole video is recorded", "Save audio only" saves a readable `.m4a` under a job panel, "Cancel recording" leaves the page with nothing recorded; the armed load is offered H.264 only and its recording saves as MP4 and `.m4a`; a quality switch and encrypted media are refused with a reason. The checklist for real sites is written in task 11.
- Large file check (opt-in, `SMOKE_LARGE=1` before `pnpm run smoke` or `pnpm run smoke:chrome`; about a minute each, 3 GB of disk): the 1.1 GB stream of `/large.html` downloads, the saved file has every sample with the right bytes, the memory of the browser grows by less than 768 MB, and the extension's storage is empty afterwards. Not run by `build.ps1` or in CI.
- Not covered by any test: how it looks, the toolbar badge, the right-click entry in Chrome, loading the way a user does (Firefox signed install, Chrome Load unpacked).
