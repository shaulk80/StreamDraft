import { describe, expect, test } from 'vitest';
import { resolveUrl } from '../../src/formats/resolve-url.ts';

describe('resolveUrl', () => {
  test.each([
    ['segment.ts', 'https://cdn.example.com/a/b/index.m3u8', 'https://cdn.example.com/a/b/segment.ts'],
    ['../up/segment.ts', 'https://cdn.example.com/a/b/index.m3u8', 'https://cdn.example.com/a/up/segment.ts'],
    ['/root/segment.ts', 'https://cdn.example.com/a/b/index.m3u8', 'https://cdn.example.com/root/segment.ts'],
    ['//other.example.org/x.ts', 'https://cdn.example.com/a/index.m3u8', 'https://other.example.org/x.ts'],
    ['https://abs.example.org/x.ts', 'https://cdn.example.com/a/index.m3u8', 'https://abs.example.org/x.ts'],
    ['seg.ts', 'https://cdn.example.com/a/index.m3u8?token=1', 'https://cdn.example.com/a/seg.ts'],
  ])('%s against %s', (reference, base, expected) => {
    expect(resolveUrl(reference, base)).toBe(expected);
  });

  test.each([
    ['segment.ts', 'not an address'],
    ['http://[bad', 'https://cdn.example.com/index.m3u8'],
  ])('gives undefined for %s against %s', (reference, base) => {
    expect(resolveUrl(reference, base)).toBeUndefined();
  });
});
