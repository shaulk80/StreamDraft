// Count unique presentation times of the video track in our fMP4 output (duplicate frames show up as repeats).
import { readFileSync } from 'node:fs';
const data = readFileSync(process.argv[2]);
const trackWanted = Number(process.argv[3] ?? 257);
function kids(s, e) { const r = []; let p = s; while (p + 8 <= e) { const sz = data.readUInt32BE(p); r.push({ t: data.toString('latin1', p + 4, p + 8), s: p, e: p + sz, b: p + 8 }); p += sz; } return r; }
const ptsList = [];
for (const moof of kids(0, data.length).filter((b) => b.t === 'moof')) {
  for (const traf of kids(moof.b, moof.e).filter((b) => b.t === 'traf')) {
    const k = kids(traf.b, traf.e);
    if (data.readUInt32BE(k.find((b) => b.t === 'tfhd').b + 4) !== trackWanted) continue;
    const tfdt = k.find((b) => b.t === 'tfdt'); const v = data[tfdt.b];
    let dts = v === 1 ? Number(data.readBigUInt64BE(tfdt.b + 4)) : data.readUInt32BE(tfdt.b + 4);
    const trun = k.find((b) => b.t === 'trun');
    const flags = data.readUInt32BE(trun.b) & 0xffffff; const n = data.readUInt32BE(trun.b + 4);
    let o = trun.b + 8; if (flags & 1) o += 4; if (flags & 4) o += 4;
    const fields = [0x100, 0x200, 0x400, 0x800].filter((f) => flags & f);
    for (let i = 0; i < n; i++) {
      let dur = 0, cto = 0, q = o;
      for (const f of fields) { const val = data.readInt32BE(q); q += 4; if (f === 0x100) dur = val; if (f === 0x800) cto = val; }
      o = q;
      ptsList.push(dts + cto); dts += dur;
    }
  }
}
const unique = new Set(ptsList);
const sorted = [...ptsList].sort((a, b) => a - b);
let monotonic = true; for (let i = 1; i < ptsList.length; i++) if (ptsList[i] < ptsList[i-1] - 20000) { monotonic = false; break; }
console.log(JSON.stringify({ samples: ptsList.length, uniquePts: unique.size, firstPts: sorted[0] / 90000, lastPts: sorted.at(-1) / 90000 }));
