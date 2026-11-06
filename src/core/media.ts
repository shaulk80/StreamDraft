import type { Quality } from './settings.ts';

export type MediaKind = 'direct' | 'hls' | 'dash';

export interface QualityOption {
  quality: Quality;
  label: string;
  sizeBytes?: number;
}

/** A video found on a page, as the popup, the overlay and the menu show it. */
export interface MediaItem {
  id: string;
  title: string;
  site: string;
  kind: MediaKind;
  container: string;
  qualities: QualityOption[];
  /** DRM-protected streams are listed but cannot be downloaded. */
  protected: boolean;
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
