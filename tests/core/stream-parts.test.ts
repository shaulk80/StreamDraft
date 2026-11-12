import { describe, expect, test } from 'vitest';
import { collectParts, isPartOf, MAX_PART_RUNS, MAX_PART_URLS } from '../../src/core/stream-parts.ts';

const BASE = 'https://cdn.example.com/dash/';

function numbered(count: number, name = 'v-480p-s', extension = '.mp4'): string[] {
  return Array.from({ length: count }, (_, index) => `${BASE}${name}${index + 1}${extension}`);
}

describe('collectParts', () => {
  test('numbered segments become one run', () => {
    const parts = collectParts(numbered(60));

    expect(parts).toEqual({ partUrls: [], partRuns: [{ prefix: `${BASE}v-480p-s`, suffix: '.mp4' }] });
  });

  test('two runs of different names stay two runs', () => {
    const parts = collectParts([...numbered(5, 'video-'), ...numbered(5, 'audio-')]);

    expect(parts.partRuns).toHaveLength(2);
    expect(parts.partUrls).toEqual([]);
  });

  test.each([
    ['a plain file', [`${BASE}video.mp4`]],
    ['two numbered files', numbered(2)],
    ['no addresses', []],
  ])('%s stays as it is', (_name, addresses) => {
    expect(collectParts(addresses)).toEqual({ partUrls: addresses, partRuns: [] });
  });

  test('the same address twice counts once', () => {
    expect(collectParts([`${BASE}init-1.mp4`, `${BASE}init-1.mp4`, `${BASE}init-1.mp4`]).partRuns).toEqual([]);
  });

  test('signed addresses that differ in the query only still make one run', () => {
    const addresses = [1, 2, 3, 4].map((index) => `${BASE}seg-${index}.mp4?token=abc${index}9`);

    expect(collectParts(addresses).partRuns).toEqual([{ prefix: `${BASE}seg-`, suffix: '.mp4' }]);
  });

  test('a huge manifest does not grow the result without limit', () => {
    const distinct = Array.from({ length: MAX_PART_URLS + 50 }, (_, index) => `${BASE}file-${index}.mp4`);
    const manyNames = Array.from({ length: MAX_PART_RUNS + 10 }, (_, index) => numbered(3, `name${String.fromCharCode(97 + (index % 26))}${index}x-`)).flat();

    expect(collectParts(distinct).partUrls.length).toBeLessThanOrEqual(MAX_PART_URLS);
    expect(collectParts(manyNames).partRuns.length).toBeLessThanOrEqual(MAX_PART_RUNS);
  });
});

describe('isPartOf', () => {
  const stream = collectParts([...numbered(10), `${BASE}init.mp4`]);

  test.each([
    ['a numbered segment', `${BASE}v-480p-s7.mp4`, true],
    ['a segment with a number beyond the manifest\'s', `${BASE}v-480p-s99.mp4`, true],
    ['a segment with a query', `${BASE}v-480p-s7.mp4?x=1`, true],
    ['a named file', `${BASE}init.mp4`, true],
    ['a file of another name', `${BASE}other-s7.mp4`, false],
    ['the same name without a number', `${BASE}v-480p-s.mp4`, false],
    ['a number followed by letters', `${BASE}v-480p-s7a.mp4`, false],
    ['another host', 'https://other.example.net/dash/v-480p-s7.mp4', false],
  ])('%s', (_name, address, expected) => {
    expect(isPartOf(stream, address)).toBe(expected);
  });

  test('a stream without parts has none', () => {
    expect(isPartOf({}, `${BASE}a.mp4`)).toBe(false);
  });
});
