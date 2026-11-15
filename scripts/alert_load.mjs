/* Alert load in 2025: how many days and fire clusters would a distance rule and the DOWNWIND wind rule flag on the
   mapped 500 kV lines of Paraguay? Measures alert load only; there is no ground truth here.
   Inputs (from scripts/alert_load_prep.py): data/replay/alert_load_dets.json, alert_load_lines.json, era5_2025/*.json
   Output: docs/research/alert_load_2025.json
   usage: node scripts/alert_load.mjs */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), R = path.join(ROOT, 'data/replay');
globalThis.window = globalThis;
for (const f of ['web/js/firelab-core.js', 'web/js/downwind-core.js']) vm.runInThisContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), { filename: f });
const D = globalThis.DOWNWIND, F = globalThis.FIRECORE;

const SET = { cluster_km: 1.5, distance_rule_km: 5, wind_gate_km: 25, scenario_hours: 3, wind_hours_tried: 3, max_cross_km: 25, min_peak_ugm3: F.BANDS[0],
  piece_vertices: 25, piece_skip_km: 30, frp_variants_mw: [5, 10], wind_field: 'wind_speed_100m, wind_direction_100m, wind_speed_10m, boundary_layer_height, cloud_cover' };
const dets = JSON.parse(fs.readFileSync(path.join(R, 'alert_load_dets.json'), 'utf8'));
const lines = JSON.parse(fs.readFileSync(path.join(R, 'alert_load_lines.json'), 'utf8'));

// line pieces of about 25 vertices (one vertex shared so no segment is lost)
const pieces = [];
for (const L of lines) for (let i = 0; i + 1 < L.pts.length || i === 0; i += SET.piece_vertices - 1) {
  const pts = L.pts.slice(i, i + SET.piece_vertices); if (pts.length < 2) break;
  const la = pts.map(p => p[0]), lo = pts.map(p => p[1]);
  pieces.push({ id: L.id, pts, minLat: Math.min(...la), maxLat: Math.max(...la), minLon: Math.min(...lo), maxLon: Math.max(...lo) });
  if (i + SET.piece_vertices >= L.pts.length) break;
}
const KM = 111.195;
function segDist(lat, lon, a, b) { // km from a point to a segment, local flat frame
  const c = Math.cos(lat * Math.PI / 180), ax = (a[1] - lon) * KM * c, ay = (a[0] - lat) * KM, bx = (b[1] - lon) * KM * c, by = (b[0] - lat) * KM;
  const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy, t = L2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L2)) : 0;
  return Math.hypot(ax + t * dx, ay + t * dy);
}
const pieceDist = (f, p) => { // quick reject by bounding box, then exact
  const c = Math.cos(f.lat * Math.PI / 180);
  const dLat = Math.max(p.minLat - f.lat, 0, f.lat - p.maxLat) * KM, dLon = Math.max(p.minLon - f.lon, 0, f.lon - p.maxLon) * KM * c;
  if (Math.hypot(dLat, dLon) > SET.piece_skip_km) return Infinity;
  let m = Infinity; for (let i = 0; i + 1 < p.pts.length; i++) m = Math.min(m, segDist(f.lat, f.lon, p.pts[i], p.pts[i + 1])); return m;
};

// ERA5 cells
const q = x => Math.round(x * 4) / 4, key = (la, lo) => la.toFixed(2) + '_' + lo.toFixed(2);
const T0 = Date.UTC(2025, 0, 1), wcache = new Map();
function cell(la, lo) {
  const k = key(q(la), q(lo)); if (wcache.has(k)) return wcache.get(k);
  const fp = path.join(R, 'era5_2025', k + '.json'); let v = null;
  if (fs.existsSync(fp)) { const h = JSON.parse(fs.readFileSync(fp, 'utf8')).hourly; v = h; }
  wcache.set(k, v); return v;
}
function wxAt(f, t) { // the model hour starting at t, or null
  const h = cell(f.lat, f.lon); if (!h) return null;
  const k = Math.round((t - T0) / 36e5); if (k < 0 || k >= h.time.length) return null;
  const ws = h.wind_speed_100m[k], wd = h.wind_direction_100m[k], u10 = h.wind_speed_10m[k], blh = h.boundary_layer_height[k], cloud = h.cloud_cover[k];
  if (ws == null || wd == null || u10 == null || blh == null) return null;
  return { ws, wd, u10, blh, cloud };
}

const fires = D.cluster(dets, SET.cluster_km);
const out = [];
let noCell = 0, noHour = 0, noWx = 0;
for (const f of fires) {
  const near = pieces.map(p => ({ p, d: pieceDist(f, p) })).filter(x => x.d <= SET.piece_skip_km);
  const dmin = near.length ? Math.min(...near.map(x => x.d)) : Infinity;
  if (dmin > SET.wind_gate_km) continue; // neither rule can flag it
  const rec = { day: f.time.slice(0, 10), time: f.time, sat: f.sat, lat: f.lat, lon: f.lon, frp: f.frp, n: f.n, dist_km: dmin, dist5: dmin <= SET.distance_rule_km, wind: false, hasWx: false, best: null };
  if (!cell(f.lat, f.lon)) noCell++;
  const t0 = Math.floor(Date.parse(f.time) / 36e5) * 36e5;
  let got = 0;
  for (let h = 0; h < SET.wind_hours_tried; h++) {
    const t = t0 + h * 36e5, wx = wxAt(f, t); if (!wx) { noHour++; continue; } got++;
    const s = D.scenario(f, wx, { time: new Date(t), hours: SET.scenario_hours });
    for (const { p } of near) {
      // pieces are scored per line piece; a flag needs the crossing and the peak in the same piece
      const c = D.crossLine(s, p.pts);
      if (c && c.crosses && c.crossKm <= SET.max_cross_km && c.peak >= SET.min_peak_ugm3) {
        rec.wind = true;
        if (!rec.best || c.peak > rec.best.peak) rec.best = { line: p.id, hour: new Date(t).toISOString().slice(0, 13) + 'Z', cross_km: +c.crossKm.toFixed(2), peak: +c.peak.toFixed(2), wind_from: Math.round(wx.wd), ws100: wx.ws };
      }
    }
  }
  rec.hasWx = got > 0; if (!rec.hasWx) noWx++;
  out.push(rec);
}

const pct = (a, p) => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y), i = (s.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i); return +(s[lo] + (s[hi] - s[lo]) * (i - lo)).toFixed(2); };
function stat(pred) {
  const sel = out.filter(pred), byDay = new Map(); sel.forEach(r => byDay.set(r.day, (byDay.get(r.day) || 0) + 1));
  const per = [...byDay.values()];
  return { flagged_days: byDay.size, flagged_clusters: sel.length, clusters_per_flagged_day_median: pct(per, .5), clusters_per_flagged_day_p90: pct(per, .9), clusters_per_flagged_day_max: per.length ? Math.max(...per) : null };
}
const res = {
  distance_5km: stat(r => r.dist5),
  wind: stat(r => r.wind),
  wind_frp_ge_5: stat(r => r.wind && r.frp >= 5),
  wind_frp_ge_10: stat(r => r.wind && r.frp >= 10),
  wind_within_5km: stat(r => r.wind && r.dist5),
  wind_beyond_5km: stat(r => r.wind && !r.dist5),
};
const flagDaysDist = new Set(out.filter(r => r.dist5).map(r => r.day)), flagDaysWind = new Set(out.filter(r => r.wind).map(r => r.day));
const windOnlyDays = [...flagDaysWind].filter(d => !flagDaysDist.has(d)).length, bothDays = [...flagDaysWind].filter(d => flagDaysDist.has(d)).length;
const distWithWx = out.filter(r => r.dist5 && r.hasWx);
const sanity = [[-25.265, -56.765], [-25.215, -57.069]].map(([la, lo]) => {
  const m = out.filter(r => r.day === '2025-01-08' && Math.abs(r.lat - la) < .03 && Math.abs(r.lon - lo) < .03);
  return { target: [la, lo], clusters_nearby_on_day: m.length, wind_flagged: m.filter(r => r.wind).map(r => ({ time: r.time, sat: r.sat, lat: +r.lat.toFixed(4), lon: +r.lon.toFixed(4), frp: +r.frp.toFixed(1), dist_km: +r.dist_km.toFixed(2), ...r.best })), not_flagged: m.filter(r => !r.wind).map(r => ({ time: r.time, sat: r.sat, lat: +r.lat.toFixed(4), lon: +r.lon.toFixed(4), frp: +r.frp.toFixed(1), dist_km: +r.dist_km.toFixed(2), hasWx: r.hasWx })) };
});
const summary = {
  settings: SET, rule_definitions: { day: 'UTC date of the satellite pass', distance: 'cluster centroid within 5 km of a mapped 500 kV line segment', wind: 'cluster within 25 km of a line; for the pass hour and the next two hours, scenario hours 3, plume axis crosses line, crossKm <= 25, peak >= 1 ug/m3; any hour qualifies' },
  inputs: { detections_within_25km: dets.length, clusters_total: fires.length, clusters_within_25km_of_line: out.length, line_ways: lines.length, line_pieces: pieces.length },
  weather: { clusters_without_cell_file: noCell, clusters_with_no_usable_hour: noWx, missing_hour_lookups: noHour, era5_cells_on_disk: fs.readdirSync(path.join(R, 'era5_2025')).length },
  results: res,
  overlap: { days_flagged_by_wind_and_distance: bothDays, days_flagged_by_wind_only: windOnlyDays, days_flagged_by_distance_only: [...flagDaysDist].filter(d => !flagDaysWind.has(d)).length },
  ring_share_upwind: { distance_clusters: res.distance_5km.flagged_clusters, of_which_wind_flagged: res.wind_within_5km.flagged_clusters, share: +(res.wind_within_5km.flagged_clusters / res.distance_5km.flagged_clusters).toFixed(4),
    distance_clusters_with_weather: distWithWx.length, share_of_those_with_weather: +(distWithWx.filter(r => r.wind).length / distWithWx.length).toFixed(4) },
  wind_flag_share_beyond_5km: +(res.wind_beyond_5km.flagged_clusters / res.wind.flagged_clusters).toFixed(4),
  sanity_2025_01_08: sanity,
};
fs.writeFileSync(path.join(ROOT, 'docs/research/alert_load_2025.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 1));
