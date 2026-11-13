import type { Extractor } from './extractor.ts';
import { GenericExtractor } from './generic-extractor.ts';

/**
 * Picks the extractor for a page: the first site extractor that matches,
 * otherwise the generic one, which accepts every page.
 */
export class ExtractorRegistry {
  private readonly generic: Extractor;

  constructor(
    private readonly siteExtractors: readonly Extractor[] = [],
    generic: Extractor = new GenericExtractor(),
  ) {
    this.generic = generic;
  }

  forPage(pageUrl: string | undefined): Extractor {
    return this.siteExtractors.find((extractor) => extractor.matches(pageUrl)) ?? this.generic;
  }
}
