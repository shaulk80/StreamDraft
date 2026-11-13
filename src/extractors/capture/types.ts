import type { Result } from '../../core/result.ts';

export interface TimeRange {
  start: number;
  end: number;
}

/** What the page's player did with its media pipeline, as the hook reports it. */
export type CaptureEvent =
  | { kind: 'buffer'; bufferId: number; sourceId: number; mime: string }
  | { kind: 'append'; bufferId: number; bytes: Uint8Array; durationSeconds?: number }
  | { kind: 'eme'; api: string };

/** A piece of a recorded buffer, ready to be stored: the init section or one media segment. */
export interface RecordedPart {
  kind: 'init' | 'fragment';
  /** 0 for the init section, then 1, 2, ... in the order the segments were stored. */
  index: number;
  bytes: Uint8Array;
  /** Fragments only: where the segment lies on the video's clock. */
  startSeconds?: number;
  endSeconds?: number;
}

/** Where recorded parts go (the page's OPFS, see decision 0010). A failure is a result, not an exception. */
export interface PartSink {
  store(bufferId: number, part: RecordedPart): Promise<Result<void>>;
}

export interface BufferSnapshot {
  bufferId: number;
  sourceId: number;
  mime: string;
  kind: 'video' | 'audio' | 'unknown';
  initStored: boolean;
  fragmentCount: number;
  /** Segments the player appended a second time; they are stored once. */
  duplicateCount: number;
  covered: TimeRange[];
  coveredSeconds: number;
  /** Why this buffer is no longer recorded, in words for the user. */
  stoppedBecause?: string;
}

export interface CaptureSnapshot {
  /** Encrypted media: nothing is recorded. */
  protected: boolean;
  /** The length of the video, once the player has stated it. */
  durationSeconds?: number;
  /** The buffers of the newest media source of the page. */
  buffers: BufferSnapshot[];
  /** Stretches of the video that no buffer holds yet. Empty while the length is unknown. */
  missing: TimeRange[];
  /** Everything that went wrong or needs the user's attention, in words. */
  problems: string[];
  /** Every buffer is whole and the video is covered from start to end. */
  complete: boolean;
}
