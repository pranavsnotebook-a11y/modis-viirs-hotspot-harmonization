// Loads the browser scripts into this Node process, the way tests/test_downwind_core.mjs does (plain scripts that attach to the global object).
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export function load(...names) {
  globalThis.window = globalThis;
  for (const n of names) vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'web/js', n + '.js'), 'utf8'), { filename: n + '.js' });
  return globalThis;
}
export const regions = () => JSON.parse(fs.readFileSync(path.join(ROOT, 'web/app-data/regions.json'), 'utf8'));
// plain copies of objects made in this realm (arrays made by the scripts are the same realm here, but keep tests honest about JSON-shaped data)
export const J = x => JSON.parse(JSON.stringify(x));
/* a wind stub with a constant wind: from the south (180 degrees) at 3 m/s for every hour of every date asked for. calls counts requests. */
export function constantWind({ wd = 180, ws = 3, fail = false } = {}) {
  const calls = [];
  const getJSON = async url => {
    calls.push(url); if (fail) throw new Error('offline');
    const q = new URL(url).searchParams, la = q.get('latitude').split(','), d0 = q.get('start_date'), d1 = q.get('end_date');
    const time = []; for (let t = Date.parse(d0 + 'T00:00:00Z'); t < Date.parse(d1 + 'T00:00:00Z') + 864e5; t += 36e5) time.push(new Date(t).toISOString().slice(0, 16));
    const n = time.length, H = () => ({ time, wind_speed_100m: Array(n).fill(ws), wind_direction_100m: Array(n).fill(wd), wind_speed_10m: Array(n).fill(ws * .6), boundary_layer_height: Array(n).fill(1500), cloud_cover: Array(n).fill(0) });
    const out = la.map(() => ({ hourly: H() })); return out.length === 1 ? out[0] : out;
  };
  return { getJSON, calls };
}
