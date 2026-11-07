import type { MediaCandidate } from '../core/media.ts';
import { candidatesFromElements, type MediaElementInfo } from './dom-candidates.ts';

const RESCAN_DELAY_MS = 250;
/** Media events do not bubble; listening on the document in the capture phase still sees them. */
const MEDIA_EVENTS = ['loadstart', 'loadedmetadata'] as const;

export type CandidateSink = (candidates: MediaCandidate[]) => void;

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
    this.scan();
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
      this.scan();
    }
  };

  /** Many changes arrive together (and background tabs get no animation frames): scan once after a short pause. */
  private queueScan(): void {
    if (this.timer !== undefined) {
      return;
    }
    this.timer = this.window.setTimeout(() => {
      this.timer = undefined;
      this.scan();
    }, RESCAN_DELAY_MS);
  }

  private scan(): void {
    const document = this.window.document;
    const elements = [...document.querySelectorAll<HTMLMediaElement>('video, audio')].map(describe);
    const found = candidatesFromElements(elements, { url: this.window.location.href, title: document.title });

    const fresh = found.filter((candidate) => !this.reported.has(candidate.url));
    if (fresh.length === 0) {
      return;
    }

    for (const candidate of fresh) {
      this.reported.add(candidate.url);
    }
    this.report(fresh);
  }
}

function describe(element: HTMLMediaElement): MediaElementInfo {
  return {
    currentSrc: element.currentSrc,
    src: element.src,
    sources: [...element.querySelectorAll('source')].map((source) => ({ src: source.src, type: source.type })),
  };
}
