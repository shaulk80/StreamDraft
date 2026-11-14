import { describe, expect, test } from 'vitest';
import { selectLatestRelease, type ReleaseInfo } from '../../scripts/release-selection.ts';

function release(tag: string, change: Partial<ReleaseInfo> = {}): ReleaseInfo {
  return {
    tag_name: tag,
    draft: false,
    prerelease: false,
    assets: [{ name: 'SHA256SUMS.txt' }, { name: `streamdraft-${tag.slice(1)}-firefox.xpi` }],
    ...change,
  };
}

describe('selectLatestRelease', () => {
  test.each<[string, ReleaseInfo[], string]>([
    ['the only release', [release('v0.1.0')], 'v0.1.0'],
    ['the highest version, whatever the order', [release('v0.1.0'), release('v0.2.0'), release('v0.1.5')], 'v0.2.0'],
    ['numbers, not text: 0.10.0 beats 0.9.0', [release('v0.9.0'), release('v0.10.0')], 'v0.10.0'],
    ['a longer version beats a shorter equal prefix', [release('v1.0'), release('v1.0.1')], 'v1.0.1'],
    ['an older release listed first does not win', [release('v0.1.0'), release('v0.3.0'), release('v0.2.0')], 'v0.3.0'],
  ])('picks %s', (_name, releases, expectedTag) => {
    const result = selectLatestRelease(releases);

    expect(result.ok && result.value.tag).toBe(expectedTag);
  });

  test('returns the name of the .xpi asset', () => {
    expect(selectLatestRelease([release('v0.1.0')])).toEqual({
      ok: true,
      value: { tag: 'v0.1.0', xpiName: 'streamdraft-0.1.0-firefox.xpi' },
    });
  });

  test.each<[string, ReleaseInfo[]]>([
    ['no releases', []],
    ['only a draft', [release('v0.2.0', { draft: true })]],
    ['only a pre-release', [release('v0.2.0', { prerelease: true })]],
    ['a release without an .xpi', [release('v0.2.0', { assets: [{ name: 'streamdraft-0.2.0-firefox.zip' }] })]],
    ['a tag that is not a version', [release('nightly')]],
    ['a tag with a pre-release suffix', [release('v0.2.0-rc.1')]],
  ])('refuses %s', (_name, releases) => {
    const result = selectLatestRelease(releases);

    expect(result.ok).toBe(false);
  });

  test('skips drafts, pre-releases and releases without an .xpi in favour of an older good one', () => {
    const result = selectLatestRelease([
      release('v0.4.0', { draft: true }),
      release('v0.3.0', { prerelease: true }),
      release('v0.2.0', { assets: [] }),
      release('v0.1.0'),
    ]);

    expect(result.ok && result.value.tag).toBe('v0.1.0');
  });
});
