import { ascii, box, concatBytes, fullBox, u16, u32, u8 } from '../../src/engine/mp4/bytes.ts';

export interface FixtureSample {
  duration: number;
  size: number;
  /** Composition offset; negative values need `signedOffsets`. */
  cto?: number;
  /** A sample a decoder can start from (default true). */
  sync?: boolean;
}

export interface FixtureTrack {
  id: number;
  kind: 'video' | 'audio' | 'text';
  timescale: number;
  /** Sample entry type; `avc1` for video, `mp4a` for audio by default. */
  codec?: string;
  defaults?: { duration: number; size: number; flags: number };
}

export interface FixtureFragment {
  trackId: number;
  /** Decoding time of the first sample, written to `tfdt`. */
  startTime: number;
  /** Index of the first sample in the track, to tell the samples' bytes apart. */
  firstIndex: number;
  samples: FixtureSample[];
}

export interface SegmentOptions {
  /** One `moof` for all fragments (otherwise one `moof` and `mdat` per fragment, the way mux.js writes). */
  combined?: boolean;
  /** `trun` with version 1: signed composition offsets. */
  signedOffsets?: boolean;
  /** Leave durations, sizes and flags to the `tfhd` defaults (the samples must then be equal). */
  useDefaults?: boolean;
  /** Put an absolute base data offset in the `tfhd`. */
  absoluteBase?: boolean;
}

const HANDLERS = { video: 'vide', audio: 'soun', text: 'text' } as const;
const NON_SYNC_FLAGS = 0x10000;
const SYNC_FLAGS = 0x2000000;

/** The bytes of one sample: a value that tells track and index apart. */
export function sampleBytes(trackId: number, index: number, size: number): Uint8Array {
  return new Uint8Array(size).fill((trackId * 41 + index) & 0xff);
}

function defaultCodec(kind: FixtureTrack['kind']): string {
  return kind === 'video' ? 'avc1' : kind === 'audio' ? 'mp4a' : 'tx3g';
}

function trackBox(track: FixtureTrack): Uint8Array {
  const identity = u32(0x10000, 0, 0, 0, 0x10000, 0, 0, 0, 0x40000000);
  const header = fullBox('tkhd', 0, 3, u32(0, 0, track.id, 0, 0), u32(0, 0), u16(0, 0, 0, 0), identity, u32(320 << 16, 180 << 16));
  const media = fullBox('mdhd', 0, 0, u32(0, 0, track.timescale, 0), u16(0x55c4, 0));
  const handler = fullBox('hdlr', 0, 0, u32(0), ascii(HANDLERS[track.kind]), u32(0, 0, 0), u8(0));
  const entry = box(track.codec ?? defaultCodec(track.kind), new Uint8Array(32));
  const table = box('stbl', fullBox('stsd', 0, 0, u32(1), entry));
  return box('trak', header, box('mdia', media, handler, box('minf', table)));
}

/** `ftyp` and `moov` for the given tracks, with `mvex` defaults. */
export function initSegment(tracks: FixtureTrack[]): Uint8Array {
  const trex = tracks.map((track) => {
    const defaults = track.defaults ?? { duration: 0, size: 0, flags: 0 };
    return fullBox('trex', 0, 0, u32(track.id, 1, defaults.duration, defaults.size, defaults.flags));
  });
  const header = fullBox('mvhd', 0, 0, u32(0, 0, 1000, 0, 0x10000), u16(0x100, 0), u32(0, 0), new Uint8Array(36), new Uint8Array(24), u32(tracks.length + 1));
  const moov = box('moov', header, ...tracks.map(trackBox), box('mvex', ...trex));
  return concatBytes([box('ftyp', ascii('iso5'), u32(0), ascii('iso5')), moov]);
}

function sampleFlags(sample: FixtureSample): number {
  return sample.sync === false ? NON_SYNC_FLAGS : SYNC_FLAGS;
}

function trafBox(fragment: FixtureFragment, dataOffset: number, options: SegmentOptions): Uint8Array {
  const [first] = fragment.samples;
  const flagsOfTfhd = 0x20000 | (options.absoluteBase ? 0x1 : 0) | (options.useDefaults ? 0x8 | 0x10 | 0x20 : 0);
  const tfhdBody = [u32(fragment.trackId)];
  if (options.absoluteBase) {
    tfhdBody.push(new Uint8Array(8));
  }
  if (options.useDefaults && first) {
    tfhdBody.push(u32(first.duration, first.size, sampleFlags(first)));
  }
  const tfhd = fullBox('tfhd', 0, flagsOfTfhd, ...tfhdBody);
  const tfdt = fullBox('tfdt', 0, 0, u32(fragment.startTime));

  const explicit = !options.useDefaults;
  const runFlags = 0x1 | (explicit ? 0x100 | 0x200 | 0x400 | 0x800 : 0);
  const entries = explicit
    ? fragment.samples.map((sample) => u32(sample.duration, sample.size, sampleFlags(sample), sample.cto ?? 0))
    : [];
  const trun = fullBox('trun', options.signedOffsets ? 1 : 0, runFlags, u32(fragment.samples.length, dataOffset), ...entries);
  return box('traf', tfhd, tfdt, trun);
}

function payloadOf(fragment: FixtureFragment): Uint8Array {
  return concatBytes(fragment.samples.map((sample, index) => sampleBytes(fragment.trackId, fragment.firstIndex + index, sample.size)));
}

function moofBox(fragments: FixtureFragment[], firstOffset: number, options: SegmentOptions): Uint8Array {
  let offset = firstOffset;
  const trafs = fragments.map((fragment) => {
    const traf = trafBox(fragment, offset, options);
    offset += payloadOf(fragment).length;
    return traf;
  });
  return box('moof', fullBox('mfhd', 0, 0, u32(1)), ...trafs);
}

/** A media segment: `moof` and `mdat` pairs (or one `moof` for all fragments). */
export function mediaSegment(fragments: FixtureFragment[], options: SegmentOptions = {}): Uint8Array {
  const groups = options.combined ? [fragments] : fragments.map((fragment) => [fragment]);
  return concatBytes(
    groups.flatMap((group) => {
      const size = moofBox(group, 0, options).length;
      const moof = moofBox(group, size + 8, options);
      return [moof, box('mdat', ...group.map(payloadOf))];
    }),
  );
}
