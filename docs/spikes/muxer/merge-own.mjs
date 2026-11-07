// Spike: merge a DASH video and a DASH audio stream (init + fMP4 segments) into one fMP4 by box-level code.
// Usage: node merge-own.mjs <video dir> <audio dir> <out file>   (dirs hold init.* and seg<N>.*)
import { closeSync, openSync, readdirSync, readFileSync, writeSync } from 'node:fs';
import path from 'node:path';

const [, , videoDir, audioDir, outFile] = process.argv;

function boxes(buffer, start = 0, end = buffer.length) {
  const result = [];
  let position = start;
  while (position + 8 <= end) {
    const size = buffer.readUInt32BE(position);
    const type = buffer.toString('latin1', position + 4, position + 8);
    if (size < 8) {
      throw new Error(`bad box size at ${position}`);
    }
    result.push({ type, start: position, end: position + size, body: position + 8 });
    position += size;
  }
  return result;
}

function files(dir, prefix) {
  return readdirSync(dir)
    .filter((name) => name.startsWith(prefix))
    .sort((a, b) => Number(a.match(/\d+/)?.[0] ?? 0) - Number(b.match(/\d+/)?.[0] ?? 0))
    .map((name) => path.join(dir, name));
}

function box(type, ...parts) {
  const body = Buffer.concat(parts);
  const head = Buffer.alloc(8);
  head.writeUInt32BE(body.length + 8, 0);
  head.write(type, 4, 'latin1');
  return Buffer.concat([head, body]);
}

/** Pulls ftyp, mvhd, trak and mvex children out of an init segment. */
function readInit(file) {
  const data = readFileSync(file);
  const top = boxes(data);
  const moov = top.find((b) => b.type === 'moov');
  const parts = boxes(data, moov.body, moov.end);
  const slice = (b) => Buffer.from(data.subarray(b.start, b.end));
  const mvex = parts.find((b) => b.type === 'mvex');
  return {
    ftyp: slice(top.find((b) => b.type === 'ftyp')),
    mvhd: slice(parts.find((b) => b.type === 'mvhd')),
    trak: slice(parts.find((b) => b.type === 'trak')),
    trex: slice(boxes(data, mvex.body, mvex.end).find((b) => b.type === 'trex')),
  };
}

function setTrackId(trak, id) {
  const copy = Buffer.from(trak);
  const tkhd = boxes(copy, 8, copy.length).find((b) => b.type === 'tkhd');
  const version = copy[tkhd.body];
  copy.writeUInt32BE(id, tkhd.body + (version === 1 ? 20 : 12));
  return copy;
}

function setTrexId(trex, id) {
  const copy = Buffer.from(trex);
  copy.writeUInt32BE(id, 12);
  return copy;
}

/** Moof+mdat pairs of a media segment, dropping styp and sidx; the track id of each traf is replaced. */
function fragments(file, newTrackId) {
  const data = readFileSync(file);
  const out = [];
  for (const b of boxes(data)) {
    if (b.type === 'moof') {
      const moof = Buffer.from(data.subarray(b.start, b.end));
      for (const traf of boxes(moof, 8, moof.length).filter((x) => x.type === 'traf')) {
        const tfhd = boxes(moof, traf.body, traf.end).find((x) => x.type === 'tfhd');
        const flags = moof.readUInt32BE(tfhd.body) & 0xffffff;
        if (flags & 0x1) {
          throw new Error('tfhd has an absolute base-data-offset; not handled in this spike');
        }
        moof.writeUInt32BE(newTrackId, tfhd.body + 4);
      }
      out.push(moof);
    } else if (b.type === 'mdat') {
      out.push(Buffer.from(data.subarray(b.start, b.end)));
    }
  }
  return out;
}

const video = readInit(files(videoDir, 'init')[0]);
const audio = readInit(files(audioDir, 'init')[0]);
const videoId = 1;
const audioId = 2;

const mvhd = Buffer.from(video.mvhd);
// mvhd v0: header 8, version/flags 4, creation 4, modification 4, timescale 4, duration 4, rate 4, volume 2, reserved 10, matrix 36, predefined 24, next_track_ID 4
mvhd.writeUInt32BE(0, 8 + 4 + 12);
mvhd.writeUInt32BE(audioId + 1, mvhd.length - 4);

const moov = box('moov', mvhd, setTrackId(video.trak, videoId), setTrackId(audio.trak, audioId), box('mvex', setTrexId(video.trex, videoId), setTrexId(audio.trex, audioId)));

const out = openSync(outFile, 'w');
writeSync(out, video.ftyp);
writeSync(out, moov);
const videoSegments = files(videoDir, 'seg');
const audioSegments = files(audioDir, 'seg');
let peakHeap = 0;
let bytes = video.ftyp.length + moov.length;
const started = performance.now();
for (let i = 0; i < Math.max(videoSegments.length, audioSegments.length); i += 1) {
  const pieces = [];
  if (videoSegments[i]) {
    pieces.push(...fragments(videoSegments[i], videoId));
  }
  if (audioSegments[i]) {
    pieces.push(...fragments(audioSegments[i], audioId));
  }
  for (const piece of pieces) {
    writeSync(out, piece);
    bytes += piece.length;
  }
  peakHeap = Math.max(peakHeap, process.memoryUsage().heapUsed);
}
closeSync(out);
console.log(JSON.stringify({ outBytes: bytes, ms: Math.round(performance.now() - started), peakHeapMb: Math.round(peakHeap / 1048576) }));
