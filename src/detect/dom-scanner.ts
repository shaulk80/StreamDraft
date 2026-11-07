import type { MediaCandidate } from '../core/media.ts';
import { candidatesFromElements, describeMediaElement } from './dom-candidates.ts';

const RESCAN_DELAY_MS = 250;
/** Media events do not bubble; listening on the document in the capture phase still sees them. */
const MEDIA_EVENTS = ['loadstart', 'loadedmetadata'] as const;

/** Takes the newly found files; resolves when they have been handed over. */
export type CandidateSink = (candidates: MediaCandidate[]) => Promise<void>;

/**
 * Watches a page for `<video>` and `<audio>` files and hands each new address
 * to `report` once. Always on: finding a video does not depend on the
 * in-page button setting.
 */
export class DomScanner {
  private readonly reported = new Set<string>();
  private mutations: MutationObserver | undefined;
  private timer: number | undefined;

  constructor(
    private readonly window: Window & typeof globalThis,
    private readonly report: CandidateSink,
  ) {}

  start(): void {
    this.mutations = new this.window.MutationObserver(() => this.queueScan());
    this.mutations.observe(this.window.document, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['src'],
    });

    for (const name of MEDIA_EVENTS) {
      this.window.document.addEventListener(name, this.onMediaEvent, true);
    }
    this.window.addEventListener('pageshow', this.onPageShow);
    void this.scan();
  }

  /**
   * Looks at the page again and reports every file in it, also the ones reported before
   * (the background may have lost them). Resolves with how many files the page has.
   */
  rescan(): Promise<number> {
    this.reported.clear();
    return this.scan();
  }

  stop(): void {
    this.mutations?.disconnect();
    this.mutations = undefined;
    for (const name of MEDIA_EVENTS) {
      this.window.document.removeEventListener(name, this.onMediaEvent, true);
    }
    this.window.removeEventListener('pageshow', this.onPageShow);
    if (this.timer !== undefined) {
      this.window.clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  private readonly onMediaEvent = (): void => {
    this.queueScan();
  };

  /**
   * A page restored from the back/forward cache never made a new request, so
   * the background has forgotten its videos: report them all again.
   */
  private readonly onPageShow = (event: PageTransitionEvent): void => {
    if (event.persisted) {
      this.reported.clear();
      void this.scan();
    }
  };

  /** Many changes arrive together (and background tabs get no animation frames): scan once after a short pause. */
  private queueScan(): void {
    if (this.timer !== undefined) {
      return;
    }
    this.timer = this.window.setTimeout(() => {
      this.timer = undefined;
      void this.scan();
    }, RESCAN_DELAY_MS);
  }

  private async scan(): Promise<number> {
    const document = this.window.document;
    const elements = [...document.querySelectorAll<HTMLMediaElement>('video, audio')].map(describeMediaElement);
    const found = candidatesFromElements(elements, { url: this.window.location.href, title: document.title });

    const fresh = found.filter((candidate) => !this.reported.has(candidate.url));
    if (fresh.length === 0) {
      return found.length;
    }

    for (const candidate of fresh) {
      this.reported.add(candidate.url);
    }
    await this.report(fresh);
    return found.length;
  }
}
