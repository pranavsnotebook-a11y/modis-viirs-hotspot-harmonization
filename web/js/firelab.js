/* FIRELAB — Smoke & Exposure Simulator.
   OBSERVED: the FIRMS fire record. MODELLED: weather (Open-Meteo models), CAMS PM2.5, GHS-POP 2025 population.
   SCENARIO: the plume, built here from textbook formulas and the user's settings. Nothing here is a measurement. */
(function () {
'use strict';
const $ = id => document.getElementById(id);
const H = () => window.__HSE;
const fmt = n => (n == null || !isFinite(n)) ? '—' : Math.round(n).toLocaleString('en-US');
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const sig = (x, d = 2) => x == null || !isFinite(x) ? '—' : x >= 100 ? fmt(x) : x.toPrecision(d);

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

let map = null, plumeLayer = null, plumeBounds = null, regionBounds = null, fittedFire = null, pendingFit = false, fireId = null, wx = null, wxFor = null, popGrid = null, popFor = null, chartObj = null, inited = false;

/* ---------- dispersion ---------- */
const SIG = { // Briggs (1973) open-country dispersion coefficients, x in m
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
// Ground-level concentration (g/m^3 -> returned in µg/m^3) averaged across a crosswind width w (m), with ground
// reflection and a mixing-height lid; well mixed below the lid once the plume fills it.
const erf = x => { const t = 1 / (1 + .3275911 * Math.abs(x)), y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - .284496736) * t + .254829592) * t * Math.exp(-x * x); return x >= 0 ? y : -y; };
function conc(Q, u, he, L, cls, x, y, w) {
  if (x < 50) return 0;
  const [sy, sz] = SIG[cls](x);
  const cross = w ? (erf((y + w / 2) / (Math.SQRT2 * sy)) - erf((y - w / 2) / (Math.SQRT2 * sy))) / (2 * w) : Math.exp(-y * y / (2 * sy * sy)) / (Math.sqrt(2 * Math.PI) * sy);
  let vert;
  if (sz > 1.6 * L) vert = 1 / L;
  else { vert = 0; for (let n = -3; n <= 3; n++) { const a = he + 2 * n * L; vert += 2 * Math.exp(-a * a / (2 * sz * sz)); } vert /= Math.sqrt(2 * Math.PI) * sz; }
  return Q / u * cross * vert * 1e6;
}

/* ---------- data ---------- */
async function getJSON(url, ms = 30000) {
  const c = new AbortController(), t = setTimeout(() => c.abort(), ms);
  try { const r = await fetch(url, { signal: c.signal }); const j = await r.json(); if (!r.ok) throw new Error(j.error || 'HTTP ' + r.status); return j; } finally { clearTimeout(t); }
}
async function weather(lat, lon, iso) {
  const key = `${lat.toFixed(3)},${lon.toFixed(3)},${iso.slice(0, 13)}`;
  if (wxFor === key) return wx;
  let j;
  if (H().SERVER) j = await getJSON(`api/weather?lat=${lat}&lon=${lon}&time=${encodeURIComponent(iso)}`);
  else { // static mode: the same keyless models, called directly
    const t = new Date(iso), d0 = new Date(t - 6 * 36e5).toISOString().slice(0, 10), d1 = new Date(+t + 30 * 36e5).toISOString().slice(0, 10);
    const h = 'wind_speed_10m,wind_direction_10m,wind_speed_100m,wind_direction_100m,boundary_layer_height,temperature_2m,relative_humidity_2m,cloud_cover';
    j = { weather_source: 'Open-Meteo best-match weather models (forecast/analysis)', errors: {} };
    try { j.weather = (await getJSON(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=${h}&start_date=${d0}&end_date=${d1}&wind_speed_unit=ms&timezone=GMT`)).hourly; } catch (e) { j.errors.weather = 'weather model data unavailable'; }
    try { j.air_quality = (await getJSON(`https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}&hourly=pm2_5&start_date=${d0}&end_date=${d1}&timezone=GMT`)).hourly; j.air_quality_source = 'CAMS atmospheric composition model via Open-Meteo (all sources, modelled, not a measurement)'; } catch (e) { j.errors.air_quality = 'CAMS model data unavailable'; }
  }
  wx = j; wxFor = key; return j;
}
async function population(b) {
  if (!H().SERVER || !H().SERVER.population_grid) return null;
  const key = b.map(x => x.toFixed(3)).join(',');
  if (popFor === key) return popGrid;
  popGrid = await getJSON(`api/population?bbox=${key}`); popFor = key; return popGrid;
}

/* ---------- fire records ---------- */
function candidates() {
  const h = H(), R = h.R(), out = [], vis = h.visibleTest();
  if (h.histMode()) return out;
  for (let i = 0; i < h.N; i++) if (h.inFilter[i] && h.harm[i] && vis(i)) out.push(i);
  out.sort((a, b) => R.frp[b] - R.frp[a]);
  // typical fires: daytime records between 20 and 300 MW, spread evenly through that range
  const mid = out.filter(i => R.frp[i] >= 2000 && R.frp[i] <= 30000 && !R.night[i]), typ = [];
  for (let k = 0; k < 40 && mid.length; k++) typ.push(mid[Math.floor(k * (mid.length - 1) / 39)]);
  return { top: out.slice(0, 40), typ };
}
function fireInfo(i) {
  const h = H(), R = h.R(), v = h.recordView(i, true);
  let frp = i < h.NM ? R.frp[i] / 100 : R.frp[i] / 100, n = 1;
  if ($('flCluster').checked) { // neighbours from the same satellite and overpass within 2 km: assumed to be the same fire
    frp = 0; n = 0;
    const lat = R.lat[i], lon = R.lon[i], s = R.sat[i], t = R.t[i], lo = i < h.NM ? 0 : h.NM, hi = i < h.NM ? h.NM : h.N;
    const dLat = 2 / 111.195 * 1e5, dLon = dLat / Math.max(.2, Math.cos(lat / 1e5 * Math.PI / 180));
    for (let k = lo; k < hi; k++) if (R.sat[k] === s && Math.abs(R.t[k] - t) <= 10 && Math.abs(R.lat[k] - lat) <= dLat && Math.abs(R.lon[k] - lon) <= dLon) { frp += R.frp[k] / 100; n++; }
  }
  return { i, v, frp, n, lat: R.lat[i] / 1e5, lon: R.lon[i] / 1e5, iso: v.time.replace(' ', 'T') + ':00Z' };
}

/* ---------- UI ---------- */
function init() {
  if (inited) return; inited = true;
  $('flBiome').innerHTML = BIOMES.map(b => `<option value="${b.k}">${b.label} · ${b.ef} g/kg</option>`).join('');
  $('flPick').addEventListener('change', () => { fireId = +$('flPick').value; autoBiome(); run(); });
  $('flUseSel').addEventListener('click', () => { const s = H().selected; if (!s) { H().toast('Select a hotspot on the Map Explorer first.'); return; } useRecord(s.i); });
  ['flBiome', 'flCluster', 'flTrap'].forEach(id => $(id).addEventListener('change', run));
  $('flHours').addEventListener('input', () => { $('flHoursV').textContent = $('flHours').value; debounce(); });
  $('flWindOverride').addEventListener('change', () => { $('flWindBox').style.display = $('flWindOverride').checked ? '' : 'none'; run(); });
  ['flWs', 'flWd'].forEach(id => $(id).addEventListener('input', () => { $('flWsV').textContent = $('flWs').value; $('flWdV').textContent = $('flWd').value; debounce(); }));
  $('flMethod').innerHTML = [
    '<b>Observed:</b> the fire is one NASA FIRMS detection (MODIS C6.1 or VIIRS 375 m NRT): position, time and fire radiative power (FRP) at the moment of the overpass.',
    `<b>Emission (scenario):</b> PM2.5 rate = FRP × ${COMBUSTION} kg/MJ (Wooster et al., 2005) × emission factor (Akagi et al., 2011, Table 1). The fire is assumed to burn at the observed FRP for the hours chosen; real fires change within minutes. A single pixel's FRP undercounts a fire spread across several pixels; the 2 km option sums them, assuming they are one fire.`,
    '<b>Weather (modelled):</b> hourly 10 m and 100 m wind, boundary-layer height and cloud from the Open-Meteo best-match forecast and analysis models (ERA5 reanalysis for older dates), at the hour nearest the overpass. Transport uses the 100 m wind.',
    `<b>Dispersion (scenario):</b> steady-state Gaussian plume. Plume-top height from FRP and boundary-layer height (Sofiev et al., 2012, calibrated on MISR plume heights; free-troposphere stability from the standard atmosphere); smoke spread evenly from the ground to the plume top, and only the share below the boundary-layer top reaches the ground unless the worst case is ticked; Pasquill–Turner stability from 10 m wind, sun elevation and cloud; Briggs open-country σy, σz; ground reflection and a mixing-height lid. Straight-line wind, flat terrain, no chemistry, no secondary aerosol, no deposition, downwind only, up to ${MAX_KM} km or the distance the wind covers in the chosen hours.`,
    '<b>Population (modelled):</b> GHS-POP R2023A epoch 2025 (European Commission JRC), summed to 0.025° cells. It counts residents, not people present or confirmed exposed.',
    '<b>CAMS PM2.5 (modelled):</b> Copernicus atmospheric composition model at the fire location, all sources, for context. It is not a measurement and it already includes some fire smoke.',
    '<b>Validation:</b> none. The plume has not been compared with ground monitors or satellite smoke for these fires. Treat values as an order of magnitude.',
  ].map(x => `<li>${x}</li>`).join('');
  map = L.map('flMap', { worldCopyJump: true }).setView([0, 0], 2);
  H().baseLayer('hybrid').addTo(map);
  plumeLayer = L.layerGroup().addTo(map);
  // instructions: shown until the user hides them
  const how = $('flHow'), setHow = on => { how.classList.toggle('hidden', !on); $('flHowBtn').setAttribute('aria-expanded', on); try { localStorage.setItem('flHow', on ? '1' : '0'); } catch (e) { /* storage unavailable */ } };
  let showHow = true; try { showHow = localStorage.getItem('flHow') !== '0'; } catch (e) { /* storage unavailable */ }
  setHow(showHow);
  $('flHowClose').addEventListener('click', () => setHow(false));
  $('flHowBtn').addEventListener('click', () => setHow(how.classList.contains('hidden')));
  // map tools
  $('flZoomPlume').addEventListener('click', () => fit(plumeBounds));
  $('flZoomOut').addEventListener('click', () => fit(regionBounds));
  const wrap = $('flMapWrap');
  $('flExpand').addEventListener('click', async () => {
    if (document.fullscreenElement === wrap) { await document.exitFullscreen(); return; }
    if (wrap.classList.contains('fullscreen')) { wrap.classList.remove('fullscreen'); afterResize(); return; }
    try { await wrap.requestFullscreen(); } catch (e) { wrap.classList.add('fullscreen'); afterResize(); }
  });
  document.addEventListener('fullscreenchange', afterResize);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && wrap.classList.contains('fullscreen')) { wrap.classList.remove('fullscreen'); afterResize(); } });
  $('flLegend').innerHTML = BANDS.map((b, k) => `<span><i style="background:${BAND_COL[k]};border-radius:2px"></i>≥ ${b}</span>`).join('') + '<span>µg/m³ added, hourly mean · scenario</span>';
}
function isFull() { const w = $('flMapWrap'); return document.fullscreenElement === w || w.classList.contains('fullscreen'); }
function afterResize() {
  $('flExpand').textContent = isFull() ? '✕ Exit full screen' : '⛶ Expand';
  setTimeout(() => { if (!map) return; map.invalidateSize(); if (pendingFit || isFull()) fit(plumeBounds); }, 120);
}
function fit(b) {
  if (!map || !b) return;
  if (!$('flMap').offsetWidth) { pendingFit = true; return; } // hidden page: fit when it is shown
  pendingFit = false;
  map.fitBounds(b, { padding: [30, 30], maxZoom: 12 });
}
let deb; const debounce = () => { clearTimeout(deb); deb = setTimeout(run, 160); };
function autoBiome() {
  if (fireId == null) return;
  const lat = Math.abs(H().R().lat[fireId] / 1e5);
  $('flBiome').value = lat >= 50 ? 'boreal' : lat >= 30 ? 'temperate' : 'savanna';
}
function fillPicker() {
  const c = candidates(), h = H();
  if (Array.isArray(c)) { $('flPick').innerHTML = '<option>No records in this filter (clear a month filter to use bundled records)</option>'; return; }
  const opt = i => { const v = h.recordView(i, true); return `<option value="${i}">${v.id} · ${(v.frpM ?? v.frpV).toFixed(0)} MW · ${esc(v.place)}${v.placeCountry ? ', ' + esc(v.placeCountry) : ''} · ${v.time}${v.night ? ' · night' : ''}</option>`; };
  const all = new Set([...c.top, ...c.typ]);
  $('flPick').innerHTML = (fireId != null && !all.has(fireId) ? `<optgroup label="Selected">${opt(fireId)}</optgroup>` : '')
    + (c.typ.length ? `<optgroup label="Typical daytime fires (20–300 MW)">${c.typ.map(opt).join('')}</optgroup>` : '')
    + `<optgroup label="Highest FRP in filter">${c.top.filter(i => !c.typ.includes(i)).map(opt).join('')}</optgroup>`;
  if (!all.size) { $('flPick').innerHTML = '<option>No records in this filter</option>'; return; }
  if (fireId == null) { fireId = c.typ[Math.floor(c.typ.length / 2)] ?? c.top[0]; autoBiome(); }
  if (fireId != null) $('flPick').value = fireId;
}
function render() { init(); fillPicker(); setTimeout(() => { map.invalidateSize(); if (pendingFit) fit(plumeBounds); }, 60); run(); }
function useRecord(i) { init(); fireId = i; autoBiome(); fillPicker(); run(); }

let runSeq = 0;
async function run() {
  if (fireId == null || !map) return;
  const seq = ++runSeq, f = fireInfo(fireId), v = f.v;
  $('flFire').innerHTML = [['Record', `${v.id} (${esc(v.sats)})`], ['Acquired (UTC)', v.time], ['Location', esc(H().locText(v))], ['Lat / Lon', `${f.lat.toFixed(4)}, ${f.lon.toFixed(4)}`], ['FRP used', `${f.frp.toFixed(1)} MW${f.n > 1 ? ` (sum of ${f.n} pixels)` : ''}`], ['Pixel FRP', H().frpText(v)], ['Confidence', v.conf], ['Pass', v.night ? 'Night' : 'Day'], ['Match status', v.status + (v.strength ? ` · ${v.strength}` : '')]]
    .map(([k, x]) => `<div class="detail-row"><span>${k}</span><b>${x}</b></div>`).join('');
  $('flWx').className = 'hotspot-detail'; $('flWx').innerHTML = 'Loading modelled weather…';
  let w;
  try { w = await weather(+f.lat.toFixed(3), +f.lon.toFixed(3), f.iso); } catch (e) { w = { errors: { weather: 'weather service unreachable' } }; }
  if (seq !== runSeq) return;
  const T = new Date(f.iso), hrs = w.weather ? w.weather.time : [];
  let k = hrs.findIndex(t => Math.abs(Date.parse(t + 'Z') - T) <= 30 * 60000); if (k < 0 && hrs.length) k = 0;
  const g = (n, d) => w.weather && w.weather[n] && w.weather[n][k] != null ? w.weather[n][k] : d;
  const modelled = !!w.weather && k >= 0;
  let ws = g('wind_speed_100m', null), wd = g('wind_direction_100m', null), u10 = g('wind_speed_10m', null), blh = g('boundary_layer_height', null), cloud = g('cloud_cover', 50);
  const override = $('flWindOverride').checked;
  if (override) { ws = +$('flWs').value; wd = +$('flWd').value; u10 = ws * .75; }
  if (!override && (ws == null || wd == null)) {
    $('flWx').innerHTML = `<div class="details-empty">Modelled wind is not available (${esc(Object.values(w.errors || {}).join('; ') || 'no data')}). Turn on “Override the modelled wind” to run a scenario with your own wind.</div>`;
    plumeLayer.clearLayers(); setStats(null); return;
  }
  if (!override) { $('flWs').value = Math.min(20, Math.max(.5, Math.round(ws * 2) / 2)); $('flWd').value = Math.round(wd) % 360; $('flWsV').textContent = $('flWs').value; $('flWdV').textContent = $('flWd').value; }
  const cams = w.air_quality && w.air_quality.pm2_5 ? w.air_quality.pm2_5[w.air_quality.time.findIndex(t => Math.abs(Date.parse(t + 'Z') - T) <= 30 * 60000)] : null;
  $('flWx').innerHTML = [['Hour used (UTC)', modelled ? hrs[k].replace('T', ' ') : '—'], ['Wind at 10 m', modelled ? `${sig(g('wind_speed_10m'))} m/s from ${fmt(g('wind_direction_10m'))}°` : '—'], ['Wind at 100 m', modelled ? `${sig(g('wind_speed_100m'))} m/s from ${fmt(g('wind_direction_100m'))}°` : '—'], ['Boundary layer', blh != null ? `${fmt(blh)} m` : 'not available, 1,000 m assumed'], ['Cloud cover', modelled ? `${fmt(cloud)}%` : '—'], ['Temperature / RH', modelled ? `${sig(g('temperature_2m'), 3)} °C · ${fmt(g('relative_humidity_2m'))}%` : '—']]
    .map(([a, b]) => `<div class="detail-row"><span>${a}</span><b>${b}</b></div>`).join('')
    + `<div class="panel-sub" style="margin-top:7px">${esc(w.weather_source || '')}${override ? ' · <b style="color:var(--orange)">wind overridden: scenario</b>' : ''}</div>`;
  drawChart(w, T);

  const u = Math.max(1, ws), Lmix = Math.max(100, blh ?? 1000), elev = solarElevation(f.lat, f.lon, T), cls = stability(Math.max(.5, u10 ?? u), elev, cloud ?? 50);
  const top = plumeTop(f.frp, Lmix), trap = $('flTrap').checked, share = trap ? 1 : Math.min(1, Lmix / top), he = Math.min(top, Lmix) / 2, lofted = false;
  const biome = BIOMES.find(b => b.k === $('flBiome').value), Q = f.frp * COMBUSTION * biome.ef; // g/s
  const hours = +$('flHours').value, xmax = Math.min(MAX_KM * 1000, u * hours * 3600);
  $('flStab').innerHTML = `Stability class <b>${cls}</b> (sun ${elev.toFixed(0)}° above horizon, 10 m wind ${sig(u10 ?? u)} m/s). Plume top ${fmt(top)} m (boundary layer ${fmt(Lmix)} m); ${share < 1 ? `${Math.round(100 * share)}% of the smoke stays in the boundary layer and can reach the ground` : trap && top > Lmix ? 'worst case: all smoke held in the boundary layer' : 'all smoke stays in the boundary layer'}; centre height ${fmt(he)} m. Smoke travels ${fmt(xmax / 1000)} km in ${hours} h.`;

  // centreline peak (point value)
  let cmax = 0, xAt = 0;
  for (let x = 100; x <= xmax && !lofted; x *= 1.04) { const c = conc(Q * share, u, he, Lmix, cls, x, 0, 0); if (c > cmax) { cmax = c; xAt = x; } }
  // grid over the downwind domain, aligned with the population grid
  const toward = (wd + 180) * Math.PI / 180, de = Math.sin(toward), dn = Math.cos(toward);
  const km = xmax / 1000, clat = Math.cos(f.lat * Math.PI / 180);
  const ends = [[0, 0], [dn * km, de * km]];
  const spread = Math.max(5, km * .35);
  let s = Math.min(...ends.map(e => e[0])) - spread, n = Math.max(...ends.map(e => e[0])) + spread, wv = Math.min(...ends.map(e => e[1])) - spread, ev = Math.max(...ends.map(e => e[1])) + spread;
  const bbox = [f.lon + wv / (111.195 * clat), f.lat + s / 111.195, f.lon + ev / (111.195 * clat), f.lat + n / 111.195].map((x, j) => j % 2 ? Math.max(-89.9, Math.min(89.9, x)) : Math.max(-179.99, Math.min(179.99, x)));
  let pop = null, popErr = null;
  try { pop = await population(bbox); } catch (e) { popErr = e.message; }
  if (seq !== runSeq) return;
  const grid = pop && pop.rows ? pop : { west: Math.floor(bbox[0] / CELL) * CELL, north: Math.ceil(bbox[3] / CELL) * CELL, dx: CELL, dy: CELL, cols: Math.ceil((bbox[2] - bbox[0]) / CELL) + 1, rows: Math.ceil((bbox[3] - bbox[1]) / CELL) + 1, values: null };
  const area = new Array(BANDS.length).fill(0), people = new Array(BANDS.length).fill(0);
  plumeLayer.clearLayers();
  const cellsDrawn = [];
  for (let r = 0; r < grid.rows; r++) {
    const la = grid.north - (r + .5) * grid.dy, cl = Math.cos(la * Math.PI / 180), ca = grid.dx * 111.195 * cl * grid.dy * 111.195;
    for (let c = 0; c < grid.cols; c++) {
      const lo = grid.west + (c + .5) * grid.dx, e = (lo - f.lon) * 111.195 * cl * 1000, nn = (la - f.lat) * 111.195 * 1000;
      const x = e * de + nn * dn, y = e * dn - nn * de;
      if (lofted || x <= 0 || x > xmax) continue;
      const C = conc(Q * share, u, he, Lmix, cls, x, y, Math.sqrt(ca) * 1000);
      if (C < BANDS[0]) continue;
      let b = 0; while (b + 1 < BANDS.length && C >= BANDS[b + 1]) b++;
      for (let j = 0; j <= b; j++) { area[j] += ca; if (grid.values) people[j] += grid.values[r * grid.cols + c]; }
      cellsDrawn.push([la, lo, b, C]);
    }
  }
  // 1 µg/m³ envelope of the point (centreline) field: a fixed-width outline that stays visible at every zoom
  const env = [[], []];
  for (let x = 100; x <= xmax; x *= 1.06) {
    const cc = conc(Q * share, u, he, Lmix, cls, x, 0, 0); if (cc <= BANDS[0]) continue;
    const half = SIG[cls](x)[0] * Math.sqrt(2 * Math.log(cc / BANDS[0]));
    for (const [side, sgn] of [[0, 1], [1, -1]]) { const e = x * de + sgn * half * dn, nn = x * dn - sgn * half * de; env[side].push([f.lat + nn / 111195, f.lon + e / (111195 * clat)]); }
  }
  const rend = L.canvas({ padding: .2 });
  cellsDrawn.forEach(([la, lo, b, C]) => L.rectangle([[la - grid.dy / 2, lo - grid.dx / 2], [la + grid.dy / 2, lo + grid.dx / 2]], { renderer: rend, stroke: false, fillColor: BAND_COL[b], fillOpacity: .55 }).bindTooltip(`Scenario · ${sig(C)} µg/m³ added (hourly mean, cell average)${grid.values ? ` · ${fmt(grid.values[Math.round((grid.north - la) / grid.dy - .5) * grid.cols + Math.round((lo - grid.west) / grid.dx - .5)])} residents` : ''}`, { sticky: true }).addTo(plumeLayer));
  L.polyline([[f.lat, f.lon], [f.lat + dn * km / 111.195, f.lon + de * km / (111.195 * clat)]], { color: '#21d9ee', weight: 2, dashArray: '6 6' }).bindTooltip(`Wind toward ${fmt((wd + 180) % 360)}° at ${sig(u)} m/s (${override ? 'scenario' : 'modelled'})`).addTo(plumeLayer);
  if (env[0].length > 1) L.polygon([[f.lat, f.lon], ...env[0], ...env[1].reverse()], { color: '#ff7a3d', weight: 2, dashArray: '5 4', fill: false, interactive: false }).addTo(plumeLayer);
  const peakTxt = cmax >= .1 ? `peak ${sig(cmax)} µg/m³` : 'peak < 0.1 µg/m³';
  const popTxt = grid.values ? `${fmt(people[2])} people ≥ 15 µg/m³` : 'population: needs server';
  const icon = L.divIcon({ className: '', iconSize: [0, 0], html: `<div class="fl-fire"><div class="arrow" style="transform:rotate(${(wd + 180) % 360}deg)"></div><div class="dot"></div><div class="lab">${esc(v.id)} · ${f.frp.toFixed(0)} MW<small>${peakTxt} · ${popTxt}</small></div></div>` });
  L.marker([f.lat, f.lon], { icon, keyboard: false, zIndexOffset: 1000 }).bindTooltip(`Observed fire · ${v.id} · ${f.frp.toFixed(1)} MW · arrow: wind toward ${fmt((wd + 180) % 360)}°`).addTo(plumeLayer);
  // bounds: the coloured area (or the plume line), and a wider regional view
  const pts = cellsDrawn.map(([la, lo]) => [la, lo]).concat(env[0], env[1], [[f.lat, f.lon], [f.lat + dn * km / 111.195, f.lon + de * km / (111.195 * clat)]]);
  plumeBounds = L.latLngBounds(pts).pad(.15);
  const span = Math.max(3, 4 * km / 111.195);
  regionBounds = L.latLngBounds([[f.lat - span, f.lon - span / clat], [f.lat + span, f.lon + span / clat]]);
  if (fittedFire !== fireId || pendingFit) { fittedFire = fireId; fit(plumeBounds); } // a new fire re-frames; slider changes keep the user's view
  $('flOverlay').innerHTML = `<b>${esc(v.id)}</b> · ${f.frp.toFixed(1)} MW · ${v.time} UTC<br>Wind ${sig(u)} m/s toward ${fmt((wd + 180) % 360)}° <span class="dtag ${override ? 'scn' : 'mod'}" style="padding:1px 5px">${override ? 'SCENARIO' : 'MODELLED'}</span><br>${share < 1 ? Math.round(100 * share) + '% of smoke in boundary layer · ' : ''}${peakTxt}<br>${popTxt} <span class="dtag scn" style="padding:1px 5px">SCENARIO</span>`;
  $('flEmpty').textContent = cellsDrawn.length ? '' : `No ground-level PM2.5 above ${BANDS[0]} µg/m³ in this scenario (peak ${cmax >= .1 ? sig(cmax) + ' µg/m³' : 'below 0.1 µg/m³'}). Try more hours, the worst case, or a larger fire.`;
  $('flMapSub').textContent = `${biome.label} · stability ${cls} · plume top ${fmt(top)} m · ${Math.round(100 * share)}% in boundary layer · lid ${fmt(Lmix)} m · ${hours} h at ${f.frp.toFixed(1)} MW`;
  setStats({ Q, hours, cmax, xAt, area, people, hasPop: !!grid.values, popErr, cams, biome, lofted });
}
function setStats(r) {
  if (!r) { ['flQ', 'flCmax', 'flPop', 'flCams'].forEach(id => { $(id).textContent = '—'; }); $('flBands').innerHTML = ''; return; }
  $('flQ').textContent = `${sig(r.Q)} g/s`; $('flQf').textContent = `${sig(r.Q * 3.6 * r.hours, 3)} kg over ${r.hours} h · EF ${r.biome.ef} ± ${r.biome.sd} g/kg`;
  $('flCmax').textContent = r.cmax >= .1 ? `${sig(r.cmax)} µg/m³` : '< 0.1 µg/m³'; $('flCmaxF').textContent = r.lofted ? 'plume rises above the boundary layer; not estimated' : r.cmax >= .1 ? `on the plume centreline ${sig(r.xAt / 1000)} km downwind (point value)` : 'below 0.1 µg/m³ at ground level';
  if (r.lofted) $('flCmax').textContent = 'Aloft';
  $('flPop').textContent = r.hasPop ? fmt(r.people[2]) : 'Needs server'; $('flPopF').textContent = r.hasPop ? `residents where added PM2.5 ≥ 15 µg/m³ · GHS-POP 2025` : (r.popErr ? 'Population request failed: ' + r.popErr : 'Start python -m hotspots.server with the GHS-POP grid');
  $('flCams').textContent = r.cams != null ? `${sig(r.cams)} µg/m³` : 'Not available'; $('flCamsF').textContent = 'CAMS model, all sources, at the overpass hour';
  $('flBands').innerHTML = BANDS.map((b, k) => `<tr><td style="text-align:left"><i style="display:inline-block;width:9px;height:9px;border-radius:2px;background:${BAND_COL[k]};margin-right:6px"></i>≥ ${b} µg/m³</td><td>${fmt(r.area[k])}</td><td>${r.hasPop ? fmt(r.people[k]) : '—'}</td></tr>`).join('');
}
function drawChart(w, T) {
  if (!window.Chart || !w.weather) return;
  const lab = w.weather.time.map(t => t.slice(5, 13).replace('T', ' ') + 'h');
  const pm = w.air_quality && w.air_quality.pm2_5 ? w.weather.time.map(t => { const j = w.air_quality.time.indexOf(t); return j >= 0 ? w.air_quality.pm2_5[j] : null; }) : [];
  const muted = getComputedStyle(document.body).getPropertyValue('--muted').trim() || '#90a9b7';
  const mark = w.weather.time.findIndex(t => Math.abs(Date.parse(t + 'Z') - T) <= 30 * 60000);
  const data = { labels: lab, datasets: [
    { label: 'Wind 100 m (m/s)', data: w.weather.wind_speed_100m, borderColor: '#21d9ee', backgroundColor: '#21d9ee', yAxisID: 'y', pointRadius: w.weather.time.map((_, j) => j === mark ? 5 : 0), borderWidth: 2, tension: 0 },
    { label: 'Wind 10 m (m/s)', data: w.weather.wind_speed_10m, borderColor: '#7fb3c4', backgroundColor: '#7fb3c4', yAxisID: 'y', pointRadius: 0, borderWidth: 1.5, tension: 0 },
    { label: 'CAMS PM2.5 (µg/m³)', data: pm, borderColor: '#ff791f', backgroundColor: '#ff791f', yAxisID: 'y2', pointRadius: w.weather.time.map((_, j) => j === mark ? 5 : 0), borderWidth: 2, tension: 0 },
  ] };
  const opts = { responsive: true, maintainAspectRatio: false, animation: false, interaction: { mode: 'index', intersect: false },
    plugins: { legend: { labels: { color: muted, boxWidth: 8, font: { size: 10 } } } },
    scales: { x: { ticks: { color: muted, font: { size: 9 }, maxTicksLimit: 8 }, grid: { color: '#29414b44' } },
      y: { position: 'left', beginAtZero: true, ticks: { color: muted, font: { size: 9 } }, title: { display: true, text: 'm/s', color: muted, font: { size: 9 } }, grid: { color: '#29414b44' } },
      y2: { position: 'right', beginAtZero: true, ticks: { color: muted, font: { size: 9 } }, title: { display: true, text: 'µg/m³', color: muted, font: { size: 9 } }, grid: { display: false } } } };
  if (chartObj) chartObj.destroy();
  chartObj = new Chart($('flChart'), { type: 'line', data, options: opts });
}
window.FIRELAB = { render, useRecord, resize: () => { if (map) { map.invalidateSize(); if (pendingFit) fit(plumeBounds); } if (chartObj) chartObj.resize(); }, _model: { conc, plumeTop, stability, BIOMES, COMBUSTION } };
})();
