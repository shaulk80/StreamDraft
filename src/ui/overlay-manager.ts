import type { MediaItem } from '../core/media.ts';
import type { Settings } from '../core/settings.ts';
import { VideoOverlay } from './video-overlay.ts';

const REPOSITION_FALLBACK_MS = 1000;

/**
 * Keeps one overlay per `<video>` in the page: finds the videos that exist,
 * the ones added later, and removes overlays of videos that are gone. Stops
 * completely (no observers, no timers) while the setting is off.
 */
export class OverlayManager {
  private readonly overlays = new Map<HTMLVideoElement, VideoOverlay>();
  private mutations: MutationObserver | undefined;
  private resizes: ResizeObserver | undefined;
  private timer: number | undefined;
  private settings: Settings | undefined;
  private scanQueued = false;

  /** `item` is the fake video every overlay shows (M1 only). */
  constructor(
    private readonly window: Window & typeof globalThis,
    private readonly item: MediaItem,
  ) {}

  get running(): boolean {
    return this.settings !== undefined;
  }

  /** Starts, or restarts with new settings. */
  start(settings: Settings): void {
    this.stop();
    this.settings = settings;

    this.mutations = new this.window.MutationObserver(() => this.queueScan());
    this.mutations.observe(this.window.document, { childList: true, subtree: true });
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
      if (!overlay.attached) {
        overlay.destroy();
        this.overlays.delete(video);
        this.resizes?.unobserve(video);
      }
    }

    for (const video of this.window.document.querySelectorAll('video')) {
      if (!this.overlays.has(video)) {
        this.overlays.set(video, new VideoOverlay(video, this.item, settings));
        this.resizes?.observe(video);
      }
    }
  }

  private repositionAll(): void {
    for (const overlay of this.overlays.values()) {
      overlay.reposition();
    }
  }
}
