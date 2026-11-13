import { fail, ok, type Result } from '../core/result.ts';
import { OpfsOutputSink } from './opfs-sink.ts';
import type { SegmentStore } from './segment-store.ts';

/** What `write` takes: bytes at the cursor, or bytes at a position (which moves the cursor there). */
export type WriteChunk = Uint8Array | Blob | { type: 'write'; position: number; data: Uint8Array };

export interface WritableLike {
  write(data: WriteChunk): Promise<void>;
  close(): Promise<void>;
  /** Drops what was written without committing it. */
  abort(): Promise<void>;
}

/** The parts of the OPFS handles the store uses, so tests can stand in for the file system. */
export interface FileLike {
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface FileHandleLike {
  createWritable(): Promise<WritableLike>;
  getFile(): Promise<FileLike>;
}

export interface DirectoryHandleLike {
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FileHandleLike>;
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<DirectoryHandleLike>;
  removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>;
}

/** The folder of all jobs, inside the origin's private file system. */
export const JOBS_DIRECTORY = 'streamdraft-jobs';

const SAFE_NAME = /^[A-Za-z0-9_-]+$/;
const NOT_FOUND = 'NotFoundError';

function isNotFound(error: unknown): boolean {
  return error instanceof DOMException && error.name === NOT_FOUND;
}

/**
 * The segments of one job as files in an OPFS folder. A file is written
 * through `createWritable`, which commits on `close`: a segment that is
 * visible is complete, even when the page was closed in the middle of a write.
 */
export class OpfsSegmentStore implements SegmentStore {
  constructor(
    private readonly jobsFolder: DirectoryHandleLike,
    private readonly jobId: string,
    private readonly folder: DirectoryHandleLike,
  ) {}

  /** Opens (and creates) the folder of a job. The id must be made of letters, digits, `-` and `_`. */
  static async open(root: DirectoryHandleLike, jobId: string): Promise<Result<OpfsSegmentStore>> {
    if (!SAFE_NAME.test(jobId)) {
      return fail('The download could not be prepared (bad job name).');
    }

    try {
      const jobsFolder = await root.getDirectoryHandle(JOBS_DIRECTORY, { create: true });
      const folder = await jobsFolder.getDirectoryHandle(jobId, { create: true });
      return ok(new OpfsSegmentStore(jobsFolder, jobId, folder));
    } catch (error) {
      console.error('StreamDraft: could not open the download folder', error);
      return fail('The browser would not give the extension space to store the download. Private windows do not allow it.');
    }
  }

  async write(name: string, data: Uint8Array): Promise<Result<number>> {
    try {
      const handle = await this.folder.getFileHandle(name, { create: true });
      const writable = await handle.createWritable();
      await writable.write(data);
      await writable.close();
      return ok(data.length);
    } catch (error) {
      console.error(`StreamDraft: could not store ${name}`, error);
      return fail('A part of the video could not be stored. The disk may be full.');
    }
  }

  async read(name: string): Promise<Result<Uint8Array>> {
    try {
      const handle = await this.folder.getFileHandle(name);
      const file = await handle.getFile();
      return ok(new Uint8Array(await file.arrayBuffer()));
    } catch (error) {
      console.error(`StreamDraft: could not read ${name}`, error);
      return fail('A stored part of the video could not be read.');
    }
  }

  async size(name: string): Promise<number | undefined> {
    try {
      const handle = await this.folder.getFileHandle(name);
      return (await handle.getFile()).size;
    } catch (error) {
      if (!isNotFound(error)) {
        console.error(`StreamDraft: could not look for ${name}`, error);
      }
      return undefined;
    }
  }

  /** The file the finished video is written to, in the job's folder (`clear` removes it with the segments). */
  createOutput(name: string): Promise<Result<OpfsOutputSink>> {
    return OpfsOutputSink.open(this.folder, name);
  }

  async clear(): Promise<Result<void>> {
    try {
      await this.jobsFolder.removeEntry(this.jobId, { recursive: true });
      return ok(undefined);
    } catch (error) {
      if (isNotFound(error)) {
        return ok(undefined);
      }
      console.error(`StreamDraft: could not remove the files of job ${this.jobId}`, error);
      return fail('The temporary files of the download could not be removed.');
    }
  }
}
