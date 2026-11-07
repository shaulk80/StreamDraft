// Spike: mux.js turns TS segments into fragmented MP4, one segment at a time.
// Usage: node hls-mux.mjs <segment dir> <out file>
import { readdirSync, readFileSync, writeFileSync, openSync, writeSync, closeSync } from 'node:fs';
import path from 'node:path';
import muxjs from 'mux.js';

const [, , dir, outFile] = process.argv;
const files = readdirSync(dir)
  .filter((name) => name.endsWith('.ts'))
  .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));

const transmuxer = new muxjs.mp4.Transmuxer(JSON.parse(process.env.MUX_OPTS ?? "{\"keepOriginalTimestamps\":false}"));
const out = openSync(outFile, 'w');
let initWritten = false;
let fragments = 0;
let bytes = 0;
let peakHeap = 0;

transmuxer.on('data', (segment) => {
  if (!initWritten) {
    writeSync(out, segment.initSegment);
    bytes += segment.initSegment.byteLength;
    initWritten = true;
  }
  writeSync(out, segment.data);
  bytes += segment.data.byteLength;
  fragments += 1;
});
transmuxer.on('error', (error) => console.error('mux error', error));

const started = performance.now();
for (const file of files) {
  const data = new Uint8Array(readFileSync(path.join(dir, file)));
  transmuxer.push(data);
  transmuxer.flush();
  peakHeap = Math.max(peakHeap, process.memoryUsage().heapUsed);
}
closeSync(out);
console.log(
  JSON.stringify({
    segments: files.length,
    fragments,
    outBytes: bytes,
    ms: Math.round(performance.now() - started),
    peakHeapMb: Math.round(peakHeap / 1048576),
  }),
);
