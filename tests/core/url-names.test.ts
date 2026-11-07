import { describe, expect, test } from 'vitest';
import { addressWithoutFragment, decodeForDisplay, fileNameOf, fileNameOfAddress } from '../../src/core/url-names.ts';

describe('decodeForDisplay', () => {
  test.each<[string, string, string]>([
    ['plain text', 'clip', 'clip'],
    ['escapes', 'Summer%20trip', 'Summer trip'],
    ['a bad escape stays as it is', '100%', '100%'],
  ])('%s', (_name, text, expected) => {
    expect(decodeForDisplay(text)).toBe(expected);
  });
});

describe('fileNameOf', () => {
  test.each<[string, string, string]>([
    ['with extension', '/a/b/clip.mp4', 'clip.mp4'],
    ['decoded', '/a/Summer%20trip.webm', 'Summer trip.webm'],
    ['path ends in a slash', '/a/b/', ''],
    ['root', '/', ''],
  ])('%s', (_name, pathname, expected) => {
    expect(fileNameOf(pathname)).toBe(expected);
  });
});

describe('fileNameOfAddress', () => {
  test.each<[string, string, string]>([
    ['an address', 'https://example.com/v/clip.mp4?token=1#t=5', 'clip.mp4'],
    ['not an address', 'nonsense', ''],
  ])('%s', (_name, address, expected) => {
    expect(fileNameOfAddress(address)).toBe(expected);
  });
});

describe('addressWithoutFragment', () => {
  test.each<[string, string, string | undefined]>([
    ['no fragment', 'https://example.com/a.mp4', 'https://example.com/a.mp4'],
    ['fragment dropped', 'https://example.com/a.mp4#t=5', 'https://example.com/a.mp4'],
    ['query kept', 'https://example.com/a.mp4?id=1#x', 'https://example.com/a.mp4?id=1'],
    ['not an address', 'nonsense', undefined],
  ])('%s', (_name, address, expected) => {
    expect(addressWithoutFragment(address)).toBe(expected);
  });
});
