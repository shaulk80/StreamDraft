import { fail, ok, type Result } from '../core/result.ts';
import { allParts, type RecordingInput, type RecordingPart } from './recording-input.ts';
import type { SegmentStore } from './segment-store.ts';

/** Reads the bytes behind a `blob:` address. */
export type ReadUrl = (url: string) => Promise<Result<Uint8Array>>;

const READ_ONLY = 'A recording cannot be changed.';
const NOT_READABLE = 'A part of the recording could not be read. The page may have removed it.';

/**
 * The parts of a captured recording as a store the muxer reads from. The files
 * belong to the page that recorded them, so this store only reads: writing
 * fails and `clear` leaves them alone.
 */
export class RecordingStore implements SegmentStore {
  private readonly parts = new Map<string, RecordingPart>();

  constructor(
    recording: RecordingInput,
    private readonly readUrl: ReadUrl,
  ) {
    allParts(recording).forEach((part) => this.parts.set(part.name, part));
  }

  write(): Promise<Result<number>> {
    return Promise.resolve(fail(READ_ONLY));
  }

  async read(name: string): Promise<Result<Uint8Array>> {
    const part = this.parts.get(name);
    if (part?.file !== undefined) {
      return this.readFile(part.file);
    }
    if (part?.url !== undefined) {
      return this.readUrl(part.url);
    }
    return fail(NOT_READABLE);
  }

  size(name: string): Promise<number | undefined> {
    return Promise.resolve(this.parts.get(name)?.file?.size);
  }

  clear(): Promise<Result<void>> {
    return Promise.resolve(ok(undefined));
  }

  private async readFile(file: NonNullable<RecordingPart['file']>): Promise<Result<Uint8Array>> {
    try {
      return ok(new Uint8Array(await file.arrayBuffer()));
    } catch (error) {
      console.error('StreamDraft: could not read a recorded part', error);
      return fail(NOT_READABLE);
    }
  }
}
