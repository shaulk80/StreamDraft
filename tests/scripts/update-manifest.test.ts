import { describe, expect, test } from 'vitest';
import { buildUpdateManifest, readAddonInfo, type UpdateInput } from '../../scripts/update-manifest.ts';

const sha256 = 'ab'.repeat(32);
const input: UpdateInput = {
  id: 'streamdraft@shaulk80.github.io',
  version: '0.1.0',
  strictMinVersion: '140.0',
  updateLink: 'https://github.com/shaulk80/StreamDraft/releases/download/v0.1.0/streamdraft-0.1.0-firefox.xpi',
  sha256,
};

describe('buildUpdateManifest', () => {
  test('lists the one version with its link, hash and lowest Firefox version', () => {
    expect(buildUpdateManifest(input)).toEqual({
      ok: true,
      value: {
        addons: {
          'streamdraft@shaulk80.github.io': {
            updates: [
              {
                version: '0.1.0',
                update_link: input.updateLink,
                update_hash: `sha256:${sha256}`,
                applications: { gecko: { strict_min_version: '140.0' } },
              },
            ],
          },
        },
      },
    });
  });

  test('leaves out applications when no lowest version is known', () => {
    const result = buildUpdateManifest({ ...input, strictMinVersion: undefined });

    expect(result.ok && result.value.addons[input.id]?.updates[0]).not.toHaveProperty('applications');
  });

  test.each<[string, Partial<UpdateInput>, string]>([
    ['a pre-release suffix', { version: '0.1.0-rc.1' }, 'plain dotted version'],
    ['an empty version', { version: '' }, 'plain dotted version'],
    ['a short hash', { sha256: 'abcd' }, 'SHA-256'],
    ['an upper-case hash', { sha256: 'AB'.repeat(32) }, 'SHA-256'],
    ['an http link', { updateLink: 'http://example.com/a.xpi' }, 'https'],
    ['a link that is no address', { updateLink: 'not a url' }, 'https'],
    ['an empty ID', { id: '' }, 'ID'],
  ])('refuses %s', (_name, change, expectedText) => {
    const result = buildUpdateManifest({ ...input, ...change });

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toContain(expectedText);
  });
});

describe('readAddonInfo', () => {
  test('reads the ID, version and lowest Firefox version', () => {
    const manifest = {
      version: '0.1.0',
      browser_specific_settings: { gecko: { id: 'a@b', strict_min_version: '140.0' } },
    };

    expect(readAddonInfo(manifest)).toEqual({
      ok: true,
      value: { id: 'a@b', version: '0.1.0', strictMinVersion: '140.0' },
    });
  });

  test.each<[string, unknown]>([
    ['null', null],
    ['text', 'manifest'],
    ['no version', { browser_specific_settings: { gecko: { id: 'a@b' } } }],
    ['no gecko section', { version: '1.0.0' }],
    ['an empty ID', { version: '1.0.0', browser_specific_settings: { gecko: { id: '' } } }],
    ['a lowest version that is no text', { version: '1.0.0', browser_specific_settings: { gecko: { id: 'a@b', strict_min_version: 140 } } }],
  ])('refuses %s', (_name, manifest) => {
    expect(readAddonInfo(manifest).ok).toBe(false);
  });
});
