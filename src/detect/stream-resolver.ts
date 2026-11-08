import { needsManifest, type MediaItem, type StreamDetails } from '../core/media.ts';
import { fail, type Result } from '../core/result.ts';
import { parseDashManifest } from '../formats/dash.ts';
import { parseHlsPlaylist } from '../formats/hls.ts';
import { summarizeDash, summarizeHls } from '../formats/stream-summary.ts';
import type { FetchText } from './manifest-fetch.ts';
import type { MediaRegistry, ResolvedStream } from './registry.ts';

/** Most manifests read in one go; a page with more streams than this gets the rest on the next popup opening. */
export const MAX_RESOLVED_AT_ONCE = 10;

/**
 * Reads the manifests of a tab's streams that have none read yet and gives
 * their items qualities (or the reason they have none). Done when the popup
 * opens, not while browsing: most manifests a page loads are never looked at.
 */
export class StreamResolver {
  constructor(
    private readonly registry: Pick<MediaRegistry, 'list' | 'update'>,
    private readonly fetchText: FetchText,
  ) {}

  /** Resolves with how many streams were read (successfully or not). Never fails. */
  async resolveTab(tabId: number): Promise<number> {
    const items = await this.registry.list(tabId);
    const pending = items.filter(needsManifest).slice(0, MAX_RESOLVED_AT_ONCE);
    if (pending.length === 0) {
      return 0;
    }

    const resolved = await Promise.all(pending.map((item) => this.resolveItem(item)));
    await this.registry.update(tabId, resolved);
    return resolved.length;
  }

  private async resolveItem(item: MediaItem): Promise<ResolvedStream> {
    const details = await this.readDetails(item);
    if (details.ok) {
      return { id: item.id, details: details.value };
    }
    return { id: item.id, details: { qualities: [], protected: false, manifestError: details.error } };
  }

  private async readDetails(item: MediaItem): Promise<Result<StreamDetails>> {
    const fetched = await this.fetchText(item.url);
    if (!fetched.ok) {
      return fetched;
    }

    const { text, url } = fetched.value;
    if (item.kind === 'hls') {
      const playlist = parseHlsPlaylist(text, url);
      return playlist.ok ? summarizeHls(playlist.value) : playlist;
    }
    if (item.kind === 'dash') {
      const manifest = parseDashManifest(text, url);
      return manifest.ok ? summarizeDash(manifest.value) : manifest;
    }
    return fail('This is not a stream.');
  }
}
