import type { Result } from '../core/result.ts';

/**
 * Where the downloaded segments of one job wait for the muxer. Segments are
 * named by the job (`segmentName`); the browser build keeps them in OPFS, the
 * tests in memory.
 */
export interface SegmentStore {
  /** Stores the segment whole or not at all: a segment that is there is complete. */
  write(name: string, data: Uint8Array): Promise<Result<number>>;
  read(name: string): Promise<Result<Uint8Array>>;
  /** The stored size, or undefined when there is no such segment (a resumed job skips those that exist). */
  size(name: string): Promise<number | undefined>;
  /** Removes every segment of the job. */
  clear(): Promise<Result<void>>;
}
