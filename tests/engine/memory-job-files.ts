import { ok, type Result } from '../../src/core/result.ts';
import type { FinishedOutput, JobFiles } from '../../src/engine/stream-engine.ts';
import type { FileLike } from '../../src/engine/opfs-store.ts';
import { MemoryOutputSink } from './memory-sink.ts';
import { MemorySegmentStore } from './memory-store.ts';

/** A finished file that can be read back, for tests. */
export class MemoryFinishedOutput extends MemoryOutputSink implements FinishedOutput {
  file(): Promise<Result<FileLike>> {
    const bytes = this.bytes();
    return Promise.resolve(ok({ size: bytes.length, arrayBuffer: () => Promise.resolve(bytes.buffer.slice(0) as ArrayBuffer) }));
  }
}

/** The files of one job in memory, for tests. */
export class MemoryJobFiles extends MemorySegmentStore implements JobFiles {
  readonly outputs = new Map<string, MemoryFinishedOutput>();
  cleared = false;

  createOutput(name: string): Promise<Result<MemoryFinishedOutput>> {
    const output = new MemoryFinishedOutput();
    this.outputs.set(name, output);
    return Promise.resolve(ok(output));
  }

  override clear(): Promise<Result<void>> {
    this.cleared = true;
    this.outputs.clear();
    return super.clear();
  }
}
