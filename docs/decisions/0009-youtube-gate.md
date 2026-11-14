# 0009: The M4 gate: record from the player, as an experiment behind switches

Date: 2026-11-13. Status: accepted by the owner for an experiment. Reviewed 2026-11-14 after the manual run (all groups pass in Firefox and Chrome): the feature stays, off by default.

## Decision

- **No YouTube extractor** (decision 0008: the page gives no address to download, and the routes that work need Google's scripts run by us).
- **Go for option C of 0008 as an experiment:** record what a page's own player plays, by watching the media pipeline in the page (`MediaSource` and `SourceBuffer`), and join it with the existing engine into a flat MP4. It is **not YouTube-specific**: it is a generic "player capture" that any site with a plain player (including the `blob:` videos M2 skipped) can use. The sites it runs on are a list in the settings.
- **Accepted costs** (owner, 2026-11-13): the video has to play through while the tab stays open and visible; the player is steered to H.264/AAC so quality stops where H.264 stops (up to 1080p on YouTube, no 4K); a download that a site's terms forbid is the user's choice (see below).
- **Protected media stays out:** a page that uses encrypted media (EME) is reported as protected and nothing is recorded (project rule: no DRM circumvention).

## The switches

The terms of service of some sites (YouTube's, see 0008) forbid downloading. The owner wants to be able to turn the feature off for everything or for one site without a new release, and to decide after trying it whether it stays.

- **Global:** the setting `playerCapture`, **off by default**. Options page, section "Experimental: record from the player".
- **Per site:** the setting `playerCaptureSites`, a list of plain site names (default `youtube.com`; a site includes its subdomains). The capture runs only on listed sites; removing a line switches that site off.
- **Nothing is injected when it is off.** The page-world script is not in the manifest. The background registers it with `scripting.registerContentScripts` (world `MAIN`, `document_start`, match patterns from the list) only while the setting is on, and removes it when it is off or the list is empty (`CaptureRegistrar`, `src/extractors/capture-registration.ts`). The state is made to match the settings on every start of the background and on every change. Pages that are already open keep what they have until they are loaded again; the options page says so.
- **New permission: `scripting`**, for this registration only. Host access for it is the existing all-sites access (decision 0002). To be explained in the README with the others (M5).
- **To remove the feature for good** (for example if a store reviewer objects): delete the `scripting` permission, `CaptureRegistrar` and the `player-capture-main` entry point; nothing else depends on them.

## Checked

Unit tests for the setting, the site list and the registrar; both smoke tests (headless Firefox and Chrome 157) load `/main-world.html` with the capture off (nothing arrives), on for `127.0.0.1` (the page's variable reaches the background), and off again (nothing arrives). The built manifests have no capture script in `content_scripts`.
