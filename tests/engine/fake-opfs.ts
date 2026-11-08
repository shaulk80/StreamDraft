import type {
  DirectoryHandleLike,
  FileHandleLike,
  FileLike,
  WritableLike,
} from '../../src/engine/opfs-store.ts';

function notFound(name: string): DOMException {
  return new DOMException(`${name} was not found`, 'NotFoundError');
}

class FakeFile implements FileHandleLike {
  content: Uint8Array<ArrayBuffer> = new Uint8Array(0);
  /** When set, `createWritable().write` rejects with it and nothing is committed. */
  failWith: Error | undefined;

  createWritable(): Promise<WritableLike> {
    // Like the real thing: data is committed on close, so a failed write leaves the old content.
    let pending: Uint8Array<ArrayBuffer> | undefined;
    return Promise.resolve({
      write: (data) => {
        if (this.failWith) {
          return Promise.reject(this.failWith);
        }
        pending = new Uint8Array(data);
        return Promise.resolve();
      },
      close: () => {
        this.content = pending ?? this.content;
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

  /** The fake file with this name, for tests that make it fail. */
  file(name: string): FakeFile | undefined {
    return this.files.get(name);
  }
}
