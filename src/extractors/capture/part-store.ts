import { fail, ok, type Result } from '../../core/result.ts';
import type { DirectoryHandleLike, FileLike } from '../../engine/opfs-store.ts';
import type { PartSink, RecordedPart } from './types.ts';

/** The folder of all recordings, inside the page's own private file system. */
export const CAPTURE_DIRECTORY = 'streamdraft-capture';

/** A recording folder older than this was left by a page that crashed or was killed, and is removed. */
export const STALE_AFTER_MS = 24 * 60 * 60 * 1000;

/** A directory whose entries can be listed (the real OPFS handle can). */
export interface ListableDirectory extends DirectoryHandleLike {
  keys(): AsyncIterable<string>;
}

/** Which part of which buffer a stored file holds. */
export interface StoredPartRecord {
  bufferId: number;
  kind: RecordedPart['kind'];
  index: number;
  startSeconds?: number;
  fileName: string;
}

const NOT_STORED = 'The recording could not be stored. The browser may not allow this page to keep files (private windows do not).';
const NOT_READABLE = 'A part of the recording could not be read.';
const INDEX_DIGITS = 6;

export function partFileName(bufferId: number, part: Pick<RecordedPart, 'kind' | 'index'>): string {
  const suffix = part.kind === 'init' ? 'init' : String(part.index).padStart(INDEX_DIGITS, '0');
  return `b${bufferId}-${suffix}`;
}

/** The time a folder name starts with (`<ms>-<id>`), or undefined for a name that is not ours. */
function startedAt(folderName: string): number | undefined {
  const stamp = Number(folderName.split('-')[0]);
  return Number.isFinite(stamp) ? stamp : undefined;
}

/**
 * The recorded parts of one page load as files in the page's OPFS (decision
 * 0010): one file per init section or media segment, in a folder of its own,
 * so two tabs of one site do not disturb each other. A file is written whole
 * and committed on close, so a part that exists is complete. Everything that
 * can fail returns a result; nothing here throws.
 */
export class OpfsPartSink implements PartSink {
  private folder: Promise<Result<DirectoryHandleLike>> | undefined;
  private readonly recorded: StoredPartRecord[] = [];
  private readonly startedAtMs: number;

  constructor(
    private readonly root: () => Promise<ListableDirectory>,
    private readonly now: () => number,
    /** Tells this load's folder from the others; unique per page load. */
    private readonly loadId: string,
  ) {
    this.startedAtMs = now();
  }

  async store(bufferId: number, part: RecordedPart): Promise<Result<void>> {
    const folder = await this.openFolder();
    if (!folder.ok) {
      return folder;
    }

    const fileName = partFileName(bufferId, part);
    try {
      const handle = await folder.value.getFileHandle(fileName, { create: true });
      const writable = await handle.createWritable();
      await writable.write(new Blob([part.bytes as BlobPart]));
      await writable.close();
    } catch (error) {
      console.error(`StreamDraft: could not store ${fileName}`, error);
      return fail(NOT_STORED);
    }

    this.recorded.push({ bufferId, kind: part.kind, index: part.index, startSeconds: part.startSeconds, fileName });
    return ok(undefined);
  }

  /** The parts stored so far, in the order they were stored. */
  records(): readonly StoredPartRecord[] {
    return this.recorded;
  }

  async file(fileName: string): Promise<Result<FileLike>> {
    const folder = await this.openFolder();
    if (!folder.ok) {
      return folder;
    }

    try {
      const handle = await folder.value.getFileHandle(fileName);
      return ok(await handle.getFile());
    } catch (error) {
      console.error(`StreamDraft: could not read ${fileName}`, error);
      return fail(NOT_READABLE);
    }
  }

  /** Removes this load's files. Later parts open a new folder. */
  async clear(): Promise<void> {
    const opened = this.folder;
    this.folder = undefined;
    this.recorded.length = 0;
    if (opened === undefined || !(await opened).ok) {
      return;
    }

    try {
      const directory = await this.root();
      const captures = await directory.getDirectoryHandle(CAPTURE_DIRECTORY);
      await captures.removeEntry(this.folderName(), { recursive: true });
    } catch (error) {
      console.error('StreamDraft: could not remove the recording files', error);
    }
  }

  private folderName(): string {
    return `${this.startedAtMs}-${this.loadId}`;
  }

  private openFolder(): Promise<Result<DirectoryHandleLike>> {
    this.folder ??= this.createFolder();
    return this.folder;
  }

  private async createFolder(): Promise<Result<DirectoryHandleLike>> {
    try {
      const root = await this.root();
      const captures = await root.getDirectoryHandle(CAPTURE_DIRECTORY, { create: true });
      await this.removeStale(captures as ListableDirectory);
      return ok(await captures.getDirectoryHandle(this.folderName(), { create: true }));
    } catch (error) {
      console.error('StreamDraft: could not open the recording folder', error);
      return fail(NOT_STORED);
    }
  }

  /** Folders of pages that did not clean up. Failing to remove one is only logged. */
  private async removeStale(captures: ListableDirectory): Promise<void> {
    try {
      for await (const name of captures.keys()) {
        const started = startedAt(name);
        if (started !== undefined && this.now() - started > STALE_AFTER_MS) {
          await captures.removeEntry(name, { recursive: true });
        }
      }
    } catch (error) {
      console.error('StreamDraft: could not remove old recording files', error);
    }
  }
}
