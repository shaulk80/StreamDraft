import { fail, ok, type Result } from '../src/core/result.ts';

// Picks the release whose signed .xpi the update manifest points to (decision 0011):
// the newest published release that is not a pre-release and carries an .xpi.
// "Newest" is by version number, not by date, so publishing an older release
// later cannot move users backwards.

/** The fields of GitHub's "list releases" answer that matter here. */
export interface ReleaseInfo {
  tag_name: string;
  draft: boolean;
  prerelease: boolean;
  assets: { name: string }[];
}

export interface SelectedRelease {
  tag: string;
  xpiName: string;
}

const tagPattern = /^v(\d+(?:\.\d+){0,3})$/;

export function selectLatestRelease(releases: ReleaseInfo[]): Result<SelectedRelease> {
  let best: { parts: number[]; selected: SelectedRelease } | undefined;
  for (const release of releases) {
    const candidate = toCandidate(release);
    if (candidate === undefined) {
      continue;
    }
    if (best === undefined || compareParts(candidate.parts, best.parts) > 0) {
      best = candidate;
    }
  }
  if (best === undefined) {
    return fail('no published release (not a draft, not a pre-release, tag like v0.1.0) has an .xpi file');
  }
  return ok(best.selected);
}

function toCandidate(release: ReleaseInfo): { parts: number[]; selected: SelectedRelease } | undefined {
  if (release.draft || release.prerelease) {
    return undefined;
  }
  const match = tagPattern.exec(release.tag_name);
  const version = match?.[1];
  if (version === undefined) {
    return undefined;
  }
  const xpi = release.assets.find((asset) => asset.name.endsWith('.xpi'));
  if (xpi === undefined) {
    return undefined;
  }
  return { parts: version.split('.').map(Number), selected: { tag: release.tag_name, xpiName: xpi.name } };
}

function compareParts(left: number[], right: number[]): number {
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index++) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }
  return 0;
}
