import type { MediaItem } from '../core/media.ts';
import { classifyCandidate } from './classify.ts';
import { candidatesFromElements, type MediaElementInfo, type PageInfo } from './dom-candidates.ts';

/**
 * The downloadable item for one media element of the page, or undefined when
 * it has no file the extension can download (nothing chosen yet, a `blob:`
 * stream, a file type it does not know). Built the same way the page scanner
 * reports it, so the background knows the item under the same id.
 */
export function itemOfElement(element: MediaElementInfo, page: PageInfo): MediaItem | undefined {
  const [candidate] = candidatesFromElements([element], page);
  if (!candidate) {
    return undefined;
  }

  const classified = classifyCandidate(candidate);
  return classified.ok ? classified.value : undefined;
}
