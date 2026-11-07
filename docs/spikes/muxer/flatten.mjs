// Spike: rewrite a fragmented MP4 as a flat MP4 (moov with full sample tables first, one mdat).
// Reads the source in two passes (the moof boxes, then the mdat payloads); holds only the sample tables.
// Usage: node flatten.mjs <in fMP4> <out MP4>
import { closeSync, fstatSync, openSync, readSync, writeSync } from 'node:fs';

const [, , inFile, outFile] = process.argv;
const src = openSync(inFile, 'r');
const srcSize = fstatSync(src).size;

function read(position, length) {
  const buffer = Buffer.alloc(length);
  readSync(src, buffer, 0, length, position);
  return buffer;
}

function boxesOf(buffer, start = 0, end = buffer.length) {
  const result = [];
  let position = start;
  while (position + 8 <= end) {
    const size = buffer.readUInt32BE(position);
    const type = buffer.toString('latin1', position + 4, position + 8);
    if (size < 8) {
      throw new Error(`bad box at ${position}`);
    }
    result.push({ type, start: position, end: position + size, body: position + 8 });
    position += size;
  }
  return result;
}

function box(type, ...parts) {
  const body = Buffer.concat(parts);
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length + 8, 0);
  head.write(type, 4, 'latin1');
  return Buffer.concat([head, body]);
}

function u32(...values) {
  const buffer = Buffer.alloc(values.length * 4);
  values.forEach((value, index) => buffer.writeUInt32BE(value >>> 0, index * 4));
  return buffer;
}

// ---- top level of the source
const top = [];
for (let position = 0; position < srcSize; ) {
  const head = read(position, 16);
  let size = head.readUInt32BE(0);
  const type = head.toString('latin1', 4, 8);
  let headerSize = 8;
  if (size === 1) {
    size = Number(head.readBigUInt64BE(8));
    headerSize = 16;
  } else if (size === 0) {
    size = srcSize - position;
  }
  top.push({ type, start: position, end: position + size, body: position + headerSize });
  position += size;
}
const ftypBox = top.find((entry) => entry.type === 'ftyp');
const moovBox = top.find((entry) => entry.type === 'moov');
const moovData = read(moovBox.start, moovBox.end - moovBox.start);
const moovParts = boxesOf(moovData, 8);

// ---- track defaults from mvex/trex, and track descriptions
const trexDefaults = {};
const mvex = moovParts.find((entry) => entry.type === 'mvex');
for (const trex of boxesOf(moovData, mvex.body, mvex.end).filter((entry) => entry.type === 'trex')) {
  trexDefaults[moovData.readUInt32BE(trex.body + 4)] = {
    duration: moovData.readUInt32BE(trex.body + 12),
    size: moovData.readUInt32BE(trex.body + 16),
    flags: moovData.readUInt32BE(trex.body + 20),
  };
}

const tracks = new Map();
for (const trakBox of moovParts.filter((entry) => entry.type === 'trak')) {
  const inner = boxesOf(moovData, trakBox.body, trakBox.end);
  const tkhd = inner.find((entry) => entry.type === 'tkhd');
  const id = moovData.readUInt32BE(tkhd.body + (moovData[tkhd.body] === 1 ? 20 : 12));
  const mdia = inner.find((entry) => entry.type === 'mdia');
  const mdhd = boxesOf(moovData, mdia.body, mdia.end).find((entry) => entry.type === 'mdhd');
  tracks.set(id, {
    id,
    trakBox,
    timescale: moovData.readUInt32BE(mdhd.body + 12),
    sizes: [],
    durations: [],
    ctos: [],
    syncs: [],
    chunks: [], // { firstSample, count, sourceOffset }
    firstDts: null,
    negativeCto: false,
  });
}

// ---- pass 1: the moof boxes
const pairs = []; // { moof, mdat } in file order
for (let i = 0; i < top.length; i += 1) {
  if (top[i].type === 'moof') {
    const mdat = top[i + 1];
    if (mdat?.type !== 'mdat') {
      throw new Error('moof without mdat');
    }
    pairs.push({ moof: top[i], mdat });
  }
}
for (const pair of pairs) {
  const moofData = read(pair.moof.start, pair.moof.end - pair.moof.start);
  for (const traf of boxesOf(moofData, 8).filter((entry) => entry.type === 'traf')) {
    const inner = boxesOf(moofData, traf.body, traf.end);
    const tfhd = inner.find((entry) => entry.type === 'tfhd');
    const tfhdFlags = moofData.readUInt32BE(tfhd.body) & 0xffffff;
    const id = moofData.readUInt32BE(tfhd.body + 4);
    const track = tracks.get(id);
    const defaults = { ...trexDefaults[id] };
    let cursor = tfhd.body + 8;
    let base = pair.moof.start;
    if (tfhdFlags & 0x1) {
      base = Number(moofData.readBigUInt64BE(cursor));
      cursor += 8;
    }
    if (tfhdFlags & 0x2) {
      cursor += 4;
    }
    if (tfhdFlags & 0x8) {
      defaults.duration = moofData.readUInt32BE(cursor);
      cursor += 4;
    }
    if (tfhdFlags & 0x10) {
      defaults.size = moofData.readUInt32BE(cursor);
      cursor += 4;
    }
    if (tfhdFlags & 0x20) {
      defaults.flags = moofData.readUInt32BE(cursor);
    }
    const tfdt = inner.find((entry) => entry.type === 'tfdt');
    if (tfdt && track.firstDts === null) {
      track.firstDts = moofData[tfdt.body] === 1 ? Number(moofData.readBigUInt64BE(tfdt.body + 4)) : moofData.readUInt32BE(tfdt.body + 4);
    }

    for (const trun of inner.filter((entry) => entry.type === 'trun')) {
      const version = moofData[trun.body];
      const flags = moofData.readUInt32BE(trun.body) & 0xffffff;
      const count = moofData.readUInt32BE(trun.body + 4);
      let q = trun.body + 8;
      let dataOffset = 0;
      if (flags & 0x1) {
        dataOffset = moofData.readInt32BE(q);
        q += 4;
      }
      let firstFlags;
      if (flags & 0x4) {
        firstFlags = moofData.readUInt32BE(q);
        q += 4;
      }
      track.chunks.push({ firstSample: track.sizes.length, count, sourceOffset: base + dataOffset });
      for (let s = 0; s < count; s += 1) {
        let duration = defaults.duration;
        let size = defaults.size;
        let sampleFlags = s === 0 && firstFlags !== undefined ? firstFlags : defaults.flags;
        let cto = 0;
        if (flags & 0x100) {
          duration = moofData.readUInt32BE(q);
          q += 4;
        }
        if (flags & 0x200) {
          size = moofData.readUInt32BE(q);
          q += 4;
        }
        if (flags & 0x400) {
          sampleFlags = moofData.readUInt32BE(q);
          q += 4;
        }
        if (flags & 0x800) {
          cto = version === 1 ? moofData.readInt32BE(q) : moofData.readUInt32BE(q);
          q += 4;
        }
        if (cto < 0) {
          track.negativeCto = true;
        }
        track.durations.push(duration);
        track.sizes.push(size);
        track.ctos.push(cto);
        track.syncs.push(((sampleFlags ?? 0) & 0x10000) === 0);
      }
    }
  }
}

// ---- build the moov
function runs(values) {
  const result = [];
  for (const value of values) {
    const last = result.at(-1);
    if (last && last.value === value) {
      last.count += 1;
    } else {
      result.push({ value, count: 1 });
    }
  }
  return result;
}

function sampleTable(track, chunkOffsets, wide) {
  const stts = runs(track.durations);
  const parts = [
    track.stsd,
    box('stts', u32(0, stts.length), ...stts.map((run) => u32(run.count, run.value))),
  ];
  if (track.ctos.some((cto) => cto !== 0)) {
    const ctts = runs(track.ctos);
    parts.push(
      box('ctts', u32(track.negativeCto ? 0x01000000 : 0, ctts.length), ...ctts.map((run) => Buffer.concat([u32(run.count), Buffer.from(u32(run.value))]))),
    );
  }
  const perChunk = runs(track.chunks.map((chunk) => chunk.count));
  let firstChunk = 1;
  const stscEntries = perChunk.map((run) => {
    const entry = u32(firstChunk, run.value, 1);
    firstChunk += run.count;
    return entry;
  });
  parts.push(box('stsc', u32(0, stscEntries.length), ...stscEntries));
  parts.push(box('stsz', u32(0, 0, track.sizes.length), Buffer.concat(track.sizes.map((size) => u32(size)))));
  if (wide) {
    const body = Buffer.alloc(chunkOffsets.length * 8);
    chunkOffsets.forEach((offset, index) => body.writeBigUInt64BE(BigInt(offset), index * 8));
    parts.push(box('co64', u32(0, chunkOffsets.length), body));
  } else {
    parts.push(box('stco', u32(0, chunkOffsets.length), Buffer.concat(chunkOffsets.map((offset) => u32(offset)))));
  }
  if (!track.syncs.every(Boolean)) {
    const sync = [];
    track.syncs.forEach((isSync, index) => {
      if (isSync) {
        sync.push(index + 1);
      }
    });
    parts.push(box('stss', u32(0, sync.length), Buffer.concat(sync.map((n) => u32(n)))));
  }
  return box('stbl', ...parts);
}

const mvhdSource = moovParts.find((entry) => entry.type === 'mvhd');
const movieTimescale = moovData.readUInt32BE(mvhdSource.body + 12);

function buildTrak(track, chunkOffsets, wide) {
  const ticks = track.durations.reduce((sum, value) => sum + value, 0);
  const movieDuration = Math.round((ticks / track.timescale) * movieTimescale);
  const trakParts = [];
  for (const part of boxesOf(moovData, track.trakBox.body, track.trakBox.end)) {
    const copy = Buffer.from(moovData.subarray(part.start, part.end));
    if (part.type === 'tkhd') {
      copy.writeUInt32BE(movieDuration, 8 + (copy[8] === 1 ? 28 : 20));
      trakParts.push(copy);
      // Edit list: an empty edit for a late start, then the media from the first composition offset on.
      const minCto = track.ctos.length > 0 ? Math.min(...track.ctos) : 0;
      const delay = Math.round(((track.firstDts ?? 0) / track.timescale) * movieTimescale);
      const entries = [];
      if (delay > 0) {
        entries.push(u32(delay, 0xffffffff, 0x00010000));
      }
      const mediaDuration = Math.max(0, Math.round(((ticks - minCto) / track.timescale) * movieTimescale));
      entries.push(u32(mediaDuration, minCto, 0x00010000));
      trakParts.push(box('edts', box('elst', u32(0, entries.length), ...entries)));
    } else if (part.type === 'edts') {
      continue;
    } else if (part.type === 'mdia') {
      const mdiaParts = [];
      for (const inner of boxesOf(moovData, part.body, part.end)) {
        const innerCopy = Buffer.from(moovData.subarray(inner.start, inner.end));
        if (inner.type === 'mdhd') {
          innerCopy.writeUInt32BE(ticks, 8 + 16);
          mdiaParts.push(innerCopy);
        } else if (inner.type === 'minf') {
          const minfParts = [];
          for (const leaf of boxesOf(moovData, inner.body, inner.end)) {
            if (leaf.type === 'stbl') {
              const stsd = boxesOf(moovData, leaf.body, leaf.end).find((entry) => entry.type === 'stsd');
              track.stsd = Buffer.from(moovData.subarray(stsd.start, stsd.end));
              minfParts.push(sampleTable(track, chunkOffsets, wide));
            } else {
              minfParts.push(Buffer.from(moovData.subarray(leaf.start, leaf.end)));
            }
          }
          mdiaParts.push(box('minf', ...minfParts));
        } else {
          mdiaParts.push(innerCopy);
        }
      }
      trakParts.push(box('mdia', ...mdiaParts));
    } else {
      trakParts.push(copy);
    }
  }
  return box('trak', ...trakParts);
}

function buildMoov(mdatPayloadStart, wide) {
  // Chunk offsets: each source mdat payload is copied in order after the mdat header.
  const payloadOffsets = new Map(); // mdat start -> offset of its payload in the new file
  let running = mdatPayloadStart;
  for (const pair of pairs) {
    payloadOffsets.set(pair.mdat.start, running);
    running += pair.mdat.end - pair.mdat.body;
  }
  const traks = [];
  let movieTicks = 0;
  for (const track of tracks.values()) {
    const offsets = track.chunks.map((chunk) => {
      const pair = pairs.find((candidate) => chunk.sourceOffset >= candidate.mdat.body && chunk.sourceOffset < candidate.mdat.end);
      return payloadOffsets.get(pair.mdat.start) + (chunk.sourceOffset - pair.mdat.body);
    });
    traks.push(buildTrak(track, offsets, wide));
    const ticks = track.durations.reduce((sum, value) => sum + value, 0);
    movieTicks = Math.max(movieTicks, Math.round((ticks / track.timescale) * movieTimescale));
  }
  const mvhd = Buffer.from(moovData.subarray(mvhdSource.start, mvhdSource.end));
  mvhd.writeUInt32BE(movieTicks, 8 + 16);
  return { moov: box('moov', mvhd, ...traks), end: running };
}

const payloadTotal = pairs.reduce((sum, pair) => sum + (pair.mdat.end - pair.mdat.body), 0);
const wide = srcSize > 0xf0000000;
const mdatHeaderSize = payloadTotal + 8 > 0xffffffff ? 16 : 8;
const ftyp = Buffer.from(read(ftypBox.start, ftypBox.end - ftypBox.start));
// The moov size does not depend on the offset values, so a first build with zeros gives it.
const probe = buildMoov(0, wide);
const mdatPayloadStart = ftyp.length + probe.moov.length + mdatHeaderSize;
const { moov } = buildMoov(mdatPayloadStart, wide);

const out = openSync(outFile, 'w');
writeSync(out, ftyp);
writeSync(out, moov);
const mdatHeader = Buffer.alloc(mdatHeaderSize);
if (mdatHeaderSize === 8) {
  mdatHeader.writeUInt32BE(payloadTotal + 8, 0);
  mdatHeader.write('mdat', 4, 'latin1');
} else {
  mdatHeader.writeUInt32BE(1, 0);
  mdatHeader.write('mdat', 4, 'latin1');
  mdatHeader.writeBigUInt64BE(BigInt(payloadTotal + 16), 8);
}
writeSync(out, mdatHeader);
const COPY = 4 * 1024 * 1024;
for (const pair of pairs) {
  for (let position = pair.mdat.body; position < pair.mdat.end; position += COPY) {
    const length = Math.min(COPY, pair.mdat.end - position);
    writeSync(out, read(position, length));
  }
}
closeSync(out);
closeSync(src);
const summary = [...tracks.values()].map((track) => `track ${track.id}: ${track.sizes.length} samples, ${track.chunks.length} chunks, ${(track.durations.reduce((a, b) => a + b, 0) / track.timescale).toFixed(2)} s`);
console.log(summary.join(' | '), `| moov ${moov.length} bytes`);
