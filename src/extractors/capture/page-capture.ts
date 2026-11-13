import { fail, ok, type Result } from '../../core/result.ts';
import type { FileLike } from '../../engine/opfs-store.ts';
import type { RecordingBuffer, RecordingInput, RecordingPart } from '../../engine/recording-input.ts';
import { CaptureSession } from './capture-session.ts';
import { OpfsPartSink, type StoredPartRecord } from './part-store.ts';
import { formatClock } from './ranges.ts';
import type { BufferSnapshot, CaptureEvent, CaptureSnapshot, TimeRange } from './types.ts';

/**
 * How the finished parts are given away. Chrome cannot send a `File` in a
 * message, so a part is reached by a `blob:` address there (`address` and
 * `release` given); Firefox hands the `File` objects over as they are.
 */
export interface PartAddresses {
  address(file: FileLike): string;
  release(address: string): void;
}

const NOTHING_RECORDED = 'Nothing was recorded on this page load. Press Record, which reloads the page, and let the video play.';

function missingText(missing: readonly TimeRange[]): string {
  const shown = missing.slice(0, 3).map((range) => `${formatClock(range.start)} to ${formatClock(range.end)}`);
  const more = missing.length > shown.length ? ' and more' : '';
  return `${shown.join(', ')}${more}`;
}

/** Why the recording cannot be saved yet, or undefined when it can. */
export function recordingProblem(snapshot: CaptureSnapshot): string | undefined {
  if (snapshot.protected) {
    return snapshot.problems[0];
  }
  if (snapshot.buffers.length === 0) {
    return NOTHING_RECORDED;
  }

  const stopped = snapshot.buffers.find((buffer) => buffer.stoppedBecause !== undefined);
  if (stopped !== undefined) {
    return stopped.stoppedBecause;
  }
  if (snapshot.durationSeconds === undefined) {
    return 'The player has not said how long the video is yet. Let it play a little longer.';
  }
  if (snapshot.missing.length > 0) {
    return `The recording is not complete. Parts of the video are missing (${missingText(snapshot.missing)}). Let the video play to the end, or go back to those parts, then save.`;
  }
  return snapshot.complete ? undefined : snapshot.problems[0] ?? 'The recording is not complete yet.';
}

/**
 * What one page load has recorded: the events of the page-world hook go into
 * a `CaptureSession` that stores its parts in the page's OPFS, and a finished
 * recording is handed over as a `RecordingInput` for the engine. Lives in the
 * content script of an armed page.
 */
export class PageCapture {
  private session: CaptureSession;
  private readonly handedOut: string[] = [];

  constructor(
    private readonly sink: OpfsPartSink,
    private readonly addresses?: PartAddresses,
  ) {
    this.session = new CaptureSession(sink);
  }

  /** Takes one event of the hook. A failing event is logged and does not stop the next ones. */
  handle(event: CaptureEvent): void {
    this.session.handle(event).catch((error: unknown) => {
      console.error('StreamDraft: could not record what the player did', error);
    });
  }

  async status(): Promise<CaptureSnapshot> {
    await this.session.settled();
    return this.session.snapshot();
  }

  /** The finished recording, or the reason it cannot be saved yet. */
  async save(): Promise<Result<RecordingInput>> {
    const snapshot = await this.status();
    const problem = recordingProblem(snapshot);
    if (problem !== undefined) {
      return fail(problem);
    }

    const buffers: RecordingBuffer[] = [];
    for (const buffer of snapshot.buffers) {
      const handed = await this.bufferOf(buffer);
      if (!handed.ok) {
        return handed;
      }
      buffers.push(handed.value);
    }
    return ok({ buffers });
  }

  /**
   * Removes the recording's files and the addresses given out for them, and forgets what the player did, so
   * that the status says "nothing recorded" afterwards. What the player appends later is not recorded: it
   * belongs to buffers this page no longer knows (Record reloads the page for a new recording).
   */
  async discard(): Promise<void> {
    await this.session.settled();
    this.session = new CaptureSession(this.sink);
    this.handedOut.splice(0).forEach((address) => this.addresses?.release(address));
    await this.sink.clear();
  }

  private async bufferOf(buffer: BufferSnapshot): Promise<Result<RecordingBuffer>> {
    const records = this.sink.records().filter((record) => record.bufferId === buffer.bufferId);
    const initRecord = records.find((record) => record.kind === 'init');
    if (initRecord === undefined) {
      return fail(NOTHING_RECORDED);
    }

    const init = await this.partOf(initRecord);
    if (!init.ok) {
      return init;
    }

    const fragments: RecordingPart[] = [];
    for (const record of records.filter((candidate) => candidate.kind === 'fragment')) {
      const part = await this.partOf(record);
      if (!part.ok) {
        return part;
      }
      fragments.push(part.value);
    }
    return ok({ kind: buffer.kind, init: init.value, fragments });
  }

  private async partOf(record: StoredPartRecord): Promise<Result<RecordingPart>> {
    const file = await this.sink.file(record.fileName);
    if (!file.ok) {
      return file;
    }

    if (this.addresses === undefined) {
      return ok({ name: record.fileName, startSeconds: record.startSeconds, file: file.value });
    }

    const url = this.addresses.address(file.value);
    this.handedOut.push(url);
    return ok({ name: record.fileName, startSeconds: record.startSeconds, url });
  }
}
