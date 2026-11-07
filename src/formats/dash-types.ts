import type { StreamVariant } from '../core/media.ts';

/** A part of a resource. Without `length` it runs to the end of the resource (`Range: bytes=offset-`). */
export interface DashByteRange {
  offset: number;
  length?: number;
}

export interface DashSegment {
  /** Absolute address. */
  url: string;
  byteRange?: DashByteRange;
  durationSeconds?: number;
}

/**
 * One representation (a rendition of one video or audio track). `variantId`
 * is the representation id; audio representations have `audioOnly` set.
 */
export interface DashRepresentation extends StreamVariant {
  mimeType?: string;
  language?: string;
  /** The initialisation segment; absent when the representation is a plain file. */
  init?: DashSegment;
  /**
   * The media segments in order. For a representation that is one file with
   * a segment index (`SegmentBase`) there is a single segment that starts
   * after the index and runs to the end of the file.
   */
  segments: DashSegment[];
}

export interface DashManifest {
  url: string;
  durationSeconds?: number;
  /** `type="dynamic"`: the stream is still being produced. */
  live: boolean;
  video: DashRepresentation[];
  audio: DashRepresentation[];
  /** What protects the stream, in words for the popup. Then `video` and `audio` are empty. */
  protectedReason?: string;
}
