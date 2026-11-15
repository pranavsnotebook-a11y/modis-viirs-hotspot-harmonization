/* Replay of the 8 January 2025 trip of a 500 kV line in Paraguay, attributed by ANDE to smoke from a nearby fire.
   Question, fixed before running: (1) did the satellites record a fire near a 500 kV line before the trip, and
   (2) does the FIRELAB plume, with the reanalysis wind, carry smoke across that line?
   Runs the same model code as the website (web/js/firelab-core.js, web/js/downwind-core.js).
   usage: node scripts/replay_line_trip.mjs [docs/research/replay_2025-01-08/case.json] */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = process.argv[2] || path.join(ROOT, 'docs/research/replay_2025-01-08/case.json');
globalThis.window = globalThis;
for (const f of ['web/js/firelab-core.js', 'web/js/downwind-core.js']) vm.runInThisContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), { filename: f });
const D = globalThis.DOWNWIND, C = JSON.parse(fs.readFileSync(file, 'utf8'));

const trip = Date.parse(C.event.trip_utc), W = C.weather;
const wxAt = t => { // the model hour containing t
  const k = W.time.indexOf(new Date(Math.floor(t / 36e5) * 36e5).toISOString().slice(0, 13) + ':00');
  return k < 0 ? null : { hour: W.time[k], ws: W.wind_speed_100m[k], wd: W.wind_direction_100m[k], u10: W.wind_speed_10m[k], blh: W.boundary_layer_height[k], cloud: W.cloud_cover[k] };
};
const r1 = (x, n = 1) => x == null ? null : +x.toFixed(n);

const fires = D.cluster(C.detections, 1.5);
const day = fires.filter(f => Date.parse(f.time) < trip && Date.parse(f.time) > trip - 12 * 36e5);
const rows = [];
for (const f of day) for (const L of C.lines) {
  const t0 = Date.parse(f.time);
  // the fire is held at its observed FRP from the overpass to the trip; each hour uses that hour's wind
  for (let t = Math.floor(t0 / 36e5) * 36e5; t <= trip; t += 36e5) {
    const wx = wxAt(t); if (!wx) continue;
    const hours = Math.max(.5, (trip - t0) / 36e5);
    for (const dWd of [0, -30, 30]) { // reanalysis wind direction is uncertain in light wind: also test 30 degrees either side
      const s = D.scenario(f, { ...wx, wd: (wx.wd + dWd + 360) % 360 }, { time: new Date(t), hours });
      const c = D.crossLine(s, L.pts);
      if (!c || c.nearestKm > 25) continue;
      rows.push({ fire: `${f.sat} ${f.time.slice(11, 16)}`, lat: r1(f.lat, 4), lon: r1(f.lon, 4), frp: r1(f.frp), pixels: f.n, line: L.id, nearest_km: r1(c.nearestKm, 2), line_bearing: Math.round(c.bearing),
        hour: wx.hour.slice(11, 16), wind_from: Math.round((wx.wd + dWd + 360) % 360), wind_shift: dWd, ws100: wx.ws, smoke_toward: Math.round(s.r.toward), off_axis: Math.round(c.offAxisDeg),
        crosses: c.crosses, cross_km: r1(c.crossKm, 2), eta_min: c.etaMin == null ? null : Math.round(c.etaMin), peak_ugm3: r1(c.peak, 2), cls: s.r.cls, top_m: Math.round(s.r.top), mix_m: Math.round(s.r.Lmix) });
    }
  }
}

const base = rows.filter(r => r.wind_shift === 0);
const fmtRow = r => `${r.fire.padEnd(14)} ${String(r.lat).padStart(9)} ${String(r.lon).padStart(9)} ${String(r.frp).padStart(6)}MW x${r.pixels}  ${r.line} near ${String(r.nearest_km).padStart(5)}km brg ${String(r.line_bearing).padStart(3)}  ${r.hour}Z wind from ${String(r.wind_from).padStart(3)} ${r.ws100}m/s -> ${String(r.smoke_toward).padStart(3)}  off ${String(r.off_axis).padStart(3)}  ${r.crosses ? `CROSS at ${r.cross_km}km, ${r.eta_min}min` : 'no cross'}  peak ${r.peak_ugm3}`;
console.log(`Trip ${C.event.trip_utc}. Fires in the 12 h before it: ${day.length} (clusters per overpass), lines tested: ${C.lines.map(l => l.id + ' osm ' + l.osm_way).join(', ')}`);
console.log('\nNearest fires to each line, any hour:');
for (const L of C.lines) {
  const seen = new Set();
  base.filter(r => r.line === L.id).sort((a, b) => a.nearest_km - b.nearest_km).forEach(r => { const k = r.fire + r.lat; if (!seen.has(k) && seen.size < 8) { seen.add(k); console.log('  ' + fmtRow(r)); } });
}
console.log('\nPlume axis crosses a line (reanalysis wind as given), peak >= 0.1 ug/m3:');
base.filter(r => r.crosses && r.peak_ugm3 >= .1).sort((a, b) => b.peak_ugm3 - a.peak_ugm3).slice(0, 30).forEach(r => console.log('  ' + fmtRow(r)));
console.log('\nSame, wind direction shifted 30 degrees either way:');
rows.filter(r => r.wind_shift !== 0 && r.crosses && r.peak_ugm3 >= .1).sort((a, b) => b.peak_ugm3 - a.peak_ugm3).slice(0, 20).forEach(r => console.log('  ' + fmtRow(r) + `  (shift ${r.wind_shift})`));

// summary for the DOWNWIND page: every number below is read from the rows above
const rng = a => { const lo = Math.min(...a), hi = Math.max(...a); return lo === hi ? String(lo) : `${lo} to ${hi}`; };
const parts = [];
for (const L of C.lines) {
  const cr = base.filter(r => r.line === L.id && r.crosses && r.peak_ugm3 >= 1 && r.cross_km <= 25);
  if (!cr.length) { parts.push(`${L.label}: no modelled crossing.`); continue; }
  const top = cr.slice().sort((a, b) => b.peak_ugm3 - a.peak_ugm3)[0], same = cr.filter(r => Math.abs(r.lat - top.lat) < .02 && Math.abs(r.lon - top.lon) < .02);
  parts.push(`${L.label} (OpenStreetMap way ${L.osm_way}): a fire ${rng(same.map(r => Math.round(r.nearest_km * 10) / 10))} km ${D.compass(top.line_bearing + 180)} of it, ${rng(same.map(r => Math.round(r.frp)))} MW across ${new Set(same.map(r => r.fire)).size} passes, is upwind. The modelled smoke crosses the line ${rng(same.map(r => Math.round(r.cross_km * 10) / 10))} km from the fire, ${rng(same.map(r => r.eta_min))} minutes after leaving it, adding ${rng(same.map(r => Math.round(r.peak_ugm3)))} µg/m³ of PM2.5 at ground level.`);
}
const closest = base.filter(r => r.line === 'L1').sort((a, b) => a.nearest_km - b.nearest_km)[0];
if (closest && !closest.crosses) parts.push(`The fire closest to a line, ${closest.nearest_km} km from it, is not downwind: a distance ring would rank it first.`);
const shifted = rows.filter(r => r.wind_shift !== 0 && r.crosses && r.peak_ugm3 >= 1 && r.cross_km <= 25);
parts.push(`Turning the wind 30° either way keeps a crossing on ${new Set(shifted.map(r => r.line)).size} of ${C.lines.length} lines.`);
const web = path.join(ROOT, 'web/app-data/replay');
fs.mkdirSync(web, { recursive: true });
fs.writeFileSync(path.join(web, '2025-01-08.json'), JSON.stringify({ ...C, result: { before: day.length, summary: parts } }));
console.log('\n' + parts.join('\n'));

fs.writeFileSync(path.join(path.dirname(file), 'result.json'), JSON.stringify({ event: C.event, fires: day.map(f => ({ sat: f.sat, time: f.time, lat: r1(f.lat, 5), lon: r1(f.lon, 5), frp: r1(f.frp, 2), pixels: f.n })), rows }, null, 0));
