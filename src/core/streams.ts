import type { QualityOption, StreamVariant } from './media.ts';
import type { Quality } from './settings.ts';

/** The heights the quality setting knows, best first. */
const HEIGHT_BUCKETS: readonly { height: number; quality: Quality }[] = [
  { height: 1080, quality: '1080p' },
  { height: 720, quality: '720p' },
  { height: 480, quality: '480p' },
  { height: 360, quality: '360p' },
];
const LOWEST_BUCKET: Quality = '360p';
/** From this height up (1440p, 4K) a rendition counts as "best" instead of 1080p. */
const BEST_FROM_HEIGHT = 1440;
const BITS_PER_BYTE = 8;
const HIGH_FRAME_RATE = 50;

/**
 * The quality setting a rendition of this height belongs to: the tallest
 * bucket that is not above it, "best" for 1440p and taller or of unknown
 * height, and the lowest bucket for anything shorter than 360p.
 */
export function qualityForHeight(height: number | undefined): Quality {
  if (height === undefined) {
    return 'best';
  }

  if (height >= BEST_FROM_HEIGHT) {
    return 'best';
  }

  const bucket = HEIGHT_BUCKETS.find((candidate) => height >= candidate.height);
  return bucket?.quality ?? LOWEST_BUCKET;
}

/** Download size in bytes from the stated bit rate and length, or undefined when either is unknown. */
export function estimateSizeBytes(bandwidth: number | undefined, durationSeconds: number | undefined): number | undefined {
  if (bandwidth === undefined || durationSeconds === undefined) {
    return undefined;
  }
  if (bandwidth <= 0 || durationSeconds <= 0) {
    return undefined;
  }
  return Math.round((bandwidth * durationSeconds) / BITS_PER_BYTE);
}

function labelFor(variant: StreamVariant): string {
  if (variant.height === undefined) {
    return 'Best quality';
  }
  const rate = variant.frameRate !== undefined && variant.frameRate >= HIGH_FRAME_RATE ? Math.round(variant.frameRate) : '';
  return `${variant.height}p${rate}`;
}

function heightRank(variant: StreamVariant): number {
  return variant.height ?? Number.POSITIVE_INFINITY;
}

function byHeightThenBandwidth(left: StreamVariant, right: StreamVariant): number {
  const leftHeight = heightRank(left);
  const rightHeight = heightRank(right);
  if (leftHeight !== rightHeight) {
    return rightHeight > leftHeight ? 1 : -1;
  }
  return (right.bandwidth ?? 0) - (left.bandwidth ?? 0);
}

/** The rendition to take the sound from when the stream has no audio-only rendition: the lightest one. */
function lightestVideoVariant(variants: StreamVariant[]): StreamVariant | undefined {
  const sorted = [...variants].sort((left, right) => (left.bandwidth ?? Number.POSITIVE_INFINITY) - (right.bandwidth ?? Number.POSITIVE_INFINITY));
  return sorted[0];
}

/**
 * Builds the quality list a stream offers, best first: one option per quality
 * setting (the tallest rendition in each bucket wins; its label still shows
 * its real height), then "Audio only" last. With no audio-only rendition the
 * audio is taken out of the lightest video rendition, so the least data is
 * fetched. A stream without renditions gives an empty list.
 */
export function buildQualityOptions(variants: StreamVariant[], durationSeconds?: number): QualityOption[] {
  const video = variants.filter((variant) => variant.audioOnly !== true).sort(byHeightThenBandwidth);
  const audioOnly = variants.filter((variant) => variant.audioOnly === true).sort(byHeightThenBandwidth);

  const options: QualityOption[] = [];
  const seen = new Set<Quality>();
  for (const variant of video) {
    const quality = qualityForHeight(variant.height);
    if (seen.has(quality)) {
      continue;
    }
    seen.add(quality);
    options.push({ quality, label: labelFor(variant), sizeBytes: estimateSizeBytes(variant.bandwidth, durationSeconds), variant });
  }

  const audioSource = audioOnly[0] ?? lightestVideoVariant(video);
  if (audioSource) {
    const isOwnRendition = audioOnly[0] !== undefined;
    options.push({
      quality: 'audio',
      label: 'Audio only',
      sizeBytes: isOwnRendition ? estimateSizeBytes(audioSource.bandwidth, durationSeconds) : undefined,
      variant: { ...audioSource, audioOnly: isOwnRendition },
    });
  }
  return options;
}
