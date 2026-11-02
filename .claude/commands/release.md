---
description: Prepare and verify a StreamDraft release (version, notes, pull request, dry run, tag, draft, downloads)
argument-hint: <version, for example 0.1.2>
---

Release version `$ARGUMENTS` of StreamDraft. Read `CLAUDE.md` (Git and CI) first. Work one step at a time, report each result, and stop where a step is marked **owner**. Never push a tag, publish a release, merge, commit or push without the owner's explicit word for that step.

1. **Check the start.** `git status` is clean, `main` is up to date, and `$ARGUMENTS` is higher than the latest tag (`git tag -l 'v*'`). The latest CI run on `main` is green.
2. **Branch** `release-$ARGUMENTS` and change:
   - `package.json`: `version` to `$ARGUMENTS`.
   - `RELEASE_NOTES.md`: a new section at the top, headed `## $ARGUMENTS (<short description>)`. The release workflow takes the notes from the section that starts with `## $ARGUMENTS ` (with the space), so the heading must match. Base it on `git log <last-tag>..HEAD` and the merged pull requests. Keep the "Firefox build is signed by Mozilla as unlisted; Chrome build is unpacked" and known-limitations parts correct.
   - `README.md` where it names versions or packages, and `docs/status.md` (releases table).
3. **Check locally:** `.\scripts\build.ps1`, exit code 0.
4. **Commit, push and open the pull request.** Wait for all checks. **Owner** says when they passed. Merge with a regular merge commit (**owner**).
5. **Dry run:** `gh workflow run release.yml --ref main`, watch it, download the `release-preview` artifact, and check that it holds the Firefox zip, the Chrome zip, the sources zip (and, from M5, the signed `.xpi`) and one `SHA256SUMS.txt` (`sha256sum -c` OK), and that `notes.md` is the new section. No release is created by a dry run.
6. **Owner pushes the tag** from a clean, up to date `main`: `git tag v$ARGUMENTS && git push origin v$ARGUMENTS`. Give those exact commands; do not run them. If a job fails, look for a real error first; a flaky step is re-run with `gh run rerun <id> --failed`.
7. **Check the draft:** `gh release view v$ARGUMENTS` shows a draft with all assets and the notes. **Owner** reviews it on the releases page and presses Publish.
8. **Verify the public release:** download the assets into a new empty folder, `sha256sum -c SHA256SUMS.txt` (Git Bash), install the Firefox build by clicking the `.xpi` link (from M5) or load it in Developer Edition, load the Chrome zip unpacked, and confirm the popup opens and one test video downloads. Delete the temporary folder.
9. **Record it:** update `docs/status.md` (releases table, hashes, open items) and ask the owner whether to commit and push it.
