/* Hot Spot Explorer. Every number shown is computed from web/app-data, built from NASA FIRMS files. */
(function () {
'use strict';
const $ = id => document.getElementById(id);
const $$ = s => [...document.querySelectorAll(s)];
const fmt = n => (n == null || !isFinite(n)) ? '—' : Math.round(n).toLocaleString('en-US');
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WINDOWS = [30, 60, 120, 180, 360];
const NO_DT = 65535;
const TYPES = { int32: Int32Array, uint32: Uint32Array, int16: Int16Array, uint16: Uint16Array, uint8: Uint8Array };
const GLOBE_MAX = 3000, MARKER_MAX = 1500;

const toast = msg => { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 3500); };

/* ---------- Data loading ---------- */
async function readAll(url, onProgress) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(url + ' HTTP ' + res.status);
  const total = +res.headers.get('content-length') || 0;
  const reader = res.body.getReader();
  const parts = []; let got = 0;
  for (;;) { const { done, value } = await reader.read(); if (done) break; parts.push(value); got += value.length; if (onProgress) onProgress(got, total); }
  const buf = new Uint8Array(got); let o = 0; for (const p of parts) { buf.set(p, o); o += p.length; }
  return buf;
}
async function gunzipIfNeeded(buf) {
  if (buf[0] !== 0x1f || buf[1] !== 0x8b) return buf;  // a server may already have decoded it
  const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
async function jsonGz(url) { return JSON.parse(new TextDecoder().decode(await gunzipIfNeeded(await readAll(url)))); }

let META, R, HIST = null, DRIFT = null, N, NM;
let CONTROL = null, SERVER = null, DAILY_YEARS = [];
async function serverStatus() { // the API server is optional: the static bundle works without it
  try {
    const c = new AbortController(), tm = setTimeout(() => c.abort(), 4000);
    const r = await fetch('api/status', { signal: c.signal }); clearTimeout(tm);
    if (!r.ok || !(r.headers.get('content-type') || '').includes('json')) return null;
    return await r.json();
  } catch (e) { return null; }
}
async function loadAll() {
  META = await (await fetch('app-data/meta.json')).json();
  const buf = await gunzipIfNeeded(await readAll('app-data/records.bin.gz', (g, t) => {
    if (t) $('loadBar').style.width = Math.min(100, 100 * g / t) + '%';
    $('loadTxt').textContent = (g / 1e6).toFixed(1) + (t ? ' of ' + (t / 1e6).toFixed(1) : '') + ' MB';
  }));
  $('loadTxt').textContent = 'Preparing ' + fmt(META.n) + ' records…';
  await new Promise(r => setTimeout(r, 20));
  R = {};
  for (const c of META.columns) R[c.name] = new TYPES[c.type](buf.buffer, buf.byteOffset + c.offset, META.n);
  N = META.n; NM = META.n_modis;
  T0 = Date.parse(META.t0);
  try { HIST = await jsonGz('app-data/history.json.gz'); } catch (e) { HIST = null; console.warn('archive summary unavailable', e); }
  try { DRIFT = await (await fetch('app-data/drift.json')).json(); } catch (e) { DRIFT = null; }
  try { CONTROL = await (await fetch('app-data/control.json')).json(); } catch (e) { CONTROL = null; }
  try { DAILY_YEARS = (await (await fetch('app-data/daily/index.json')).json()).years || []; } catch (e) { DAILY_YEARS = []; }
  SERVER = await serverStatus();
}
let T0 = 0;

/* ---------- Shared filter state ---------- */
const S = { region: 'Global', sensor: 'Harmonized', from: 0, to: 0, window: 180, period: null, status: 'All match statuses', search: '', page: 0, baseline: '2003-2025', calFrom: 2000, calTo: 2026 };
const dirty = new Set();
let currentPage = 'overview';
let regionMember = null;  // Uint8Array over country index + 1
let harm, modisMatched, gLat, gLon, gVFrp, gCount, gSats, gDt, gConf, vStr, vAmb, gStr, gAmb;
/* Match strength rules, mirrored from src/hotspots/harmonize.py. A label for how direct the evidence is, not a probability. */
const SAME_PASS = 30, NEAR = 120, AMBIG = 15, STR = [null, 'strong', 'moderate', 'weak'];
const satOn = [1, 1, 1, 1, 1];
let inFilter, stats = null, cellCache = {};

const recordsPeriod = () => { // A month covered only by the archive has no bundled records
  if (!S.period) return false;
  return !META.days.some(d => d.slice(0, 7) === S.period);
};
const histMode = recordsPeriod;

function buildRegionMember() {
  const n = META.countries.length;
  regionMember = new Uint8Array(n + 1);
  if (S.region === 'Global') { regionMember.fill(1); return; }
  for (let i = 0; i < n; i++) if (META.countries[i] === S.region || META.continents[i] === S.region) regionMember[i + 1] = 1;
}

/* Re-evaluate cross-sensor status for a time window. No new matching: each VIIRS pixel keeps its best candidate. */
function applyWindow() {
  const w = S.window;
  modisMatched = new Uint8Array(NM);
  gLat = new Float32Array(NM); gLon = new Float32Array(NM); gCount = new Uint16Array(NM); gSats = new Uint8Array(NM); gDt = new Uint16Array(NM).fill(NO_DT); gConf = new Uint8Array(NM);
  const wsum = new Float32Array(NM), satFrp = new Float32Array(NM * 3);
  harm = new Uint8Array(N);
  harm.fill(1, 0, NM);
  vStr = new Uint8Array(N); vAmb = new Uint8Array(N); gStr = new Uint8Array(NM); gAmb = new Uint8Array(NM);
  const { mi, dt, frp, lat, lon, sat } = R, hasV2 = !!R.dist;
  for (let i = NM; i < N; i++) {
    if (dt[i] <= w) {
      const m = mi[i], f = Math.max(frp[i], 1);
      if (hasV2) {
        const core = R.dist[i] <= 0.5 * Math.min(R.scan[m], R.track[m]);
        const amb = R.dt2[i] <= w && R.dt2[i] - dt[i] <= AMBIG;
        const st = dt[i] <= SAME_PASS && core && !amb ? 1 : (dt[i] <= SAME_PASS || (dt[i] <= NEAR && core && !amb)) ? 2 : 3;
        vStr[i] = st; vAmb[i] = amb ? 1 : 0;
        if (!gStr[m] || st < gStr[m]) gStr[m] = st;
        if (amb) gAmb[m] = 1;
      }
      modisMatched[m] = 1; gLat[m] += lat[i] * f; gLon[m] += lon[i] * f; wsum[m] += f; gCount[m]++;
      gSats[m] |= 1 << (sat[i] - 2); satFrp[m * 3 + sat[i] - 2] += frp[i];
      if (dt[i] < gDt[m]) gDt[m] = dt[i];
      if (R.conf[i] > gConf[m]) gConf[m] = R.conf[i];
    } else harm[i] = 1;
  }
  gVFrp = new Float32Array(NM);
  for (let m = 0; m < NM; m++) if (modisMatched[m]) {
    gLat[m] /= wsum[m]; gLon[m] /= wsum[m];
    gVFrp[m] = Math.max(satFrp[m * 3], satFrp[m * 3 + 1], satFrp[m * 3 + 2]);  // repeat passes are never added together
  }
}

/* One pass over all records for the current filter. */
function applyFilter() {
  const { t, country } = R;
  const lo = S.from * 1440, hi = (S.to + 1) * 1440;
  inFilter = new Uint8Array(N);
  const days = META.days.length;
  const s = { m: 0, v: 0, mm: 0, mv: 0, mo: 0, vo: 0, h: 0, str: [0, 0, 0, 0], amb: 0, gap: new Uint32Array(5 * 2 * 24), gaps: [], dayM: new Uint32Array(days), dayV: new Uint32Array(days), dayH: new Uint32Array(days), dayMM: new Uint32Array(days), dayMV: new Uint32Array(days), byCountry: new Uint32Array(META.countries.length + 1) };
  for (let i = 0; i < N; i++) {
    const tt = t[i];
    if (tt < lo || tt >= hi || !regionMember[country[i] + 1]) continue;
    inFilter[i] = 1;
    const d = tt / 1440 | 0;
    if (i < NM) {
      s.m++; s.dayM[d]++; s.h++; s.dayH[d]++; s.byCountry[country[i] + 1]++;
      if (modisMatched[i]) { s.mm++; s.dayMM[d]++; } else s.mo++;
    } else {
      s.v++; s.dayV[d]++;
      if (harm[i]) { s.vo++; s.h++; s.dayH[d]++; s.byCountry[country[i] + 1]++; } else {
        s.mv++; s.dayMV[d]++; s.str[vStr[i]]++; if (vAmb[i]) s.amb++;
        const g = R.dt[i]; s.gap[(R.sat[i] * 2 + R.sat[R.mi[i]]) * 24 + Math.min(23, g / 15 | 0)]++; if (s.gaps.length < 200000) s.gaps.push(g);
      }
    }
  }
  stats = s;
}

function changed(what) {
  if (what.window) applyWindow();
  if (what.window || what.filter) applyFilter();
  ['overview', 'map', 'harmonization', 'calendar', 'history', 'data'].forEach(p => dirty.add(p));
  renderFilterChips(); syncControls();
  renderCurrent();
}

/* ---------- Record access ---------- */
const satName = i => META.sat_names[R.sat[i]];
function statusOf(i) { if (i < NM) return modisMatched[i] ? 'Matched' : 'MODIS Only'; return harm[i] ? 'VIIRS Only' : 'Matched'; }
const strengthOf = i => STR[i < NM ? gStr[i] : vStr[i]] || null;
const ambOf = i => !!(i < NM ? gAmb[i] : vAmb[i]);
const hsId = i => i < NM ? 'HS-M' + String(i).padStart(6, '0') : 'HS-V' + String(i - NM).padStart(7, '0');
function isoTime(i) { return new Date(T0 + R.t[i] * 60000).toISOString().slice(0, 16).replace('T', ' '); }
const confText = i => i < NM ? R.conf[i] + '%' : ({ 200: 'low', 201: 'nominal', 202: 'high' }[R.conf[i]] || 'n/a');
function hav(a1, o1, a2, o2) { const r = Math.PI / 180, x = Math.sin((a2 - a1) * r / 2) ** 2 + Math.cos(a1 * r) * Math.cos(a2 * r) * Math.sin((o2 - o1) * r / 2) ** 2; return 12742 * Math.asin(Math.sqrt(x)); }
function recordView(i, asHarmonized) {
  const raw = !asHarmonized;
  const isM = i < NM, matched = statusOf(i) === 'Matched';
  const groupLoc = !raw && isM && modisMatched[i];
  const lat = groupLoc ? gLat[i] / 1e5 : R.lat[i] / 1e5, lon = groupLoc ? gLon[i] / 1e5 : R.lon[i] / 1e5;
  const p = R.place[i], pl = META.places, km = hav(lat, lon, pl.lat[p], pl.lon[p]);
  const c = R.country[i];
  const sensor = !raw && matched && isM ? 'MODIS + VIIRS' : isM ? 'MODIS' : 'VIIRS';
  let sats = satName(i);
  if (!raw && matched && isM) { const l = []; for (let k = 0; k < 3; k++) if (gSats[i] >> k & 1) l.push(META.sat_names[k + 2]); sats = satName(i) + ' + ' + l.join(', '); }
  return {
    i, id: hsId(i), lat, lon, sensor, sats, status: statusOf(i), time: isoTime(i),
    frpM: isM ? R.frp[i] / 100 : null,
    frpV: isM ? ((!raw && matched) ? gVFrp[i] / 100 : null) : R.frp[i] / 100,
    conf: !raw && matched && isM ? `MODIS ${R.conf[i]}% · VIIRS best ${({ 200: 'low', 201: 'nominal', 202: 'high' })[gConf[i]]}` : confText(i), place: pl.name[p], placeCountry: pl.country[p], km, country: c >= 0 ? META.countries[c] : null,
    count: isM && !raw ? gCount[i] : 0, dt: isM && !raw && matched ? gDt[i] : (!isM && R.dt[i] <= S.window ? R.dt[i] : null),
    night: !!R.night[i], scan: R.scan[i] / 100, track: R.track[i] / 100,
    strength: strengthOf(i), amb: ambOf(i),
    distKm: !isM && R.dist && R.dt[i] <= S.window ? R.dist[i] / 100 : null,
    rivalDt: !isM && R.dt2 && R.dt[i] <= S.window && R.dt2[i] !== NO_DT ? R.dt2[i] : null,
    nCand: !isM && R.nc && R.dt[i] <= S.window ? R.nc[i] : null,
  };
}
const frpText = v => v.frpM != null && v.frpV != null ? `MODIS ${v.frpM.toFixed(1)} · VIIRS ${v.frpV.toFixed(1)} MW` : `${(v.frpM ?? v.frpV ?? 0).toFixed(1)} MW`;
const locText = v => `${v.km < 300 ? 'near ' : ''}${v.place}${v.placeCountry ? ', ' + v.placeCountry : ''} (${Math.round(v.km)} km)`;
const badge = s => `<span class="badge ${s === 'Matched' ? 'match' : s === 'MODIS Only' ? 'modis' : 'viirs'}">${s}</span>`;
const strBadge = v => v.strength ? `<span class="badge ${v.strength}">${v.strength}</span>${v.amb ? ' <span class="badge amb">ambiguous</span>' : ''}` : '';
function tipHTML(v) {
  return `<div class="hs-tip"><b class="t">🔥 ${v.id}</b><hr><div><b>Location:</b> ${esc(locText(v))}</div><div><b>Lat/Lon:</b> ${v.lat.toFixed(4)}, ${v.lon.toFixed(4)}</div><div><b>Sensor:</b> ${v.sensor} <small>(${esc(v.sats)})</small></div><div><b>Acquired:</b> ${v.time} UTC</div><div><b>FRP:</b> ${frpText(v)}</div><div><b>Confidence:</b> ${v.conf}</div><div><b>Status:</b> ${v.status}${v.strength ? ` (${v.strength}${v.amb ? ', ambiguous' : ''})` : ''}${v.count ? ` · ${v.count} VIIRS pixels, closest ${v.dt} min` : ''}</div></div>`;
}
let selected = null;
/* One record, summary first; technical fields and provenance one click away. Empty fields are left out. */
function detailHTML(v, i, withMap) {
  const row = ([k, x]) => `<div class="detail-row"><span>${k}</span><b>${x}</b></div>`;
  const key = [['Sensor', `${v.sensor} <small>${esc(v.sats)}</small>`], ['Acquired', `<span class="mono">${v.time}</span> UTC`], ['Fire radiative power', frpText(v)], ['Confidence', v.conf]];
  const tech = [['Latitude', v.lat.toFixed(4) + '°'], ['Longitude', v.lon.toFixed(4) + '°'], ['Country', esc(v.country || 'Offshore / unassigned')], ['Pass', v.night ? 'Night' : 'Day'],
    v.dt != null ? ['Closest time gap', v.dt + ' min'] : null, v.distKm != null ? ['Centre distance', v.distKm.toFixed(2) + ' km'] : null,
    v.nCand != null ? ['MODIS candidates', v.nCand] : null, v.rivalDt != null ? ['Rival candidate', `Δt ${v.rivalDt} min`] : null,
    v.count ? ['VIIRS pixels in group', v.count] : null, ['Pixel footprint', `${v.scan.toFixed(2)} × ${v.track.toFixed(2)} km`], ['Product', i < NM ? 'MODIS C6.1 NRT' : 'VIIRS 375 m NRT']].filter(Boolean);
  return `<div class="rec-head"><span class="rec-id mono">${v.id}</span><span class="dtag obs">OBSERVED</span></div>`
    + `<div class="rec-status">${badge(v.status)} ${strBadge(v)}</div>`
    + `<div class="rec-loc">${esc(locText(v))}</div>`
    + `<div class="kv">${key.map(([k, x]) => `<div><span>${k}</span><b>${x}</b></div>`).join('')}</div>`
    + `<details class="adv"><summary>Technical details &amp; provenance</summary>${tech.map(row).join('')}<p class="hint">Hotspot ID assigned by this project; FIRMS records carry none. A match is a candidate link, not proof of one physical fire.</p></details>`
    + `<div class="rec-actions">${withMap ? '<button class="ghost-btn" data-act="map">Show on map</button>' : ''}${v.status === 'Matched' ? '<button class="ghost-btn" data-act="inspect">Why this match?</button>' : ''}<button class="primary-btn fire" data-act="firelab">Simulate smoke in FIRELAB</button></div>`;
}
function bindDetail(root, i, asHarm) {
  root.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', () => {
    const a = b.dataset.act;
    if (a === 'firelab') location.href = 'firelab.html?fire=' + hsId(i);
    else if (a === 'inspect') { if (window.UI) UI.close('recDrawer'); inspectId = i < NM ? i : R.mi[i]; goPage('harmonization'); }
    else if (a === 'map') { if (window.UI) UI.close('recDrawer'); const v = recordView(i, asHarm); goPage('map'); setTimeout(() => { flyTo(v.lat, v.lon, 9); selectRecord(i, asHarm); }, 120); }
  }));
}
function selectRecord(i, asHarm) {
  selected = { i, asHarm };
  const v = recordView(i, asHarm);
  $('selectionBadge').textContent = v.id;
  const d = $('hotspotDetails'); d.className = 'hotspot-detail';
  d.innerHTML = detailHTML(v, i, false);
  bindDetail(d, i, asHarm);
  if (window.UI) UI.mapPanel('details', true);
}
function openRecord(i, asHarm) {
  const v = recordView(i, asHarm);
  $('recTitle').textContent = v.id; $('recBody').innerHTML = detailHTML(v, i, true);
  bindDetail($('recBody'), i, asHarm);
  if (window.UI) UI.open('recDrawer');
}

/* ---------- Basemaps ---------- */
const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/';
function baseLayer(mode) {
  const t = (svc, attribution, o = {}) => L.tileLayer(ESRI + svc + '/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, maxNativeZoom: 17, attribution, ...o });
  if (mode === 'normal') return t('World_Street_Map', 'Tiles © Esri — World Street Map', { maxNativeZoom: 18 });
  if (mode === 'terrain') return t('World_Topo_Map', 'Tiles © Esri — World Topographic Map', { maxNativeZoom: 18 });
  const img = t('World_Imagery', 'Imagery © Esri and its contributors');
  if (mode === 'satellite') return img;
  return L.layerGroup([img, t('Reference/World_Boundaries_and_Places', 'Labels © Esri')]);  // hybrid: imagery plus labels
}
function watchTiles(layer, label, onFail) {
  let errors = 0, loads = 0, gaveUp = false;
  const tiles = layer.getLayers ? layer.getLayers() : [layer];
  tiles.forEach(tl => {
    tl.on('tileload', () => { loads++; });
    tl.on('tileerror', () => {
      errors++;
      if (!gaveUp && errors >= 8 && errors > loads) { gaveUp = true; onFail(label); }  // stop requesting a failing provider
    });
  });
}

let ovMap, exMap, ovLayer, exLayer, ovBase, exBase, currentMode = 'satellite', globe = null, globeMode = false, rotating = true, canvasR;
const LABELS = { normal: 'Normal', satellite: 'Satellite', hybrid: 'Hybrid', terrain: 'Terrain' };
function setBasemap(mode) {
  currentMode = mode;
  if (exBase) exMap.removeLayer(exBase);
  exBase = baseLayer(mode);
  $('basemapMsg').classList.remove('show');
  watchTiles(exBase, LABELS[mode], label => {
    exMap.removeLayer(exBase);
    const m = $('basemapMsg'); m.textContent = `The ${label} basemap could not load, so it has been turned off. This is a map tile problem: the hotspot data below is unaffected. Try another map style or check your connection.`; m.classList.add('show');
  });
  exBase.addTo(exMap);
  $('currentMode').textContent = LABELS[mode];
  $$('#mapModeButtons [data-mode]').forEach(b => b.classList.toggle('active', b.dataset.mode === mode && !globeMode));
}

/* ---------- 2D hotspots: grid clustering over typed arrays ---------- */
const layers = { harm: true, modis: false, viirs: false };
function visibleTest() {
  const l = layers;
  return i => satOn[R.sat[i]] && ((l.harm && harm[i]) || (i < NM ? l.modis : l.viirs));
}
const mercY = (lat, scale) => { const s = Math.sin(lat * Math.PI / 180); return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * scale; };
const short = n => n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e4 ? Math.round(n / 1e3) + 'k' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(n);
const markerColor = (i, asHarm) => {
  const mode = $('markerMode').value;
  if (mode === 'red') return '#ff493f';
  if (mode === 'strength') { const s = strengthOf(i); return s === 'strong' ? '#27dfae' : s === 'moderate' ? '#21d9ee' : s === 'weak' ? '#ffd34d' : '#5d7480'; }
  const st = statusOf(i); return st === 'Matched' ? '#27dfae' : st === 'MODIS Only' ? '#ffd34d' : '#a783ff';
};
function drawRecords(map, group, cellPx, compact) {
  group.clearLayers();
  const b = map.getBounds(), z = map.getZoom(), scale = 256 * 2 ** z;
  const wide = b.getEast() - b.getWest() >= 360;
  const west = L.Util.wrapNum(b.getWest(), [-180, 180], true) * 1e5, east = L.Util.wrapNum(b.getEast(), [-180, 180], true) * 1e5;
  const south = b.getSouth() * 1e5, north = b.getNorth() * 1e5;
  const inLon = wide ? () => true : west <= east ? (x => x >= west && x <= east) : (x => x >= west || x <= east);
  const { lat, lon, frp } = R, vis = visibleTest();
  const ids = [];
  let total = 0;
  const bins = new Map();
  for (let i = 0; i < N; i++) {
    if (!inFilter[i] || !vis(i)) continue;
    const la = lat[i], lo = lon[i];
    if (la < south || la > north || !inLon(lo)) continue;
    total++;
    if (ids.length <= MARKER_MAX) ids.push(i);
    const key = Math.floor((lo / 1e5 + 180) / 360 * scale / cellPx) * 1e6 + Math.floor(mercY(la / 1e5, scale) / cellPx);
    let c = bins.get(key);
    if (!c) { c = { n: 0, la: 0, lo: 0, top: i }; bins.set(key, c); }
    c.n++; c.la += la; c.lo += lo; if (frp[i] > frp[c.top]) c.top = i;
  }
  if (!compact && total <= MARKER_MAX) {
    ids.forEach(i => {
      const asHarm = !!harm[i] && layers.harm;
      const v = recordView(i, asHarm);
      const color = markerColor(i);
      L.circleMarker([v.lat, v.lon], { renderer: canvasR, radius: 6, weight: 1.5, color: '#ffe4de', fillColor: color, fillOpacity: .95 })
        .bindTooltip(tipHTML(v), { direction: 'top', sticky: true })
        .on('click', () => selectRecord(i, asHarm))
        .addTo(group);
    });
  } else {
    bins.forEach(c => {
      const size = compact ? Math.min(22, 7 + 2.2 * Math.log10(c.n + 1) * 2) : Math.min(46, 18 + 5 * Math.log10(c.n));
      const v = recordView(c.top, !!harm[c.top]);
      const icon = L.divIcon({ className: '', html: `<div class="cluster${compact ? ' dot' : ''}" style="width:${size}px;height:${size}px">${compact ? '' : short(c.n)}</div>`, iconSize: [size, size], iconAnchor: [size / 2, size / 2] });
      const pos = [c.la / c.n / 1e5, c.lo / c.n / 1e5];
      const tip = `<div class="hs-tip"><b class="t">🔥 ${fmt(c.n)} records in this cluster</b><hr><div><b>Strongest:</b> ${v.id}</div><div><b>Location:</b> ${esc(locText(v))}</div><div><b>FRP:</b> ${frpText(v)}</div><div><b>Acquired:</b> ${v.time} UTC</div><small>${compact ? 'Click to open in Map Explorer' : 'Click to zoom in'}</small></div>`;
      L.marker(pos, { icon, keyboard: false }).bindTooltip(tip, { direction: 'top' }).on('click', () => {
        if (compact) { goPage('map'); setTimeout(() => flyTo(pos[0], pos[1], Math.max(4, map.getZoom() + 3)), 150); }
        else map.setView(pos, Math.min(map.getZoom() + 2, 12));
      }).addTo(group);
    });
  }
  return total;
}
/* Months with no bundled records: show the archive's real 1 degree monthly totals instead. */
async function monthCells() {
  const y = S.period.slice(0, 4);
  if (!cellCache[y]) cellCache[y] = await jsonGz(`app-data/cells/${y}.json.gz`);
  const m = +S.period.slice(5, 7) - 1, c = cellCache[y];
  const agg = new Map();
  for (const r of c.rows) {
    if (r[0] !== m || !regionMember[r[3] + 1]) continue;
    const k = r[1] * 1000 + r[2];
    let a = agg.get(k); if (!a) { a = { la: r[1], lo: r[2], m: 0, v: 0, h: 0, top: r[3], topn: 0 }; agg.set(k, a); }
    a.m += r[4]; a.v += r[5]; a.h += r[6];
    if (r[6] + r[4] > a.topn) { a.topn = r[6] + r[4]; a.top = r[3]; }
  }
  const out = [...agg.values()], r = H();
  if (r && r.v[monthIdx(S.period)] == null) out.forEach(a => { a.v = a.h = null; }); // VIIRS not observed: no data, not zero
  return out;
}
const cellMetric = c => S.sensor === 'MODIS' ? c.m : S.sensor === 'VIIRS' ? c.v : c.h;
function monthLabel(p) { return MONTHS[+p.slice(5, 7) - 1] + ' ' + p.slice(0, 4); }
async function drawCells(map, group, compact) {
  const cells = (await monthCells()).filter(c => cellMetric(c) > 0);
  group.clearLayers();
  const mx = Math.max(1, ...cells.map(cellMetric));
  cells.forEach(c => {
    const n = cellMetric(c), name = c.top >= 0 ? META.countries[c.top] : 'Offshore / unassigned';
    L.circleMarker([c.la + .5, c.lo + .5], { renderer: canvasR, radius: (compact ? 2 : 3) + (compact ? 7 : 12) * Math.sqrt(n / mx), weight: 1, color: '#ffe4de', fillColor: '#ff493f', fillOpacity: .85 })
      .bindTooltip(`<div class="hs-tip"><b class="t">${monthLabel(S.period)} · 1° cell</b><hr><div><b>Location:</b> ${c.la}° to ${c.la + 1}°, ${c.lo}° to ${c.lo + 1}°, mainly ${esc(name)}</div><div><b>MODIS:</b> ${fmt(c.m)} detections</div><div><b>VIIRS (S-NPP):</b> ${c.v || c.v === 0 ? fmt(c.v) : 'no data'}</div><div><b>Harmonized:</b> ${fmt(c.h)}</div><small>Monthly archive total. Individual records are bundled only for ${META.days[0]} to ${META.days.at(-1)}.</small></div>`, { sticky: true })
      .addTo(group);
  });
  return cells.reduce((s, c) => s + cellMetric(c), 0);
}

async function renderOverviewMap() {
  if (!ovMap) return;
  if (histMode()) await drawCells(ovMap, ovLayer, true);
  else drawRecords(ovMap, ovLayer, 32, true);
}
async function renderExplorer() {
  if (!exMap) return;
  const hist = histMode();
  const total = hist ? await drawCells(exMap, exLayer, false) : drawRecords(exMap, exLayer, 62, false);
  $('visibleLabel').textContent = hist ? `${S.sensor} detections, ${monthLabel(S.period)}` : 'Records in view';
  $('visiblePoints').textContent = fmt(total);
  $('activeLayers').textContent = Object.values(layers).filter(Boolean).length;
  $('mapDataTag').textContent = hist ? 'MONTHLY ARCHIVE · 1° CELLS' : 'FIRMS RECORDS';
  if (globeMode) updateGlobe();
}

/* ---------- 3D globe ---------- */
function topRecords(limit) {
  const vis = visibleTest(), { frp } = R;
  const hist = new Uint32Array(2048);
  let n = 0;
  const bucket = f => Math.min(2047, Math.round(Math.log2(1 + f) * 80));
  for (let i = 0; i < N; i++) if (inFilter[i] && vis(i)) { hist[bucket(frp[i])]++; n++; }
  let cum = 0, cut = 0;
  for (let b = 2047; b >= 0; b--) { cum += hist[b]; if (cum >= limit) { cut = b; break; } }
  const out = [];
  for (let i = 0; i < N && out.length < limit; i++) if (inFilter[i] && vis(i) && bucket(frp[i]) >= cut) out.push(i);
  return { ids: out, total: n };
}
async function updateGlobe() {
  if (!globe) return;
  if (histMode()) {
    const cells = (await monthCells()).filter(c => cellMetric(c) > 0).sort((a, b) => cellMetric(b) - cellMetric(a)).slice(0, GLOBE_MAX);
    const mx = Math.max(1, ...cells.map(cellMetric));
    globe.pointsData(cells.map(c => ({ lat: c.la + .5, lon: c.lo + .5, r: .12 + .5 * Math.sqrt(cellMetric(c) / mx), color: '#ff493f', label: `<div class="hs-tip" style="background:#fff;padding:9px 11px;border-radius:9px"><b class="t">${monthLabel(S.period)} · 1° cell</b><hr><div><b>Location:</b> ${c.la}°, ${c.lo}°, mainly ${esc(c.top >= 0 ? META.countries[c.top] : 'Offshore / unassigned')}</div><div><b>MODIS:</b> ${fmt(c.m)} · <b>VIIRS:</b> ${fmt(c.v)}</div><div><b>Harmonized:</b> ${fmt(c.h)}</div></div>` })));
    $('globeNote').textContent = `${monthLabel(S.period)}: monthly 1° totals from the archive.`;
    return;
  }
  const { ids, total } = topRecords(GLOBE_MAX);
  globe.pointsData(ids.map(i => { const asH = !!harm[i] && layers.harm, v = recordView(i, asH); return { i, asH, lat: v.lat, lon: v.lon, r: statusOf(i) === 'Matched' ? .26 : .18, color: markerColor(i), v }; }));
  $('globeNote').textContent = `Showing the ${fmt(ids.length)} highest-FRP of ${fmt(total)} records in this filter, so the globe stays responsive.`;
}
function ensureGlobe() {
  if (globe || !window.Globe) { if (!window.Globe) toast('The 3D globe library could not load. The 2D map still works.'); return !!globe; }
  const el = $('globeContainer'), IMG = 'https://cdn.jsdelivr.net/npm/three-globe@2.45.0/example/img/';
  globe = window.Globe()(el)
    .globeImageUrl(IMG + 'earth-blue-marble.jpg').bumpImageUrl(IMG + 'earth-topology.png').backgroundImageUrl(IMG + 'night-sky.png')
    .showAtmosphere(true).atmosphereColor('#2bd9ef').atmosphereAltitude(.18)
    .pointLat('lat').pointLng('lon').pointColor('color').pointRadius('r').pointAltitude(.012).pointsMerge(false)
    .pointLabel(d => d.label || `<div style="background:#fff;padding:9px 11px;border-radius:9px;box-shadow:0 8px 28px #0005">${tipHTML(d.v)}</div>`)
    .onPointHover(d => { el.style.cursor = d ? 'pointer' : 'grab'; })
    .onPointClick(d => { if (d.v) selectRecord(d.i, d.asH); setRotate(false); globe.pointOfView({ lat: d.lat, lng: d.lon, altitude: 1.2 }, 900); });
  const c = globe.controls();
  c.enableRotate = true; c.enableZoom = true; c.autoRotate = true; c.autoRotateSpeed = .35;
  c.addEventListener('start', () => setRotate(false));  // a manual drag takes control
  sizeGlobe();
  updateGlobe();
  return true;
}
function sizeGlobe() { if (globe) { const el = $('globeContainer'); globe.width(el.clientWidth).height(el.clientHeight); } }
function setRotate(on) {
  rotating = on;
  if (globe) globe.controls().autoRotate = on;
  $('rotateBtn').textContent = on ? '⏸ Stop rotation' : '⟳ Auto-rotate';
  $('rotateBtn').classList.toggle('active', on);
}
function switchGlobe(on) {
  globeMode = on;
  $('globeContainer').style.display = on ? 'block' : 'none';
  $('explorerMap').style.display = on ? 'none' : 'block';
  $('mapStage').classList.toggle('globe-on', on);
  $('globeToggle').classList.toggle('active', on);
  $$('#mapModeButtons [data-mode]').forEach(b => b.classList.toggle('active', !on && b.dataset.mode === currentMode));
  $('basemapMsg').classList.remove('show');
  if (on) { ensureGlobe(); sizeGlobe(); setRotate(true); updateGlobe(); $('currentMode').textContent = '3D Globe'; }
  else { $('currentMode').textContent = LABELS[currentMode]; setTimeout(() => { exMap.invalidateSize(); renderExplorer(); }, 60); }
}

/* ---------- Search ---------- */
function flyTo(lat, lon, zoom, label) {
  if (globeMode && globe) { setRotate(false); globe.pointOfView({ lat, lng: lon, altitude: Math.max(.2, 2.6 * .72 ** zoom) }, 1600); }
  else exMap.flyTo([lat, lon], zoom, { duration: 1.4 });
  if (label) toast('Flying to ' + label);
}
const extentZoom = e => { const span = Math.max(e.xmax - e.xmin, e.ymax - e.ymin); return Math.max(2, Math.min(11, Math.round(Math.log2(360 / Math.max(span, .05))))); };
async function searchPlace() {
  const q = $('placeSearch').value.trim();
  if (!q) { toast('Enter a country or place to search'); return; }
  try {
    const u = 'https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates?f=json&maxLocations=1&outFields=Match_addr&singleLine=' + encodeURIComponent(q);
    const d = await (await fetch(u)).json(), c = d.candidates && d.candidates[0];
    if (c && c.score >= 70) { flyTo(c.location.y, c.location.x, c.extent ? extentZoom(c.extent) : 6, c.attributes.Match_addr || c.address); return; }
  } catch (e) { /* fall through to the offline list */ }
  const pl = META.places, low = q.toLowerCase(), k = pl.name.findIndex(n => n.toLowerCase() === low);
  if (k >= 0) { flyTo(pl.lat[k], pl.lon[k], 7, pl.name[k] + ' (offline list)'); return; }
  toast('Location not found. Try a country or major city.');
}

/* ---------- Charts: created once, then updated in place ---------- */
const CH = {};
const css = v => getComputedStyle(document.body).getPropertyValue(v).trim();
function chart(id, type, labels, datasets, opts = {}) {
  const el = $(id); if (!el || !window.Chart) return null;
  const muted = css('--muted') || '#90a9b7';
  const ds = datasets.map(d => ({ label: d.label, data: d.data, borderColor: d.color, backgroundColor: d.bg || (d.fill ? d.color + '33' : d.color), borderWidth: type === 'bar' ? 0 : 2, tension: 0, fill: !!d.fill, pointRadius: d.pr ?? 2, pointHoverRadius: 5, spanGaps: false, yAxisID: d.axis || 'y' }));
  const options = {
    responsive: true, maintainAspectRatio: false, animation: false, resizeDelay: 120,
    interaction: { mode: 'index', intersect: false },
    plugins: { legend: { display: datasets.length > 1, labels: { color: muted, boxWidth: 8, font: { size: 11 } } }, tooltip: { callbacks: opts.tooltip || {} } },
    scales: {
      x: { ticks: { color: muted, font: { size: 10.5 }, maxTicksLimit: 12 }, grid: { color: '#8ca5b31a' } },
      y: { ticks: { color: muted, font: { size: 10.5 }, callback: opts.yTick || (v => short(Math.abs(v)).replace(/^/, v < 0 ? '-' : '')) }, grid: { color: '#8ca5b31a' }, beginAtZero: opts.zero !== false, title: { display: !!opts.yTitle, text: opts.yTitle || '', color: muted, font: { size: 10.5 } } },
    },
    onClick: opts.onClick || undefined,
  };
  if (CH[id] && CH[id].config.type === type) {
    const c = CH[id];
    c.data.labels = labels; c.data.datasets = ds; c.options.scales.y.ticks.color = muted; c.options.scales.x.ticks.color = muted;
    c.options.plugins.legend.labels.color = muted; c.options.plugins.legend.display = datasets.length > 1;
    c.options.onClick = options.onClick; c.options.plugins.tooltip.callbacks = options.plugins.tooltip.callbacks;
    c.options.scales.y.ticks.callback = options.scales.y.ticks.callback; c.options.scales.y.title = options.scales.y.title;
    c.update('none');
    return c;
  }
  if (CH[id]) CH[id].destroy();
  CH[id] = new Chart(el, { type, data: { labels, datasets: ds }, options });
  return CH[id];
}

/* ---------- Archive helpers ---------- */
const H = () => HIST && (HIST.regions[S.region] || null);
function hSeries(key) { // key: m, v, h monthly arrays, h derived as m + v - mv
  const r = H(); if (!r) return null;
  if (key === 'h') return r.m.map((x, i) => (x == null || r.v[i] == null) ? null : x + r.v[i] - (r.mv[i] || 0)); // needs both sensors, so it starts with VIIRS
  return r[key];
}
const sensorKey = () => S.sensor === 'MODIS' ? 'm' : S.sensor === 'VIIRS' ? 'v' : 'h';
const median = a => { const s = a.filter(x => x != null).sort((x, y) => x - y), n = s.length; return !n ? null : n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };
const daysIn = (y, m) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
function monthIdx(p) { return HIST ? HIST.months.indexOf(p) : -1; }
function baselineYears() { const [a, b] = S.baseline.split('-').map(Number); return [a, b]; }
/* Same calendar month across baseline years, restricted to months with data */
function baselineFor(key, m) {
  const s = hSeries(key); if (!s) return null;
  const [a, b] = baselineYears(), vals = [];
  HIST.months.forEach((p, i) => { const y = +p.slice(0, 4); if (+p.slice(5, 7) - 1 === m && y >= a && y <= b && s[i] != null && inCoverage(key, p)) vals.push(s[i] / daysIn(y, m)); });
  return vals.length >= 3 ? { med: median(vals), n: vals.length } : null;
}
function inCoverage(key, p) {
  const i = monthIdx(p), r = H();
  if (i < 0 || !r) return false;
  return key === 'v' ? r.v[i] != null : key === 'm' ? r.m[i] != null : r.m[i] != null && r.v[i] != null;  // null means not observed, never zero
}

const SENSOR_COL = { MODIS: '#e7c04a', VIIRS: '#a783ff', Harmonized: '#ff6b3d' }; // same identity as the map layers
const BOTH_MODIS_FROM = 2003; // Terra alone until Aqua joined in mid-2002: earlier counts are not comparable
/* Anomaly of the current selection against the MODIS archive: MODIS only, because it spans the whole baseline. */
function windowAnomaly() {
  if (!HIST || !H()) return null;
  if (histMode()) {
    if (+S.period.slice(0, 4) < BOTH_MODIS_FROM) return null;
    const i = monthIdx(S.period), s = hSeries('m'); if (i < 0 || s[i] == null) return null;
    const m = +S.period.slice(5, 7) - 1, y = +S.period.slice(0, 4), b = baselineFor('m', m); if (!b || !b.med) return null;
    return { pct: 100 * (s[i] / daysIn(y, m) / b.med - 1), label: `vs ${MONTHS[m]} ${S.baseline} median · MODIS, not drift-corrected` };
  }
  let exp = 0, days = 0;
  for (let d = S.from; d <= S.to; d++) { if (META.partial_days.includes(META.days[d])) continue; const b = baselineFor('m', +META.days[d].slice(5, 7) - 1); if (!b) return null; exp += b.med; days++; }
  if (!days || !exp) return null;
  let obs = 0; for (let d = S.from; d <= S.to; d++) if (!META.partial_days.includes(META.days[d])) obs += stats.dayM[d];
  return { pct: 100 * (obs / exp - 1), label: `${days} d vs same-month ${S.baseline} median · MODIS, not drift-corrected` };
}

/* ---------- Satellite coverage: a satellite that delivered nothing is "no data", never zero ---------- */
const satHasData = k => !META.sat_days || (META.sat_days[META.sat_names[k]] || []).length > 0;
function satList(ks) {
  const on = ks.filter(satHasData).map(k => META.sat_names[k]), off = ks.filter(k => !satHasData(k)).map(k => META.sat_names[k]);
  return (on.join(', ') || 'none') + (off.length ? ` · ${off.join(', ')}: no data` : '');
}
function missingSatDays(d) { return META.sat_days ? META.sat_names.filter((n, k) => satHasData(k) && !(META.sat_days[n] || []).includes(d)) : []; }

/* ---------- Overview ---------- */
function renderOverview() {
  const hist = histMode();
  const a = windowAnomaly();
  $('statAnomaly').classList.add('small');
  $('statAnomaly').textContent = a ? (a.pct >= 0 ? '+' : '') + a.pct.toFixed(0) + '%' : 'Not available';
  $('footAnomaly').textContent = a ? a.label : (!HIST ? 'Archive summary not loaded' : hist && +S.period.slice(0, 4) < BOTH_MODIS_FROM ? 'Not comparable: Terra alone until mid-2002' : 'Too few baseline months for this filter');
  if (hist) {
    const i = monthIdx(S.period), mS = hSeries('m'), vS = hSeries('v'), hS = hSeries('h');
    $('statModis').textContent = fmt(mS && mS[i]); $('statViirs').textContent = vS && vS[i] != null ? fmt(vS[i]) : 'No data'; $('statHarmonized').textContent = hS && hS[i] != null ? fmt(hS[i]) : 'No data';
    $('footModis').textContent = 'Raw pixels · monthly archive'; $('footViirs').textContent = vS && vS[i] != null ? 'Raw pixels · S-NPP only' : 'VIIRS S-NPP starts in 2012'; $('footHarm').textContent = hS && hS[i] != null ? `${monthLabel(S.period)}, ${HIST.window} min window` : 'Needs both sensors, so it starts in 2012';
    const y = S.period.slice(0, 4), lab = [], m = [], v = [], h = [];
    HIST.months.forEach((p, k) => { if (p.slice(0, 4) === y) { lab.push(MONTHS[+p.slice(5, 7) - 1]); m.push(mS[k]); v.push(vS[k]); h.push(hS[k]); } });
    $('dailySub').textContent = `Monthly totals, ${y} · ${S.region}`; $('dailyTag').textContent = y;
    chart('dailyChart', 'line', lab, [{ label: 'MODIS', data: m, color: '#e7c04a', fill: true }, { label: 'VIIRS S-NPP', data: v, color: '#a783ff' }, { label: 'Harmonized', data: h, color: '#ff6b3d' }]);
    $('overviewMapSub').textContent = `${monthLabel(S.period)} · 1° monthly totals from the archive`;
  } else {
    $('statModis').textContent = fmt(stats.m); $('statViirs').textContent = fmt(stats.v); $('statHarmonized').textContent = fmt(stats.h);
    $('footModis').textContent = 'Raw pixels · ' + satList([0, 1]); $('footViirs').textContent = 'Raw pixels · ' + satList([2, 3, 4]); $('footHarm').textContent = `Unique records, ${S.window} min window`;
    const idx = []; for (let d = S.from; d <= S.to; d++) idx.push(d);
    $('dailySub').textContent = `Detections per UTC day · ${S.region} · click a day to open its records`; $('dailyTag').textContent = idx.length + ' DAYS';
    const data = S.sensor === 'MODIS' ? [{ label: 'MODIS', data: idx.map(d => stats.dayM[d]), color: '#e7c04a', fill: true }] : S.sensor === 'VIIRS' ? [{ label: 'VIIRS', data: idx.map(d => stats.dayV[d]), color: '#a783ff', fill: true }] : [{ label: 'Harmonized', data: idx.map(d => stats.dayH[d]), color: '#ff6b3d', fill: true }, { label: 'VIIRS', data: idx.map(d => stats.dayV[d]), color: '#a783ff' }, { label: 'MODIS', data: idx.map(d => stats.dayM[d]), color: '#e7c04a' }];
    chart('dailyChart', 'line', idx.map(d => META.days[d].slice(5) + (META.partial_days.includes(META.days[d]) ? '*' : '')), data, {
      tooltip: { footer: items => { const d = idx[items[0].dataIndex], miss = missingSatDays(d); return (META.partial_days.includes(META.days[d]) ? 'Partial day (file cut-off)\n' : '') + (miss.length ? 'No data from ' + miss.join(', ') : ''); } },
      onClick: (e, el) => { if (el && el.length) { const d = idx[el[0].index]; S.from = S.to = d; S.period = null; S.page = 0; changed({ filter: true }); goPage('data'); } },
    });
    $('overviewMapSub').textContent = 'Clusters of harmonized records · click to open in Map Explorer';
  }
  renderInsights(hist, a);
  $('overviewNote').textContent = hist
    ? `DATA NOTICE · ${monthLabel(S.period)} comes from the FIRMS yearly archive (MODIS, S-NPP VIIRS). Monthly totals only; individual records are bundled for ${META.days[0]} to ${META.days.at(-1)}.`
    : `DATA NOTICE · ${META.source}. Downloaded ${META.generated_at.slice(0, 16).replace('T', ' ')} UTC, not a live feed. These are satellite detections, not confirmed fires, and this is not an alert service.`;
}
function renderInsights(hist, a) {
  const items = [];
  if (hist) {
    const i = monthIdx(S.period), mS = hSeries('m'), vS = hSeries('v');
    items.push(['⌖', 'Selected month', `${monthLabel(S.period)}, ${S.region}: ${fmt(mS[i])} MODIS detections${vS[i] != null ? ` and ${fmt(vS[i])} S-NPP VIIRS detections` : ''}.`]);
    if (a) items.push(['↗', 'Against baseline', `MODIS is ${Math.abs(a.pct).toFixed(0)}% ${a.pct >= 0 ? 'above' : 'below'} the ${MONTHS[+S.period.slice(5, 7) - 1]} median per day for ${S.baseline}.`]);
    items.push(['◷', 'Resolution', 'This month shows 1° totals. Record-level detail is limited to the bundled recent window.']);
  } else {
    let top = 0; for (let c = 1; c < stats.byCountry.length; c++) if (stats.byCountry[c] > stats.byCountry[top] || top === 0) top = stats.byCountry[c] ? c : top;
    if (top > 0 && stats.byCountry[top]) items.push(['↗', 'Most records', `${esc(META.countries[top - 1])}: ${fmt(stats.byCountry[top])} of ${fmt(stats.h)} harmonized records (${(100 * stats.byCountry[top] / stats.h).toFixed(0)}%) in this filter.`]);
    if (stats.m) items.push(['⌖', 'Cross-sensor matching', `${(100 * stats.mm / stats.m).toFixed(0)}% of MODIS pixels have a VIIRS candidate within ${S.window} min. Satellites pass at different times, so most pixels have none.`]);
    const off = META.sat_names.filter((n, k) => !satHasData(k));
    if (off.length) items.push(['⚠', 'Missing satellite data', `${off.join(', ')} delivered no records to FIRMS for ${META.days[0]} to ${META.days.at(-1)}. Its counts are shown as no data, not zero, and its fires cannot be matched.`]);
    let last = 0; for (let i = 0; i < NM; i++) if (R.t[i] > last) last = R.t[i];
    last = new Date(T0 + last * 60000).toISOString().slice(0, 16).replace('T', ' ');
    items.push(['◷', 'Data freshness', `Latest MODIS acquisition in this bundle: ${last} UTC. Bundle built ${META.generated_at.slice(0, 16).replace('T', ' ')} UTC${SERVER ? '; use Live FIRMS query on the map for the newest data' : ''}.`]);
  }
  $('insights').innerHTML = items.map(([ic, t, b]) => `<div class="insight"><span class="insight-icon">${ic}</span><span><b>${t}</b><br>${b}</span></div>`).join('');
}

/* ---------- Harmonization Lab ---------- */
function windowCounts(w) {
  const { dt, mi, t, country } = R, lo = S.from * 1440, hi = (S.to + 1) * 1440;
  const seen = new Uint8Array(NM); let mv = 0, v = 0;
  for (let i = NM; i < N; i++) if (dt[i] <= w) seen[mi[i]] = 1;
  let mm = 0, m = 0;
  for (let i = 0; i < NM; i++) if (t[i] >= lo && t[i] < hi && regionMember[country[i] + 1]) { m++; if (seen[i]) mm++; }
  for (let i = NM; i < N; i++) if (t[i] >= lo && t[i] < hi && regionMember[country[i] + 1]) { v++; if (dt[i] <= w) mv++; }
  return { mv, mm, m, v, h: m + v - mv };
}
function renderLab() {
  const hist = histMode();
  $('windowSel').disabled = hist;
  if (hist) {
    const i = monthIdx(S.period), r = H(), m = r.m[i] || 0, v = r.v[i] || 0, mv = r.mv[i] || 0, mm = r.mm[i] || 0;
    const noV = r.v[i] == null;
    setLab(m - mm, noV ? null : v - mv, noV ? null : mm, m, noV ? null : v, noV ? null : mm, noV ? null : mv, noV ? null : m + v - mv);
    $('labScope').textContent = monthLabel(S.period).toUpperCase() + ' · S-NPP';
    $('vennSub').textContent = `${monthLabel(S.period)} archive, MODIS vs S-NPP, ${HIST.window} min window · click a category to open its cells`;
    $('strengthBars').innerHTML = '<div class="panel-sub">Match strength needs record-level data. Clear the month filter.</div>'; $('labAmb').textContent = '—'; $('labGap').textContent = '—';
    $('inspText').innerHTML = 'The inspector needs record-level data. Clear the month filter.';
    $('winImpact').textContent = '';
    $('sensRows').innerHTML = `<tr><td colspan="5" style="text-align:left">The window comparison uses bundled records (${META.days[0]} to ${META.days.at(-1)}). Clear the month filter to use it.</td></tr>`;
    return;
  }
  setLab(stats.mo, stats.vo, stats.mm, stats.m, stats.v, stats.mm, stats.mv, stats.h);
  renderStrength(); renderGapChart(); renderInspector();
  $('labScope').textContent = `${S.window} MIN · ${S.region.toUpperCase()}`;
  $('vennSub').textContent = 'Click a category above to open those records';
  { const cur = windowCounts(S.window), ref = windowCounts(S.window === 30 ? 180 : 30); $('winImpact').innerHTML = `At <b>${S.window} min</b>, ${fmt(cur.mv)} VIIRS pixels have a MODIS candidate. At ${S.window === 30 ? 180 : 30} min it would be ${fmt(ref.mv)} (${fmt(Math.abs(cur.mv - ref.mv))} ${cur.mv >= ref.mv ? 'fewer' : 'more'}), and the harmonized count ${fmt(ref.h)} instead of ${fmt(cur.h)}.`; }
  $('sensRows').innerHTML = WINDOWS.map(w => { const c = windowCounts(w); return `<tr class="${w === S.window ? 'current' : ''}"><td>${w} min</td><td>${fmt(c.mv)}</td><td>${fmt(c.mm)}</td><td>${c.m ? (100 * c.mm / c.m).toFixed(1) + '%' : '—'}</td><td>${fmt(c.h)}</td></tr>`; }).join('');
}
function renderStrength() {
  const t = stats.str, tot = t[1] + t[2] + t[3], col = ['', '#27dfae', '#21d9ee', '#ffd34d'];
  $('strengthBars').innerHTML = !R.dist ? '<div class="panel-sub">This data bundle predates match strength. Rebuild it with python -m hotspots.refresh.</div>' : [1, 2, 3].map(k => `<div class="sbar"><span>${STR[k]}</span><span class="track"><i style="width:${tot ? 100 * t[k] / tot : 0}%;background:${col[k]}"></i></span><b>${fmt(t[k])}</b></div>`).join('');
  $('strengthTag').textContent = fmt(tot) + ' MATCHED VIIRS';
  $('labAmb').textContent = tot ? `${fmt(stats.amb)} (${(100 * stats.amb / tot).toFixed(0)}%)` : '—';
  const g = stats.gaps.slice().sort((a, b) => a - b); $('labGap').textContent = g.length ? g[g.length >> 1] + ' min' : '—';
}
function renderGapChart() {
  const labels = Array.from({ length: Math.ceil(S.window / 15) }, (_, k) => `${k * 15}–${k * 15 + 15}`), pairs = [], col = { '2,0': '#ff9b5c', '2,1': '#ff493f', '3,0': '#21d9ee', '3,1': '#2b8cff', '4,0': '#a783ff', '4,1': '#45e0a0' };
  for (const v of [2, 3, 4]) for (const m of [0, 1]) {
    const data = labels.map((_, b) => stats.gap[(v * 2 + m) * 24 + b]);
    if (data.some(x => x > 0)) pairs.push({ label: `${META.sat_names[v]} ↔ ${META.sat_names[m]}`, data, color: col[v + ',' + m], pr: 0 });
  }
  chart('gapChart', 'line', labels, pairs, { yTitle: 'matched VIIRS pixels', tooltip: { title: it => it[0].label + ' min' } });
  const aq = [3, 4].map(v => { let n = 0, w = 0; for (let b = 0; b < 24; b++) { const c = stats.gap[(v * 2 + 1) * 24 + b]; n += c; w += c * (b * 15 + 7.5); } return n ? w / n : null; }).filter(x => x != null);
  $('gapSub').textContent = `${S.region} · matched VIIRS pixels within ${S.window} min, by satellite pair · 15 min bins`;
  $('gapNote').textContent = aq.length ? `Aqua ↔ NOAA-20/21 pairs average about ${Math.round(aq.reduce((a, b) => a + b) / aq.length)} min apart. Aqua's orbit has drifted later, so the satellites no longer pass together; few pairs are within 30 min.` : 'No Aqua ↔ VIIRS matches in this filter.';
}

/* Match inspector: draw one group to scale with the criteria that decided it */
let inspMap = null, inspLayer = null, inspectId = null, inspSeq = 0;
function rectLatLngs(lat, lon, scan, track, sat, night) { // orbit-oriented pixel rectangle, as in src/hotspots/footprint.py
  const inc = 98.2 * Math.PI / 180, cl = Math.cos(lat * Math.PI / 180);
  const ascDay = sat !== 0, asc = ascDay ? !night : night;
  let az = Math.asin(Math.max(-1, Math.min(1, Math.cos(inc) / Math.max(cl, 1e-6)))); if (!asc) az = Math.PI - az;
  const ve = 6.7 * Math.sin(az) - .4651 * cl, vn = 6.7 * Math.cos(az), h = Math.atan2(ve, vn);
  const t = [Math.sin(h), Math.cos(h)], sc = [Math.cos(h), -Math.sin(h)];
  return [[1, 1], [1, -1], [-1, -1], [-1, 1]].map(([a, b]) => { const e = a * track / 2 * t[0] + b * scan / 2 * sc[0], n = a * track / 2 * t[1] + b * scan / 2 * sc[1]; return [lat + n / 111.195, lon + e / (111.195 * cl)]; });
}
function pickInspect(kind) {
  const cand = [];
  const lo = S.from * 1440, hi = (S.to + 1) * 1440;
  for (let m = 0; m < NM; m++) {
    if (!modisMatched[m] || !inFilter[m] || !satOn[R.sat[m]]) continue;
    if (kind === 'ambiguous' && !gAmb[m]) continue;
    if (kind === 'strong' && gStr[m] !== 1) continue;
    if (kind === 'weak' && gStr[m] !== 3) continue;
    cand.push(m);
  }
  if (!cand.length) return null;
  if (kind === 'frp') { cand.sort((a, b) => R.frp[b] - R.frp[a]); return cand[inspSeq % Math.min(cand.length, 50)]; }
  if (kind === 'random') return cand[Math.floor(Math.random() * cand.length)];
  return cand[(inspSeq * 7919) % cand.length];
}
function renderInspector() {
  if (!window.L) return;
  if (!inspMap) {
    inspMap = L.map('inspMap', { zoomControl: true, attributionControl: true, worldCopyJump: true }).setView([0, 0], 2);
    baseLayer('satellite').addTo(inspMap); inspLayer = L.layerGroup().addTo(inspMap);
  }
  setTimeout(() => inspMap.invalidateSize(), 50);
  let m = inspectId != null && modisMatched[inspectId] ? inspectId : pickInspect($('inspPick').value);
  inspLayer.clearLayers();
  if (m == null) { $('inspText').className = 'insp-text details-empty'; $('inspText').innerHTML = 'No matches of this kind in the current filter.'; return; }
  const members = []; for (let i = NM; i < N; i++) if (R.mi[i] === m && R.dt[i] <= S.window) members.push(i);
  const la = R.lat[m] / 1e5, lo = R.lon[m] / 1e5;
  L.polygon(rectLatLngs(la, lo, R.scan[m] / 100, R.track[m] / 100, R.sat[m], R.night[m]), { color: '#ffd34d', weight: 2, fillOpacity: .12 }).bindTooltip(`MODIS ${satName(m)} pixel · ${isoTime(m)} UTC · FRP ${(R.frp[m] / 100).toFixed(1)} MW`).addTo(inspLayer);
  const cs = Math.min(R.scan[m], R.track[m]) / 200;
  L.circle([la, lo], { radius: cs * 1000, color: '#ffd34d', weight: 1, dashArray: '3 4', fill: false }).bindTooltip('Core: half the shorter side of the MODIS pixel').addTo(inspLayer);
  const colS = ['', '#27dfae', '#21d9ee', '#ff9b5c'];
  members.forEach(i => L.polygon(rectLatLngs(R.lat[i] / 1e5, R.lon[i] / 1e5, R.scan[i] / 100, R.track[i] / 100, R.sat[i], R.night[i]), { color: colS[vStr[i]], weight: 1.5, fillOpacity: .25, dashArray: vAmb[i] ? '4 3' : null }).bindTooltip(`${satName(i)} · ${isoTime(i)} UTC · Δt ${R.dt[i]} min · ${(R.dist[i] / 100).toFixed(2)} km · ${STR[vStr[i]]}${vAmb[i] ? ' · ambiguous' : ''}`).addTo(inspLayer));
  // nearby unmatched VIIRS in the same window, for context
  let ctx = 0; for (let i = NM; i < N && ctx < 300; i++) if (harm[i] && Math.abs(R.lat[i] - R.lat[m]) < 3000 && Math.abs(R.lon[i] - R.lon[m]) < 3000 && Math.abs(R.t[i] - R.t[m]) <= S.window) { ctx++; L.circleMarker([R.lat[i] / 1e5, R.lon[i] / 1e5], { radius: 3, color: '#a783ff', weight: 1, fillOpacity: .6 }).bindTooltip(`Unmatched ${satName(i)} · ${isoTime(i)} UTC: no footprint overlap with a MODIS pixel within ${S.window} min`).addTo(inspLayer); }
  inspMap.fitBounds(L.latLngBounds(rectLatLngs(la, lo, R.scan[m] / 100 * 2.2, R.track[m] / 100 * 2.2, R.sat[m], R.night[m])));
  const dts = members.map(i => R.dt[i]), dmin = Math.min(...dts), dmax = Math.max(...dts);
  const nStr = [0, 0, 0, 0]; members.forEach(i => nStr[vStr[i]]++); const nAmb = members.filter(i => vAmb[i]).length;
  const sats = [...new Set(members.map(satName))].join(', ');
  const ok = (c, t) => `<span class="${c ? 'ok' : 'no'}">${c ? '✓' : '✕'}</span> ${t}`;
  $('inspText').className = 'insp-text';
  $('inspText').innerHTML = `<div style="font-size:13px;font-weight:800;color:var(--orange);margin-bottom:6px">${hsId(m)} · group of ${members.length + 1}</div>`
    + [['MODIS pixel', `${satName(m)}, ${isoTime(m)} UTC, ${(R.scan[m] / 100).toFixed(2)} × ${(R.track[m] / 100).toFixed(2)} km`], ['VIIRS pixels', `${members.length} from ${sats}`], ['Spatial test', ok(true, 'every footprint overlaps the MODIS pixel')], ['Time test', ok(dmax <= S.window, `Δt ${dmin === dmax ? dmin : dmin + '–' + dmax} min ≤ ${S.window} min window`)], ['Same pass (≤ 30 min)', ok(dmin <= SAME_PASS, dmin <= SAME_PASS ? 'yes' : 'no, a different overpass')], ['Strength of members', `${nStr[1]} strong · ${nStr[2]} moderate · ${nStr[3]} weak`], ['Ambiguous members', nAmb ? `${nAmb}: another MODIS pixel qualifies within ${AMBIG} min` : 'none'], ['FRP', `MODIS ${(R.frp[m] / 100).toFixed(1)} MW · VIIRS best satellite sum ${(gVFrp[m] / 100).toFixed(1)} MW`], ['Counted in Harmonized', 'once, as this group']]
      .map(([k, v]) => `<div class="rule"><span>${k}</span><b>${v}</b></div>`).join('')
    + `<div class="panel-sub" style="margin-top:8px">Yellow: MODIS pixel and its core. Coloured: VIIRS pixels by strength (green strong, cyan moderate, orange weak; dashed = ambiguous). Purple dots: VIIRS pixels nearby with no MODIS match. Orientation is estimated from the orbit.</div>`;
  $('inspSub').textContent = `${hsId(m)} · ${esc(recordView(m, true).place)} · window ${S.window} min`;
  inspectId = null;
}

function setLab(mo, vo, mm, m, v, mmg, mv, h) {
  $('vennM').textContent = fmt(mo); $('vennV').textContent = fmt(vo); $('vennB').textContent = fmt(mm);
  $('labM').textContent = fmt(m); $('labV').textContent = fmt(v); $('labMM').textContent = fmt(mmg); $('labMV').textContent = fmt(mv); $('labH').textContent = fmt(h);
}

/* ---------- Activity calendar ---------- */
const HEAT = ['#3d8e4a', '#a7c93e', '#e6e84a', '#ffb02e', '#f45a2b', '#b5151d', '#170d2c'];
function partialMonths() { // recent months missing from the archive: partial, near-real-time, S-NPP only for VIIRS
  const out = {}; if (!META) return out;
  const { t, country, sat, dt } = R, key = sensorKey();
  for (let i = 0; i < N; i++) {
    if (!regionMember[country[i] + 1]) continue;
    const isM = i < NM;
    if (!isM && sat[i] !== 2) continue;
    const use = key === 'm' ? isM : key === 'v' ? !isM : (isM || !(dt[i] <= (HIST ? HIST.window : 180)));
    if (!use) continue;
    const p = META.days[t[i] / 1440 | 0].slice(0, 7); out[p] = (out[p] || 0) + 1;
  }
  return out;
}
function renderCalendar() {
  const root = $('heatmap'); root.innerHTML = '';
  const years = []; for (let y = S.calFrom; y <= S.calTo; y++) years.push(y);
  root.style.setProperty('--years', years.length);
  root.style.minWidth = Math.max(520, 58 + years.length * 28) + 'px';
  $('calScope').textContent = S.region + ' · ' + S.sensor;
  if (!HIST) { $('calendarSub').textContent = 'The archive summary is not available.'; return; }
  const key = sensorKey(), s = hSeries(key);
  const partial = partialMonths();
  const val = {}; const vals = [];
  HIST.months.forEach((p, i) => { val[p] = s ? s[i] : null; });
  for (let m = 0; m < 12; m++) for (const y of years) {
    const p = `${y}-${String(m + 1).padStart(2, '0')}`;
    if (val[p] != null && val[p] > 0 && !(p in partial && !HIST.months.includes(p))) vals.push(Math.log10(val[p]));
  }
  vals.sort((a, b) => a - b);
  const q = f => vals.length ? vals[Math.min(vals.length - 1, Math.floor(f * vals.length))] : 0;
  const cuts = [.2, .38, .55, .7, .84, .95].map(q);
  const color = v => { const l = Math.log10(v); let k = 0; while (k < cuts.length && l >= cuts[k]) k++; return HEAT[k]; };
  const frag = document.createDocumentFragment();
  frag.appendChild(document.createElement('div'));
  years.forEach(y => { const e = document.createElement('div'); e.className = 'heat-year'; e.textContent = years.length > 16 ? "'" + String(y).slice(2) : y; e.title = y; frag.appendChild(e); });
  for (let m = 0; m < 12; m++) {
    const lab = document.createElement('div'); lab.className = 'heat-month'; lab.textContent = MONTHS[m]; frag.appendChild(lab);
    for (const y of years) {
      const p = `${y}-${String(m + 1).padStart(2, '0')}`;
      const inArchive = val[p] != null && inCoverage(key, p);
      const isPartial = !inArchive && partial[p] != null;
      const cell = document.createElement('button');
      cell.className = 'heat-cell';
      let title, count = null;
      if (inArchive) {
        count = val[p];
        if (count === 0) { cell.classList.add('zero'); title = `${MONTHS[m]} ${y}: 0 detections (observed, none recorded)`; }
        else { cell.style.background = color(count); title = `${MONTHS[m]} ${y}: ${fmt(count)} ${S.sensor} detections`; }
      } else if (isPartial) {
        count = partial[p]; cell.classList.add('partial'); cell.style.background = color(Math.max(1, count));
        const nd = META.days.filter(d => d.slice(0, 7) === p).length;
        title = `${MONTHS[m]} ${y}: ${fmt(count)} so far from ${nd} of ${daysIn(y, m)} days (near-real-time, partial)`;
      } else { cell.classList.add('missing'); title = `${MONTHS[m]} ${y}: no ${S.sensor} data for this period${key === 'h' && y < 2012 ? ' (it needs both sensors and VIIRS starts in 2012; choose MODIS to see this month)' : ''}`; }
      cell.title = title; cell.setAttribute('aria-label', title);
      if (S.period === p) cell.classList.add('selected');
      cell.addEventListener('click', () => selectMonth(p, count, inArchive, isPartial));
      frag.appendChild(cell);
    }
  }
  root.appendChild(frag);
  const rng = cuts.map(c => short(Math.round(10 ** c)));
  $('heatLegend').innerHTML = `<span>Fewer</span>${HEAT.map((c, i) => `<i style="background:${c}" title="${i === 0 ? '< ' + (rng[0] || '') : i < rng.length ? rng[i - 1] + ' to ' + rng[i] : '≥ ' + (rng.at(-1) || '')}"></i>`).join('')}<span>More (${rng[0] || ''} to ${rng.at(-1) || ''}+ per month)</span><span class="gap"></span><i class="zero"></i><span>Zero detections</span><i class="missing"></i><span>No data</span><i class="partial"></i><span>Partial month</span>`;
  $('calendarSub').textContent = `Monthly ${S.sensor} detections · ${S.region} · ${S.calFrom}–${S.calTo} · colors are quantiles of this view`;
  const c = HIST.coverage;
  $('calendarNote').textContent = `FIRMS yearly archive: MODIS ${c.MODIS ? c.MODIS.join(' to ') : 'not loaded'}, VIIRS S-NPP ${c.VIIRS ? c.VIIRS.join(' to ') : 'not loaded'}. Harmonized needs both sensors, so it starts in 2012; choose MODIS for earlier months. MODIS counts step up in mid-2002 when Aqua joined Terra, with no change in fire. Striped cells have no data and are not zero.`;
  renderCalendarSummary();
  renderDaily();
}
function renderCalendarSummary() {
  if (!S.period) { $('calSelected').textContent = 'Select a cell'; $('calCount').textContent = '—'; $('calAnom').textContent = '—'; $('calOpenMap').style.display = 'none'; return; }
  const key = sensorKey(), i = monthIdx(S.period), s = hSeries(key);
  $('calSelected').textContent = monthLabel(S.period);
  $('calOpenMap').style.display = '';
  const n = i >= 0 && s ? s[i] : null;
  $('calCount').textContent = n != null ? fmt(n) : (partialMonths()[S.period] != null ? fmt(partialMonths()[S.period]) + ' (partial)' : 'No data');
  const m = +S.period.slice(5, 7) - 1, y = +S.period.slice(0, 4), b = baselineFor(key, m);
  $('calAnom').textContent = n != null && b && b.med && !(key === 'm' && y < BOTH_MODIS_FROM) ? ((n / daysIn(y, m) / b.med - 1) * 100).toFixed(0) + '%' : '—';
}
function selectMonth(p, count, inArchive, isPartial) {
  if (!inArchive && !isPartial) { toast(`No ${S.sensor} data for ${monthLabel(p)}. Missing data is not the same as zero.`); return; }
  S.period = S.period === p ? null : p;
  if (S.period && META.days.some(d => d.slice(0, 7) === p)) {
    const f = META.days.findIndex(d => d.slice(0, 7) === p), l = META.days.length - 1 - [...META.days].reverse().findIndex(d => d.slice(0, 7) === p);
    S.from = f; S.to = l;
  } else if (!S.period) { S.from = 0; S.to = META.days.length - 1; }
  S.page = 0;
  changed({ filter: true });
  if (S.period) toast(`Filtered to ${monthLabel(p)}. Map, statistics and records now use this month.`);
}

/* ---------- Historical analysis ---------- */
function renderHistory() {
  if (!HIST || !H()) { $('annualSub').textContent = 'Archive summary not available for this region.'; return; }
  const c = HIST.coverage, m = hSeries('m'), v = hSeries('v'), h = hSeries('h');
  const yearly = (s, key) => {
    const out = {}; HIST.months.forEach((p, i) => { const y = +p.slice(0, 4); (out[y] = out[y] || { n: 0, sum: 0 }); if (s[i] != null && inCoverage(key, p)) { out[y].n++; out[y].sum += s[i]; } });
    return out;
  };
  const ym = yearly(m, 'm'), yv = yearly(v, 'v'), yh = yearly(h, 'h');
  const years = Object.keys(ym).map(Number).sort((a, b) => a - b);
  const full = (o, y) => o[y] && o[y].n === 12 ? o[y].sum : null;
  $('annualSub').textContent = `${S.region} · complete calendar years only · VIIRS = S-NPP, Harmonized from 2012 · Terra alone before mid-2002`;
  chart('historyChart', 'line', years, [{ label: 'MODIS', data: years.map(y => full(ym, y)), color: '#e7c04a' }, { label: 'VIIRS S-NPP', data: years.map(y => full(yv, y)), color: '#a783ff' }, { label: 'Harmonized', data: years.map(y => full(yh, y)), color: '#ff6b3d' }], { yTitle: 'detections per year' });
  const key = sensorKey(), s = hSeries(key), [a, b] = baselineYears();
  const byM = Array.from({ length: 12 }, () => []), used = new Set();
  HIST.months.forEach((p, i) => { const y = +p.slice(0, 4); if (y >= a && y <= b && s[i] != null && inCoverage(key, p)) { byM[+p.slice(5, 7) - 1].push(s[i]); used.add(y); } });
  const ys = [...used].sort((x, z) => x - z);
  $('seasonSub').textContent = `${S.region} · ${S.sensor} · ${!ys.length ? 'no data in this period' : ys.length === 1 ? 'one year only, ' + ys[0] : 'median by calendar month, ' + ys[0] + '–' + ys.at(-1)}`;
  chart('seasonChart', 'bar', MONTHS, [{ label: S.sensor, data: byM.map(x => median(x)), color: SENSOR_COL[S.sensor], bg: SENSOR_COL[S.sensor] + 'cc', pr: 0 }], { yTitle: 'detections per month' });
  const over = years.filter(y => full(yv, y) != null && full(ym, y));
  $('cmpSub').textContent = `${S.region} · ratio to MODIS, complete overlap years · fewer pixels match after 2021 as orbits drift, so recent Harmonized is not comparable with earlier years`;
  chart('cmpChart', 'line', over, [{ label: 'VIIRS S-NPP ÷ MODIS', data: over.map(y => full(yv, y) / full(ym, y)), color: '#a783ff' }, { label: 'Harmonized ÷ MODIS', data: over.map(y => full(yh, y) / full(ym, y)), color: '#ff6b3d' }], { yTick: x => x.toFixed(1) + '×', yTitle: 'ratio to MODIS', zero: true });
  const modisBase = median(years.filter(y => y >= a && y <= b).map(y => full(ym, y)));
  const anomY = years.filter(y => y >= BOTH_MODIS_FROM && full(ym, y) != null);
  const anom = anomY.map(y => modisBase ? 100 * (full(ym, y) / modisBase - 1) : null);
  $('anomSub').textContent = `${S.region} · MODIS only, % vs ${S.baseline} median of ${fmt(modisBase)} per year · from ${BOTH_MODIS_FROM}, when Terra and Aqua both flew all year`;
  chart('anomChart', 'bar', anomY, [{ label: 'MODIS anomaly', data: anom, color: '#ff791f', bg: anom.map(x => x >= 0 ? '#ff791fcc' : '#21d9eecc'), pr: 0 }], { yTick: x => x + '%', yTitle: '% vs baseline', zero: false, tooltip: { label: c => c.parsed.y == null ? 'n/a' : c.parsed.y.toFixed(1) + '%' } });
  if (DRIFT) {
    const y = DRIFT.year;
    chart('driftHourChart', 'line', y, [{ label: 'Aqua, day pass', data: DRIFT.aqua_D_h, color: '#ff791f', pr: 2 }, { label: 'Terra, day pass', data: DRIFT.terra_D_h, color: '#21d9ee', pr: 2 }], { yTick: x => x.toFixed(1) + ' h', yTitle: 'local solar hour', zero: false });
    chart('driftRatioChart', 'line', y, [{ label: 'Observed, day', data: DRIFT.aqua_over_terra_D, color: '#ff791f', pr: 2 }, { label: 'Model, day', data: DRIFT.pred_D, color: '#ffd34d', pr: 0 }, { label: 'Observed, night', data: DRIFT.aqua_over_terra_N, color: '#21d9ee', pr: 2 }, { label: 'Model, night', data: DRIFT.pred_N, color: '#a783ff', pr: 0 }], { yTick: x => x.toFixed(1) + '×', yTitle: 'Aqua ÷ Terra pixels', zero: true });
  }
  if (CONTROL) {
    const y = CONTROL.year;
    chart('controlRatioChart', 'line', y, [{ label: 'Observed, day', data: CONTROL.Terra_SNPP_D_change, color: '#ff791f', pr: 2 }, { label: 'Model, day', data: CONTROL.pred_Terra_SNPP_D_change, color: '#ffd34d', pr: 0 }, { label: 'Observed, night', data: CONTROL.Terra_SNPP_N_change, color: '#21d9ee', pr: 2 }, { label: 'Model, night', data: CONTROL.pred_Terra_SNPP_N_change, color: '#a783ff', pr: 0 }], { yTick: x => x.toFixed(1) + '×', yTitle: 'change vs 2013–2020', zero: false });
    chart('controlTotalChart', 'line', y, [{ label: 'MODIS', data: CONTROL.modis_pct, color: '#e7c04a', pr: 2 }, { label: 'VIIRS S-NPP', data: CONTROL.snpp_pct, color: '#a783ff', pr: 2 }], { yTick: x => x + '%', yTitle: '% vs 2013–2020 mean', zero: false });
  }
  const ratioFirst = over.length ? full(yv, over[0]) / full(ym, over[0]) : null, ratioLast = over.length ? full(yv, over.at(-1)) / full(ym, over.at(-1)) : null;
  const latest = anomY.at(-1);
  $('histInsights').innerHTML = [
    ['Comparison period', modisBase ? `${S.baseline}` : 'Not calculated', `${S.region}. The baseline is the median of complete years, MODIS only, because it is the one record spanning the period. It is not a climatology of true fire.`],
    ['Latest complete year', latest ? `${latest}: ${anom.at(-1) >= 0 ? '+' : ''}${anom.at(-1).toFixed(0)}%` : 'n/a', 'MODIS detections against that baseline, not corrected for orbit drift. Since about 2022 Terra and Aqua pass at different times of day (charts above), so recent MODIS anomalies mix fire change with when the satellites look.'],
    ['Why not splice raw counts?', ratioLast ? `VIIRS ≈ ${ratioLast.toFixed(1)}× MODIS` : 'n/a', ratioFirst ? `${over[0]}: ${ratioFirst.toFixed(1)}×. ${over.at(-1)}: ${ratioLast.toFixed(1)}×. Joining the raw records would create a false jump, so sensors are compared side by side and anomalies stay within one sensor.` : 'No complete overlap years for this filter.'],
  ].map(([k, h3, p]) => `<div class="insight-card"><div class="kicker">${k}</div><h3>${h3}</h3><p>${p}</p></div>`).join('');
}

/* ---------- Data Explorer ---------- */
let tableIds = null, tableRows = null;
const PER = 12;
function rawView() { return S.sensor !== 'Harmonized'; }
function rowsForFilter() {
  const q = S.search.trim().toLowerCase(), raw = rawView();
  const pick = i => raw ? (S.sensor === 'MODIS' ? i < NM : i >= NM) : harm[i] === 1;
  const st = S.status;
  let placeHit = null, countryHit = null, idQ = null, numQ = null, satHit = 0, statusQ = null;
  if (q) {
    placeHit = META.places.name.map((n, i) => n.toLowerCase().includes(q) || (META.places.country[i] || '').toLowerCase().includes(q));
    countryHit = META.countries.map(n => n.toLowerCase().includes(q));
    if (/^hs-?[mv]/.test(q)) idQ = q;
    if (/^-?\d+(\.\d*)?$/.test(q)) numQ = q;
    META.sat_names.forEach((n, k) => { if (n.toLowerCase().includes(q)) satHit |= 1 << k; });
    if ('modis'.includes(q)) satHit |= 3; if ('viirs'.includes(q)) satHit |= 28;
    statusQ = ['matched', 'modis only', 'viirs only'].find(s => s.includes(q)) || null;
  }
  const hit = i => {
    if (!q) return true;
    if (placeHit[R.place[i]] || (R.country[i] >= 0 && countryHit[R.country[i]]) || satHit >> R.sat[i] & 1) return true;
    if (statusQ && statusOf(i).toLowerCase() === statusQ) return true;
    if (idQ && hsId(i).toLowerCase().startsWith(idQ)) return true;
    if (numQ && (String(R.lat[i] / 1e5).startsWith(numQ) || String(R.lon[i] / 1e5).startsWith(numQ))) return true;
    return false;
  };
  const ids = [];
  const buckets = new Uint32Array(65536);
  for (let i = 0; i < N; i++) {
    if (!inFilter[i] || !pick(i)) continue;
    if (st !== 'All match statuses') {
      if (st === 'Ambiguous assignment') { if (!ambOf(i)) continue; }
      else if (st.startsWith('Matched · ')) { if (strengthOf(i) !== st.slice(10)) continue; }
      else if (statusOf(i) !== st) continue;
    }
    if (!hit(i)) continue;
    ids.push(i); buckets[R.t[i]]++;
  }
  // counting sort, newest first
  let pos = 0; const start = new Uint32Array(65536);
  for (let v = 65535; v >= 0; v--) { start[v] = pos; pos += buckets[v]; }
  const out = new Int32Array(ids.length);
  for (const i of ids) out[start[R.t[i]]++] = i;
  return out;
}
const HEAD_REC = ['Acquired (UTC)', 'Location', 'Sensor', 'FRP (MW)', 'Confidence', 'Match status', 'Hotspot ID'];
const NUMCOL = new Set(['FRP (MW)', 'MODIS', 'VIIRS (S-NPP)', 'Harmonized']);
const headRow = h => '<tr>' + h.map(x => `<th scope="col"${NUMCOL.has(x) ? ' class="num"' : ''}>${x}</th>`).join('') + '</tr>';
const HEAD_CELL = ['1° cell (lat, lon)', 'Period', 'Country', 'MODIS', 'VIIRS (S-NPP)', 'Harmonized'];
async function renderData() {
  const hist = histMode();
  $('tableStatus').disabled = hist; $('tableSearch').disabled = hist;
  if (hist) {
    $('dataHead').innerHTML = headRow(HEAD_CELL);
    const cells = await cellRows();
    tableRows = cells; tableIds = null;
    const per = PER, maxP = Math.max(0, Math.ceil(cells.length / per) - 1); S.page = Math.min(S.page, maxP);
    $('dataRows').innerHTML = cells.slice(S.page * per, (S.page + 1) * per).map(c => `<tr><td data-l="Cell"><b class="mono">${c.la}°, ${c.lo}°</b></td><td data-l="Period">${monthLabel(S.period)}</td><td data-l="Country">${esc(c.country)}</td><td class="num" data-l="MODIS">${fmt(c.m)}</td><td class="num" data-l="VIIRS">${c.v == null ? 'No data' : fmt(c.v)}</td><td class="num" data-l="Harmonized">${c.h == null ? 'No data' : fmt(c.h)}</td></tr>`).join('') || '<tr><td colspan="6" class="empty-state">No detections for these filters.</td></tr>';
    $('tableCount').textContent = `Showing ${cells.length ? S.page * per + 1 : 0}–${Math.min((S.page + 1) * per, cells.length)} of ${fmt(cells.length)} monthly 1° cell rows`;
    $('pageNum').textContent = S.page + 1;
    $('tableNote').textContent = `${monthLabel(S.period)} is in the yearly archive, so this table holds 1° monthly totals. Individual records are bundled for ${META.days[0]} to ${META.days.at(-1)}.`;
    $('dataNote').textContent = 'Source: FIRMS yearly country archives. Exports contain these cell totals, restricted to the selected region.';
    $('exportDaily').disabled = true;
    $('dataScope').textContent = `${fmt(cells.length)} monthly 1° cells in scope.`;
    return;
  }
  $('exportDaily').disabled = false;
  $('dataHead').innerHTML = headRow(HEAD_REC);
  tableIds = rowsForFilter(); tableRows = null;
  const maxP = Math.max(0, Math.ceil(tableIds.length / PER) - 1); S.page = Math.min(S.page, maxP);
  const raw = rawView(), sub = tableIds.subarray(S.page * PER, (S.page + 1) * PER);
  $('dataRows').innerHTML = [...sub].map(i => { const v = recordView(i, !raw); return `<tr class="rec-row" data-i="${i}" tabindex="0" aria-label="Open details for ${v.id}"><td data-l="Acquired (UTC)"><span class="mono">${v.time}</span></td><td data-l="Location" class="loc">${esc(v.place)}${v.placeCountry ? ', ' + esc(v.placeCountry) : ''}<small class="mono">${v.lat.toFixed(4)}, ${v.lon.toFixed(4)}</small></td><td data-l="Sensor"><span class="sensor-chip ${v.sensor === 'MODIS' ? 'm' : v.sensor === 'VIIRS' ? 'v' : 'mv'}">${v.sensor}</span><small>${esc(v.sats)}</small></td><td class="num" data-l="FRP (MW)">${v.frpM != null && v.frpV != null ? `M ${v.frpM.toFixed(1)} · V ${v.frpV.toFixed(1)}` : (v.frpM ?? v.frpV).toFixed(1)}</td><td data-l="Confidence">${v.conf}</td><td data-l="Match status">${badge(v.status)} ${strBadge(v)}</td><td data-l="Hotspot ID"><span class="mono id">${v.id}</span></td></tr>`; }).join('') || '<tr><td colspan="7" class="empty-state"><b>No records match these filters.</b><br>Clear the search or widen the date range. This is an empty selection, not missing data.</td></tr>';
  $('tableCount').textContent = `Showing ${tableIds.length ? S.page * PER + 1 : 0}–${Math.min((S.page + 1) * PER, tableIds.length)} of ${fmt(tableIds.length)} ${raw ? 'raw ' + S.sensor : 'harmonized'} records`;
  $('pageNum').textContent = S.page + 1;
  $('dataScope').textContent = `${fmt(tableIds.length)} ${raw ? 'raw ' + S.sensor : 'harmonized'} record${tableIds.length === 1 ? '' : 's'} in scope.`;
  $('tableNote').textContent = raw ? `Raw ${S.sensor} detections, one row per pixel. Sensor filter set to Harmonized shows unique records.` : `Harmonized records: each matched group (one MODIS pixel and its VIIRS pixels within ${S.window} min) is one row, at the FRP-weighted VIIRS position. Newest first.`;
  $('dataNote').textContent = 'Source: NASA FIRMS near-real-time files (MODIS_NRT, VIIRS_*_NRT), not standard-processing science data. Hotspot IDs are assigned by this project and stay stable only within this data bundle. Exports contain exactly the records that match your filters.';
}
async function cellRows() {
  const y = S.period.slice(0, 4);
  if (!cellCache[y]) cellCache[y] = await jsonGz(`app-data/cells/${y}.json.gz`);
  const m = +S.period.slice(5, 7) - 1, noV = H() && H().v[monthIdx(S.period)] == null; // VIIRS not observed: no data, not zero
  return cellCache[y].rows.filter(r => r[0] === m && regionMember[r[3] + 1]).map(r => ({ la: r[1], lo: r[2], country: r[3] >= 0 ? META.countries[r[3]] : 'Offshore / unassigned', m: r[4], v: noV ? null : r[5], h: noV ? null : r[6] })).sort((a, b) => noV ? b.m - a.m : b.h - a.h);
}

function download(name, parts, type) { const url = URL.createObjectURL(new Blob(parts, { type })); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 2000); }
const srcKey = i => `${satName(i)}|${isoTime(i).replace(' ', 'T')}Z|${(R.lat[i] / 1e5).toFixed(5)}|${(R.lon[i] / 1e5).toFixed(5)}`;
const q = x => x == null ? '' : /[",\n]/.test(String(x)) ? '"' + String(x).replace(/"/g, '""') + '"' : String(x);
const slug = () => [S.region, S.sensor, histMode() ? S.period : META.days[S.from] + '_' + META.days[S.to]].join('_').replace(/[^\w-]+/g, '-');
function memberMap(ids) { // source IDs of VIIRS pixels in each exported matched group
  const want = new Set(); for (const i of ids) if (i < NM && modisMatched[i]) want.add(i);
  const out = new Map(); if (!want.size) return out;
  for (let i = NM; i < N; i++) if (R.dt[i] <= S.window && want.has(R.mi[i])) { const m = R.mi[i]; if (!out.has(m)) out.set(m, []); out.get(m).push(i); }
  return out;
}
function exportCsv() {
  if (histMode()) {
    if (!tableRows) return;
    download(`hotspot_cells_${slug()}.csv`, ['lat_cell,lon_cell,month,country,modis_detections,viirs_snpp_detections,harmonized_records,source\n', ...tableRows.map(c => [c.la, c.lo, S.period, q(c.country), c.m, c.v, c.h, 'FIRMS yearly archive'].join(',') + '\n')], 'text/csv');
    toast(`Exported ${fmt(tableRows.length)} monthly cell rows`); return;
  }
  const ids = tableIds || rowsForFilter(), raw = rawView(), members = raw ? new Map() : memberMap(ids);
  const cols = 'hotspot_id,record_type,match_status,match_strength,ambiguous_assignment,sensor,satellites,acquired_utc,latitude,longitude,modis_frp_mw,viirs_frp_mw,confidence,day_night,scan_km,track_km,closest_dt_min,centre_distance_km,rival_modis_dt_min,modis_candidates,match_window_min,matched_modis_id,country,nearest_listed_place,place_distance_km,source_key,matched_viirs_ids,matched_viirs_source_keys,product,source\n';
  const parts = [cols];
  for (const i of ids) {
    const v = recordView(i, !raw), mem = members.get(i) || [];
    const mm = i >= NM && R.dt[i] <= S.window ? hsId(R.mi[i]) : '';
    parts.push([v.id, raw ? 'raw' : 'harmonized', v.status, v.strength || '', v.strength ? v.amb : '', v.sensor, q(v.sats), v.time.replace(' ', 'T') + 'Z', v.lat.toFixed(5), v.lon.toFixed(5), v.frpM == null ? '' : v.frpM.toFixed(2), v.frpV == null ? '' : v.frpV.toFixed(2), v.conf, v.night ? 'N' : 'D', v.scan, v.track, v.dt ?? '', v.distKm ?? '', v.rivalDt ?? '', v.nCand ?? '', S.window, mm, q(v.country || ''), q(v.place), Math.round(v.km), q(srcKey(i)), q(mem.map(hsId).join(';')), q(mem.map(srcKey).join(';')), i < NM ? 'MODIS_NRT' : ['', '', 'VIIRS_SNPP_NRT', 'VIIRS_NOAA20_NRT', 'VIIRS_NOAA21_NRT'][R.sat[i]], 'NASA FIRMS NRT'].join(',') + '\n');
  }
  download(`hotspot_records_${slug()}.csv`, parts, 'text/csv');
  toast(`Exported ${fmt(ids.length)} records`);
}
function exportDaily() {
  const parts = ['date,region,raw_modis,raw_viirs,matched_modis_pixels,matched_viirs_pixels,harmonized_records,match_window_min,partial_day\n'];
  for (let d = S.from; d <= S.to; d++) parts.push([META.days[d], q(S.region), stats.dayM[d], stats.dayV[d], stats.dayMM[d], stats.dayMV[d], stats.dayH[d], S.window, META.partial_days.includes(META.days[d])].join(',') + '\n');
  download(`daily_summary_${slug()}.csv`, parts, 'text/csv');
  toast('Exported the daily summary');
}
const GEO_LIMIT = 250000;
function exportGeo() {
  if (histMode()) {
    if (!tableRows) return;
    const f = tableRows.map(c => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [c.lo + .5, c.la + .5] }, properties: { cell_lat: c.la, cell_lon: c.lo, month: S.period, country: c.country, modis: c.m, viirs_snpp: c.v, harmonized: c.h, source: 'FIRMS yearly archive' } }));
    download(`hotspot_cells_${slug()}.geojson`, [JSON.stringify({ type: 'FeatureCollection', features: f })], 'application/geo+json');
    toast(`Exported ${fmt(f.length)} cells`); return;
  }
  const ids = tableIds || rowsForFilter(), raw = rawView();
  if (ids.length > GEO_LIMIT) { toast(`${fmt(ids.length)} records is too large for GeoJSON in a browser. Narrow the filters to ${fmt(GEO_LIMIT)} or fewer, or use CSV.`); return; }
  const members = raw ? new Map() : memberMap(ids), parts = ['{"type":"FeatureCollection","features":['];
  let first = true;
  for (const i of ids) {
    const v = recordView(i, !raw), mem = members.get(i) || [];
    const fe = { type: 'Feature', geometry: { type: 'Point', coordinates: [+v.lon.toFixed(5), +v.lat.toFixed(5)] }, properties: { hotspot_id: v.id, record_type: raw ? 'raw' : 'harmonized', match_status: v.status, match_strength: v.strength, ambiguous_assignment: v.strength ? v.amb : null, centre_distance_km: v.distKm, rival_modis_dt_min: v.rivalDt, matched_modis_id: i >= NM && R.dt[i] <= S.window ? hsId(R.mi[i]) : null, product: i < NM ? 'MODIS_NRT' : ['', '', 'VIIRS_SNPP_NRT', 'VIIRS_NOAA20_NRT', 'VIIRS_NOAA21_NRT'][R.sat[i]], sensor: v.sensor, satellites: v.sats, acquired_utc: v.time.replace(' ', 'T') + 'Z', modis_frp_mw: v.frpM, viirs_frp_mw: v.frpV, confidence: v.conf, closest_dt_min: v.dt, match_window_min: S.window, country: v.country, nearest_listed_place: v.place, source_key: srcKey(i), matched_viirs_ids: mem.map(hsId), source: 'NASA FIRMS NRT' } };
    parts.push((first ? '' : ',') + JSON.stringify(fe)); first = false;
  }
  parts.push(']}');
  download(`hotspot_records_${slug()}.geojson`, parts, 'application/geo+json');
  toast(`Exported ${fmt(ids.length)} records as GeoJSON`);
}

/* ---------- Daily activity calendar ---------- */
const dailyCache = {};
let daySel = null;
function bundleDaily() { // per-day counts from the record bundle for the current region (date filter ignored)
  const nd = META.days.length, m = new Uint32Array(nd), v = new Uint32Array(nd), h = new Uint32Array(nd), { t, country } = R;
  for (let i = 0; i < N; i++) {
    if (!regionMember[country[i] + 1]) continue;
    const d = t[i] / 1440 | 0;
    if (i < NM) { m[d]++; h[d]++; } else { v[d]++; if (harm[i]) h[d]++; }
  }
  return { m, v, h };
}
async function renderDaily() {
  const yrs = [...DAILY_YEARS]; const by = +META.days[0].slice(0, 4); if (!yrs.includes(by)) yrs.push(by);
  const sel = $('dayYear');
  if (!sel.options.length) { sel.innerHTML = yrs.map(y => `<option>${y}</option>`).join(''); sel.value = by; sel.addEventListener('change', () => { daySel = null; renderDaily(); }); }
  const y = +sel.value, key = sensorKey(), root = $('dayGrid');
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0, nDays = leap ? 366 : 365;
  const val = new Array(nDays).fill(undefined), recent = new Set();
  let note = '';
  if (DAILY_YEARS.includes(y)) {
    if (!dailyCache[y]) { $('dailyCalSub').textContent = 'Loading ' + y + '…'; try { dailyCache[y] = await jsonGz(`app-data/daily/${y}.json.gz`); } catch (e) { dailyCache[y] = null; } }
    const D = dailyCache[y];
    if (D) {
      const om = new Set(D.observed.m), ov = new Set(D.observed.v), acc = Array.from({ length: nDays }, () => [0, 0, 0]);
      for (const [d, c, m, v, mv] of D.rows) if (regionMember[c + 1]) { acc[d][0] += m; acc[d][1] += v; acc[d][2] += mv; }
      for (let d = 0; d < nDays; d++) {
        const [m, v, mv] = acc[d];
        val[d] = key === 'm' ? (om.has(d) ? m : null) : key === 'v' ? (ov.has(d) ? v : null) : (om.has(d) && ov.has(d) ? m + v - mv : null);
      }
      note = `FIRMS yearly archive: MODIS and VIIRS S-NPP, matched with a ${D.window} min window.`;
    }
  }
  if (y === by) {
    const b = bundleDaily(), d0 = Date.UTC(y, 0, 1);
    META.days.forEach((ds, k) => {
      const doy = Math.round((Date.parse(ds) - d0) / 864e5); if (doy < 0 || doy >= nDays) return;
      const vOk = [2, 3, 4].some(s => (META.sat_days[META.sat_names[s]] || []).includes(k));
      val[doy] = key === 'm' ? b.m[k] : key === 'v' ? (vOk ? b.v[k] : null) : (vOk ? b.h[k] : null);
      recent.add(doy);
    });
    note += (note ? ' ' : '') + `Outlined days (${META.days[0]} to ${META.days.at(-1)}) come from the NRT bundle, where VIIRS means ${satList([2, 3, 4])}, so they are not comparable with archive S-NPP counts. Other ${y} days are not in the archive yet.`;
  }
  const logs = val.filter(x => x > 0).map(Math.log10).sort((a, b) => a - b);
  const qq = f => logs.length ? logs[Math.min(logs.length - 1, Math.floor(f * logs.length))] : 0, cuts = [.2, .38, .55, .7, .84, .95].map(qq);
  const color = x => { const l = Math.log10(x); let k = 0; while (k < cuts.length && l >= cuts[k]) k++; return HEAT[k]; };
  const pad = (new Date(Date.UTC(y, 0, 1)).getUTCDay() + 6) % 7; // weeks start on Monday
  const frag = document.createDocumentFragment();
  for (let k = 0; k < pad; k++) { const e = document.createElement('div'); e.className = 'dcell pad'; frag.appendChild(e); }
  for (let d = 0; d < nDays; d++) {
    const e = document.createElement('button'), x = val[d], date = new Date(Date.UTC(y, 0, 1 + d)).toISOString().slice(0, 10);
    e.className = 'dcell' + (recent.has(d) ? ' recent' : '') + (daySel === date ? ' sel' : '');
    let title;
    if (x == null) { e.classList.add('missing'); title = `${date}: no ${S.sensor} data`; }
    else if (x === 0) { e.classList.add('zero'); title = `${date}: 0 detections (observed)`; }
    else { e.style.background = color(x); title = `${date}: ${fmt(x)} ${S.sensor} detections${recent.has(d) ? ' (NRT bundle)' : ''}`; }
    e.title = title; e.setAttribute('aria-label', title);
    e.addEventListener('click', () => { daySel = date; showDay(date, d, y, recent.has(d)); renderDaily(); });
    frag.appendChild(e);
  }
  root.innerHTML = ''; root.appendChild(frag);
  MONTHS.forEach((mn, k) => { const doy = Math.round((Date.UTC(y, k, 1) - Date.UTC(y, 0, 1)) / 864e5), w = Math.floor((doy + pad) / 7); const l = document.createElement('span'); l.className = 'mlab'; l.style.left = (30 + w * 17) + 'px'; l.textContent = mn; root.appendChild(l); });
  ['Mon', 'Wed', 'Fri'].forEach((n, k) => { const l = document.createElement('span'); l.className = 'wlab'; l.style.top = (18 + k * 2 * 17) + 'px'; l.textContent = n; root.appendChild(l); });
  $('dayLegend').innerHTML = `<span>Fewer</span>${HEAT.map(c => `<i style="background:${c}"></i>`).join('')}<span>More</span><span class="gap"></span><i class="zero"></i><span>Zero (observed)</span><i class="missing"></i><span>No data</span><i class="partial"></i><span>NRT bundle</span>`;
  $('dailyCalSub').textContent = `${S.sensor} detections per UTC day · ${S.region} · ${y} · colours are quantiles of this year. ${note}`;
}
function showDay(date, doy, y, recent) {
  $('daySel').textContent = date;
  const D = dailyCache[y];
  let m = null, v = null, h = null;
  if (recent) { const k = META.days.indexOf(date), b = bundleDaily(), vOk = [2, 3, 4].some(s => (META.sat_days[META.sat_names[s]] || []).includes(k)); m = b.m[k]; v = vOk ? b.v[k] : null; h = vOk ? b.h[k] : null; }
  else if (D) {
    let a = [0, 0, 0]; for (const [d, c, x, w, mv] of D.rows) if (d === doy && regionMember[c + 1]) { a[0] += x; a[1] += w; a[2] += mv; }
    const om = D.observed.m.includes(doy), ov = D.observed.v.includes(doy);
    m = om ? a[0] : null; v = ov ? a[1] : null; h = om && ov ? a[0] + a[1] - a[2] : null;
  }
  $('dayM').textContent = m == null ? 'No data' : fmt(m); $('dayV').textContent = v == null ? 'No data' : fmt(v); $('dayH').textContent = h == null ? 'No data' : fmt(h);
  const btn = $('dayOpen'); btn.style.display = recent ? '' : 'none';
  btn.onclick = () => { const k = META.days.indexOf(date); S.from = S.to = k; S.period = null; S.page = 0; changed({ filter: true }); goPage('data'); };
}

/* ---------- Live FIRMS query through the server (the MAP_KEY never reaches the browser) ---------- */
let liveLayer = null;
async function runLive() {
  const out = $('liveOut');
  if (!SERVER) { out.innerHTML = '<span class="err">The API server is not running, so live queries are off. Start it with <code>python -m hotspots.server</code> and reload. The bundled records still work.</span>'; return; }
  if (globeMode) switchGlobe(false);
  const b = exMap.getBounds(), w = Math.max(-180, b.getWest()), e = Math.min(180, b.getEast()), so = Math.max(-90, b.getSouth()), no = Math.min(90, b.getNorth());
  if ((e - w) * (no - so) > 2500 || e - w >= 359) { out.innerHTML = '<span class="err">Zoom in first: one live query covers at most 2,500 square degrees (about 50° × 50°).</span>'; return; }
  const days = $('liveDays').value, bbox = [w, so, e, no].map(x => x.toFixed(3)).join(',');
  out.innerHTML = 'Querying NASA FIRMS…'; $('liveRun').disabled = true;
  try {
    const r = await fetch(`api/harmonize?bbox=${bbox}&days=${days}&window=${S.window}`), j = await r.json();
    if (!r.ok) throw new Error(j.error || 'HTTP ' + r.status);
    if (!liveLayer) liveLayer = L.layerGroup().addTo(exMap);
    liveLayer.clearLayers();
    const col = { 'Matched': '#27dfae', 'MODIS Only': '#ffd34d', 'VIIRS Only': '#a783ff' }, satN = META.sat_names;
    j.records.slice(0, 6000).forEach(x => L.circleMarker([x.lat, x.lon], { renderer: canvasR, radius: x.sensor === 'MODIS' ? 5 : 3.5, weight: 1.5, color: '#04141d', fillColor: col[x.status], fillOpacity: .95 })
      .bindTooltip(`<div class="hs-tip"><b class="t">Live · ${esc(x.id)}</b><hr><div><b>${esc(satN[x.sat])}</b> · ${esc(x.product)}</div><div><b>Acquired:</b> ${esc(x.time)}</div><div><b>FRP:</b> ${x.frp ?? '—'} MW · <b>Conf:</b> ${esc(x.conf)}</div><div><b>Status:</b> ${esc(x.status)}${x.strength ? ' (' + esc(x.strength) + (x.ambiguous ? ', ambiguous' : '') + ')' : ''}${x.group_id ? ' · group ' + esc(x.group_id) : ''}</div>${x.dt_min != null ? `<div><b>Δt:</b> ${Math.round(x.dt_min)} min${x.dist_km != null ? ` · ${(+x.dist_km).toFixed(2)} km` : ''}</div>` : ''}<small>Fetched live from NASA FIRMS by our server</small></div>`, { sticky: true }).addTo(liveLayer));
    const sm = j.summary, pr = Object.entries(j.products).map(([k, v]) => `<tr><td>${esc(k)}</td><td>${v.error ? '<span class="err">' + esc(v.error) + '</span>' : v.no_data ? 'no data' : fmt(v.records_in_box)}</td></tr>`).join('');
    out.innerHTML = `<b>${fmt(sm.harmonized)} harmonized</b> from ${fmt(sm.modis)} MODIS + ${fmt(sm.viirs)} VIIRS · ${fmt(sm.matched_viirs)} VIIRS matched (${sm.strength_viirs ? `${fmt(sm.strength_viirs.strong)} strong, ${fmt(sm.strength_viirs.moderate)} moderate, ${fmt(sm.strength_viirs.weak)} weak` : ''})<table>${pr}</table><div style="margin-top:5px;color:var(--muted)">${esc(j.period_utc[0] || '')} to ${esc(j.period_utc[1] || '')} UTC · ${esc(Object.values(j.products)[0].via || '')}${j.truncated ? ' · map shows the 25,000 highest-FRP records' : ''} · <button class="link-btn" id="liveClear">clear layer</button></div>`;
    $('liveClear').addEventListener('click', () => { liveLayer.clearLayers(); out.innerHTML = ''; });
    $('liveTag').textContent = 'LIVE · ' + new Date().toISOString().slice(11, 16) + ' UTC';
  } catch (err) { out.innerHTML = `<span class="err">Live query failed: ${esc(err.message)}. The bundled records are unaffected.</span>`; }
  $('liveRun').disabled = false;
}

/* ---------- Controls ---------- */
function regionOptions() {
  const cont = ['North America', 'South America', 'Europe', 'Africa', 'Asia', 'Oceania'];
  const names = [...new Set(META.countries)].sort();
  return `<option value="Global">Global</option><optgroup label="Regions">${cont.map(c => `<option>${c}</option>`).join('')}</optgroup><optgroup label="Countries">${names.map(c => `<option>${esc(c)}</option>`).join('')}</optgroup>`;
}
function initControls() {
  const reg = regionOptions();
  $$('.js-region').forEach(e => { e.innerHTML = reg; e.addEventListener('change', () => { S.region = e.value; S.page = 0; buildRegionMember(); changed({ filter: true }); if (exMap) { if (currentPage === 'map') zoomToRegion(); else pendingFit = true; } }); });
  $$('.js-sensor').forEach(e => { e.innerHTML = ['Harmonized', 'MODIS', 'VIIRS'].map(x => `<option>${x}</option>`).join(''); e.addEventListener('change', () => { S.sensor = e.value; S.page = 0; const dropped = S.period && HIST && monthIdx(S.period) >= 0 && !inCoverage(sensorKey(), S.period); if (dropped) { toast(`No ${S.sensor} data for ${monthLabel(S.period)}, so the month filter was cleared.`); S.period = null; S.from = 0; S.to = META.days.length - 1; } layers.harm = S.sensor === 'Harmonized'; layers.modis = S.sensor === 'MODIS'; layers.viirs = S.sensor === 'VIIRS'; syncLayers(); changed(dropped ? { filter: true } : {}); }); });
  const dayOpts = META.days.map((d, i) => `<option value="${i}">${d}${META.partial_days.includes(d) ? ' (partial)' : ''}</option>`).join('');
  $$('.js-from').forEach(e => { e.innerHTML = dayOpts; e.addEventListener('change', () => { S.from = +e.value; if (S.to < S.from) S.to = S.from; S.period = null; S.page = 0; changed({ filter: true }); }); });
  $$('.js-to').forEach(e => { e.innerHTML = dayOpts; e.addEventListener('change', () => { S.to = +e.value; if (S.from > S.to) S.from = S.to; S.period = null; S.page = 0; changed({ filter: true }); }); });
  const yrs = HIST ? [...new Set(HIST.months.map(p => +p.slice(0, 4)))] : []; if (!yrs.includes(2026)) yrs.push(2026);
  S.calFrom = yrs[0] || 2026; S.calTo = yrs.at(-1);
  ['calFrom', 'calTo'].forEach(id => { $(id).innerHTML = yrs.map(y => `<option>${y}</option>`).join(''); $(id).addEventListener('change', () => { S.calFrom = +$('calFrom').value; S.calTo = +$('calTo').value; if (S.calFrom > S.calTo) [S.calFrom, S.calTo] = [S.calTo, S.calFrom]; dirty.add('calendar'); syncControls(); renderCurrent(); }); });
  $('windowSel').addEventListener('change', e => { S.window = +e.target.value; S.page = 0; changed({ window: true }); });
  $('baselineSel').addEventListener('change', e => { S.baseline = e.target.value; changed({}); });
  $('tableStatus').addEventListener('change', e => { S.status = e.target.value; S.page = 0; dirty.add('data'); renderFilterChips(); renderCurrent(); });
  let deb; $('tableSearch').addEventListener('input', e => { clearTimeout(deb); deb = setTimeout(() => { S.search = e.target.value; S.page = 0; dirty.add('data'); renderFilterChips(); renderCurrent(); }, 220); });
  $('prevPage').addEventListener('click', () => { S.page = Math.max(0, S.page - 1); dirty.add('data'); renderCurrent(); });
  $('nextPage').addEventListener('click', () => { S.page++; dirty.add('data'); renderCurrent(); });
  $('firstPage').addEventListener('click', () => { S.page = 0; dirty.add('data'); renderCurrent(); });
  const openRow = tr => { if (tr && tr.dataset.i != null) openRecord(+tr.dataset.i, !rawView()); };
  $('dataRows').addEventListener('click', e => openRow(e.target.closest('tr.rec-row')));
  $('dataRows').addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { const tr = e.target.closest('tr.rec-row'); if (tr) { e.preventDefault(); openRow(tr); } } });
  $('exportCsv').addEventListener('click', exportCsv); $('exportDaily').addEventListener('click', exportDaily); $('exportGeo').addEventListener('click', exportGeo);
  $('calOpenMap').addEventListener('click', () => goPage('map'));
  $$('.venn .circle').forEach(c => { const open = () => { S.status = c.dataset.status; S.sensor = 'Harmonized'; S.page = 0; $('tableStatus').value = S.status; layers.harm = true; syncLayers(); dirty.add('data'); syncControls(); goPage('data'); }; c.addEventListener('click', open); c.addEventListener('keydown', e => { if (e.key === 'Enter') open(); }); });
  $('layerHarm').addEventListener('change', e => { layers.harm = e.target.checked; dirty.add('map'); dirty.add('overview'); renderCurrent(); });
  $('layerModis').addEventListener('change', e => { layers.modis = e.target.checked; dirty.add('map'); dirty.add('overview'); renderCurrent(); });
  $('layerViirs').addEventListener('change', e => { layers.viirs = e.target.checked; dirty.add('map'); dirty.add('overview'); renderCurrent(); });
  $('markerMode').addEventListener('change', () => { dirty.add('map'); renderLegend(); renderCurrent(); });
  $('satChecks').innerHTML = META.sat_names.map((n, k) => `<label class="check-row${satHasData(k) ? '' : ' nodata'}" title="${satHasData(k) ? '' : n + ' delivered no records for this period: no data, not zero'}"><input type="checkbox" data-sat="${k}" ${satHasData(k) ? 'checked' : 'disabled'}> ${n}</label>`).join('');
  $$('#satChecks input').forEach(c => c.addEventListener('change', () => { satOn[+c.dataset.sat] = c.checked ? 1 : 0; ['map', 'overview', 'harmonization'].forEach(p => dirty.add(p)); renderCurrent(); }));
  $('inspPick').addEventListener('change', () => { inspSeq = 0; renderInspector(); });
  $('inspNext').addEventListener('click', () => { inspSeq++; renderInspector(); });
  $('liveRun').addEventListener('click', runLive);
  if (!SERVER) { $('liveSub').textContent = 'Needs the API server (python -m hotspots.server). The page is running from static files, so live FIRMS queries are off.'; $('liveTag').textContent = 'OFFLINE'; }
  else $('liveSub').textContent = `Fetch the newest MODIS and VIIRS detections for this view from NASA FIRMS through our server (${SERVER.map_key_configured ? 'area API with the server-side MAP_KEY' : 'public 7-day files, no key configured'}), then match them.`;
  $('searchPlace').addEventListener('click', searchPlace);
  $('placeSearch').addEventListener('keydown', e => { if (e.key === 'Enter') searchPlace(); });
  $('globalSearchBtn').addEventListener('click', () => { goPage('map'); $('placeSearch').focus({ preventScroll: true }); });
  $$('#mapModeButtons [data-mode]').forEach(b => b.addEventListener('click', () => { if (globeMode) switchGlobe(false); setBasemap(b.dataset.mode); }));
  $('globeToggle').addEventListener('click', () => switchGlobe(!globeMode));
  $('rotateBtn').addEventListener('click', () => setRotate(!rotating));
  $('zoomInBtn').addEventListener('click', () => { if (globeMode && globe) { const p = globe.pointOfView(); setRotate(false); globe.pointOfView({ ...p, altitude: Math.max(.1, p.altitude * .7) }, 300); } else exMap.zoomIn(); });
  $('zoomOutBtn').addEventListener('click', () => { if (globeMode && globe) { const p = globe.pointOfView(); globe.pointOfView({ ...p, altitude: Math.min(6, p.altitude * 1.4) }, 300); } else exMap.zoomOut(); });
  $('locateBtn').addEventListener('click', () => { if (globeMode && globe) { globe.pointOfView({ lat: 14, lng: 5, altitude: 2.5 }, 900); } else exMap.setView([14, 5], 2); toast('View reset to global'); });
  $('mapLayersBtn').addEventListener('click', () => { if (window.UI) UI.mapPanel('layers'); });
  $('fullscreenBtn').addEventListener('click', async () => {
    const st = $('mapStage');
    if (document.fullscreenElement) { await document.exitFullscreen(); return; }
    if (st.classList.contains('fullscreen')) { st.classList.remove('fullscreen'); resizeMaps(); return; }
    try { await st.requestFullscreen(); } catch (e) { st.classList.add('fullscreen'); resizeMaps(); }
  });
  document.addEventListener('fullscreenchange', () => { $('fullscreenBtn').classList.toggle('on', !!document.fullscreenElement); setTimeout(resizeMaps, 200); });
  $('themeToggle').addEventListener('click', () => {
    const light = document.body.classList.toggle('light');
    $('themeToggle').setAttribute('aria-pressed', light);
    ['overview', 'history'].forEach(p => dirty.add(p)); renderCurrent();
  });
  window.addEventListener('resize', () => { clearTimeout(window._rz); window._rz = setTimeout(resizeMaps, 150); });
  $$('.nav-item[data-page]').forEach(b => b.addEventListener('click', () => goPage(b.dataset.page)));
  $$('[data-goto]').forEach(b => b.addEventListener('click', () => goPage(b.dataset.goto)));
}
function resizeMaps() { if (ovMap) ovMap.invalidateSize(); if (exMap) exMap.invalidateSize(); sizeGlobe(); }
function syncLayers() { $('layerHarm').checked = layers.harm; $('layerModis').checked = layers.modis; $('layerViirs').checked = layers.viirs; }
let pendingFit = false;
function zoomToRegion() { // framed from the data itself; a hidden map has no size, so this waits until the map is on screen
  pendingFit = false;
  if (S.region === 'Global') { if (globeMode && globe) globe.pointOfView({ lat: 14, lng: 5, altitude: 2.5 }, 900); else exMap.setView([14, 5], 2); return; }
  const { lat, lon } = R; let a = 1e9, b = -1e9, c = 1e9, d = -1e9, n = 0;
  for (let i = 0; i < N; i += 1) if (regionMember[R.country[i] + 1]) { n++; if (lat[i] < a) a = lat[i]; if (lat[i] > b) b = lat[i]; if (lon[i] < c) c = lon[i]; if (lon[i] > d) d = lon[i]; }
  if (!n || d - c >= 300 * 1e5) return;
  if (globeMode && globe) { const span = Math.max((b - a) / 1e5, (d - c) / 1e5); flyTo((a + b) / 2e5, (c + d) / 2e5, Math.max(2, Math.min(9, Math.round(Math.log2(360 / Math.max(span, .5)))))); }
  else exMap.fitBounds([[a / 1e5, c / 1e5], [b / 1e5, d / 1e5]], { padding: [20, 20] });
}
function syncControls() {
  $$('.js-region').forEach(e => { e.value = S.region; });
  $$('.js-sensor').forEach(e => { e.value = S.sensor; });
  $$('.js-from').forEach(e => { e.value = S.from; e.disabled = histMode(); });
  $$('.js-to').forEach(e => { e.value = S.to; e.disabled = histMode(); });
  $('calFrom').value = S.calFrom; $('calTo').value = S.calTo;
  $('tableStatus').value = S.status;
}
function isDefaultScope() { return S.region === 'Global' && S.sensor === 'Harmonized' && !S.period && S.from === 0 && S.to === META.days.length - 1 && S.status === 'All match statuses' && !S.search; }
function resetScope() {
  Object.assign(S, { region: 'Global', sensor: 'Harmonized', period: null, from: 0, to: META.days.length - 1, status: 'All match statuses', search: '', page: 0 });
  $('tableSearch').value = ''; layers.harm = true; layers.modis = false; layers.viirs = false; syncLayers();
  buildRegionMember(); changed({ filter: true });
  if (exMap) { if (currentPage === 'map') zoomToRegion(); else pendingFit = true; }
  toast('Scope reset: global, all bundled days, harmonized layer.');
}
function renderFilterChips() {
  const per = S.period ? `<span class="chip period">Month ${monthLabel(S.period)}<button id="clearPeriod" aria-label="Clear month filter" title="Clear month filter">✕</button></span>` : `<span class="chip">${META.days[S.from]} → ${META.days[S.to]} UTC</span>`;
  const extra = (S.status !== 'All match statuses' ? `<span class="chip">${esc(S.status)}</span>` : '') + (S.search ? `<span class="chip">“${esc(S.search)}”</span>` : '');
  $('activeFilters').innerHTML = `<span class="scope-k">Scope</span><span class="chip">${esc(S.region)}</span><span class="chip">${S.sensor}</span>${per}<span class="chip">Window ${HIST && histMode() ? HIST.window : S.window} min</span>${extra}${isDefaultScope() ? '' : '<button class="link-btn" id="resetScope">Reset scope</button>'}`;
  const c = $('clearPeriod'); if (c) c.addEventListener('click', () => { S.period = null; S.from = 0; S.to = META.days.length - 1; S.page = 0; changed({ filter: true }); });
  const r = $('resetScope'); if (r) r.addEventListener('click', resetScope);
}
function renderLegend() {
  const mode = $('markerMode').value;
  $('mapLegend').innerHTML = mode === 'strength' ? '<span><i style="background:#27dfae"></i>Strong match</span><span><i style="background:#21d9ee"></i>Moderate</span><span><i style="background:#ffd34d"></i>Weak</span><span><i style="background:#5d7480"></i>Unmatched</span>'
    : mode === 'red'
    ? '<span><i style="background:#ff493f"></i>Fire hotspot (individual record)</span><span><i style="background:#e8301d;width:12px;height:12px"></i>Cluster, with record count</span>'
    : '<span><i style="background:#27dfae"></i>Matched</span><span><i style="background:#ffd34d"></i>MODIS only</span><span><i style="background:#a783ff"></i>VIIRS only</span>';
}

/* ---------- Navigation ---------- */
const RENDER = { overview: () => { renderOverview(); renderOverviewMap(); }, map: renderExplorer, harmonization: renderLab, calendar: renderCalendar, history: renderHistory, data: renderData };
function renderCurrent() {
  if (!dirty.has(currentPage)) return;
  dirty.delete(currentPage);
  RENDER[currentPage]();
}
function goPage(name) {
  currentPage = name;
  $$('.page').forEach(p => p.classList.toggle('active', p.id === 'page-' + name));
  $$('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.page === name));
  window.scrollTo(0, 0);
  document.dispatchEvent(new CustomEvent('fv:page', { detail: name }));
  requestAnimationFrame(() => {
    if (name === 'map' && exMap) { exMap.invalidateSize(); sizeGlobe(); if (pendingFit) zoomToRegion(); }
    if (name === 'overview' && ovMap) ovMap.invalidateSize();
    if (name === 'harmonization' && inspMap) inspMap.invalidateSize();
    renderCurrent();
    $$(`#page-${name} canvas`).forEach(c => { if (CH[c.id]) CH[c.id].resize(); });
  });
}

/* ---------- Start ---------- */
function initMaps() {
  if (!window.L) { toast('The map library could not load. Check your connection.'); return; }
  canvasR = L.canvas({ padding: .3 });
  ovMap = L.map('overviewMap', { zoomControl: false, scrollWheelZoom: false, worldCopyJump: true, minZoom: 1 }).setView([12, 8], 1);
  ovBase = baseLayer('satellite');
  watchTiles(ovBase, 'Satellite', () => { ovMap.removeLayer(ovBase); $('overviewMapSub').textContent = 'The basemap could not load; hotspots are unaffected.'; });
  ovBase.addTo(ovMap);
  ovLayer = L.layerGroup().addTo(ovMap);
  exMap = L.map('explorerMap', { zoomControl: false, worldCopyJump: true, minZoom: 2 }).setView([14, 5], 2);
  exLayer = L.layerGroup().addTo(exMap);
  setBasemap('satellite');
  let mv; exMap.on('moveend', () => { clearTimeout(mv); mv = setTimeout(() => { if (currentPage === 'map' && !globeMode) renderExplorer(); else dirty.add('map'); }, 80); });
}
async function main() {
  try { await loadAll(); } catch (e) {
    $('loadTxt').textContent = 'Could not load the data bundle: ' + e.message + '. Serve this folder over HTTP, for example python3 -m http.server.';
    return;
  }
  S.to = META.days.length - 1;
  buildRegionMember();
  applyWindow();
  applyFilter();
  initControls(); initMaps(); renderLegend();
  $('dataPill').textContent = `● NASA FIRMS · ${META.days[0]} to ${META.days.at(-1)} · ${SERVER ? (SERVER.map_key_configured ? 'live API: MAP_KEY on server' : 'live: public FIRMS files') : 'static bundle'}`;
  $('serverState').classList.toggle('off', !SERVER);
  $('serverState').textContent = SERVER ? `Server online · ${SERVER.map_key_configured ? 'FIRMS MAP_KEY configured (kept on the server)' : 'no MAP_KEY: public NRT files only'}` : 'Static mode: no API server, so live FIRMS, weather and population requests are off.';
  $('mapNote').textContent = `Hotspots are NASA FIRMS detections from ${META.days[0]} to ${META.days.at(-1)}, not live alerts. Harmonized is the default layer; turning on raw layers shows the same fire more than once by design. Locations name the nearest entry in Natural Earth's populated places list and can be far from the fire. Basemaps © Esri.`;
  $$('.page').forEach(p => dirty.add(p.id.slice(5)));
  renderFilterChips(); syncControls();
  renderCurrent();
  $('loader').style.display = 'none';
}
main();
window.__HSE = { S, R: () => R, get NM() { return NM; }, get N() { return N; }, get SERVER() { return SERVER; }, get inFilter() { return inFilter; }, get harm() { return harm; }, get selected() { return selected; }, get T0() { return T0; },
  recordView, statusOf, strengthOf, satName, hsId, isoTime, baseLayer, chart, fmt, esc, toast, locText, frpText, visibleTest, histMode, satOn, get gVFrp() { return gVFrp; }, get modisMatched() { return modisMatched; }, get stats() { return stats; }, get META() { return META; }, get HIST() { return HIST; }, get layers() { return layers; }, get globe() { return globe; }, get exMap() { return exMap; }, get rotating() { return rotating; }, get charts() { return CH; }, goPage };
})();
