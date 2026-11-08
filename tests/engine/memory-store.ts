import { fail, ok, type Result } from '../../src/core/result.ts';
import type { SegmentStore } from '../../src/engine/segment-store.ts';

/** A segment store that keeps the segments in a map, for tests. */
export class MemorySegmentStore implements SegmentStore {
  readonly segments = new Map<string, Uint8Array>();
  /** Names whose write fails, to test a full disk. */
  readonly failingWrites = new Set<string>();

  write(name: string, data: Uint8Array): Promise<Result<number>> {
    if (this.failingWrites.has(name)) {
      return Promise.resolve(fail('A part of the video could not be stored. The disk may be full.'));
    }
    this.segments.set(name, data);
    return Promise.resolve(ok(data.length));
  }

  read(name: string): Promise<Result<Uint8Array>> {
    const data = this.segments.get(name);
    return Promise.resolve(data === undefined ? fail('Missing.') : ok(data));
  }

  size(name: string): Promise<number | undefined> {
    return Promise.resolve(this.segments.get(name)?.length);
  }

  clear(): Promise<Result<void>> {
    this.segments.clear();
    return Promise.resolve(ok(undefined));
  }
}
