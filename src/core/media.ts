import { renderFilename, type Quality } from './settings.ts';

export type MediaKind = 'direct' | 'hls' | 'dash';

export interface QualityOption {
  quality: Quality;
  label: string;
  sizeBytes?: number;
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
    quality: option.quality,
    date,
  });
  return `${name}.${extension}`;
}

/** What the demo "Download" actions say instead of downloading (M1 only). */
export function demoDownloadText(filename: string): string {
  return `Demo only. Would save as "${filename}".`;
}
