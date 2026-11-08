import { fail, ok, type Result } from '../../core/result.ts';
import { childBoxes, findBox, readBoxes, sliceBox, textAt, viewOf, type Box } from './bytes.ts';
import type { SampleDefaults, TrackInfo, TrackKind } from './types.ts';

export const DAMAGED_MESSAGE = 'A part of the video is damaged and cannot be joined.';

/** Sample entries the muxer writes. Anything else is reported rather than written into a file nobody can play. */
const SUPPORTED_CODECS: readonly string[] = ['avc1', 'avc3', 'hvc1', 'hev1', 'av01', 'vp09', 'mp4a', 'ac-3', 'ec-3', 'Opus'];
/** Sample entries of encrypted tracks (common encryption): DRM. */
const ENCRYPTED_CODECS: readonly string[] = ['encv', 'enca'];

const HANDLER_KINDS: Readonly<Record<string, TrackKind>> = { vide: 'video', soun: 'audio' };

// Offsets inside the content of `tkhd` boxes: version 1 has 64-bit times and duration, 12 bytes more up to the matrix.
const TKHD_MATRIX_V0 = 40;
const TKHD_VERSION_1_SHIFT = 12;
const MATRIX_SIZE = 36;
const TKHD_WIDTH_AFTER_MATRIX = MATRIX_SIZE;

function sampleDefaultsOf(data: Uint8Array, mvex: Box | undefined): Map<number, SampleDefaults> {
  const defaults = new Map<number, SampleDefaults>();
  if (mvex === undefined) {
    return defaults;
  }

  const view = viewOf(data);
  for (const trex of childBoxes(data, mvex).filter((candidate) => candidate.type === 'trex')) {
    defaults.set(view.getUint32(trex.body + 4), {
      duration: view.getUint32(trex.body + 12),
      size: view.getUint32(trex.body + 16),
      flags: view.getUint32(trex.body + 20),
    });
  }
  return defaults;
}

interface TrackHeader {
  id: number;
  width: number;
  height: number;
  matrix: Uint8Array;
}

function readTrackHeader(data: Uint8Array, tkhd: Box): TrackHeader {
  const view = viewOf(data);
  const shift = data[tkhd.body] === 1 ? TKHD_VERSION_1_SHIFT : 0;
  const matrixStart = tkhd.body + TKHD_MATRIX_V0 + shift;
  const sizeStart = matrixStart + TKHD_WIDTH_AFTER_MATRIX;
  return {
    id: view.getUint32(tkhd.body + 12 + shift),
    width: view.getUint32(sizeStart),
    height: view.getUint32(sizeStart + 4),
    matrix: data.slice(matrixStart, matrixStart + MATRIX_SIZE),
  };
}

function unsupportedCodec(codec: string): string {
  return `This video uses a format (${codec}) that StreamDraft cannot save yet.`;
}

function readTrack(data: Uint8Array, trak: Box, defaults: Map<number, SampleDefaults>): Result<TrackInfo | undefined> {
  const parts = childBoxes(data, trak);
  const tkhd = findBox(parts, 'tkhd');
  const mdia = findBox(parts, 'mdia');
  if (tkhd === undefined || mdia === undefined) {
    return fail(DAMAGED_MESSAGE);
  }

  const mediaParts = childBoxes(data, mdia);
  const mdhd = findBox(mediaParts, 'mdhd');
  const hdlr = findBox(mediaParts, 'hdlr');
  const minf = findBox(mediaParts, 'minf');
  if (mdhd === undefined || hdlr === undefined || minf === undefined) {
    return fail(DAMAGED_MESSAGE);
  }

  const kind = HANDLER_KINDS[textAt(data, hdlr.body + 8, 4)];
  if (kind === undefined) {
    return ok(undefined);
  }

  const stbl = findBox(childBoxes(data, minf), 'stbl');
  const stsd = stbl === undefined ? undefined : findBox(childBoxes(data, stbl), 'stsd');
  if (stsd === undefined) {
    return fail(DAMAGED_MESSAGE);
  }

  const codec = textAt(data, stsd.body + 12, 4);
  if (ENCRYPTED_CODECS.includes(codec)) {
    return fail('This video is protected (encrypted) and cannot be downloaded.');
  }
  if (!SUPPORTED_CODECS.includes(codec)) {
    return fail(unsupportedCodec(codec));
  }

  const header = readTrackHeader(data, tkhd);
  const view = viewOf(data);
  const timescaleAt = mdhd.body + (data[mdhd.body] === 1 ? 20 : 12);
  return ok({
    sourceId: header.id,
    kind,
    timescale: view.getUint32(timescaleAt),
    sampleDescription: sliceBox(data, stsd),
    codec,
    width: header.width,
    height: header.height,
    matrix: header.matrix,
    defaults: defaults.get(header.id) ?? { duration: 0, size: 0, flags: 0 },
  });
}

/**
 * The audio and video tracks an init segment describes (or the `moov` of a
 * whole file). Other tracks (subtitles) are left out; encrypted tracks and
 * codecs the muxer does not write give an error in plain words.
 */
export function parseInitSegment(data: Uint8Array): Result<TrackInfo[]> {
  try {
    const moov = findBox(readBoxes(data), 'moov');
    if (moov === undefined) {
      return fail(DAMAGED_MESSAGE);
    }

    const parts = childBoxes(data, moov);
    const defaults = sampleDefaultsOf(data, findBox(parts, 'mvex'));
    const tracks: TrackInfo[] = [];
    for (const trak of parts.filter((candidate) => candidate.type === 'trak')) {
      const track = readTrack(data, trak, defaults);
      if (!track.ok) {
        return track;
      }
      if (track.value !== undefined) {
        tracks.push(track.value);
      }
    }

    return tracks.length === 0 ? fail('The video has no picture or sound to save.') : ok(tracks);
  } catch (error) {
    console.error('StreamDraft: could not read an init segment', error);
    return fail(DAMAGED_MESSAGE);
  }
}
