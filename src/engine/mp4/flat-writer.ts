import { fail, ok, type Result } from '../../core/result.ts';
import type { OutputSink } from '../output-sink.ts';
import { ascii, concatBytes, u32, u64 } from './bytes.ts';
import { buildFileType, buildMoov } from './moov-builder.ts';
import { TrackTables } from './track-tables.ts';
import type { Sample, TrackInfo, TrackKind } from './types.ts';

/** `mdat` header with a 64-bit size: its length does not depend on how big the data turns out to be. */
const MDAT_HEADER_SIZE = 16;
const LARGE_SIZE_MARKER = 1;

export interface FlatMp4Summary {
  fileSize: number;
  audioOnly: boolean;
  durationSeconds: number;
  tracks: { kind: TrackKind; samples: number }[];
}

function mdatHeader(payloadSize: number): Uint8Array {
  return concatBytes([u32(LARGE_SIZE_MARKER), ascii('mdat'), u64(payloadSize + MDAT_HEADER_SIZE)]);
}

/**
 * Writes a flat MP4: `ftyp`, one `mdat` that holds the samples as they arrive,
 * then the `moov` with the complete sample tables. The tables are kept in
 * memory while writing (a few bytes per sample); the samples never are. The
 * file is written once, front to back, plus a patch of the `mdat` size at the end.
 *
 * The movie box comes last, so the file is complete only when `finish` has
 * run. Players read such files like any other (cameras write them this way).
 */
export class FlatMp4Writer {
  private readonly sink: OutputSink;
  private readonly tables: TrackTables[] = [];
  private started = false;
  private mdatStart = 0;

  constructor(sink: OutputSink) {
    this.sink = sink;
  }

  /** Adds an output track before the first sample is written. Resolves with its id in the file. */
  addTrack(info: TrackInfo): Result<number> {
    if (this.started) {
      return fail('A track cannot be added once writing has started.');
    }

    const id = this.tables.length + 1;
    this.tables.push(new TrackTables(id, info));
    return ok(id);
  }

  /** Seconds of the longest track so far. */
  secondsWritten(): number {
    return Math.max(0, ...this.tables.map((table) => table.seconds));
  }

  async appendSamples(trackId: number, payload: Uint8Array, samples: readonly Sample[], startTime: number | undefined): Promise<Result<void>> {
    const table = this.tables.find((candidate) => candidate.id === trackId);
    if (table === undefined) {
      return fail('The video has a track that was not announced.');
    }

    const begun = await this.begin();
    if (!begun.ok) {
      return begun;
    }

    const offset = this.sink.position;
    const written = await this.sink.append(payload);
    if (!written.ok) {
      return written;
    }
    table.addChunk(offset, samples, startTime);
    return ok(undefined);
  }

  /** Writes the movie box and fixes the `mdat` size. The file is complete after this and `sink.close()`. */
  async finish(): Promise<Result<FlatMp4Summary>> {
    if (this.tables.length === 0 || this.tables.every((table) => table.sampleCount === 0)) {
      return fail('The video has no picture or sound to save.');
    }

    const populated = this.tables.filter((table) => table.sampleCount > 0);
    const payloadSize = this.sink.position - this.mdatStart - MDAT_HEADER_SIZE;
    const moov = await this.sink.append(buildMoov(populated));
    if (!moov.ok) {
      return moov;
    }

    const patched = await this.sink.patch(this.mdatStart, mdatHeader(payloadSize));
    if (!patched.ok) {
      return patched;
    }

    return ok({
      fileSize: this.sink.position,
      audioOnly: populated.every((table) => table.kind === 'audio'),
      durationSeconds: this.secondsWritten(),
      tracks: populated.map((table) => ({ kind: table.kind, samples: table.sampleCount })),
    });
  }

  private async begin(): Promise<Result<void>> {
    if (this.started) {
      return ok(undefined);
    }

    this.started = true;
    const header = await this.sink.append(buildFileType(this.tables.every((table) => table.kind === 'audio')));
    if (!header.ok) {
      return header;
    }

    this.mdatStart = this.sink.position;
    return this.sink.append(mdatHeader(0));
  }
}
