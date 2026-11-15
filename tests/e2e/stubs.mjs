// Deterministic stand-ins for the two outside services the pages call, so tests do not depend on the network or on
// Open-Meteo's rate limit: modelled wind (Open-Meteo) and INPE's 10-minute fire files. Used by the e2e tests and by the
// DOWNWIND regression baseline. The numbers are synthetic and exist only to exercise the code.
import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const WEB = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../web');

const HOURS = 24;
function hourly(lat, lon, d0, d1) {
  const time = [], ws = [], wd = [], u10 = [], blh = [], cloud = [];
  for (let t = Date.parse(d0 + 'T00:00:00Z'), k = 0; t < Date.parse(d1 + 'T00:00:00Z') + 864e5; t += 36e5, k++) {
    time.push(new Date(t).toISOString().slice(0, 16));
    const s = 2.2 + 4.5 * Math.abs(Math.sin(lat * 7.3 + lon * 3.1 + (k % HOURS) * .11));
    ws.push(+s.toFixed(1)); u10.push(+(s * .6).toFixed(1));
    wd.push(Math.round((lat * 977 + lon * 613 + (k % HOURS) * 4 + 3600) % 360));
    blh.push(300 + Math.round(1500 * Math.abs(Math.sin(((k % HOURS) - 6) / 24 * Math.PI)))); cloud.push((k * 7) % 60);
  }
  return { time, wind_speed_100m: ws, wind_direction_100m: wd, wind_speed_10m: u10, boundary_layer_height: blh, cloud_cover: cloud };
}
export function windResponse(url) {
  const q = new URL(url).searchParams, la = q.get('latitude').split(',').map(Number), lo = q.get('longitude').split(',').map(Number);
  const one = (a, b) => ({ latitude: a, longitude: b, hourly: hourly(a, b, q.get('start_date'), q.get('end_date')) });
  return la.length === 1 ? one(la[0], lo[0]) : la.map((a, i) => one(a, lo[i]));
}

const assetCache = new Map();
function assets(iso) {
  if (!assetCache.has(iso)) assetCache.set(iso, JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(WEB, 'app-data/assets', iso + '.json.gz')))));
  return assetCache.get(iso);
}
/* a CSV for one INPE file name: pixels a little off the mapped power lines and roads of all four regions, in most files */
export function inpeCsv(name) {
  const m = /focos_10min_(\d{4})(\d\d)(\d\d)_(\d\d)(\d\d)\.csv/.exec(name); if (!m) return null;
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]), slot = Math.round(t / 6e5), rows = ['lat,lon,satelite,data'];
  let n = 0;
  for (const iso of ['PY', 'BO', 'AR', 'BR']) {
    const A = assets(iso);
    for (const kind of ['power', 'roads']) for (const w of (A[kind] || []).slice(0, 400)) {
      const p = w.pts[Math.floor(w.pts.length / 2)]; n++;
      if (n % 9 !== 0 || (n + slot) % 4 === 0) continue;
      rows.push(`${(p[0] + .015).toFixed(6)},${(p[1] + .012).toFixed(6)},GOES-19,${new Date(t - 180000).toISOString().slice(0, 19).replace('T', ' ')}`);
    }
  }
  return rows.join('\n');
}
/* install on a Playwright context or page */
export async function stubOutside(ctx, { wind = true, inpe = true, windFail = false } = {}) {
  // the server's wind cache is answered here from the same synthetic wind, so tests never reach the real wind service
  await ctx.route(/\/api\/wind/, r => { if (!wind || windFail) return r.abort(); const q = new URL(r.request().url()).searchParams, cells = {}; for (const c of q.get('cells').split(';')) { const [a, b] = c.split(',').map(Number); cells[c] = hourly(a, b, q.get('d0'), q.get('d1')); } r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ cells }) }); });
  if (wind) await ctx.route(/open-meteo\.com\//, r => windFail ? r.abort() : r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(windResponse(r.request().url())) }));
  if (inpe) await ctx.route(/dataserver-coids\.inpe\.br\//, r => { const c = inpeCsv(r.request().url().split('/').pop()); r.fulfill(c == null ? { status: 404, body: '' } : { status: 200, contentType: 'text/csv', headers: { 'access-control-allow-origin': '*' }, body: c }); });
}
