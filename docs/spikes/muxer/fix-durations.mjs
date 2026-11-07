// Spike: set the real mvhd/tkhd/mdhd durations of a fragmented MP4 in place (version-0 boxes only).
// Usage: node fix-durations.mjs <file>
import { closeSync, fstatSync, openSync, readSync, writeSync } from 'node:fs';

const fd = openSync(process.argv[2], 'r+');
const size = fstatSync(fd).size;

function read(position, length) {
  const buffer = Buffer.alloc(length);
  readSync(fd, buffer, 0, length, position);
  return buffer;
}

function children(start, end) {
  const result = [];
  let position = start;
  while (position + 8 <= end) {
    const head = read(position, 8);
    const boxSize = head.readUInt32BE(0);
    if (boxSize < 8) {
      break;
    }
    result.push({ type: head.toString('latin1', 4, 8), start: position, end: position + boxSize, body: position + 8 });
    position += boxSize;
  }
  return result;
}

function put(position, value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32BE(value, 0);
  writeSync(fd, buffer, 0, 4, position);
}

const top = children(0, size);
const moov = top.find((box) => box.type === 'moov');
const parts = children(moov.body, moov.end);
const traks = parts.filter((box) => box.type === 'trak').map((trak) => {
  const inner = children(trak.body, trak.end);
  const mdia = inner.find((box) => box.type === 'mdia');
  const mdhd = children(mdia.body, mdia.end).find((box) => box.type === 'mdhd');
  const tkhd = inner.find((box) => box.type === 'tkhd');
  return {
    id: read(tkhd.body + 12, 4).readUInt32BE(0),
    tkhd,
    mdhd,
    timescale: read(mdhd.body + 12, 4).readUInt32BE(0),
    ticks: 0,
  };
});
const mvex = parts.find((box) => box.type === 'mvex');
const defaults = {};
for (const trex of children(mvex.body, mvex.end).filter((box) => box.type === 'trex')) {
  const body = read(trex.body, 24);
  defaults[body.readUInt32BE(4)] = body.readUInt32BE(12);
}

for (const moof of top.filter((box) => box.type === 'moof')) {
  for (const traf of children(moof.body, moof.end).filter((box) => box.type === 'traf')) {
    const inner = children(traf.body, traf.end);
    const tfhd = inner.find((box) => box.type === 'tfhd');
    const head = read(tfhd.body, 8);
    const flags = head.readUInt32BE(0) & 0xffffff;
    const id = head.readUInt32BE(4);
    let offset = tfhd.body + 8;
    if (flags & 0x1) {
      offset += 8;
    }
    if (flags & 0x2) {
      offset += 4;
    }
    const defaultDuration = flags & 0x8 ? read(offset, 4).readUInt32BE(0) : defaults[id];
    const track = traks.find((candidate) => candidate.id === id);
    for (const trun of inner.filter((box) => box.type === 'trun')) {
      const header = read(trun.body, 8);
      const trunFlags = header.readUInt32BE(0) & 0xffffff;
      const count = header.readUInt32BE(4);
      let position = trun.body + 8;
      if (trunFlags & 0x1) {
        position += 4;
      }
      if (trunFlags & 0x4) {
        position += 4;
      }
      const perSample = [0x100, 0x200, 0x400, 0x800].reduce((sum, flag) => sum + (trunFlags & flag ? 4 : 0), 0);
      for (let i = 0; i < count; i += 1) {
        track.ticks += trunFlags & 0x100 ? read(position + i * perSample, 4).readUInt32BE(0) : defaultDuration;
      }
    }
  }
}

const mvhdBox = parts.find((box) => box.type === 'mvhd');
const movieTimescale = read(mvhdBox.body + 12, 4).readUInt32BE(0);
let movieTicks = 0;
for (const track of traks) {
  put(track.mdhd.body + 16, track.ticks);
  const inMovie = Math.round((track.ticks / track.timescale) * movieTimescale);
  put(track.tkhd.body + 20, inMovie);
  movieTicks = Math.max(movieTicks, inMovie);
  console.log(`track ${track.id}: ${(track.ticks / track.timescale).toFixed(2)} s`);
}
put(mvhdBox.body + 16, movieTicks);
console.log(`movie: ${(movieTicks / movieTimescale).toFixed(2)} s`);
closeSync(fd);
