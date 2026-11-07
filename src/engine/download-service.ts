import { downloadFilename, pickQuality, type MediaItem } from '../core/media.ts';
import type { DownloadMediaMessage } from '../core/messages.ts';
import { fail, ok, type Result } from '../core/result.ts';
import type { Settings } from '../core/settings.ts';

/** The part of `browser.downloads` the service uses. Resolves with the download's id. */
export interface DownloadsLike {
  download(options: { url: string; filename: string; conflictAction: 'uniquify'; saveAs: false }): Promise<number>;
}

export interface DownloadServiceDeps {
  downloads: DownloadsLike;
  /** The videos found on a tab; the service never downloads an address the registry did not list. */
  listItems(tabId: number): Promise<MediaItem[]>;
  loadSettings(): Promise<Settings>;
  /** Today as `YYYY-MM-DD`, for the {date} placeholder. */
  today(): string;
}

export interface StartedDownload {
  filename: string;
  downloadId: number;
}

/**
 * Starts the browser's own download of a video found on a tab. Direct files
 * only (M2): the browser fetches the file itself, with the user's cookies, so
 * nothing passes through the extension.
 */
export class DownloadService {
  constructor(private readonly deps: DownloadServiceDeps) {}

  async start(tabId: number, request: Pick<DownloadMediaMessage, 'itemId' | 'quality'>): Promise<Result<StartedDownload>> {
    const items = await this.deps.listItems(tabId);
    const item = items.find((candidate) => candidate.id === request.itemId);
    if (!item) {
      return fail('This video is no longer listed for the page. Reload the page and try again.');
    }
    if (item.protected) {
      return fail('This video is protected by DRM and cannot be downloaded.');
    }
    if (item.kind !== 'direct') {
      return fail('Streamed videos cannot be downloaded yet.');
    }

    const settings = await this.deps.loadSettings();
    const option =
      item.qualities.find((candidate) => candidate.quality === request.quality) ??
      pickQuality(item, settings.defaultQuality);
    if (!option) {
      return fail('This video has no quality to download.');
    }

    const filename = downloadFilename(item, option, settings.filenameTemplate, this.deps.today());
    return this.begin(item.url, filename);
  }

  private async begin(url: string, filename: string): Promise<Result<StartedDownload>> {
    try {
      const downloadId = await this.deps.downloads.download({ url, filename, conflictAction: 'uniquify', saveAs: false });
      return ok({ filename, downloadId });
    } catch (error) {
      console.error(`StreamDraft: the browser refused to download ${url}`, error);
      return fail('The browser could not start the download.');
    }
  }
}
