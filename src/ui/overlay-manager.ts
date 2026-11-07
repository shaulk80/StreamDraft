import type { MediaItem } from '../core/media.ts';
import type { Settings } from '../core/settings.ts';
import { describeMediaElement } from '../detect/dom-candidates.ts';
import { itemOfElement } from '../detect/video-item.ts';
import type { DownloadAction } from './download-client.ts';
import { VideoOverlay } from './video-overlay.ts';

const REPOSITION_FALLBACK_MS = 1000;
/** Media events do not bubble; listening on the document in the capture phase still sees them. */
const LOAD_EVENT = 'loadstart';

/**
 * Keeps one overlay per `<video>` in the page that has a file the extension can
 * download: finds the videos that exist, the ones added later and the ones that
 * get their file later, and removes the overlays of videos that are gone or whose
 * file changed. Stops completely (no observers, no timers) while the setting is off.
 */
export class OverlayManager {
  private readonly overlays = new Map<HTMLVideoElement, VideoOverlay>();
  private mutations: MutationObserver | undefined;
  private resizes: ResizeObserver | undefined;
  private timer: number | undefined;
  private settings: Settings | undefined;
  private scanQueued = false;

  constructor(
    private readonly window: Window & typeof globalThis,
    private readonly createAction: (settings: Settings) => DownloadAction,
  ) {}

  get running(): boolean {
    return this.settings !== undefined;
  }

  /** Starts, or restarts with new settings. */
  start(settings: Settings): void {
    this.stop();
    this.settings = settings;

    this.mutations = new this.window.MutationObserver(() => this.queueScan());
    this.mutations.observe(this.window.document, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['src'],
    });
    this.window.document.addEventListener(LOAD_EVENT, this.onLoad, true);
    this.resizes = new this.window.ResizeObserver(() => this.repositionAll());
    this.resizes.observe(this.window.document.documentElement);

    this.window.addEventListener('scroll', this.onViewChange, true);
    this.window.addEventListener('resize', this.onViewChange);
    // Layout can move without any event (images loading above the video).
    this.timer = this.window.setInterval(this.onViewChange, REPOSITION_FALLBACK_MS);

    this.scan();
  }

  stop(): void {
    this.mutations?.disconnect();
    this.resizes?.disconnect();
    this.mutations = undefined;
    this.resizes = undefined;
    this.window.document.removeEventListener(LOAD_EVENT, this.onLoad, true);
    this.window.removeEventListener('scroll', this.onViewChange, true);
    this.window.removeEventListener('resize', this.onViewChange);
    if (this.timer !== undefined) {
      this.window.clearInterval(this.timer);
      this.timer = undefined;
    }

    for (const overlay of this.overlays.values()) {
      overlay.destroy();
    }
    this.overlays.clear();
    this.settings = undefined;
  }

  private readonly onViewChange = (): void => {
    this.repositionAll();
  };

  private readonly onLoad = (): void => {
    this.queueScan();
  };

  /** Many DOM changes arrive together; look at the page once per frame. */
  private queueScan(): void {
    if (this.scanQueued) {
      return;
    }
    this.scanQueued = true;
    this.window.requestAnimationFrame(() => {
      this.scanQueued = false;
      this.scan();
    });
  }

  private scan(): void {
    const settings = this.settings;
    if (!settings) {
      return;
    }

    for (const [video, overlay] of this.overlays) {
      if (!overlay.attached || this.itemOf(video)?.id !== overlay.itemId) {
        overlay.destroy();
        this.overlays.delete(video);
        this.resizes?.unobserve(video);
      }
    }

    for (const video of this.window.document.querySelectorAll('video')) {
      const item = this.overlays.has(video) ? undefined : this.itemOf(video);
      if (item) {
        this.overlays.set(video, new VideoOverlay(video, item, settings, this.createAction(settings)));
        this.resizes?.observe(video);
      }
    }
  }

  /** The file of a video, or nothing when it has none that can be downloaded (yet). */
  private itemOf(video: HTMLVideoElement): MediaItem | undefined {
    const document = this.window.document;
    return itemOfElement(describeMediaElement(video), { url: this.window.location.href, title: document.title });
  }

  private repositionAll(): void {
    for (const overlay of this.overlays.values()) {
      overlay.reposition();
    }
  }
}
