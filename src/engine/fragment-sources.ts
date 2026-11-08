import { fail, ok, type Result } from '../core/result.ts';
import type { HlsKey } from '../formats/hls-types.ts';
import { aacTrack, parseAdts, sameConfig, type AacConfig } from './mp4/adts.ts';
import { parseFragments } from './mp4/fragment-reader.ts';
import { parseInitSegment } from './mp4/init-reader.ts';
import type { SampleDefaults, TrackFragment, TrackInfo } from './mp4/types.ts';
import type { SegmentDecryptor } from './segment-decryptor.ts';
import type { SegmentStore } from './segment-store.ts';
import { TsSegmentMuxer } from './ts-segment-muxer.ts';

export type SourceFormat = 'ts' | 'fmp4' | 'adts';

/** A downloaded part (a segment or an init section) waiting in the store. */
export interface StoredPart {
  name: string;
  /** Present when the part is AES-128 encrypted. */
  key?: HlsKey;
  /** The segment's media sequence number: the IV when the key states none. */
  sequence?: number;
}

/** One stream to join: its init section (fMP4 only) and its segments in order. */
export interface MuxSource {
  format: SourceFormat;
  init?: StoredPart;
  segments: StoredPart[];
}

/** What reading one segment gives: sample runs of the source's tracks. */
export type SegmentFragments = TrackFragment[];

/** Hands out the sample runs of one stream, a segment at a time. */
export interface FragmentSource {
  readonly segmentCount: number;
  /** Reads what is needed to know the tracks. The first segment is kept for the first `next()`. */
  open(): Promise<Result<TrackInfo[]>>;
  /** The next segment's sample runs, or undefined after the last. */
  next(): Promise<Result<SegmentFragments | undefined>>;
  close(): void;
}

/** Reads stored parts, decrypting those that are encrypted. */
export class PartLoader {
  private readonly store: SegmentStore;
  private readonly decryptor: SegmentDecryptor | undefined;

  constructor(store: SegmentStore, decryptor: SegmentDecryptor | undefined) {
    this.store = store;
    this.decryptor = decryptor;
  }

  async load(part: StoredPart): Promise<Result<Uint8Array>> {
    const stored = await this.store.read(part.name);
    if (!stored.ok || part.key === undefined) {
      return stored;
    }

    if (this.decryptor === undefined) {
      return fail('The video is encrypted and no key was available.');
    }
    return this.decryptor.decrypt(stored.value, part.key, part.sequence ?? 0);
  }
}

/** Shared walk over the segments of a source. */
abstract class SegmentWalker {
  protected readonly loader: PartLoader;
  protected readonly source: MuxSource;
  protected index = 0;

  constructor(loader: PartLoader, source: MuxSource) {
    this.loader = loader;
    this.source = source;
  }

  get segmentCount(): number {
    return this.source.segments.length;
  }

  close(): void {
    // Nothing to release by default.
  }

  protected async loadNext(): Promise<Result<Uint8Array | undefined>> {
    const part = this.source.segments[this.index];
    if (part === undefined) {
      return ok(undefined);
    }

    this.index++;
    return this.loader.load(part);
  }
}

function defaultsOf(tracks: readonly TrackInfo[]): Map<number, SampleDefaults> {
  return new Map(tracks.map((track) => [track.sourceId, track.defaults]));
}

/** Fragmented MP4: DASH segments and HLS fMP4. The init section names the tracks. */
export class Fmp4Source extends SegmentWalker implements FragmentSource {
  private defaults = new Map<number, SampleDefaults>();

  async open(): Promise<Result<TrackInfo[]>> {
    if (this.source.init === undefined) {
      return fail('The video has no initialisation data.');
    }

    const init = await this.loader.load(this.source.init);
    if (!init.ok) {
      return init;
    }

    const tracks = parseInitSegment(init.value);
    if (tracks.ok) {
      this.defaults = defaultsOf(tracks.value);
    }
    return tracks;
  }

  async next(): Promise<Result<SegmentFragments | undefined>> {
    const data = await this.loadNext();
    if (!data.ok) {
      return data;
    }
    if (data.value === undefined) {
      return ok(undefined);
    }
    return parseFragments(data.value, this.defaults);
  }
}

/** MPEG-TS segments, remuxed by mux.js. The first segment is read in `open()` to learn the tracks. */
export class TsSource extends SegmentWalker implements FragmentSource {
  private readonly muxer = new TsSegmentMuxer();
  private first: SegmentFragments | undefined;

  async open(): Promise<Result<TrackInfo[]>> {
    const data = await this.loadNext();
    if (!data.ok) {
      return data;
    }
    if (data.value === undefined) {
      return fail('The video has no parts.');
    }

    const muxed = this.muxer.push(data.value);
    if (!muxed.ok) {
      return muxed;
    }
    this.first = muxed.value.fragments;
    return ok(muxed.value.tracks);
  }

  async next(): Promise<Result<SegmentFragments | undefined>> {
    if (this.first !== undefined) {
      const first = this.first;
      this.first = undefined;
      return ok(first);
    }

    const data = await this.loadNext();
    if (!data.ok) {
      return data;
    }
    if (data.value === undefined) {
      return ok(undefined);
    }

    const muxed = this.muxer.push(data.value);
    return muxed.ok ? ok(muxed.value.fragments) : muxed;
  }

  override close(): void {
    this.muxer.dispose();
  }
}

/** Raw AAC audio in ADTS frames, written as an `.m4a` track. */
export class AdtsSource extends SegmentWalker implements FragmentSource {
  private config: AacConfig | undefined;
  private first: SegmentFragments | undefined;

  async open(): Promise<Result<TrackInfo[]>> {
    const data = await this.loadNext();
    if (!data.ok) {
      return data;
    }
    if (data.value === undefined) {
      return fail('The audio has no parts.');
    }

    const frames = this.fragmentsOf(data.value);
    if (!frames.ok || this.config === undefined) {
      return frames.ok ? fail('The audio has no parts.') : frames;
    }
    this.first = frames.value;
    return ok([aacTrack(this.config)]);
  }

  async next(): Promise<Result<SegmentFragments | undefined>> {
    if (this.first !== undefined) {
      const first = this.first;
      this.first = undefined;
      return ok(first);
    }

    const data = await this.loadNext();
    if (!data.ok) {
      return data;
    }
    if (data.value === undefined) {
      return ok(undefined);
    }
    return this.fragmentsOf(data.value);
  }

  private fragmentsOf(data: Uint8Array): Result<SegmentFragments> {
    const frames = parseAdts(data);
    if (!frames.ok) {
      return frames;
    }

    if (this.config !== undefined && !sameConfig(this.config, frames.value.config)) {
      return fail('The sound changes its format in the middle of the audio, which StreamDraft cannot join.');
    }
    this.config ??= frames.value.config;
    return ok([{ sourceTrackId: 1, samples: frames.value.samples, payload: frames.value.payload }]);
  }
}

export function createFragmentSource(source: MuxSource, loader: PartLoader): FragmentSource {
  switch (source.format) {
    case 'ts':
      return new TsSource(loader, source);
    case 'fmp4':
      return new Fmp4Source(loader, source);
    case 'adts':
      return new AdtsSource(loader, source);
  }
}
