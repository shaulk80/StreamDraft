import type { MediaItem } from '../core/media.ts';
import type { Settings } from '../core/settings.ts';
import type { DownloadAction } from './download-client.ts';
import { createDownloadRow } from './media-view.ts';
import { placeOverlay } from './overlay-geometry.ts';

/** Id of the element that holds an overlay; tests and the manager look for it. */
export const OVERLAY_HOST_ID = 'streamdraft-overlay';

const STYLE = `
:host { all: initial; position: fixed; z-index: 2147483647; font: 13px system-ui, sans-serif; }
:host([hidden]) { display: none; }
.toggle { all: unset; box-sizing: border-box; cursor: pointer; padding: 6px 10px; border-radius: 6px;
  background: rgba(20, 20, 20, 0.8); color: #fff; font: inherit; }
.toggle:hover, .toggle:focus-visible { background: #000; }
.panel { position: absolute; top: 100%; right: 0; margin-top: 4px; width: 260px; box-sizing: border-box;
  padding: 10px; border-radius: 6px; background: #fff; color: #111; box-shadow: 0 2px 10px rgba(0, 0, 0, 0.4); }
.panel[hidden] { display: none; }
.title { margin: 0 0 6px; font-weight: 600; overflow-wrap: anywhere; }
.actions { display: flex; gap: 6px; }
.quality { flex: 1; min-width: 0; font: inherit; }
.download { font: inherit; }
.result { margin: 6px 0 0; overflow-wrap: anywhere; }
.result.error { color: #b00020; }
`;

/**
 * A "Download" button that floats over one `<video>`. It lives in its own
 * element with a Shadow DOM, so the page's styles cannot change it and it does
 * not change the page's layout.
 */
export class VideoOverlay {
  private readonly host: HTMLElement;
  private readonly panel: HTMLElement;

  constructor(
    private readonly video: HTMLVideoElement,
    item: MediaItem,
    settings: Settings,
    download: DownloadAction,
  ) {
    const doc = video.ownerDocument;
    this.host = doc.createElement('div');
    this.host.id = OVERLAY_HOST_ID;
    this.host.hidden = true;

    const shadow = this.host.attachShadow({ mode: 'open' });
    const style = doc.createElement('style');
    style.textContent = STYLE;

    const toggle = doc.createElement('button');
    toggle.className = 'toggle';
    toggle.type = 'button';
    toggle.textContent = 'Download';
    toggle.setAttribute('aria-label', 'StreamDraft: download this video');

    this.panel = doc.createElement('div');
    this.panel.className = 'panel';
    this.panel.hidden = true;
    const title = doc.createElement('p');
    title.className = 'title';
    title.textContent = item.title;
    this.panel.append(title, createDownloadRow(doc, item, settings, download));

    toggle.addEventListener('click', () => {
      this.panel.hidden = !this.panel.hidden;
    });

    shadow.append(style, toggle, this.panel);
    doc.body.append(this.host);
    this.reposition();
  }

  /** True while the video is still part of the page. */
  get attached(): boolean {
    return this.video.isConnected;
  }

  /** Moves the button to the video's current corner, or hides it. */
  reposition(): void {
    const window = this.video.ownerDocument.defaultView;
    if (!window) {
      this.host.hidden = true;
      return;
    }

    const placement = placeOverlay(this.video.getBoundingClientRect(), {
      width: window.innerWidth,
      height: window.innerHeight,
    });
    this.host.hidden = !placement.visible;
    if (!placement.visible) {
      this.panel.hidden = true;
      return;
    }

    this.host.style.top = `${placement.top}px`;
    // Anchor by the right edge: the button's width is not known before it is drawn.
    this.host.style.left = 'auto';
    this.host.style.right = `${window.innerWidth - placement.right}px`;
  }

  destroy(): void {
    this.host.remove();
  }
}
