/* FIRELAB model and data services, shared by the simulation space (firelab.html).
   OBSERVED: the FIRMS fire record. MODELLED: weather (Open-Meteo models), CAMS PM2.5, GHS-POP 2025 population.
   SCENARIO: the plume, built here from published formulas and the user's settings. Nothing here is a measurement. */
(function () {
'use strict';

/* PM2.5 emission factors, g per kg dry matter: Akagi et al. (2011), ACP 11, 4039, Table 1 (mean, sd). */
const BIOMES = [
  { k: 'savanna', label: 'Savanna and grassland', ef: 7.17, sd: 3.42 },
  { k: 'tropical', label: 'Tropical forest', ef: 9.1, sd: 3.5 },
  { k: 'crop', label: 'Crop residue', ef: 6.26, sd: 2.36 },
  { k: 'pasture', label: 'Pasture maintenance', ef: 14.8, sd: 6.7 },
  { k: 'temperate', label: 'Temperate forest', ef: 12.7, sd: 7.5 },
  { k: 'boreal', label: 'Boreal forest', ef: 15.3, sd: 5.9 },
];
const COMBUSTION = 0.368;   // kg dry matter burned per MJ of fire radiative energy (Wooster et al., 2005)
const N2_FT = 1.1e-4;       // free-troposphere Brunt–Väisälä frequency squared, s^-2, from the standard atmosphere (6.5 K/km lapse)
const BANDS = [1, 5, 15, 35, 55, 150];
const BAND_COL = ['#fff6d6', '#ffe9a3', '#ffc04d', '#ff8a2b', '#f2462b', '#9b1238'];
const MAX_KM = 200, CELL = 0.025;

const SIG = { // Briggs (1973) open-country dispersion coefficients, x in m -> [sigma_y, sigma_z]
  A: x => [0.22 * x / Math.sqrt(1 + 1e-4 * x), 0.20 * x], B: x => [0.16 * x / Math.sqrt(1 + 1e-4 * x), 0.12 * x],
  C: x => [0.11 * x / Math.sqrt(1 + 1e-4 * x), 0.08 * x / Math.sqrt(1 + 2e-4 * x)], D: x => [0.08 * x / Math.sqrt(1 + 1e-4 * x), 0.06 * x / Math.sqrt(1 + 1.5e-3 * x)],
  E: x => [0.06 * x / Math.sqrt(1 + 1e-4 * x), 0.03 * x / (1 + 3e-4 * x)], F: x => [0.04 * x / Math.sqrt(1 + 1e-4 * x), 0.016 * x / (1 + 3e-4 * x)],
};
function solarElevation(lat, lon, date) {
  const d = (date - Date.UTC(date.getUTCFullYear(), 0, 1)) / 864e5, decl = -23.44 * Math.cos(2 * Math.PI * (d + 10) / 365);
  const hr = date.getUTCHours() + date.getUTCMinutes() / 60 + lon / 15, ha = (hr - 12) * 15, r = Math.PI / 180;
  return Math.asin(Math.sin(lat * r) * Math.sin(decl * r) + Math.cos(lat * r) * Math.cos(decl * r) * Math.cos(ha * r)) / r;
}
function stability(u10, elev, cloud) { // Pasquill–Turner classes; intermediate classes take the more unstable letter
  if (elev > 0) {
    const ins = cloud > 80 ? (elev > 35 ? 1 : 0) : elev > 60 ? 2 : elev > 35 ? 1 : 0; // 2 strong, 1 moderate, 0 slight
    const row = u10 < 2 ? 'AAB' : u10 < 3 ? 'ABC' : u10 < 5 ? 'BBC' : u10 < 6 ? 'CCD' : 'CDD';
    return row[2 - ins];
  }
  const cl = cloud >= 50;
  return u10 < 3 ? (cl ? 'E' : 'F') : u10 < 5 ? (cl ? 'D' : 'E') : 'D';
}
function plumeTop(frpMW, hbl) { // Sofiev et al. (2012), ACP 12, 1995: calibrated on MISR plume heights
  return 0.24 * hbl + 170 * Math.pow(frpMW, 0.35) * Math.exp(-0.6 * N2_FT / 2.5e-4);
}
const erf = x => { const t = 1 / (1 + .3275911 * Math.abs(x)), y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - .284496736) * t + .254829592) * t * Math.exp(-x * x); return x >= 0 ? y : -y; };
// Ground-level concentration in µg/m^3, averaged across a crosswind width w (m) when w is given, with ground
// reflection and a mixing-height lid; well mixed below the lid once the plume fills it.
function conc(Q, u, he, L, cls, x, y, w) {
  if (x < 50) return 0;
  const [sy, sz] = SIG[cls](x);
  const cross = w ? (erf((y + w / 2) / (Math.SQRT2 * sy)) - erf((y - w / 2) / (Math.SQRT2 * sy))) / (2 * w) : Math.exp(-y * y / (2 * sy * sy)) / (Math.sqrt(2 * Math.PI) * sy);
  let vert;
  if (sz > 1.6 * L) vert = 1 / L;
  else { vert = 0; for (let n = -3; n <= 3; n++) { const a = he + 2 * n * L; vert += 2 * Math.exp(-a * a / (2 * sz * sz)); } vert /= Math.sqrt(2 * Math.PI) * sz; }
  return Q / u * cross * vert * 1e6;
}

/* One scenario. p: {lat, lon, frp, ws, wd, u10, blh, cloud, time (Date), ef, hours, trap}, grid: population grid or
   a plain grid without values. Returns everything the map and charts need. Pure: no DOM, no network. */
function simulate(p, grid, opts = {}) {
  const u = Math.max(1, p.ws), Lmix = Math.max(100, p.blh ?? 1000), elev = solarElevation(p.lat, p.lon, p.time);
  const cls = stability(Math.max(.5, p.u10 ?? u), elev, p.cloud ?? 50);
  const top = plumeTop(p.frp, Lmix), share = p.trap ? 1 : Math.min(1, Lmix / top), he = Math.min(top, Lmix) / 2;
  const Q = p.frp * COMBUSTION * p.ef, Qg = Q * share; // g/s emitted, g/s that can reach the ground
  const xmax = Math.min(MAX_KM * 1000, u * p.hours * 3600);
  const toward = (p.wd + 180) * Math.PI / 180, de = Math.sin(toward), dn = Math.cos(toward), clat = Math.cos(p.lat * Math.PI / 180);
  let cmax = 0, xAt = 0;
  const profile = [];
  for (let x = 100; x <= MAX_KM * 1000; x *= 1.08) {
    const c = x <= xmax ? conc(Qg, u, he, Lmix, cls, x, 0, 0) : null;
    profile.push([x / 1000, c]);
    if (c != null && c > cmax) { cmax = c; xAt = x; }
  }
  const scales = opts.scales || [1];
  const area = scales.map(() => new Array(BANDS.length).fill(0)), people = scales.map(() => new Array(BANDS.length).fill(0));
  const cells = [];
  if (grid && !opts.noGrid) {
    for (let r = 0; r < grid.rows; r++) {
      const la = grid.north - (r + .5) * grid.dy, cl = Math.cos(la * Math.PI / 180), ca = grid.dx * 111.195 * cl * grid.dy * 111.195, w = Math.sqrt(ca) * 1000;
      const nn = (la - p.lat) * 111195;
      for (let c = 0; c < grid.cols; c++) {
        const lo = grid.west + (c + .5) * grid.dx, e = (lo - p.lon) * 111195 * cl;
        const x = e * de + nn * dn; if (x <= 0 || x > xmax) continue;
        const y = e * dn - nn * de;
        const C1 = conc(Qg, u, he, Lmix, cls, x, y, w); // concentration is linear in Q, so other emission scales are multiples
        if (C1 * Math.max(...scales) < BANDS[0]) continue;
        const pop = grid.values ? grid.values[r * grid.cols + c] : 0;
        scales.forEach((s, k) => { const C = C1 * s; for (let b = 0; b < BANDS.length && C >= BANDS[b]; b++) { area[k][b] += ca; people[k][b] += pop; } });
        if (C1 >= BANDS[0]) { let b = 0; while (b + 1 < BANDS.length && C1 >= BANDS[b + 1]) b++; cells.push([la, lo, b, C1, pop]); }
      }
    }
  }
  const env = [[], []]; // point-value outline at the lowest band
  for (let x = 100; x <= xmax; x *= 1.06) {
    const cc = conc(Qg, u, he, Lmix, cls, x, 0, 0); if (cc <= BANDS[0]) continue;
    const half = SIG[cls](x)[0] * Math.sqrt(2 * Math.log(cc / BANDS[0]));
    for (const [side, sgn] of [[0, 1], [1, -1]]) { const e = x * de + sgn * half * dn, nn = x * dn - sgn * half * de; env[side].push([p.lat + nn / 111195, p.lon + e / (111195 * clat)]); }
  }
  return { u, Lmix, elev, cls, top, share, he, Q, Qg, xmax, cmax, xAt, profile, cells, area: area[0], people: people[0], areaS: area, peopleS: people, env, toward: (p.wd + 180) % 360, de, dn, clat };
}

/* Domain around a fire: a square of MAX_KM half-width, so any wind direction or duration fits without refetching. */
function domain(lat, lon) {
  const d = MAX_KM / 111.195, clat = Math.max(.2, Math.cos(lat * Math.PI / 180));
  return [Math.max(-179.99, lon - d / clat), Math.max(-89.9, lat - d), Math.min(179.99, lon + d / clat), Math.min(89.9, lat + d)];
}
function plainGrid(b) {
  return { west: Math.floor(b[0] / CELL) * CELL, north: Math.ceil(b[3] / CELL) * CELL, dx: CELL, dy: CELL, cols: Math.ceil((b[2] - b[0]) / CELL) + 1, rows: Math.ceil((b[3] - b[1]) / CELL) + 1, values: null };
}

/* ---------- services ---------- */
async function getJSON(url, ms = 30000) {
  const c = new AbortController(), t = setTimeout(() => c.abort(), ms);
  try { const r = await fetch(url, { signal: c.signal }); const j = await r.json(); if (!r.ok) throw new Error(j.error || 'HTTP ' + r.status); return j; } finally { clearTimeout(t); }
}
async function serverStatus() {
  try {
    const c = new AbortController(), tm = setTimeout(() => c.abort(), 4000);
    const r = await fetch('api/status', { signal: c.signal }); clearTimeout(tm);
    if (!r.ok || !(r.headers.get('content-type') || '').includes('json')) return null;
    return await r.json();
  } catch (e) { return null; }
}
const wxCache = new Map();
async function weather(lat, lon, iso, server) {
  const key = `${lat.toFixed(3)},${lon.toFixed(3)},${iso.slice(0, 13)}`;
  if (wxCache.has(key)) return wxCache.get(key);
  let j;
  if (server) j = await getJSON(`api/weather?lat=${lat}&lon=${lon}&time=${encodeURIComponent(iso)}`);
  else { // static mode: the same keyless models, called directly
    const t = new Date(iso), d0 = new Date(t - 6 * 36e5).toISOString().slice(0, 10), d1 = new Date(+t + 30 * 36e5).toISOString().slice(0, 10);
    const h = 'wind_speed_10m,wind_direction_10m,wind_speed_100m,wind_direction_100m,boundary_layer_height,temperature_2m,relative_humidity_2m,cloud_cover';
    j = { weather_source: 'Open-Meteo best-match weather models (forecast/analysis)', errors: {} };
    try { j.weather = (await getJSON(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=${h}&start_date=${d0}&end_date=${d1}&wind_speed_unit=ms&timezone=GMT`)).hourly; } catch (e) { j.errors.weather = 'weather model data unavailable'; }
    try { j.air_quality = (await getJSON(`https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}&hourly=pm2_5&start_date=${d0}&end_date=${d1}&timezone=GMT`)).hourly; j.air_quality_source = 'CAMS atmospheric composition model via Open-Meteo (all sources, modelled, not a measurement)'; } catch (e) { j.errors.air_quality = 'CAMS model data unavailable'; }
  }
  wxCache.set(key, j); return j;
}
const popCache = new Map();
async function population(b, server) {
  if (!server || !server.population_grid) return null;
  const key = b.map(x => x.toFixed(3)).join(',');
  if (!popCache.has(key)) popCache.set(key, getJSON(`api/population?bbox=${key}`, 60000));
  try { return await popCache.get(key); } catch (e) { popCache.delete(key); throw e; }
}

window.FIRECORE = { BIOMES, COMBUSTION, BANDS, BAND_COL, MAX_KM, CELL, SIG, conc, plumeTop, stability, solarElevation, simulate, domain, plainGrid, getJSON, serverStatus, weather, population };
})();
