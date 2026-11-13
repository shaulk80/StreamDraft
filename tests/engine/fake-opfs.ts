import type {
  DirectoryHandleLike,
  FileHandleLike,
  FileLike,
  WritableLike,
  WriteChunk,
} from '../../src/engine/opfs-store.ts';

function notFound(name: string): DOMException {
  return new DOMException(`${name} was not found`, 'NotFoundError');
}

/** Where a chunk goes: bytes at the cursor, a Blob at the cursor, or bytes at a position. */
async function positioned(chunk: WriteChunk, cursor: number): Promise<{ position: number; data: Uint8Array }> {
  if (chunk instanceof Uint8Array) {
    return { position: cursor, data: chunk };
  }
  if (chunk instanceof Blob) {
    return { position: cursor, data: new Uint8Array(await chunk.arrayBuffer()) };
  }
  return chunk;
}

class FakeFile implements FileHandleLike {
  content: Uint8Array<ArrayBuffer> = new Uint8Array(0);
  /** When set, writes reject with it and nothing is committed. */
  failWith: Error | undefined;

  createWritable(): Promise<WritableLike> {
    // Like the real thing: the data is staged and committed on close, so a failed or aborted write leaves the old content.
    let staged: Uint8Array<ArrayBuffer> = new Uint8Array(0);
    let cursor = 0;
    return Promise.resolve({
      write: async (chunk: WriteChunk) => {
        if (this.failWith) {
          throw this.failWith;
        }

        const target = await positioned(chunk, cursor);
        const end = target.position + target.data.length;
        if (end > staged.length) {
          const larger = new Uint8Array(end);
          larger.set(staged);
          staged = larger;
        }
        staged.set(target.data, target.position);
        cursor = end;
      },
      close: () => {
        this.content = staged;
        return Promise.resolve();
      },
      abort: () => {
        staged = new Uint8Array(0);
        return Promise.resolve();
      },
    });
  }

  getFile(): Promise<FileLike> {
    const copy = this.content.slice();
    return Promise.resolve({ size: copy.length, arrayBuffer: () => Promise.resolve(copy.buffer) });
  }
}

/** An in-memory directory with the handle methods the OPFS store uses. */
export class FakeDirectory implements DirectoryHandleLike {
  readonly files = new Map<string, FakeFile>();
  readonly directories = new Map<string, FakeDirectory>();

  getFileHandle(name: string, options?: { create?: boolean }): Promise<FileHandleLike> {
    let file = this.files.get(name);
    if (file === undefined) {
      if (options?.create !== true) {
        return Promise.reject(notFound(name));
      }
      file = new FakeFile();
      this.files.set(name, file);
    }
    return Promise.resolve(file);
  }

  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<DirectoryHandleLike> {
    let directory = this.directories.get(name);
    if (directory === undefined) {
      if (options?.create !== true) {
        return Promise.reject(notFound(name));
      }
      directory = new FakeDirectory();
      this.directories.set(name, directory);
    }
    return Promise.resolve(directory);
  }

  removeEntry(name: string): Promise<void> {
    const removed = this.files.delete(name) || this.directories.delete(name);
    return removed ? Promise.resolve() : Promise.reject(notFound(name));
  }

  async *keys(): AsyncIterable<string> {
    yield* [...this.directories.keys(), ...this.files.keys()];
    await Promise.resolve();
  }

  /** The fake file with this name, for tests that make it fail. */
  file(name: string): FakeFile | undefined {
    return this.files.get(name);
  }
}
