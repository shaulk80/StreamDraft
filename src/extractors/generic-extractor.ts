import type { MediaItem } from '../core/media.ts';
import { ok, type Result } from '../core/result.ts';
import { classifyCandidate } from '../detect/classify.ts';
import type { ExtractContext, Extractor } from './extractor.ts';

export const GENERIC_EXTRACTOR_ID = 'generic';

/**
 * The extractor for every page: lists the media files found on it (direct
 * files, HLS and DASH streams) and skips what is not a video. Candidates that
 * do not name their page get the context's page address and title.
 */
export class GenericExtractor implements Extractor {
  readonly id = GENERIC_EXTRACTOR_ID;

  matches(): boolean {
    return true;
  }

  async extract(context: ExtractContext): Promise<Result<MediaItem[]>> {
    const items: MediaItem[] = [];
    for (const candidate of context.candidates) {
      const classified = classifyCandidate({
        ...candidate,
        pageUrl: candidate.pageUrl ?? context.pageUrl,
        pageTitle: candidate.pageTitle ?? context.pageTitle,
      });
      if (classified.ok) {
        items.push(classified.value);
      }
    }
    return ok(items);
  }
}
