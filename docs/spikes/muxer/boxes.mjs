// Spike: summarise the box structure of an MP4. Usage: node boxes.mjs <file>
import { closeSync, fstatSync, openSync, readSync } from 'node:fs';

const file = process.argv[2];
const fd = openSync(file, 'r');
const size = fstatSync(fd).size;

function read(position, length) {
  const buffer = Buffer.alloc(length);
  readSync(fd, buffer, 0, length, position);
  return buffer;
}

function header(position) {
  const head = read(position, 16);
  let boxSize = head.readUInt32BE(0);
  const type = head.toString('latin1', 4, 8);
  let headerSize = 8;
  if (boxSize === 1) {
    boxSize = Number(head.readBigUInt64BE(8));
    headerSize = 16;
  } else if (boxSize === 0) {
    boxSize = size - position;
  }
  return { type, boxSize, headerSize };
}

function children(start, end) {
  const result = [];
  let position = start;
  while (position + 8 <= end) {
    const { type, boxSize, headerSize } = header(position);
    if (boxSize < 8) {
      break;
    }
    result.push({ type, start: position, end: position + boxSize, bodyStart: position + headerSize });
    position += boxSize;
  }
  return result;
}

const top = children(0, size);
const counts = {};
for (const box of top) {
  counts[box.type] = (counts[box.type] ?? 0) + 1;
}
console.log('top-level:', JSON.stringify(counts), 'order:', top.slice(0, 6).map((b) => b.type).join(','), '...');

const moov = top.find((box) => box.type === 'moov');
if (moov) {
  const parts = children(moov.bodyStart, moov.end);
  const mvhd = parts.find((box) => box.type === 'mvhd');
  const version = read(mvhd.bodyStart, 1)[0];
  const body = read(mvhd.bodyStart, 32);
  const timescale = version === 1 ? body.readUInt32BE(20) : body.readUInt32BE(12);
  const duration = version === 1 ? Number(body.readBigUInt64BE(24)) : body.readUInt32BE(16);
  console.log(`mvhd: timescale ${timescale}, duration ${duration} (${duration / timescale}s)`);
  for (const trak of parts.filter((box) => box.type === 'trak')) {
    const trakParts = children(trak.bodyStart, trak.end);
    const tkhd = trakParts.find((box) => box.type === 'tkhd');
    const tkVersion = read(tkhd.bodyStart, 1)[0];
    const trackId = read(tkhd.bodyStart + (tkVersion === 1 ? 20 : 12), 4).readUInt32BE(0);
    const mdia = trakParts.find((box) => box.type === 'mdia');
    const mdiaParts = children(mdia.bodyStart, mdia.end);
    const hdlr = mdiaParts.find((box) => box.type === 'hdlr');
    const handler = read(hdlr.bodyStart + 8, 4).toString('latin1');
    const minf = mdiaParts.find((box) => box.type === 'minf');
    const stbl = children(minf.bodyStart, minf.end).find((box) => box.type === 'stbl');
    const stblParts = children(stbl.bodyStart, stbl.end);
    const stsd = stblParts.find((box) => box.type === 'stsd');
    const entry = read(stsd.bodyStart + 8, 8).toString('latin1', 4, 8);
    const stsz = stblParts.find((box) => box.type === 'stsz');
    const sampleCount = read(stsz.bodyStart + 8, 4).readUInt32BE(0);
    console.log(`trak id ${trackId}: handler ${handler}, sample entry ${entry}, samples in moov ${sampleCount}`);
  }
  console.log('moov children:', parts.map((box) => box.type).join(','));
}

// Fragment summary: samples per track from trun.
const perTrack = {};
for (const moof of top.filter((box) => box.type === 'moof')) {
  for (const traf of children(moof.bodyStart, moof.end).filter((box) => box.type === 'traf')) {
    const parts = children(traf.bodyStart, traf.end);
    const tfhd = parts.find((box) => box.type === 'tfhd');
    const trackId = read(tfhd.bodyStart + 4, 4).readUInt32BE(0);
    for (const trun of parts.filter((box) => box.type === 'trun')) {
      const count = read(trun.bodyStart + 4, 4).readUInt32BE(0);
      perTrack[trackId] = (perTrack[trackId] ?? 0) + count;
    }
  }
}
if (Object.keys(perTrack).length > 0) {
  console.log('fragment samples per track id:', JSON.stringify(perTrack));
}
closeSync(fd);
