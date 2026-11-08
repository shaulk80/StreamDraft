import { fail, ok, type Result } from '../core/result.ts';
import type { OutputSink } from './output-sink.ts';
import type { DirectoryHandleLike, FileHandleLike, FileLike, WritableLike } from './opfs-store.ts';

const DISK_FULL = 'The finished video could not be written. The disk may be full.';

/** An OPFS file written front to back. It becomes visible when `close` commits it. */
export class OpfsOutputSink implements OutputSink {
  position = 0;
  private readonly handle: FileHandleLike;
  private readonly writable: WritableLike;

  private constructor(handle: FileHandleLike, writable: WritableLike) {
    this.handle = handle;
    this.writable = writable;
  }

  static async open(folder: DirectoryHandleLike, name: string): Promise<Result<OpfsOutputSink>> {
    try {
      const handle = await folder.getFileHandle(name, { create: true });
      return ok(new OpfsOutputSink(handle, await handle.createWritable()));
    } catch (error) {
      console.error(`StreamDraft: could not create ${name}`, error);
      return fail('The browser would not give the extension space to store the download.');
    }
  }

  async append(data: Uint8Array): Promise<Result<void>> {
    try {
      await this.writable.write(data);
      this.position += data.length;
      return ok(undefined);
    } catch (error) {
      console.error('StreamDraft: could not write the finished video', error);
      return fail(DISK_FULL);
    }
  }

  async patch(position: number, data: Uint8Array): Promise<Result<void>> {
    try {
      await this.writable.write({ type: 'write', position, data });
      return ok(undefined);
    } catch (error) {
      console.error('StreamDraft: could not patch the finished video', error);
      return fail(DISK_FULL);
    }
  }

  async close(): Promise<Result<void>> {
    try {
      await this.writable.close();
      return ok(undefined);
    } catch (error) {
      console.error('StreamDraft: could not finish the video file', error);
      return fail(DISK_FULL);
    }
  }

  async abort(): Promise<void> {
    try {
      await this.writable.abort();
    } catch (error) {
      console.error('StreamDraft: could not drop the unfinished video file', error);
    }
  }

  /** The committed file, once `close` has succeeded. */
  async file(): Promise<Result<FileLike>> {
    try {
      return ok(await this.handle.getFile());
    } catch (error) {
      console.error('StreamDraft: could not open the finished video file', error);
      return fail('The finished video could not be read back.');
    }
  }
}
