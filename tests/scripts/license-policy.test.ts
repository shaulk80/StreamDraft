import { describe, expect, test } from 'vitest';
import { classifyLicense, type LicenseVerdict } from '../../scripts/license-policy.ts';

describe('classifyLicense', () => {
  test.each<[string, LicenseVerdict]>([
    ['MIT', 'allowed'],
    ['Apache-2.0', 'allowed'],
    ['BSD-3-Clause', 'allowed'],
    ['GPL-3.0-only', 'denied'],
    ['AGPL-3.0-or-later', 'denied'],
    ['LGPL-2.1', 'warn'],
    ['MPL-2.0', 'warn'],
    ['Unknown', 'warn'],
    ['(MIT OR GPL-3.0)', 'allowed'],
    ['(GPL-2.0 OR GPL-3.0)', 'denied'],
    ['(MIT AND GPL-3.0)', 'denied'],
    ['(MIT AND Zlib)', 'allowed'],
    ['', 'warn'],
  ])('%s is %s', (expression, expected) => {
    expect(classifyLicense(expression)).toBe(expected);
  });
});
