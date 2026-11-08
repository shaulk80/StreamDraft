import { fail, ok, type Result } from '../../core/result.ts';
import { childBoxes, readBoxes, viewOf, type Box } from './bytes.ts';
import { DAMAGED_MESSAGE } from './init-reader.ts';
import type { Sample, SampleDefaults, TrackFragment } from './types.ts';

// tfhd flags
const TFHD_BASE_OFFSET = 0x1;
const TFHD_SAMPLE_DESCRIPTION = 0x2;
const TFHD_DEFAULT_DURATION = 0x8;
const TFHD_DEFAULT_SIZE = 0x10;
const TFHD_DEFAULT_FLAGS = 0x20;
const TFHD_DEFAULT_BASE_IS_MOOF = 0x20000;
// trun flags
const TRUN_DATA_OFFSET = 0x1;
const TRUN_FIRST_SAMPLE_FLAGS = 0x4;
const TRUN_SAMPLE_DURATION = 0x100;
const TRUN_SAMPLE_SIZE = 0x200;
const TRUN_SAMPLE_FLAGS = 0x400;
const TRUN_SAMPLE_CTO = 0x800;
/** Sample flag: the sample depends on others, so a decoder cannot start from it. */
const NON_SYNC = 0x10000;
const FLAGS_MASK = 0xffffff;
const MDAT_HEADER = 8;

const ABSOLUTE_OFFSET_MESSAGE = 'This video uses a layout of its parts that StreamDraft cannot join yet.';

interface TrackHeader {
  trackId: number;
  defaults: SampleDefaults;
  /** Absolute offset the data offsets count from, when the fragment states one; the muxer cannot use that. */
  absoluteBase: boolean;
  defaultBaseIsMoof: boolean;
}

function readTrackHeader(data: Uint8Array, tfhd: Box, trackDefaults: SampleDefaults): TrackHeader {
  const view = viewOf(data);
  const flags = view.getUint32(tfhd.body) & FLAGS_MASK;
  const defaults = { ...trackDefaults };
  let cursor = tfhd.body + 8;
  if ((flags & TFHD_BASE_OFFSET) !== 0) {
    cursor += 8;
  }
  if ((flags & TFHD_SAMPLE_DESCRIPTION) !== 0) {
    cursor += 4;
  }
  if ((flags & TFHD_DEFAULT_DURATION) !== 0) {
    defaults.duration = view.getUint32(cursor);
    cursor += 4;
  }
  if ((flags & TFHD_DEFAULT_SIZE) !== 0) {
    defaults.size = view.getUint32(cursor);
    cursor += 4;
  }
  if ((flags & TFHD_DEFAULT_FLAGS) !== 0) {
    defaults.flags = view.getUint32(cursor);
  }
  return {
    trackId: view.getUint32(tfhd.body + 4),
    defaults,
    absoluteBase: (flags & TFHD_BASE_OFFSET) !== 0,
    defaultBaseIsMoof: (flags & TFHD_DEFAULT_BASE_IS_MOOF) !== 0,
  };
}

interface Run {
  samples: Sample[];
  /** Offset of the run's first byte in the segment, counted from the run's own base. */
  dataOffset: number | undefined;
}

function readRun(data: Uint8Array, trun: Box, defaults: SampleDefaults): Run {
  const view = viewOf(data);
  const version = data[trun.body] ?? 0;
  const flags = view.getUint32(trun.body) & FLAGS_MASK;
  const count = view.getUint32(trun.body + 4);
  let cursor = trun.body + 8;
  let dataOffset: number | undefined;
  if ((flags & TRUN_DATA_OFFSET) !== 0) {
    dataOffset = view.getInt32(cursor);
    cursor += 4;
  }

  let firstFlags: number | undefined;
  if ((flags & TRUN_FIRST_SAMPLE_FLAGS) !== 0) {
    firstFlags = view.getUint32(cursor);
    cursor += 4;
  }

  const samples: Sample[] = [];
  for (let index = 0; index < count; index++) {
    let duration = defaults.duration;
    let size = defaults.size;
    let sampleFlags = index === 0 && firstFlags !== undefined ? firstFlags : defaults.flags;
    let cto = 0;
    if ((flags & TRUN_SAMPLE_DURATION) !== 0) {
      duration = view.getUint32(cursor);
      cursor += 4;
    }
    if ((flags & TRUN_SAMPLE_SIZE) !== 0) {
      size = view.getUint32(cursor);
      cursor += 4;
    }
    if ((flags & TRUN_SAMPLE_FLAGS) !== 0) {
      sampleFlags = view.getUint32(cursor);
      cursor += 4;
    }
    if ((flags & TRUN_SAMPLE_CTO) !== 0) {
      cto = version === 1 ? view.getInt32(cursor) : view.getUint32(cursor);
      cursor += 4;
    }
    samples.push({ duration, size, cto, sync: (sampleFlags & NON_SYNC) === 0 });
  }
  return { samples, dataOffset };
}

function readStartTime(data: Uint8Array, tfdt: Box | undefined): number | undefined {
  if (tfdt === undefined) {
    return undefined;
  }

  const view = viewOf(data);
  return data[tfdt.body] === 1 ? Number(view.getBigUint64(tfdt.body + 4)) : view.getUint32(tfdt.body + 4);
}

function readTraf(data: Uint8Array, traf: Box, moof: Box, defaultsByTrack: ReadonlyMap<number, SampleDefaults>, dataEnd: number): Result<{ fragments: TrackFragment[]; dataEnd: number }> {
  const parts = childBoxes(data, traf);
  const tfhd = parts.find((candidate) => candidate.type === 'tfhd');
  if (tfhd === undefined) {
    return fail(DAMAGED_MESSAGE);
  }

  const view = viewOf(data);
  const trackId = view.getUint32(tfhd.body + 4);
  const trackDefaults = defaultsByTrack.get(trackId);
  if (trackDefaults === undefined) {
    // A track the muxer leaves out (subtitles): its data is skipped.
    return ok({ fragments: [], dataEnd });
  }

  const header = readTrackHeader(data, tfhd, trackDefaults);
  if (header.absoluteBase) {
    return fail(ABSOLUTE_OFFSET_MESSAGE);
  }

  const base = header.defaultBaseIsMoof || dataEnd === 0 ? moof.start : dataEnd;
  const startTime = readStartTime(data, parts.find((candidate) => candidate.type === 'tfdt'));
  const fragments: TrackFragment[] = [];
  let cursor = dataEnd === 0 ? moof.end + MDAT_HEADER : dataEnd;
  for (const trun of parts.filter((candidate) => candidate.type === 'trun')) {
    const run = readRun(data, trun, header.defaults);
    const start = run.dataOffset === undefined ? cursor : base + run.dataOffset;
    const end = start + run.samples.reduce((sum, sample) => sum + sample.size, 0);
    if (start < 0 || end > data.length) {
      return fail(DAMAGED_MESSAGE);
    }

    fragments.push({
      sourceTrackId: trackId,
      samples: run.samples,
      payload: data.subarray(start, end),
      startTime: fragments.length === 0 ? startTime : undefined,
    });
    cursor = end;
  }
  return ok({ fragments, dataEnd: cursor });
}

/**
 * The sample runs of a media segment (`moof` boxes with their `mdat` data), one
 * `TrackFragment` per `trun`. `defaultsByTrack` names the tracks to read (by
 * source id) and their `trex` defaults; data of other tracks is skipped. The
 * payloads point into `data`, they are not copied.
 */
export function parseFragments(data: Uint8Array, defaultsByTrack: ReadonlyMap<number, SampleDefaults>): Result<TrackFragment[]> {
  try {
    const boxes = readBoxes(data);
    if ((boxes.at(-1)?.end ?? 0) !== data.length) {
      // Bytes that do not form a box: the segment was cut off, and joining it would silently lose its end.
      return fail(DAMAGED_MESSAGE);
    }

    const fragments: TrackFragment[] = [];
    for (const moof of boxes.filter((candidate) => candidate.type === 'moof')) {
      let dataEnd = 0;
      for (const traf of childBoxes(data, moof).filter((candidate) => candidate.type === 'traf')) {
        const read = readTraf(data, traf, moof, defaultsByTrack, dataEnd);
        if (!read.ok) {
          return read;
        }
        fragments.push(...read.value.fragments);
        dataEnd = read.value.dataEnd;
      }
    }
    return ok(fragments);
  } catch (error) {
    console.error('StreamDraft: could not read a media segment', error);
    return fail(DAMAGED_MESSAGE);
  }
}
