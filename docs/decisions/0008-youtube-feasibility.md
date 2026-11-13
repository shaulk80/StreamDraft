# 0008: YouTube feasibility

Date: 2026-11-13. Status: findings and recommendation; the decision is the owner's, at the gate (task 4, record it in 0009).

## Question

Can an ordinary public YouTube video be downloaded by this extension within its rules: no `eval`, no remotely hosted code, no DRM circumvention, no external servers, everything bundled?

## What was checked

- **A real watch page.** One GET of `https://www.youtube.com/watch?v=jNQXAC9IVRw` ("Me at the zoo", 19 s) on 2026-11-13, no cookies, a Firefox 140 user agent. The `ytInitialPlayerResponse` variable (the one the MAIN-world script of task 2 reads) was parsed. Confirmed by the owner on 2026-11-13 in Firefox: `ytInitialPlayerResponse.streamingData.adaptiveFormats.some(f => f.url || f.signatureCipher)` returned `false` on a watch page. Not done: other videos, signed in against signed out, the extension running on youtube.com. The result agrees with the yt-dlp documents below, but it is one sample.
- **Documents:** the yt-dlp announcement [#14404](https://github.com/yt-dlp/yt-dlp/issues/14404), its [PO Token Guide](https://github.com/yt-dlp/yt-dlp/wiki/PO-Token-Guide) (last edited 2026-07-12), issue [#16082](https://github.com/yt-dlp/yt-dlp/issues/16082), a [third-party SABR guide](https://www.bigiron.cc/guides/yt-dlp-po-tokens-and-sabr-why-downloads-keep-breaking) (2026-08-09), the [YouTube terms](https://www.youtube.com/t/terms), the [Mozilla add-on policies](https://extensionworkshop.com/documentation/publish/add-on-policies/). The Chrome Web Store policy text could not be fetched (the overview page has no detail); Chrome is not a store target in v1 (decision 0001), so it is left out.

## Findings

1. **The page has no downloadable address at all.** In the player response: `playabilityStatus` OK, `streamingData` has only `expiresInSeconds`, `adaptiveFormats` (14 entries: itags 133, 134, 242, 395, 160, 278, 140, 249, 250, 251, audio and video) and `serverAbrStreamingUrl`. None of the 14 formats has a `url` or a `signatureCipher`. There is no `formats` list and no HLS or DASH manifest. So the old routes (plain URL, or a cipher to unscramble) are gone for the web client; the PO Token Guide says the same: the `web` client has "only SABR formats available".
2. **The only address is the SABR one.** `serverAbrStreamingUrl` is a `googlevideo.com/videoplayback` address with `sabr=1`, a signature (`sig`, `lsig`) and an `n` parameter. SABR is a server-driven session: the client posts a protobuf request, the server answers with a binary stream of parts and controls chunking and quality switching. There are no per-format files to fetch, so our HLS/DASH engine plan does not apply; a SABR client would be a new engine.
3. **Playback needs a PO token.** The PO Token Guide lists `web` as needing a token for video streaming ("GVS") and subtitles, bound to the video id, so one per video. The token comes from YouTube's attestation script (BotGuard) running in a page; yt-dlp cannot make it itself and uses a separate provider ([#14404](https://github.com/yt-dlp/yt-dlp/issues/14404)). Our own code cannot make it without fetching and running Google's script, which breaks the no-remote-code rule. The page's own player can, but we cannot ask it for a token.
4. **The `n` parameter needs the player's JavaScript.** yt-dlp gave up on its own interpreter: the functions are "spread out all over the player", and since 2025-11 it needs a full JavaScript runtime (Deno, Node, Bun, QuickJS) plus a solver bundle ([#14404](https://github.com/yt-dlp/yt-dlp/issues/14404)). Running a downloaded player script is exactly what the rules forbid (no `eval`, no remote code; Mozilla: "Add-ons must be self-contained and not load remote code for execution").
5. **Upkeep is high.** A maintainer in the thread behind that announcement put the rate at "one player per day" for player versions that broke signature extraction ([yt-dlp #14400](https://github.com/yt-dlp/yt-dlp/issues/14400)); the PO token rules are called an arms race. In February 2026 a client that worked without tokens stopped overnight ([#16082](https://github.com/yt-dlp/yt-dlp/issues/16082)). The one route the maintainers say needs neither `n` nor a token, the `web_safari` HLS formats, is not in the page response we read, and they promise it only "for as long as possible".
6. **Terms of service.** YouTube forbids to "access, reproduce, download, distribute ... any part of the Service or any Content" except as the Service permits, with exceptions for written permission or what the law permits, and to "circumvent ... security-related features or features that: (a) prevent or restrict the copying or other use of Content". Mozilla requires add-ons to "conform to the laws of the United States" and the part of the policy that was read (up to section 6.2.2.3) does not mention third-party terms. Whether SABR and PO tokens count as such a feature is a judgment, but a downloader that works only by getting around them would sit next to the project rule "No DRM circumvention".

## Options and cost

| Option | What it needs | Fits the rules? | Cost and risk |
|---|---|---|---|
| A. Read the response, use its addresses | Nothing | Yes | Does not work: no addresses. |
| B. Build a SABR client | Protobuf protocol, PO token, solved `n` | No (needs Google's attestation and player scripts run by us) | Large, breaks daily. |
| C. Capture what the page's own player loads: hook `MediaSource`/`SourceBuffer.appendBuffer` in the MAIN world and collect the media chunks | The player must play the video through (real time, or sped up); the engine gets a WebM muxer (the player often chooses VP9/Opus; our muxer reads fragmented MP4 only); chunks of an ad inserted by the server would be in the capture; quality is what the player chose | No remote code and no tokens (the page does the hard part), but it is still a download YouTube's terms forbid, and it works around SABR rather than with it | Medium to build; breaks when the player changes how it appends; slow for the user. Would also serve any site that plays through MSE (today `blob:` videos are skipped). |
| D. Drop YouTube from v1 | Nothing | Yes | Keeps the extractor interface and the MAIN-world plumbing for later; YouTube pages still get the generic detector (which finds nothing there). |

## Recommendation

**No-go for a YouTube extractor in v1 (option D).** The page gives nothing to download, the only working routes need either Google's scripts run inside the extension (B) or a playback-time capture that fights the site's own protection (C), and both break often and sit against the store and terms risks the project accepted on 2026-11-02 as the reason for this gate. Keep tasks 1 and 2 (they are small and useful), skip tasks 5 and 6, and finish M4 with the interface, the MAIN-world reader and a recorded decision.

If the owner wants a downloader for sites that stream through `MediaSource` without a manifest, option C as a generic MSE capture (not YouTube-specific) is the next thing to spike; it is a separate decision, with its own test page.

Finding 1 was checked a second time by the owner in Firefox (the console line above returned `false`), so it no longer rests on the one fetched page alone.
