import { childBoxes, findBox, readBoxes, textAt, viewOf, type Box } from '../../src/engine/mp4/bytes.ts';

export interface ReadSample {
  offset: number;
  size: number;
  dts: number;
  pts: number;
  sync: boolean;
}

export interface ReadEdit {
  duration: number;
  /** -1 for an empty edit. */
  mediaTime: number;
}

export interface ReadTrack {
  id: number;
  handler: string;
  timescale: number;
  mediaDuration: number;
  codec: string;
  samples: ReadSample[];
  edits: ReadEdit[];
  offsetBox: 'stco' | 'co64';
  hasSyncTable: boolean;
}

export interface ReadFile {
  topLevel: string[];
  brand: string;
  movieTimescale: number;
  movieDuration: number;
  mdat: Box;
  tracks: ReadTrack[];
}

function need(box: Box | undefined, name: string): Box {
  if (box === undefined) {
    throw new Error(`missing ${name} box`);
  }
  return box;
}

function entries(data: Uint8Array, box: Box, size: number, read: (position: number) => number[]): number[][] {
  const view = viewOf(data);
  const count = view.getUint32(box.body + 4);
  return Array.from({ length: count }, (_unused, index) => read(box.body + 8 + index * size));
}

function readTrack(data: Uint8Array, trak: Box): ReadTrack {
  const view = viewOf(data);
  const parts = childBoxes(data, trak);
  const tkhd = need(findBox(parts, 'tkhd'), 'tkhd');
  const mdia = need(findBox(parts, 'mdia'), 'mdia');
  const mediaParts = childBoxes(data, mdia);
  const mdhd = need(findBox(mediaParts, 'mdhd'), 'mdhd');
  const hdlr = need(findBox(mediaParts, 'hdlr'), 'hdlr');
  const minf = need(findBox(mediaParts, 'minf'), 'minf');
  const stbl = need(findBox(childBoxes(data, minf), 'stbl'), 'stbl');
  const table = childBoxes(data, stbl);
  const version = data[mdhd.body];
  const stsd = need(findBox(table, 'stsd'), 'stsd');

  const durations = entries(data, need(findBox(table, 'stts'), 'stts'), 8, (p) => [view.getUint32(p), view.getUint32(p + 4)]);
  const ctts = findBox(table, 'ctts');
  const offsets = ctts === undefined ? [] : entries(data, ctts, 8, (p) => [view.getUint32(p), data[ctts.body] === 1 ? view.getInt32(p + 4) : view.getUint32(p + 4)]);
  const chunkMap = entries(data, need(findBox(table, 'stsc'), 'stsc'), 12, (p) => [view.getUint32(p), view.getUint32(p + 4)]);
  const stsz = need(findBox(table, 'stsz'), 'stsz');
  const sampleCount = view.getUint32(stsz.body + 8);
  const sizes = Array.from({ length: sampleCount }, (_unused, index) => view.getUint32(stsz.body + 12 + index * 4));
  const stco = findBox(table, 'stco');
  const co64 = findBox(table, 'co64');
  const chunkOffsets = stco
    ? entries(data, stco, 4, (p) => [view.getUint32(p)]).map(([offset]) => offset ?? 0)
    : entries(data, need(co64, 'stco or co64'), 8, (p) => [Number(view.getBigUint64(p))]).map(([offset]) => offset ?? 0);
  const stss = findBox(table, 'stss');
  const syncNumbers = stss ? entries(data, stss, 4, (p) => [view.getUint32(p)]).map(([number]) => number ?? 0) : undefined;

  const durationOf: number[] = durations.flatMap(([count, value]) => Array<number>(count ?? 0).fill(value ?? 0));
  const ctoOf: number[] = offsets.flatMap(([count, value]) => Array<number>(count ?? 0).fill(value ?? 0));
  const samples: ReadSample[] = [];
  let sampleIndex = 0;
  chunkOffsets.forEach((chunkOffset, chunkIndex) => {
    const entry = [...chunkMap].reverse().find(([firstChunk]) => (firstChunk ?? 0) <= chunkIndex + 1);
    let offset = chunkOffset;
    for (let inChunk = 0; inChunk < (entry?.[1] ?? 0); inChunk++) {
      const dts = durationOf.slice(0, sampleIndex).reduce((sum, value) => sum + value, 0);
      samples.push({
        offset,
        size: sizes[sampleIndex] ?? 0,
        dts,
        pts: dts + (ctoOf[sampleIndex] ?? 0),
        sync: syncNumbers === undefined || syncNumbers.includes(sampleIndex + 1),
      });
      offset += sizes[sampleIndex] ?? 0;
      sampleIndex++;
    }
  });

  const elst = findBox(childBoxes(data, need(findBox(parts, 'edts'), 'edts')), 'elst');
  const edits = elst
    ? entries(data, elst, 12, (p) => [view.getUint32(p), view.getInt32(p + 4)]).map(([duration, mediaTime]) => ({ duration: duration ?? 0, mediaTime: mediaTime ?? 0 }))
    : [];

  return {
    id: view.getUint32(tkhd.body + 12),
    handler: textAt(data, hdlr.body + 8, 4),
    timescale: view.getUint32(mdhd.body + (version === 1 ? 20 : 12)),
    mediaDuration: version === 1 ? Number(view.getBigUint64(mdhd.body + 24)) : view.getUint32(mdhd.body + 16),
    codec: textAt(data, stsd.body + 12, 4),
    samples,
    edits,
    offsetBox: stco ? 'stco' : 'co64',
    hasSyncTable: stss !== undefined,
  };
}

/** Reads a flat MP4 the way a player does, from its sample tables. Test oracle, independent of the writer. */
export function readFlatMp4(data: Uint8Array): ReadFile {
  const top = readBoxes(data);
  const moov = need(findBox(top, 'moov'), 'moov');
  const ftyp = need(findBox(top, 'ftyp'), 'ftyp');
  const parts = childBoxes(data, moov);
  const mvhd = need(findBox(parts, 'mvhd'), 'mvhd');
  const view = viewOf(data);
  return {
    topLevel: top.map((entry) => entry.type),
    brand: textAt(data, ftyp.body, 4),
    movieTimescale: view.getUint32(mvhd.body + 12),
    movieDuration: view.getUint32(mvhd.body + 16),
    mdat: need(findBox(top, 'mdat'), 'mdat'),
    tracks: parts.filter((part) => part.type === 'trak').map((trak) => readTrack(data, trak)),
  };
}

/** The bytes of a sample, read from where the tables say it is. */
export function bytesOf(data: Uint8Array, sample: ReadSample): Uint8Array {
  return data.subarray(sample.offset, sample.offset + sample.size);
}
