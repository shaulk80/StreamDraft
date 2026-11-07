import { describe, expect, test } from 'vitest';
import { headerValue, totalSizeOf } from '../../src/detect/headers.ts';

describe('headerValue', () => {
  test.each<[string, string, string | undefined]>([
    ['exact name', 'Content-Type', 'video/mp4'],
    ['other case', 'content-type', 'video/mp4'],
    ['absent', 'etag', undefined],
  ])('%s', (_name, wanted, expected) => {
    expect(headerValue([{ name: 'content-TYPE', value: 'video/mp4' }], wanted)).toBe(expected);
  });

  test('no headers at all', () => {
    expect(headerValue(undefined, 'content-type')).toBeUndefined();
  });
});

describe('totalSizeOf', () => {
  test.each<[string, number, Record<string, string>, number | undefined]>([
    ['whole file uses Content-Length', 200, { 'content-length': '5000' }, 5000],
    ['whole file without a length', 200, {}, undefined],
    ['garbage length', 200, { 'content-length': '12abc' }, undefined],
    ['partial uses the total of Content-Range', 206, { 'content-range': 'bytes 0-99/5000', 'content-length': '100' }, 5000],
    ['partial with unknown total', 206, { 'content-range': 'bytes 0-99/*', 'content-length': '100' }, undefined],
    ['partial never falls back to the piece length', 206, { 'content-length': '100' }, undefined],
    ['partial with a broken range', 206, { 'content-range': 'items 0-99/5000' }, undefined],
  ])('%s', (_name, statusCode, headers, expected) => {
    const list = Object.entries(headers).map(([name, value]) => ({ name, value }));

    expect(totalSizeOf(statusCode, list)).toBe(expected);
  });
});
