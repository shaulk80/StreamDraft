import { parseFragments } from '../../engine/mp4/fragment-reader.ts';
import { ENCRYPTED_MESSAGE, parseInitSegment } from '../../engine/mp4/init-reader.ts';
import type { SampleDefaults, TrackInfo } from '../../engine/mp4/types.ts';
import { mediaKindOf } from './type-filter.ts';
import { formatClock, mergeRanges, SAME_START_SECONDS, totalSeconds } from './ranges.ts';
import { SegmentAssembler, type AssembledPart } from './segment-assembler.ts';
import type { BufferSnapshot, PartSink, TimeRange } from './types.ts';

/** What a recorder tells its session. */
export interface RecorderEvents {
  /** Something the user should hear about. */
  problem(message: string): void;
  /** The init section says the media is encrypted. */
  protectedMedia(): void;
}

interface StoredSegment {
  range: TimeRange;
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** What makes two init sections the same representation: codec settings, size and clock. */
function configurationOf(tracks: readonly TrackInfo[]): string {
  return tracks
    .map((track) => `${track.sourceId}:${track.codec}:${track.timescale}:${track.width}x${track.height}:${hex(track.sampleDescription)}`)
    .join('|');
}

function defaultsOf(tracks: readonly TrackInfo[]): Map<number, SampleDefaults> {
  return new Map(tracks.map((track) => [track.sourceId, track.defaults]));
}

/**
 * Records one source buffer of the player: finds its init section and media
 * segments in what the player appends, stores each once, and knows which
 * stretch of the video it holds. It stops, and says why, when the buffer
 * changes to another representation (the player switched quality), when the
 * data cannot be read, or when storing fails. It never throws.
 */
export class BufferRecorder {
  private readonly assembler = new SegmentAssembler();
  private tracks: TrackInfo[] = [];
  private configuration: string | undefined;
  private segments: StoredSegment[] = [];
  private stopped: string | undefined;
  private initStored = false;
  private duplicates = 0;
  private storedCount = 0;
  private queue: Promise<void> = Promise.resolve();

  constructor(
    readonly bufferId: number,
    readonly sourceId: number,
    readonly mime: string,
    private readonly sink: PartSink,
    private readonly events: RecorderEvents,
  ) {}

  /** Takes what the player appended. Calls are handled in order, one after the other. */
  push(chunk: Uint8Array): Promise<void> {
    this.queue = this.queue.then(() => this.handle(chunk));
    return this.queue;
  }

  /** Stops recording this buffer for a reason outside it (encrypted media, an unreadable format). */
  stop(reason: string): void {
    this.stopped ??= reason;
  }

  snapshot(): BufferSnapshot {
    const covered = mergeRanges(this.segments.map((segment) => segment.range));
    return {
      bufferId: this.bufferId,
      sourceId: this.sourceId,
      mime: this.mime,
      kind: this.tracks[0]?.kind ?? mediaKindOf(this.mime),
      initStored: this.initStored,
      fragmentCount: this.storedCount,
      duplicateCount: this.duplicates,
      covered,
      coveredSeconds: totalSeconds(covered),
      stoppedBecause: this.stopped,
    };
  }

  private async handle(chunk: Uint8Array): Promise<void> {
    if (this.stopped !== undefined) {
      return;
    }

    const assembled = this.assembler.push(chunk);
    if (!assembled.ok) {
      this.fail(assembled.error);
      return;
    }

    for (const part of assembled.value) {
      if (this.stopped !== undefined) {
        return;
      }
      await (part.kind === 'init' ? this.handleInit(part) : this.handleSegment(part));
    }
  }

  private async handleInit(part: AssembledPart): Promise<void> {
    const parsed = parseInitSegment(part.bytes);
    if (!parsed.ok) {
      if (parsed.error === ENCRYPTED_MESSAGE) {
        this.events.protectedMedia();
      }
      this.fail(parsed.error);
      return;
    }

    const configuration = configurationOf(parsed.value);
    if (this.configuration === undefined) {
      this.tracks = parsed.value;
      this.configuration = configuration;
      await this.store({ kind: 'init', index: 0, bytes: part.bytes });
      this.initStored = this.stopped === undefined;
      return;
    }

    // The player sends the init section again after a seek; only a different one is a change.
    if (configuration !== this.configuration) {
      const at = this.segments.reduce((latest, segment) => Math.max(latest, segment.range.end), 0);
      this.fail(`The player changed the quality of the ${this.snapshot().kind} at ${formatClock(at)}. Choose one quality in the player's menu and record again.`);
    }
  }

  private async handleSegment(part: AssembledPart): Promise<void> {
    const main = this.tracks[0];
    if (main === undefined) {
      this.fail('The player sent video data before it described it.');
      return;
    }

    const fragments = parseFragments(part.bytes, defaultsOf(this.tracks));
    if (!fragments.ok) {
      this.fail(fragments.error);
      return;
    }

    const own = fragments.value.filter((fragment) => fragment.sourceTrackId === main.sourceId);
    const first = own[0];
    if (first === undefined) {
      return;
    }
    if (first.startTime === undefined) {
      this.fail('A part of the video does not say where it belongs in time.');
      return;
    }

    const durationTicks = own.reduce((sum, fragment) => sum + fragment.samples.reduce((inner, sample) => inner + sample.duration, 0), 0);
    const range = { start: first.startTime / main.timescale, end: (first.startTime + durationTicks) / main.timescale };
    if (this.segments.some((segment) => Math.abs(segment.range.start - range.start) < SAME_START_SECONDS)) {
      this.duplicates += 1;
      return;
    }
    if (this.segments.some((segment) => range.start < segment.range.end - SAME_START_SECONDS && range.end > segment.range.start + SAME_START_SECONDS)) {
      this.fail(`Parts of the ${this.snapshot().kind} overlap around ${formatClock(range.start)}: the player is cutting the video differently than before.`);
      return;
    }

    this.storedCount += 1;
    await this.store({ kind: 'fragment', index: this.storedCount, bytes: part.bytes, startSeconds: range.start, endSeconds: range.end });
    if (this.stopped === undefined) {
      this.segments.push({ range });
    }
  }

  private async store(part: Parameters<PartSink['store']>[1]): Promise<void> {
    try {
      const stored = await this.sink.store(this.bufferId, part);
      if (!stored.ok) {
        this.fail(stored.error);
      }
    } catch (error) {
      console.error('StreamDraft: storing a recorded part failed', error);
      this.fail('The recording could not be stored.');
    }
  }

  private fail(message: string): void {
    if (this.stopped === undefined) {
      this.stopped = message;
      this.events.problem(message);
    }
  }
}
