import type { FileLike } from './opfs-store.ts';

/**
 * One stored piece of a captured recording (decision 0010): the init section of
 * a buffer or one media segment. It lives in the page's private file system and
 * is reached by a `File` (Firefox hands these over) or by a `blob:` address
 * (Chrome; only the address can travel in a message).
 */
export interface RecordingPart {
  /** Unique within the recording. */
  name: string;
  /** Segments only: where the segment lies on the video's clock, in seconds. */
  startSeconds?: number;
  url?: string;
  file?: FileLike;
}

/** What the player appended to one source buffer: its init section and its segments. */
export interface RecordingBuffer {
  kind: 'video' | 'audio' | 'unknown';
  init: RecordingPart;
  fragments: RecordingPart[];
}

/** A finished capture, ready to be joined into one file. */
export interface RecordingInput {
  buffers: RecordingBuffer[];
}

/** All parts of the recording, init sections and segments of every buffer. */
export function allParts(recording: RecordingInput): RecordingPart[] {
  return recording.buffers.flatMap((buffer) => [buffer.init, ...buffer.fragments]);
}
