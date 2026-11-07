// Spike: mux.js TS -> fMP4 with the gop-fusion duplicates trimmed from each video fragment.
// Usage: node hls-mux2.mjs <segment dir> <out file>
import { closeSync, openSync, readdirSync, readFileSync, writeSync } from 'node:fs';
import path from 'node:path';
import muxjs from 'mux.js';

const [, , dir, outFile] = process.argv;
const files = readdirSync(dir)
  .filter((name) => name.endsWith('.ts'))
  .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));

function boxes(buffer, start, end) {
  const result = [];
  let position = start;
  while (position + 8 <= end) {
    const size = buffer.readUInt32BE(position);
    result.push({ type: buffer.toString('latin1', position + 4, position + 8), start: position, end: position + size, body: position + 8 });
    position += size;
  }
  return result;
}

/**
 * `data` holds moof+mdat pairs, one per track. For the video pair, drops the leading samples whose
 * total duration is `prepended` (ticks at 90 kHz): mux.js put them there from the previous segment.
 */
function trimPrepended(data, prepended, videoTrackId) {
  const buffer = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  const top = boxes(buffer, 0, buffer.length);
  const pieces = [];
  let dropped = 0;
  for (let i = 0; i < top.length; i += 2) {
    const moofBox = top[i];
    const mdatBox = top[i + 1];
    const moof = Buffer.from(buffer.subarray(moofBox.start, moofBox.end));
    const mdat = Buffer.from(buffer.subarray(mdatBox.start, mdatBox.end));
    const traf = boxes(moof, 8, moof.length).find((box) => box.type === 'traf');
    const inner = boxes(moof, traf.body, traf.end);
    const trackId = moof.readUInt32BE(inner.find((box) => box.type === 'tfhd').body + 4);
    if (trackId !== videoTrackId || prepended <= 0) {
      pieces.push(moof, mdat);
      continue;
    }
    const trun = inner.find((box) => box.type === 'trun');
    const flags = moof.readUInt32BE(trun.body) & 0xffffff;
    const count = moof.readUInt32BE(trun.body + 4);
    const hasOffset = (flags & 0x1) !== 0;
    const entries = trun.body + 8 + (hasOffset ? 4 : 0) + (flags & 0x4 ? 4 : 0);
    const fields = [0x100, 0x200, 0x400, 0x800].filter((flag) => flags & flag);
    const per = fields.length * 4;
    let skip = 0;
    let ticks = 0;
    let bytes = 0;
    while (skip < count && ticks < prepended) {
      let q = entries + skip * per;
      for (const flag of fields) {
        const value = moof.readUInt32BE(q);
        q += 4;
        if (flag === 0x100) {
          ticks += value;
        }
        if (flag === 0x200) {
          bytes += value;
        }
      }
      skip += 1;
    }
    dropped += skip;
    const removeFromMoof = skip * per;
    const newMoof = Buffer.concat([moof.subarray(0, entries), moof.subarray(entries + removeFromMoof)]);
    newMoof.writeUInt32BE(newMoof.length, 0);
    newMoof.writeUInt32BE(newMoof.readUInt32BE(traf.start) - removeFromMoof, traf.start);
    newMoof.writeUInt32BE(newMoof.readUInt32BE(trun.start) - removeFromMoof, trun.start);
    newMoof.writeUInt32BE(count - skip, trun.body + 4);
    if (hasOffset) {
      newMoof.writeInt32BE(newMoof.readInt32BE(trun.body + 8) - removeFromMoof, trun.body + 8);
    }
    const tfdt = inner.find((box) => box.type === 'tfdt');
    if (newMoof[tfdt.body] === 1) {
      newMoof.writeBigUInt64BE(newMoof.readBigUInt64BE(tfdt.body + 4) + BigInt(ticks), tfdt.body + 4);
    } else {
      newMoof.writeUInt32BE(newMoof.readUInt32BE(tfdt.body + 4) + ticks, tfdt.body + 4);
    }
    const newMdat = Buffer.concat([mdat.subarray(0, 8), mdat.subarray(8 + bytes)]);
    newMdat.writeUInt32BE(newMdat.length, 0);
    pieces.push(newMoof, newMdat);
  }
  return { data: Buffer.concat(pieces), dropped };
}

const transmuxer = new muxjs.mp4.Transmuxer({ keepOriginalTimestamps: false });
const out = openSync(outFile, 'w');
let initWritten = false;
let totalDropped = 0;
let peakHeap = 0;
const started = performance.now();

let pendingPrepended = 0;
transmuxer.on('videoSegmentTimingInfo', (info) => {
  pendingPrepended = info.prependedContentDuration;
});
transmuxer.on('data', (segment) => {
  if (!initWritten) {
    writeSync(out, segment.initSegment);
    initWritten = true;
  }
  const prepended = pendingPrepended;
  pendingPrepended = 0;
  const trimmed = trimPrepended(segment.data, prepended, 257);
  totalDropped += trimmed.dropped;
  writeSync(out, trimmed.data);
});

const REPEAT = Number(process.env.REPEAT ?? 1);
let inputBytes = 0;
for (const file of Array.from({ length: REPEAT }, () => files).flat()) {
  const bytes = new Uint8Array(readFileSync(path.join(dir, file)));
  inputBytes += bytes.length;
  transmuxer.push(bytes);
  transmuxer.flush();
  peakHeap = Math.max(peakHeap, process.memoryUsage().heapUsed);
}
closeSync(out);
console.log(JSON.stringify({ segments: files.length, inputMb: Math.round(inputBytes / 1048576), droppedSamples: totalDropped, ms: Math.round(performance.now() - started), peakHeapMb: Math.round(peakHeap / 1048576) }));
