import type { MediaCandidate } from '../core/media.ts';

/** The parts of a `<video>` or `<audio>` element the scan reads, so the logic runs without a DOM. */
export interface MediaElementInfo {
  /** The file the browser chose (resolved address); empty until it has started loading. */
  currentSrc: string;
  /** The element's own `src` attribute, resolved; empty when it uses `<source>` children. */
  src: string;
  sources: { src: string; type: string }[];
}

export interface PageInfo {
  url: string;
  title: string;
}

/**
 * One candidate per element that has a file to play. The file the browser
 * chose wins; a `<source type>` of that file gives the content type, which
 * matters for addresses without an extension. Elements that have not chosen
 * yet are picked up later, when the browser reports `loadstart`.
 */
export function candidatesFromElements(elements: readonly MediaElementInfo[], page: PageInfo): MediaCandidate[] {
  return elements.flatMap((element): MediaCandidate[] => {
    const url = element.currentSrc !== '' ? element.currentSrc : element.src;
    if (url === '') {
      return [];
    }

    const matching = element.sources.find((source) => source.src === url);
    return [
      {
        url,
        contentType: matching && matching.type !== '' ? matching.type : undefined,
        pageUrl: page.url,
        pageTitle: page.title,
      },
    ];
  });
}
