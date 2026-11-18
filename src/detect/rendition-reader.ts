import { parseHlsPlaylist } from '../formats/hls.ts';
import { hlsSegmentUrls } from '../formats/stream-summary.ts';
import type { FetchText } from './manifest-fetch.ts';

/** Most rendition playlists read for one master; the segments of the rest are not recognised. */
export const MAX_RENDITIONS_READ = 8;

async function segmentsOf(fetchText: FetchText, url: string): Promise<string[]> {
  const fetched = await fetchText(url);
  if (!fetched.ok) {
    // The fetcher has logged the cause; the segments of this rendition are simply not recognised.
    return [];
  }

  const playlist = parseHlsPlaylist(fetched.value.text, fetched.value.url);
  if (!playlist.ok) {
    console.error(`StreamDraft: the rendition playlist ${url} could not be read: ${playlist.error}`);
    return [];
  }
  return playlist.value.kind === 'media' ? hlsSegmentUrls(playlist.value) : [];
}

/**
 * The segment files named by the rendition playlists of an HLS master. A master
 * names only the playlists; its segments are known once these are read, and a
 * player that loads them as separate files would otherwise fill the list.
 * Never fails: a playlist that cannot be read adds nothing.
 */
export async function readRenditionSegments(fetchText: FetchText, renditionUrls: readonly string[]): Promise<string[]> {
  const wanted = [...new Set(renditionUrls)].slice(0, MAX_RENDITIONS_READ);
  const segments = await Promise.all(wanted.map((url) => segmentsOf(fetchText, url)));
  return segments.flat();
}
