import { describe, expect, test } from 'vitest';
import { versionLabel } from '../../src/ui/about.ts';

describe('versionLabel', () => {
  test.each([
    ['0.1.1', 'Version 0.1.1'],
    [' 1.2.3 ', 'Version 1.2.3'],
    ['', 'Version unknown'],
    ['   ', 'Version unknown'],
    [undefined, 'Version unknown'],
  ])('says "%s" as "%s"', (version, expected) => {
    expect(versionLabel(version)).toBe(expected);
  });
});
