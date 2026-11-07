// Spike: concatenate ADTS segments, dropping the ID3v2 tag at the start of each. Usage: node strip-id3.mjs <dir> <out>
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
const [, , dir, out] = process.argv;
const names = readdirSync(dir).filter((n) => n.endsWith('.aac')).sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
const parts = names.map((name) => {
  const d = readFileSync(path.join(dir, name));
  if (d.toString('latin1', 0, 3) !== 'ID3') return d;
  const size = ((d[6] & 0x7f) << 21) | ((d[7] & 0x7f) << 14) | ((d[8] & 0x7f) << 7) | (d[9] & 0x7f);
  return d.subarray(10 + size);
});
writeFileSync(out, Buffer.concat(parts));
console.log('first bytes after strip:', parts[0].subarray(0, 2).toString('hex'), 'segments', parts.length);
