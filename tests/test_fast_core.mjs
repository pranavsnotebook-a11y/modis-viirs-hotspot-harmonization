// node tests/test_fast_core.mjs   (offline unit checks, then one LIVE check against INPE that is skipped if the network fails)
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
globalThis.window = globalThis;
for (const f of ['web/js/firelab-core.js', 'web/js/downwind-core.js', 'web/js/fast-core.js']) vm.runInThisContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), { filename: f });
const F = globalThis.FAST;
let n = 0; const ok = (name, fn) => { fn(); n++; console.log('ok  ' + name); };
const resp = (status, text = '') => ({ status, ok: status >= 200 && status < 300, text: async () => text });

const NOW = Date.UTC(2026, 10, 14, 18, 23, 0);
ok('fileTimes: newest first, 10-minute steps, covers the window', () => {
  const t = F.fileTimes(NOW, 1);
  assert.equal(F.fileName(t[0]), 'focos_10min_20261114_1820.csv');
  assert.equal(F.fileName(t[1]), 'focos_10min_20261114_1810.csv');
  assert.ok(t.every((x, i) => i === 0 || t[i - 1] - x === 6e5));
  assert.ok(t[t.length - 1] <= NOW - 36e5 && t[t.length - 1] > NOW - 36e5 - 6e5);
});

const T1 = Date.UTC(2026, 10, 14, 18, 20), T2 = T1 - 6e5, T3 = T1 - 12e5;
const csvA = `lat,lon,satelite,data
  -23.500000,  -57.200000,GOES-19,2026-11-14 18:03:00
  -23.500000,  -57.200000,GOES-19,2026-11-14 18:03:00
  -23.900000,  -57.000000,GOES-19,2026-11-14
  -23.700000,  -57.100000,NOAA-20,2026-11-14 15:00:00
  -23.600000,  -57.300000,MSG-03,2026-11-14 18:00:00
  -10.000000,  -40.000000,GOES-19,2026-11-14 18:00:00
  -23.100000,  -56.800000 , goes-19 ,2026-11-14 18:10:00
`;
const csvB = `lat,lon,satelite,data
  -23.500000,  -57.200000,GOES-19,2026-11-14 17:53:00
`;
const PY = [-62.7, -27.7, -54.2, -19.2];
const mk = () => { const calls = []; const f = async url => { calls.push(url); const nm = url.split('/').pop();
  if (nm.endsWith('1820.csv')) return resp(404);
  if (nm.endsWith('1810.csv')) return resp(200, csvA);
  if (nm.endsWith('1800.csv')) return resp(200, csvB);
  if (nm.endsWith('1750.csv')) throw new Error('network down');
  return resp(200, 'lat,lon,satelite,data\n'); }; f.calls = calls; return f; };

let R; const fi = mk();
R = await F.load({ bbox: PY, hours: 0.5, now: NOW, fetchImpl: fi });
ok('load: padded spaces parsed, date-only / non-GOES / out-of-bbox dropped', () => {
  assert.equal(R.detections.length, 4); // 3 from 1810 (duplicate counted twice, padded row) + 1 from 1800
  assert.ok(R.detections.every(d => d.lat < -23 && d.lat > -24 && d.fileMs && d.time.endsWith('Z')));
  assert.ok(!R.detections.some(d => d.lat === -10));
});
ok('load: 404 counted missing, network error counted failed, load succeeds', () => {
  assert.equal(R.files.requested, 4); assert.equal(R.files.missing, 1); assert.equal(R.files.failed, 1); assert.equal(R.files.loaded, 2);
});
ok('load: newest file and detection', () => {
  assert.equal(R.newestFileMs, T2); assert.equal(R.newestDetectionMs, Date.UTC(2026, 10, 14, 18, 10));
});
const R2 = await F.load({ bbox: PY, hours: 1, now: NOW, fetchImpl: fi });
ok('load: cache avoids refetching loaded files; failed ones are retried', () => {
  assert.equal(R2.files.failed, 1); assert.equal(fi.calls.filter(u => u.endsWith('1750.csv')).length, 2);
  const c = fi.calls.filter(u => u.endsWith('1810.csv')).length; assert.equal(c, 1);
});
{ let cur = 0, max = 0; const slow = async () => { cur++; max = Math.max(max, cur); await new Promise(r => setTimeout(r, 5)); cur--; return resp(200, 'lat,lon,satelite,data\n'); };
  await F.load({ bbox: PY, hours: 6, now: NOW + 36e8, fetchImpl: slow }); ok('concurrency max=' + max, () => assert.ok(max <= 6 && max > 1)); }

ok('pixels: grouping, scans, first/last', () => {
  const P = F.pixels(R.detections);
  assert.equal(P.length, 2);
  const a = P.find(p => p.lat === -23.5 && p.lon === -57.2);
  assert.equal(a.scans, 2); // 18:03 (twice in file) and 17:53 -> two distinct scans
  assert.equal(a.firstMs, Date.UTC(2026, 10, 14, 17, 53)); assert.equal(a.lastMs, Date.UTC(2026, 10, 14, 18, 3));
  assert.equal(P[0], a); // ranked by scans
});

const px = { lat: -23.5, lon: -57.2 }, kmLat = 1 / 111.195, south = { ws: 5, wd: 180 }; // wind FROM the south, smoke toward north
const lineAt = dKm => [[px.lat + dKm * kmLat, px.lon - .05], [px.lat + dKm * kmLat, px.lon + .05]];
ok('line 5 km north is downwind, with travel time', () => {
  const r = F.upwindOfLine(px, south, lineAt(5));
  assert.equal(r.downwind, true); assert.equal(r.inPixel, false);
  assert.ok(Math.abs(r.distKm - 5) < .05 && Math.abs(r.alongKm - 5) < .05);
  assert.ok(Math.abs(r.travelMin - 5000 / 5 / 60) < .2); assert.equal(r.compass, 'north'); assert.equal(r.uncertainKm, 2);
});
ok('line 5 km south is not downwind', () => assert.equal(F.upwindOfLine(px, south, lineAt(-5)).downwind, false));
ok('line beyond reachKm is not downwind; reachKm option works', () => {
  assert.equal(F.upwindOfLine(px, south, lineAt(15)).downwind, false);
  assert.equal(F.upwindOfLine(px, south, lineAt(15), { reachKm: 20 }).downwind, true);
});
ok('line 1 km away is inPixel', () => assert.equal(F.upwindOfLine(px, south, lineAt(1)).inPixel, true));
ok('wind speed floor of 1 m/s', () => {
  const r = F.upwindOfLine(px, { ws: 0, wd: 180 }, lineAt(6)); assert.ok(Math.abs(r.travelMin - 6000 / 60) < .5);
});
ok('point: downwind, off-axis, far, inPixel', () => {
  const pt = (dN, dE) => [px.lat + dN * kmLat, px.lon + dE * kmLat / Math.cos(px.lat * Math.PI / 180)];
  assert.equal(F.upwindOfPoint(px, south, ...pt(5, 0)).downwind, true);
  assert.equal(F.upwindOfPoint(px, south, ...pt(0, 5)).downwind, false);   // crosswind
  assert.equal(F.upwindOfPoint(px, south, ...pt(-5, 0)).downwind, false);  // upwind
  assert.equal(F.upwindOfPoint(px, south, ...pt(15, 0)).downwind, false);  // beyond reach
  const near = F.upwindOfPoint(px, south, ...pt(1, 0)); assert.equal(near.inPixel, true); assert.equal(near.uncertainKm, 2);
});
ok('SOURCE label', () => {
  assert.equal(F.SOURCE.name, 'INPE Programa Queimadas, 10-minute files, GOES-19');
  assert.ok(F.SOURCE.url.startsWith('https://') && F.SOURCE.caveats.length === 6);
});

// ---------------- LIVE check (network). Skipped with a notice if INPE cannot be reached. ----------------
console.log('\n--- LIVE check against INPE ---');
try {
  F._cache.clear();
  const now = Date.now(), at = new Date(now).toISOString();
  for (const [name, bbox] of [['South America', [-82, -56, -34, 13]], ['Paraguay', [-62.7, -27.7, -54.2, -19.2]]]) {
    const L = await F.load({ bbox, hours: 6, now });
    if (L.files.loaded === 0) throw new Error('no file could be loaded (' + JSON.stringify(L.files) + ')');
    const P = F.pixels(L.detections);
    const age = L.newestDetectionMs == null ? 'n/a (no detections)' : ((now - L.newestDetectionMs) / 6e4).toFixed(0) + ' min';
    const fAge = L.newestFileMs == null ? 'n/a' : ((now - L.newestFileMs) / 6e4).toFixed(0) + ' min';
    const multi = P.filter(p => p.scans >= 2).length;
    console.log(`${name}: run ${at}; files requested ${L.files.requested} loaded ${L.files.loaded} missing ${L.files.missing} failed ${L.files.failed}; detections ${L.detections.length}; pixels ${P.length} (${multi} flagged on 2+ scans); newest detection age ${age}; newest file age ${fAge}`);
  }
} catch (e) { console.log('LIVE check skipped (network or server problem): ' + e.message); }
console.log(`\n${n} offline checks passed`);
