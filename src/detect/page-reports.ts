import type { MediaCandidate } from '../core/media.ts';
import { classifyCandidate } from './classify.ts';
import type { MediaRegistry } from './registry.ts';

/**
 * Adds the media files a page's content script reported to that tab's list.
 * The files are classified here, not in the page, so a page cannot pass
 * anything off as a video. Returns how many were accepted.
 */
export async function addPageCandidates(
  registry: Pick<MediaRegistry, 'add'>,
  tabId: number,
  candidates: readonly MediaCandidate[],
): Promise<number> {
  let accepted = 0;
  for (const candidate of candidates) {
    const item = classifyCandidate(candidate);
    if (!item.ok) {
      continue;
    }

    const added = await registry.add(tabId, item.value);
    if (added.ok) {
      accepted += 1;
    }
  }
  return accepted;
}
