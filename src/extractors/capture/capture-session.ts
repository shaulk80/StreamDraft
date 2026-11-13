import { ENCRYPTED_MESSAGE } from '../../engine/mp4/init-reader.ts';
import { BufferRecorder } from './buffer-recorder.ts';
import { EDGE_SECONDS, gapsIn, mergeRanges } from './ranges.ts';
import { isRecordableMediaType } from './type-filter.ts';
import type { BufferSnapshot, CaptureEvent, CaptureSnapshot, PartSink, TimeRange } from './types.ts';

/**
 * What one page's player has done so far, and what of it is recorded. Events
 * from the page's hook go in (`handle`, in order), the state comes out
 * (`snapshot`). A page may create several media sources (a next video, an
 * advertisement); the snapshot describes the newest, and says so when an older
 * one had recorded something.
 */
export class CaptureSession {
  private readonly recorders = new Map<number, BufferRecorder>();
  private readonly problems: string[] = [];
  private duration: number | undefined;
  private encrypted = false;
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly sink: PartSink) {}

  /** Handles one event after the ones before it have been handled. */
  handle(event: CaptureEvent): Promise<void> {
    this.queue = this.queue.then(() => this.process(event));
    return this.queue;
  }

  snapshot(): CaptureSnapshot {
    const buffers = this.currentBuffers();
    const missing = this.missingRanges(buffers);
    const wholeBuffers = buffers.length > 0 && buffers.every((buffer) => buffer.initStored && buffer.stoppedBecause === undefined);
    const complete = wholeBuffers && !this.encrypted && this.duration !== undefined && missing.length === 0;
    return {
      protected: this.encrypted,
      durationSeconds: this.duration,
      buffers,
      missing,
      problems: [...this.problems],
      complete,
    };
  }

  private async process(event: CaptureEvent): Promise<void> {
    switch (event.kind) {
      case 'eme':
        this.markEncrypted();
        return;
      case 'buffer':
        this.addBuffer(event.bufferId, event.sourceId, event.mime);
        return;
      case 'append':
        await this.append(event.bufferId, event.bytes, event.durationSeconds);
        return;
    }
  }

  private addBuffer(bufferId: number, sourceId: number, mime: string): void {
    const older = [...this.recorders.values()].some((recorder) => recorder.sourceId < sourceId && recorder.snapshot().fragmentCount > 0);
    if (older) {
      this.addProblem('The page started another video. Only the newest one is recorded.');
    }

    const recorder = new BufferRecorder(bufferId, sourceId, mime, this.sink, {
      problem: (message) => this.addProblem(message),
      protectedMedia: () => this.markEncrypted(),
    });
    this.recorders.set(bufferId, recorder);
    if (this.encrypted) {
      recorder.stop(ENCRYPTED_MESSAGE);
      return;
    }
    if (!isRecordableMediaType(mime)) {
      const reason = `The player uses a format StreamDraft cannot save (${mime}).`;
      recorder.stop(reason);
      this.addProblem(reason);
    }
  }

  private async append(bufferId: number, bytes: Uint8Array, durationSeconds: number | undefined): Promise<void> {
    if (durationSeconds !== undefined && Number.isFinite(durationSeconds) && durationSeconds > 0) {
      this.duration = durationSeconds;
    }

    const recorder = this.recorders.get(bufferId);
    if (recorder === undefined || this.encrypted) {
      return;
    }
    await recorder.push(bytes);
  }

  private markEncrypted(): void {
    if (this.encrypted) {
      return;
    }

    this.encrypted = true;
    this.addProblem(ENCRYPTED_MESSAGE);
    for (const recorder of this.recorders.values()) {
      recorder.stop(ENCRYPTED_MESSAGE);
    }
  }

  private addProblem(message: string): void {
    if (!this.problems.includes(message)) {
      this.problems.push(message);
    }
  }

  private currentBuffers(): BufferSnapshot[] {
    const newest = Math.max(-1, ...[...this.recorders.values()].map((recorder) => recorder.sourceId));
    return [...this.recorders.values()]
      .filter((recorder) => recorder.sourceId === newest)
      .map((recorder) => recorder.snapshot());
  }

  /** What at least one of the recorded buffers lacks; unknown (nothing listed) until the length is known. */
  private missingRanges(buffers: readonly BufferSnapshot[]): TimeRange[] {
    if (this.duration === undefined) {
      return [];
    }

    const duration = this.duration;
    const gaps = buffers.flatMap((buffer) => gapsIn(buffer.covered, duration));
    return mergeRanges(gaps, EDGE_SECONDS / 5);
  }
}
