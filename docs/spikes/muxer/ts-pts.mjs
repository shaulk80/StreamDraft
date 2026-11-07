import { readFileSync } from 'node:fs';
const dir = process.argv[2];
for (let n = 0; n < 4; n += 1) {
  const d = readFileSync(`${dir}/seg${n}.ts`);
  let frames = 0, first = null, last = null;
  for (let p = 0; p + 188 <= d.length; p += 188) {
    if (d[p] !== 0x47 || !(d[p + 1] & 0x40)) continue;
    const afc = (d[p + 3] >> 4) & 3;
    let o = p + 4; if (afc & 2) o += 1 + d[p + 4];
    if (d[o] === 0 && d[o + 1] === 0 && d[o + 2] === 1 && d[o + 3] === 0xe0 && (d[o + 7] & 0x80)) {
      const pts = ((d[o + 9] & 0x0e) * 2 ** 29) + d[o + 10] * 2 ** 22 + ((d[o + 11] & 0xfe) * 2 ** 14) + d[o + 12] * 2 ** 7 + (d[o + 13] >> 1);
      frames += 1; if (first === null) first = pts; last = pts;
    }
  }
  console.log(`seg${n}: video PES ${frames}, first PTS ${(first / 90000).toFixed(3)}, last PTS ${(last / 90000).toFixed(3)}, span ${((last - first) / 90000).toFixed(3)}`);
}
