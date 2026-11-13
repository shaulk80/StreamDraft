import type { MediaCandidate, MediaItem } from '../core/media.ts';
import type { ExtractorRegistry } from '../extractors/extractor-registry.ts';
import { classifyCandidate } from './classify.ts';
import { headerValue, totalSizeOf, type HeaderLike } from './headers.ts';
import type { MediaRegistry } from './registry.ts';

/** The fields of a `webRequest` event the observer reads. */
export interface ResponseDetails {
  url: string;
  tabId: number;
  statusCode: number;
  type: string;
  /** Firefox gives the page's address here, Chrome gives only its origin in `initiator`. */
  documentUrl?: string;
  initiator?: string;
  responseHeaders?: HeaderLike[];
}

export interface RequestStartDetails {
  tabId: number;
  type: string;
}

export interface TabInfo {
  url?: string;
  title?: string;
}

export interface ObserverDeps {
  registry: Pick<MediaRegistry, 'add' | 'list' | 'clear'>;
  extractors: Pick<ExtractorRegistry, 'forPage'>;
  /** Undefined when the tab is gone or cannot be read. */
  lookupTab(tabId: number): Promise<TabInfo | undefined>;
  /** A stream (HLS or DASH) was seen on the tab for the first time: time to read its manifest. */
  onStreamFound?(tabId: number): void;
}

/** Responses that carry a whole file or a piece of one. Everything else is not a download. */
const MEDIA_STATUS_CODES = [200, 206];
const TAB_NOT_FOUND = -1;

/**
 * Turns what the browser reports about requests into registry entries.
 * Observe only: it never changes or blocks a request.
 */
export class NetworkObserver {
  constructor(private readonly deps: ObserverDeps) {}

  /** A tab starts loading a new page: the videos of the old page no longer apply. */
  async handleRequestStart(details: RequestStartDetails): Promise<void> {
    if (details.type !== 'main_frame' || details.tabId === TAB_NOT_FOUND) {
      return;
    }
    await this.deps.registry.clear(details.tabId);
  }

  async handleResponse(details: ResponseDetails): Promise<void> {
    if (details.tabId === TAB_NOT_FOUND || !MEDIA_STATUS_CODES.includes(details.statusCode)) {
      return;
    }

    const candidate: MediaCandidate = {
      url: details.url,
      contentType: headerValue(details.responseHeaders, 'content-type'),
      sizeBytes: totalSizeOf(details.statusCode, details.responseHeaders),
    };
    const quick = classifyCandidate(candidate);
    if (!quick.ok) {
      // Nearly every response is not a video; there is nothing to report.
      return;
    }

    // A player asks for the same file many times (one request per range): only
    // the first sighting looks the tab up and starts reading a manifest.
    const known = await this.deps.registry.list(details.tabId);
    const isFirstSighting = !known.some((existing) => existing.id === quick.value.id);

    const item = isFirstSighting ? await this.withPageDetails(details, candidate, quick.value) : quick.value;
    await this.deps.registry.add(details.tabId, item);
    if (isFirstSighting && item.kind !== 'direct') {
      this.deps.onStreamFound?.(details.tabId);
    }
  }

  /** The page title and address for the item, from the tab. */
  private async withPageDetails(
    details: ResponseDetails,
    candidate: MediaCandidate,
    item: MediaItem,
  ): Promise<MediaItem> {
    const tab = await this.deps.lookupTab(details.tabId);
    const pageUrl = tab?.url ?? details.documentUrl ?? details.initiator;
    const extracted = await this.deps.extractors
      .forPage(pageUrl)
      .extract({ pageUrl, pageTitle: tab?.title, candidates: [candidate] });
    const [detailed] = extracted.ok ? extracted.value : [];
    return detailed ?? item;
  }
}
