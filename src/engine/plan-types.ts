import type { HlsKey } from '../formats/hls-types.ts';
import type { SourceFormat } from './fragment-sources.ts';
import type { SegmentRequest } from './segment-fetcher.ts';

/** One media segment of a stream, with what is needed to decrypt it. */
export interface PlannedSegment {
  request: SegmentRequest;
  key?: HlsKey;
  /** The segment's media sequence number: the IV when the key states none. */
  sequence?: number;
}

/** One stream to join (the picture, or the sound), before its parts are given store names. */
export interface PlannedSource {
  format: SourceFormat;
  /** The initialisation section of fragmented MP4. */
  init?: SegmentRequest;
  segments: PlannedSegment[];
}

export const NO_VARIANT = 'This quality is not available for the video. Reload the page and try again.';
export const PROTECTED = 'This video is protected by DRM and cannot be downloaded.';
export const LIVE = 'Live streams cannot be downloaded yet.';
export const AUDIO_EXTRACTION_MISSING = 'Taking the sound out of a video is not available yet.';
