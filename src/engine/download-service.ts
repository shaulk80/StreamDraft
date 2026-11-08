import { downloadFilename, pickQuality, type MediaItem, type QualityOption } from '../core/media.ts';
import type { DownloadMediaMessage } from '../core/messages.ts';
import { fail, ok, type Result } from '../core/result.ts';
import type { Quality, Settings } from '../core/settings.ts';
import { addressWithoutFragment } from '../core/url-names.ts';
import type { StreamStarter } from './job-coordinator.ts';

/**
 * The part of `browser.downloads` the service uses. Resolves with the download's id.
 * `saveAs` is deliberately not passed: left out, the browser follows the user's own
 * "ask where to save files" setting; `true` or `false` would override it.
 */
export interface DownloadsLike {
  download(options: { url: string; filename: string; conflictAction: 'uniquify' }): Promise<number>;
}

export interface DownloadServiceDeps {
  downloads: DownloadsLike;
  /** The videos found on a tab; the service never downloads an address the registry did not list. */
  listItems(tabId: number): Promise<MediaItem[]>;
  loadSettings(): Promise<Settings>;
  /** Today as `YYYY-MM-DD`, for the {date} placeholder. */
  today(): string;
  /** Downloads HLS and DASH videos; without it streams are refused. */
  streams?: StreamStarter;
}

const NOT_LISTED = 'This video is no longer listed for the page. Reload the page and try again.';
const AMBIGUOUS = 'Could not tell which video this is. Use the StreamDraft button in the toolbar.';

export interface StartedDownload {
  filename: string;
  /** A direct file is saved by the browser at once. */
  downloadId?: number;
  /** A stream is a job of the engine; the browser saves the file when the job is done. */
  jobId?: string;
}

/**
 * Starts the download of a video found on a tab. A direct file is fetched by
 * the browser itself, with the user's cookies, so nothing passes through the
 * extension; a stream (HLS, DASH) is a job of the engine, which fetches and
 * joins its parts and hands the finished file to the browser.
 */
export class DownloadService {
  constructor(private readonly deps: DownloadServiceDeps) {}

  /** Downloads the video the popup or the page's button named, in the quality it chose. */
  async start(tabId: number, request: Pick<DownloadMediaMessage, 'itemId' | 'quality'>): Promise<Result<StartedDownload>> {
    const items = await this.deps.listItems(tabId);
    const item = items.find((candidate) => candidate.id === request.itemId);
    if (!item) {
      return fail(NOT_LISTED);
    }
    return this.startItem(item, request.quality, await this.deps.loadSettings());
  }

  /**
   * Downloads the video behind an address, in the default quality (the context
   * menu knows the address of the clicked video, not an item). A video the
   * registry does not know by that address (a `blob:` source) is taken to be
   * the page's only video, when there is exactly one; otherwise the user is
   * told to use the popup rather than risk downloading the wrong one.
   */
  async startForAddress(tabId: number, address: string | undefined): Promise<Result<StartedDownload>> {
    const items = await this.deps.listItems(tabId);
    const id = address === undefined ? undefined : addressWithoutFragment(address);
    const [only] = items;
    const item = items.find((candidate) => candidate.id === id) ?? (items.length === 1 ? only : undefined);
    if (!item) {
      return fail(items.length === 0 ? 'No video was found on this page.' : AMBIGUOUS);
    }

    const settings = await this.deps.loadSettings();
    return this.startItem(item, settings.defaultQuality, settings);
  }

  private async startItem(item: MediaItem, wanted: Quality, settings: Settings): Promise<Result<StartedDownload>> {
    if (item.protected) {
      return fail('This video is protected by DRM and cannot be downloaded.');
    }

    const option =
      item.qualities.find((candidate) => candidate.quality === wanted) ??
      pickQuality(item, settings.defaultQuality);
    if (!option) {
      return fail('This video has no quality to download.');
    }

    const filename = downloadFilename(item, option, settings.filenameTemplate, this.deps.today());
    if (item.kind === 'direct') {
      return this.begin(item.url, filename);
    }
    return this.beginStream(item, option, filename);
  }

  private async beginStream(item: MediaItem, option: QualityOption, filename: string): Promise<Result<StartedDownload>> {
    if (this.deps.streams === undefined) {
      return fail('Streamed videos cannot be downloaded yet.');
    }

    const started = await this.deps.streams.start({ item, option, filename });
    return started.ok ? ok({ filename, jobId: started.value.jobId }) : started;
  }

  private async begin(url: string, filename: string): Promise<Result<StartedDownload>> {
    try {
      const downloadId = await this.deps.downloads.download({ url, filename, conflictAction: 'uniquify' });
      return ok({ filename, downloadId });
    } catch (error) {
      console.error(`StreamDraft: the browser refused to download ${url}`, error);
      return fail('The browser could not start the download.');
    }
  }
}
