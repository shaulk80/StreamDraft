import type { MediaCandidate, MediaItem } from '../core/media.ts';
import type { Result } from '../core/result.ts';

/** What an extractor is given about the page: the address, the title and the media files seen on it so far. */
export interface ExtractContext {
  pageUrl?: string;
  pageTitle?: string;
  /** Files the network observer or the page scanner found. A site extractor may ignore them. */
  candidates: readonly MediaCandidate[];
}

/**
 * Turns a page into downloadable items. The generic extractor works from the
 * files found on any page; a site extractor knows one site (for example from
 * data the page's own scripts hold) and takes over the pages it matches.
 * An expected failure (unsupported video, unreadable data) is a `Result`
 * error, never an exception.
 */
export interface Extractor {
  /** Short stable name, used in logs. */
  readonly id: string;
  /** True when this extractor knows the page. Must not throw on an address that is not valid. */
  matches(pageUrl: string | undefined): boolean;
  extract(context: ExtractContext): Promise<Result<MediaItem[]>>;
}
