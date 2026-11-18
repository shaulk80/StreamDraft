import { needsManifest, type MediaItem, type StreamDetails } from '../core/media.ts';
import { dashSegmentUrlsOfAllPeriods, parseDashManifest } from '../formats/dash.ts';
import { parseHlsPlaylist } from '../formats/hls.ts';
import { failedDetails, summarizeDash, summarizeHls, withSegmentParts } from '../formats/stream-summary.ts';
import type { FetchText } from './manifest-fetch.ts';
import { readRenditionSegments } from './rendition-reader.ts';
import type { MediaRegistry, ResolvedStream } from './registry.ts';

/** Most manifests read in one go; a page with more streams than this gets the rest on the next popup opening. */
export const MAX_RESOLVED_AT_ONCE = 10;

/**
 * Reads the manifests of a tab's streams that have none read yet and gives
 * their items qualities (or the reason they have none). Done as soon as a
 * stream is found (so the files it is made of are not taken for videos and the
 * badge counts right) and again when the popup opens (for a manifest that
 * could not be read the first time).
 */
export class StreamResolver {
  /** The last read of each tab; the next one starts when it ends, so a manifest is never fetched twice at once. */
  private readonly tails = new Map<number, Promise<number>>();

  constructor(
    private readonly registry: Pick<MediaRegistry, 'list' | 'update'>,
    private readonly fetchText: FetchText,
  ) {}

  /** Resolves with how many streams were read (successfully or not). Never fails. */
  resolveTab(tabId: number): Promise<number> {
    const previous = this.tails.get(tabId) ?? Promise.resolve(0);
    const next = previous.then(() => this.readPending(tabId));
    this.tails.set(tabId, next);
    void next.then(() => {
      if (this.tails.get(tabId) === next) {
        this.tails.delete(tabId);
      }
    });
    return next;
  }

  private async readPending(tabId: number): Promise<number> {
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
    return { id: item.id, details: await this.readDetails(item) };
  }

  private async readDetails(item: MediaItem): Promise<StreamDetails> {
    const fetched = await this.fetchText(item.url);
    if (!fetched.ok) {
      return failedDetails(fetched.error);
    }

    const { text, url } = fetched.value;
    if (item.kind === 'hls') {
      return this.describeHls(text, url);
    }
    if (item.kind === 'dash') {
      return describeDash(text, url);
    }
    return failedDetails('This is not a stream.');
  }

  /** An HLS master names only the playlists of its renditions, so these are read for the segment files they name. */
  private async describeHls(text: string, url: string): Promise<StreamDetails> {
    const playlist = parseHlsPlaylist(text, url);
    const summary = playlist.ok ? summarizeHls(playlist.value) : playlist;
    if (!summary.ok) {
      return failedDetails(summary.error);
    }

    const isMaster = playlist.ok && playlist.value.kind === 'master';
    if (!isMaster || summary.value.protected) {
      return summary.value;
    }
    return withSegmentParts(summary.value, await readRenditionSegments(this.fetchText, summary.value.partUrls ?? []));
  }
}

/** A manifest that cannot be downloaded (several periods, live) still names its files, and they are not videos. */
function describeDash(text: string, url: string): StreamDetails {
  const manifest = parseDashManifest(text, url);
  const summary = manifest.ok ? summarizeDash(manifest.value) : manifest;
  if (summary.ok) {
    return summary.value;
  }
  return failedDetails(summary.error, dashSegmentUrlsOfAllPeriods(text, url));
}
