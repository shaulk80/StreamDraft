import { describe, expect, test } from 'vitest';
import { ok } from '../../src/core/result.ts';
import type { Extractor } from '../../src/extractors/extractor.ts';
import { ExtractorRegistry } from '../../src/extractors/extractor-registry.ts';
import { GENERIC_EXTRACTOR_ID } from '../../src/extractors/generic-extractor.ts';

function siteExtractor(id: string, host: string): Extractor {
  return {
    id,
    matches: (pageUrl) => URL.canParse(pageUrl ?? '') && new URL(pageUrl ?? '').hostname === host,
    extract: () => Promise.resolve(ok([])),
  };
}

describe('ExtractorRegistry.forPage', () => {
  const registry = new ExtractorRegistry([siteExtractor('a', 'a.example'), siteExtractor('b', 'b.example')]);

  test.each([
    ['https://a.example/watch', 'a'],
    ['https://b.example/watch', 'b'],
    ['https://other.example/watch', GENERIC_EXTRACTOR_ID],
    ['not an address', GENERIC_EXTRACTOR_ID],
    [undefined, GENERIC_EXTRACTOR_ID],
  ])('page %s is read by %s', (pageUrl, expectedId) => {
    expect(registry.forPage(pageUrl).id).toBe(expectedId);
  });

  test('without site extractors every page gets the generic one', () => {
    expect(new ExtractorRegistry().forPage('https://a.example/').id).toBe(GENERIC_EXTRACTOR_ID);
  });
});
