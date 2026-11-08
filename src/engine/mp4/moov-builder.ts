import { ascii, box, fullBox, needsWide, u16, u32, u64 } from './bytes.ts';
import type { TrackTables, ValueRun } from './track-tables.ts';

/** The movie's own clock; each track keeps its media clock. */
export const MOVIE_TIMESCALE = 1000;

const UNITY_RATE = 0x00010000;
const FULL_VOLUME = 0x0100;
/** Track flags: enabled, and part of the movie. */
const TRACK_ENABLED_IN_MOVIE = 0x3;
/** The language code "und" (undetermined), packed in 15 bits. */
const LANGUAGE_UNDETERMINED = 0x55c4;
const EMPTY_EDIT = 0xffffffff;
const MAX_UINT32 = 0xffffffff;
const SELF_CONTAINED = 1;
const IDENTITY_MATRIX = u32(0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000);
const HANDLER_NAMES: Readonly<Record<string, string>> = { vide: 'VideoHandler', soun: 'SoundHandler' };

function clampToU32(value: number): number {
  return Math.min(MAX_UINT32, Math.max(0, Math.round(value)));
}

function toMovieTicks(ticks: number, timescale: number): number {
  return clampToU32((ticks / timescale) * MOVIE_TIMESCALE);
}

function runsBox(type: string, runs: readonly ValueRun[], version: number): Uint8Array {
  const entries = runs.map((run) => u32(run.count, run.value));
  return fullBox(type, version, 0, u32(runs.length), ...entries);
}

function chunkMapBox(table: TrackTables): Uint8Array {
  // Sample-to-chunk: one entry per change in the number of samples per chunk.
  const entries: Uint8Array[] = [];
  let previous = -1;
  table.chunkSamples.forEach((count, index) => {
    if (count !== previous) {
      entries.push(u32(index + 1, count, 1));
      previous = count;
    }
  });
  return fullBox('stsc', 0, 0, u32(entries.length), ...entries);
}

function chunkOffsetBox(table: TrackTables): Uint8Array {
  const wide = table.chunkOffsets.some(needsWide);
  if (wide) {
    return fullBox('co64', 0, 0, u32(table.chunkOffsets.length), ...table.chunkOffsets.map(u64));
  }
  return fullBox('stco', 0, 0, u32(table.chunkOffsets.length), u32(...table.chunkOffsets));
}

function sampleTableBox(table: TrackTables): Uint8Array {
  const parts = [table.info.sampleDescription, runsBox('stts', table.durationRuns, 0)];
  if (table.hasCompositionOffsets) {
    parts.push(runsBox('ctts', table.ctoRuns, table.hasNegativeCto ? 1 : 0));
  }
  parts.push(chunkMapBox(table));
  parts.push(fullBox('stsz', 0, 0, u32(0, table.sampleCount), table.sizes.toBigEndian()));
  parts.push(chunkOffsetBox(table));
  if (!table.allSync) {
    parts.push(fullBox('stss', 0, 0, u32(table.syncSamples.length), table.syncSamples.toBigEndian()));
  }
  return box('stbl', ...parts);
}

function mediaInformationBox(table: TrackTables): Uint8Array {
  const header =
    table.kind === 'video' ? fullBox('vmhd', 0, 1, u16(0, 0, 0, 0)) : fullBox('smhd', 0, 0, u16(0, 0));
  const dataInformation = box('dinf', fullBox('dref', 0, 0, u32(1), fullBox('url ', 0, SELF_CONTAINED)));
  return box('minf', header, dataInformation, sampleTableBox(table));
}

function mediaHeaderBox(table: TrackTables): Uint8Array {
  if (needsWide(table.totalTicks)) {
    return fullBox('mdhd', 1, 0, u64(0), u64(0), u32(table.timescale), u64(table.totalTicks), u16(LANGUAGE_UNDETERMINED, 0));
  }
  return fullBox('mdhd', 0, 0, u32(0, 0, table.timescale, table.totalTicks), u16(LANGUAGE_UNDETERMINED, 0));
}

function handlerBox(table: TrackTables): Uint8Array {
  const handler = table.kind === 'video' ? 'vide' : 'soun';
  const name = HANDLER_NAMES[handler] ?? '';
  return fullBox('hdlr', 0, 0, u32(0), ascii(handler), u32(0, 0, 0), ascii(name), Uint8Array.of(0));
}

function trackHeaderBox(table: TrackTables, durationTicks: number): Uint8Array {
  const volume = table.kind === 'audio' ? FULL_VOLUME : 0;
  const matrix = table.info.matrix ?? IDENTITY_MATRIX;
  return fullBox(
    'tkhd',
    0,
    TRACK_ENABLED_IN_MOVIE,
    u32(0, 0, table.id, 0, durationTicks),
    u32(0, 0),
    u16(0, 0, volume, 0),
    matrix,
    u32(table.info.width, table.info.height),
  );
}

/** Where the track starts on the movie's clock, and how long it plays. */
export interface TrackTiming {
  /** Delay before the track's first sample, in movie ticks. */
  delay: number;
  /** Playing length, in movie ticks. */
  duration: number;
}

export function trackTiming(table: TrackTables, earliestStart: number): TrackTiming {
  const minCto = Number.isFinite(table.minCto) ? Math.max(0, table.minCto) : 0;
  const startSeconds = (table.startTime ?? 0) / table.timescale - earliestStart;
  return {
    delay: clampToU32(startSeconds * MOVIE_TIMESCALE),
    duration: toMovieTicks(table.totalTicks - minCto, table.timescale),
  };
}

/**
 * The edit list: an empty edit for a track that starts late, then the media
 * from its first composition offset on, so the first picture shows at time 0
 * even when frames are reordered.
 */
function editListBox(table: TrackTables, timing: TrackTiming): Uint8Array {
  const minCto = Number.isFinite(table.minCto) ? Math.max(0, table.minCto) : 0;
  const entries: Uint8Array[] = [];
  if (timing.delay > 0) {
    entries.push(u32(timing.delay, EMPTY_EDIT, UNITY_RATE));
  }
  entries.push(u32(timing.duration, minCto, UNITY_RATE));
  return box('edts', fullBox('elst', 0, 0, u32(entries.length), ...entries));
}

function trackBox(table: TrackTables, timing: TrackTiming): Uint8Array {
  const media = box('mdia', mediaHeaderBox(table), handlerBox(table), mediaInformationBox(table));
  return box('trak', trackHeaderBox(table, timing.delay + timing.duration), editListBox(table, timing), media);
}

/** The movie box: movie header, then one `trak` with full sample tables per track. */
export function buildMoov(tables: readonly TrackTables[]): Uint8Array {
  const starts = tables.map((table) => (table.startTime ?? 0) / table.timescale);
  const earliestStart = Math.min(...starts);
  const timings = tables.map((table) => trackTiming(table, earliestStart));
  const movieDuration = Math.max(0, ...timings.map((timing) => timing.delay + timing.duration));
  const header = fullBox(
    'mvhd',
    0,
    0,
    u32(0, 0, MOVIE_TIMESCALE, movieDuration, UNITY_RATE),
    u16(FULL_VOLUME, 0),
    u32(0, 0),
    IDENTITY_MATRIX,
    u32(0, 0, 0, 0, 0, 0),
    u32(tables.length + 1),
  );
  return box('moov', header, ...tables.map((table, index) => trackBox(table, timings[index] ?? { delay: 0, duration: 0 })));
}

/** The file type box: the brand tells players what to expect. */
export function buildFileType(audioOnly: boolean): Uint8Array {
  if (audioOnly) {
    return box('ftyp', ascii('M4A '), u32(0), ascii('M4A '), ascii('mp42'), ascii('isom'));
  }
  return box('ftyp', ascii('isom'), u32(0x200), ascii('isom'), ascii('iso2'), ascii('avc1'), ascii('mp41'));
}
