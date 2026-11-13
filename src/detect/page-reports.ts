import type { MediaCandidate } from '../core/media.ts';
import type { ExtractorRegistry } from '../extractors/extractor-registry.ts';
import type { MediaRegistry } from './registry.ts';

/**
 * Adds the media files a page's content script reported to that tab's list.
 * The files are classified here, not in the page, so a page cannot pass
 * anything off as a video; the extractor for the page's address does it.
 * Returns how many were accepted.
 */
export async function addPageCandidates(
  registry: Pick<MediaRegistry, 'add'>,
  extractors: Pick<ExtractorRegistry, 'forPage'>,
  tabId: number,
  pageUrl: string | undefined,
  candidates: readonly MediaCandidate[],
): Promise<number> {
  const extracted = await extractors.forPage(pageUrl).extract({ pageUrl, candidates });
  if (!extracted.ok) {
    console.error(`StreamDraft: could not read the videos of the page: ${extracted.error}`);
    return 0;
  }

  let accepted = 0;
  for (const item of extracted.value) {
    const added = await registry.add(tabId, item);
    if (added.ok) {
      accepted += 1;
    }
  }
  return accepted;
}
