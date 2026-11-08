import type { Result } from '../core/result.ts';

/**
 * Where the finished file is written. Appends are sequential; one patch at a
 * given position is allowed, and must be the last write (the stream's cursor
 * moves to the patch). Browser build: an OPFS file. Tests: memory.
 */
export interface OutputSink {
  /** Bytes appended so far: the offset the next append lands at. */
  readonly position: number;
  append(data: Uint8Array): Promise<Result<void>>;
  /** Overwrites bytes already written. After this call nothing more may be appended. */
  patch(position: number, data: Uint8Array): Promise<Result<void>>;
  /** Commits the file. */
  close(): Promise<Result<void>>;
  /** Drops the file without committing it. Never fails. */
  abort(): Promise<void>;
}
