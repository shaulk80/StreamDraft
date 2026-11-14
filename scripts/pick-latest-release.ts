import { readFileSync } from 'node:fs';
import { fail, ok, type Result } from '../src/core/result.ts';
import { selectLatestRelease, type ReleaseInfo, type SelectedRelease } from './release-selection.ts';

// Reads GitHub's list of releases as JSON on stdin (an array, or the array of
// arrays that `gh api --paginate --slurp` prints) and prints two lines for a
// workflow to append to $GITHUB_OUTPUT: tag=... and xpi=...
//   gh api --paginate --slurp repos/OWNER/REPO/releases | node scripts/pick-latest-release.ts
// Exit code 1 means nothing suitable was found; the reason is printed.

function parseReleases(text: string): Result<ReleaseInfo[]> {
  try {
    const data = JSON.parse(text) as unknown;
    if (!Array.isArray(data)) {
      return fail('the input is not a JSON array');
    }
    return ok(data.flat() as ReleaseInfo[]);
  } catch (error) {
    console.error(error);
    return fail('the input is not valid JSON');
  }
}

function run(): Result<SelectedRelease> {
  const releases = parseReleases(readFileSync(0, 'utf8'));
  if (!releases.ok) {
    return releases;
  }
  return selectLatestRelease(releases.value);
}

const outcome = run();
if (outcome.ok) {
  console.log(`tag=${outcome.value.tag}`);
  console.log(`xpi=${outcome.value.xpiName}`);
} else {
  console.error(`pick-latest-release failed: ${outcome.error}`);
  process.exit(1);
}
