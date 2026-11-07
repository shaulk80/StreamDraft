import { readFileSync } from 'node:fs';
const data = readFileSync(process.argv[2]);
function kids(s, e) { const r = []; let p = s; while (p + 8 <= e) { const sz = data.readUInt32BE(p); r.push({ t: data.toString('latin1', p + 4, p + 8), s: p, e: p + sz, b: p + 8 }); p += sz; } return r; }
for (const moof of kids(0, data.length).filter((b) => b.t === 'moof')) {
  for (const traf of kids(moof.b, moof.e).filter((b) => b.t === 'traf')) {
    const k = kids(traf.b, traf.e);
    const id = data.readUInt32BE(k.find((b) => b.t === 'tfhd').b + 4);
    if (id !== 257) continue;
    const tfdt = k.find((b) => b.t === 'tfdt'); const v = data[tfdt.b];
    const dts = v === 1 ? Number(data.readBigUInt64BE(tfdt.b + 4)) : data.readUInt32BE(tfdt.b + 4);
    const trun = k.find((b) => b.t === 'trun');
    const flags = data.readUInt32BE(trun.b) & 0xffffff; const n = data.readUInt32BE(trun.b + 4);
    let o = trun.b + 8; if (flags & 1) o += 4; if (flags & 4) o += 4;
    const per = [0x100, 0x200, 0x400, 0x800].reduce((a, f) => a + (flags & f ? 4 : 0), 0);
    let sum = 0; const durs = new Set();
    for (let i = 0; i < n; i++) { const d = data.readUInt32BE(o + i * per); sum += d; durs.add(d); }
    console.log(`start ${(dts / 90000).toFixed(3)} n ${n} sum ${(sum / 90000).toFixed(3)} end ${((dts + sum) / 90000).toFixed(3)} distinct durations ${[...durs].slice(0, 4).join('/')}`);
  }
}
