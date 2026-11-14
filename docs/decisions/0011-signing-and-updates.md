# 0011: Signing and updates

Date: 2026-11-14. Status: proposed, for the owner to confirm before task 2.

## Decision

**Firefox.**
- `release.yml` signs the Firefox build on AMO as an unlisted add-on with `web-ext sign --channel unlisted --upload-source-code <sources zip>`, using the repository secrets `AMO_JWT_ISSUER` and `AMO_JWT_SECRET`. Without the secrets the step is skipped with a warning and the release carries the unsigned zip, as `0.0.1` did.
- The signed `.xpi` becomes a release asset next to the Chrome zip, the sources zip and `SHA256SUMS.txt` (the sums are written after signing, so they cover the `.xpi`).
- The Firefox manifest gets `browser_specific_settings.gecko.update_url = https://shaulk80.github.io/StreamDraft/updates.json`. The Chrome manifest does not get it.
- `updates.json` is hosted on GitHub Pages (source: GitHub Actions). It lists one entry: the newest published release that is not a pre-release: `version`, `update_link` (the release's `.xpi` URL), `update_hash` (`sha256:` of that file) and `applications.gecko.strict_min_version` (copied from the manifest).
- A separate workflow `pages.yml` builds and deploys it on `release: published` (the owner publishing the draft), and can also be started by hand. It downloads the `.xpi` from the published release, hashes it and runs the generator. Building it when the draft is created would be wrong: the asset address does not work until the release is published.
- The workflow takes the newest non-pre-release by version, not the one just published, so publishing an older release later cannot move users backwards.

**Chrome.** No store, no auto-update: the user loads the unzipped Chrome package in developer mode and updates by loading the newer zip. Chrome ignores an `update_url` outside the Web Store unless the extension is installed by policy, so there is nothing cheaper to offer. The README says so.

## Why

- The add-on ID is already `streamdraft@shaulk80.github.io`, which fits a `shaulk80.github.io` address; Pages needs no server and no extra account.
- A static JSON file is all Firefox needs for self-hosted updates, and an update link on GitHub Releases keeps the files and their hashes in one place.
- Publishing after the owner publishes the draft keeps the rule that Claude never publishes a release: no user sees an update before the owner decided.
- AMO may ask for the source of a bundled build; the sources zip is already produced by the build and `web-ext sign` can upload it with the submission (`--upload-source-code`, web-ext 10.8). Whether Mozilla accepts WXT's zip is proven only by the first real signing run.

## Consequences

- Needs from the owner before tasks 3 and 4 can run: AMO API credentials as repository secrets, and Pages enabled with GitHub Actions as the source.
- The first signed version cannot be tried before `0.1.0`: AMO refuses to sign a version number twice, so a failed or wrong signing run costs a version number, so the next try uses the next version number.
- An update is offered only when the signed `.xpi` of a higher version is published; the check in task 6 installs `0.1.0`, publishes a later test version and waits for (or forces) Firefox's update check.
- The `.xpi` URL goes through GitHub's redirect to its download host; Firefox follows redirects, to be confirmed in task 6.
- Not covered: a listing on addons.mozilla.org (a larger review and a public page) and a Chrome Web Store listing; both stay out of scope for v1.
