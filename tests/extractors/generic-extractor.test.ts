import { describe, expect, test } from 'vitest';
import type { MediaCandidate } from '../../src/core/media.ts';
import { GenericExtractor } from '../../src/extractors/generic-extractor.ts';

async function titlesOf(candidates: MediaCandidate[], pageTitle?: string): Promise<string[]> {
  const result = await new GenericExtractor().extract({ pageUrl: 'https://example.com/watch', pageTitle, candidates });
  expect(result.ok).toBe(true);
  return result.ok ? result.value.map((item) => item.title) : [];
}

describe('GenericExtractor.extract', () => {
  test.each([
    ['a video file', [{ url: 'https://example.com/a.mp4' }], ['Page']],
    ['a file that is not a video', [{ url: 'https://example.com/page.html', contentType: 'text/html' }], []],
    ['a blob address', [{ url: 'blob:https://example.com/1' }], []],
    ['a tiny file', [{ url: 'https://example.com/a.mp4', sizeBytes: 100 }], []],
    ['no candidates', [], []],
    [
      'a candidate with its own title',
      [{ url: 'https://example.com/a.mp4', pageTitle: 'Own' }, { url: 'https://example.com/b.webm' }],
      ['Own', 'Page'],
    ],
  ])('%s', async (_name, candidates, expectedTitles) => {
    expect(await titlesOf(candidates, 'Page')).toEqual(expectedTitles);
  });

  test('is the extractor for every page', () => {
    expect(new GenericExtractor().matches()).toBe(true);
  });
});
