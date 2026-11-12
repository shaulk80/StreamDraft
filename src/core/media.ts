import { renderFilename, type Quality } from './settings.ts';

export type MediaKind = 'direct' | 'hls' | 'dash';

/**
 * One rendition of a stream (an HLS variant, a DASH representation), as the
 * engine needs it to fetch the right segments. Direct files have none.
 */
export interface StreamVariant {
  /** Finds the rendition again in the parsed manifest: a playlist address or a representation id. */
  variantId: string;
  /** Bits per second, as the manifest states it. */
  bandwidth?: number;
  width?: number;
  height?: number;
  /** RFC 6381 codec list such as `avc1.64001f, mp4a.40.2`. */
  codecs?: string;
  frameRate?: number;
  /** The rendition has no video track. */
  audioOnly?: boolean;
}

export interface QualityOption {
  quality: Quality;
  label: string;
  sizeBytes?: number;
  /**
   * Streams only. For the `audio` option, `variant.audioOnly` tells whether
   * the audio is a rendition of its own (true) or has to be taken out of a
   * rendition that carries video too (false).
   */
  variant?: StreamVariant;
}

/** A video found on a page, as the popup, the overlay and the menu show it. */
export interface MediaItem {
  id: string;
  /** The address the file is downloaded from. */
  url: string;
  title: string;
  site: string;
  kind: MediaKind;
  container: string;
  qualities: QualityOption[];
  /** DRM-protected streams are listed but cannot be downloaded. */
  protected: boolean;
  /** What protects the stream, in words for the popup (for example "Widevine DRM"); only with `protected`. */
  protectedReason?: string;
  /** Why the manifest could not be read, in words for the popup; only for streams. */
  manifestError?: string;
  /**
   * Streams only: addresses the manifest names (the playlists of the renditions
   * of an HLS master, the files and segments of a DASH stream). They are parts
   * of this stream, not videos of their own, and are not listed.
   */
  partUrls?: string[];
  /** Streams only: numbered segment files, kept as a pattern instead of one address each. */
  partRuns?: PartRun[];
}

/**
 * Addresses that differ only in one number: `prefix` + digits + `suffix`, where
 * the prefix and suffix are the address without its query. How a stream's
 * hundreds of numbered segments are remembered in a few bytes.
 */
export interface PartRun {
  prefix: string;
  suffix: string;
}

/** What reading a stream's manifest adds to its item. */
export type StreamDetails = Pick<
  MediaItem,
  'qualities' | 'protected' | 'protectedReason' | 'manifestError' | 'partUrls' | 'partRuns'
>;

/**
 * A stream whose manifest has not been read yet (or could not be, see
 * `manifestError`): it has nothing to offer for download.
 */
export function needsManifest(item: MediaItem): boolean {
  return item.kind !== 'direct' && !item.protected && item.qualities.length === 0;
}

/** What the network observer or the page scanner knows about one possible video. */
export interface MediaCandidate {
  url: string;
  contentType?: string;
  sizeBytes?: number;
  /** The page the file was found on; names the site and, with `pageTitle`, the file. */
  pageUrl?: string;
  pageTitle?: string;
}

/**
 * Picks the option to preselect: the wanted quality if the video has it,
 * otherwise the best video option that is not above it, otherwise the first
 * option. `qualities` is ordered best first.
 */
export function pickQuality(item: MediaItem, wanted: Quality): QualityOption | undefined {
  const exact = item.qualities.find((option) => option.quality === wanted);
  if (exact) {
    return exact;
  }

  if (wanted === 'audio') {
    return item.qualities.find((option) => option.quality === 'audio') ?? item.qualities[0];
  }

  const wantedHeight = heightOf(wanted);
  const notAbove = item.qualities.filter(
    (option) => option.quality !== 'audio' && heightOf(option.quality) <= wantedHeight,
  );
  return notAbove[0] ?? item.qualities[0];
}

function heightOf(quality: Quality): number {
  if (quality === 'best') {
    return Number.POSITIVE_INFINITY;
  }
  if (quality === 'audio') {
    return 0;
  }
  return Number.parseInt(quality, 10);
}

const KILOBYTE = 1024;
const SIZE_UNITS = ['KB', 'MB', 'GB'] as const;

/** Human-readable size such as "410 MB". Values under 1 KB are shown as bytes. */
export function formatSize(bytes: number): string {
  if (bytes < KILOBYTE) {
    return `${bytes} B`;
  }

  let value = bytes / KILOBYTE;
  let unitIndex = 0;
  while (value >= KILOBYTE && unitIndex < SIZE_UNITS.length - 1) {
    value /= KILOBYTE;
    unitIndex += 1;
  }

  const rounded = value >= 10 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${SIZE_UNITS[unitIndex]}`;
}

/** What {quality} says for a plain file: its height is unknown, so it is "the file as it is". */
const ORIGINAL_QUALITY_NAME = 'original';

/** The file name (with extension) a download of `option` would be saved under. */
export function downloadFilename(
  item: MediaItem,
  option: QualityOption,
  template: string,
  date: string,
): string {
  const extension = option.quality === 'audio' ? 'm4a' : item.container;
  const name = renderFilename(template, {
    title: item.title,
    site: item.site,
    quality: option.quality === 'best' ? ORIGINAL_QUALITY_NAME : option.quality,
    date,
  });
  return `${name}.${extension}`;
}

/** What the demo "Download" actions say instead of downloading (M1 only). */
export function demoDownloadText(filename: string): string {
  return `Demo only. Would save as "${filename}".`;
}
