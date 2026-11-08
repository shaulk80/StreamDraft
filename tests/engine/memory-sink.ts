import { fail, ok, type Result } from '../../src/core/result.ts';
import type { OutputSink } from '../../src/engine/output-sink.ts';

/** An output sink that keeps the file in memory, for tests. */
export class MemoryOutputSink implements OutputSink {
  position = 0;
  closed = false;
  aborted = false;
  /** Appends from this count on fail (a full disk); undefined never fails. */
  failAfterAppends: number | undefined;
  private appends = 0;
  private chunks: Uint8Array[] = [];
  private patches: { position: number; data: Uint8Array }[] = [];

  append(data: Uint8Array): Promise<Result<void>> {
    if (this.failAfterAppends !== undefined && this.appends >= this.failAfterAppends) {
      return Promise.resolve(fail('The finished video could not be written. The disk may be full.'));
    }
    this.appends++;
    this.chunks.push(data.slice());
    this.position += data.length;
    return Promise.resolve(ok(undefined));
  }

  patch(position: number, data: Uint8Array): Promise<Result<void>> {
    this.patches.push({ position, data: data.slice() });
    return Promise.resolve(ok(undefined));
  }

  close(): Promise<Result<void>> {
    this.closed = true;
    return Promise.resolve(ok(undefined));
  }

  abort(): Promise<void> {
    this.aborted = true;
    return Promise.resolve();
  }

  /** The file as written, patches applied. */
  bytes(): Uint8Array {
    const file = new Uint8Array(this.position);
    let offset = 0;
    for (const chunk of this.chunks) {
      file.set(chunk, offset);
      offset += chunk.length;
    }
    for (const patch of this.patches) {
      file.set(patch.data, patch.position);
    }
    return file;
  }
}
