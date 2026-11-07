import type { StreamVariant } from '../core/media.ts';

/** A part of a resource, as `#EXT-X-BYTERANGE` states it. */
export interface HlsByteRange {
  offset: number;
  length: number;
}

/** AES-128 (whole segment, CBC) key information. SAMPLE-AES and DRM keys never get here: the playlist is reported as protected. */
export interface HlsKey {
  /** Absolute address of the 16-byte key. */
  url: string;
  /** The 16-byte initialisation vector; when absent the segment's sequence number is used, big-endian. */
  iv?: Uint8Array;
}

/** The initialisation section (`#EXT-X-MAP`) of fMP4 segments. */
export interface HlsInitSection {
  url: string;
  byteRange?: HlsByteRange;
}

export interface HlsSegment {
  /** Media sequence number; the default AES IV comes from it. */
  sequence: number;
  /** Absolute address. */
  url: string;
  durationSeconds: number;
  byteRange?: HlsByteRange;
  /** Present when the segment is AES-128 encrypted. */
  key?: HlsKey;
  /** Present for fMP4 segments. */
  init?: HlsInitSection;
  /** The encoding changes at the start of this segment. */
  discontinuity: boolean;
}

export interface HlsMediaPlaylist {
  kind: 'media';
  url: string;
  /** Empty when the playlist is protected: nothing is downloaded. */
  segments: HlsSegment[];
  targetDurationSeconds?: number;
  totalDurationSeconds: number;
  /** No end marker: the playlist is still growing. */
  live: boolean;
  /** What protects the stream, in words for the popup. */
  protectedReason?: string;
}

/** A variant of a master playlist; `variantId` is the address of its media playlist. */
export interface HlsVariant extends StreamVariant {
  /** The audio group (`#EXT-X-MEDIA`) the variant's sound comes from, when it is not in the variant itself. */
  audioGroupId?: string;
}

/** An alternative audio track (`#EXT-X-MEDIA:TYPE=AUDIO`). */
export interface HlsAudioRendition {
  groupId: string;
  name: string;
  language?: string;
  isDefault: boolean;
  /** Absolute address of its media playlist; absent when the audio is inside the variants' own segments. */
  url?: string;
}

export interface HlsMasterPlaylist {
  kind: 'master';
  url: string;
  variants: HlsVariant[];
  audioRenditions: HlsAudioRendition[];
  /** From `#EXT-X-SESSION-KEY`: what protects the whole stream. */
  protectedReason?: string;
}

export type HlsPlaylist = HlsMasterPlaylist | HlsMediaPlaylist;
