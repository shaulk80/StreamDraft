import type { Sample, TrackInfo, TrackKind } from './types.ts';

/** Consecutive equal values stored as one: sample durations and offsets rarely change. */
export interface ValueRun {
  value: number;
  count: number;
}

const INITIAL_CAPACITY = 1024;

/** A growing list of unsigned 32-bit numbers (sample sizes, sync sample numbers). */
export class U32List {
  private values = new Uint32Array(INITIAL_CAPACITY);
  length = 0;

  push(value: number): void {
    if (this.length === this.values.length) {
      const larger = new Uint32Array(this.values.length * 2);
      larger.set(this.values);
      this.values = larger;
    }
    this.values[this.length] = value;
    this.length++;
  }

  /** The numbers as big-endian bytes, the way the sample tables store them. */
  toBigEndian(): Uint8Array {
    const bytes = new Uint8Array(this.length * 4);
    const view = new DataView(bytes.buffer);
    for (let index = 0; index < this.length; index++) {
      view.setUint32(index * 4, this.values[index] ?? 0);
    }
    return bytes;
  }
}

function addToRuns(runs: ValueRun[], value: number): void {
  const last = runs.at(-1);
  if (last !== undefined && last.value === value) {
    last.count++;
    return;
  }
  runs.push({ value, count: 1 });
}

/** The pieces of one output track, kept while its samples are written and turned into sample tables at the end. */
export class TrackTables {
  readonly id: number;
  readonly kind: TrackKind;
  readonly timescale: number;
  readonly info: TrackInfo;
  readonly sizes = new U32List();
  readonly syncSamples = new U32List();
  readonly durationRuns: ValueRun[] = [];
  readonly ctoRuns: ValueRun[] = [];
  /** Offset in the file and sample count of each chunk (one per fragment written). */
  readonly chunkOffsets: number[] = [];
  readonly chunkSamples: number[] = [];
  sampleCount = 0;
  totalTicks = 0;
  minCto = Number.POSITIVE_INFINITY;
  hasNegativeCto = false;
  /** Decoding time of the first sample, in ticks of the track. */
  startTime: number | undefined;

  constructor(id: number, info: TrackInfo) {
    this.id = id;
    this.kind = info.kind;
    this.timescale = info.timescale;
    this.info = info;
  }

  addChunk(offset: number, samples: readonly Sample[], startTime: number | undefined): void {
    this.chunkOffsets.push(offset);
    this.chunkSamples.push(samples.length);
    this.startTime ??= startTime ?? 0;
    for (const sample of samples) {
      this.sampleCount++;
      this.sizes.push(sample.size);
      addToRuns(this.durationRuns, sample.duration);
      addToRuns(this.ctoRuns, sample.cto);
      if (sample.sync) {
        this.syncSamples.push(this.sampleCount);
      }
      this.totalTicks += sample.duration;
      this.minCto = Math.min(this.minCto, sample.cto);
      this.hasNegativeCto ||= sample.cto < 0;
    }
  }

  get allSync(): boolean {
    return this.syncSamples.length === this.sampleCount;
  }

  get hasCompositionOffsets(): boolean {
    return this.ctoRuns.some((run) => run.value !== 0);
  }

  get seconds(): number {
    return this.totalTicks / this.timescale;
  }
}
