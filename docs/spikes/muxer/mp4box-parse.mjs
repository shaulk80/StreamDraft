// Spike: can mp4box.js read the files, and what does it keep in memory? Usage: node mp4box-parse.mjs <file> [keepMdat]
import { readFileSync } from 'node:fs';
import * as MP4Box from 'mp4box';

const [, , file, keep] = process.argv;
const data = readFileSync(file);
const mp4 = MP4Box.createFile(keep === 'keep');
let info;
mp4.onReady = (value) => {
  info = value;
};
mp4.onError = (error) => console.error('error', error);
const started = performance.now();
const CHUNK = 1024 * 1024;
let peak = 0;
for (let offset = 0; offset < data.length; offset += CHUNK) {
  const slice = data.buffer.slice(data.byteOffset + offset, data.byteOffset + Math.min(offset + CHUNK, data.length));
  slice.fileStart = offset;
  mp4.appendBuffer(slice);
  peak = Math.max(peak, process.memoryUsage().heapUsed);
}
mp4.flush();
console.log(JSON.stringify({
  ms: Math.round(performance.now() - started),
  peakHeapMb: Math.round(peak / 1048576),
  tracks: info?.tracks.map((t) => ({ id: t.id, codec: t.codec, type: t.type, samples: t.nb_samples, duration: t.duration / t.timescale })),
  fragmented: info?.isFragmented,
}));
