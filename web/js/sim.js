/* FIRELAB simulation space. Fires are real NASA FIRMS records from web/app-data; everything else is labelled
   MODELLED (weather, CAMS, population) or SCENARIO (the plume and what follows from it). */
(function () {
'use strict';
const F = window.FIRECORE;
const $ = id => document.getElementById(id);
const fmt = n => (n == null || !isFinite(n)) ? '—' : Math.round(n).toLocaleString('en-US');
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const sig = (x, d = 2) => x == null || !isFinite(x) ? '—' : x >= 100 ? fmt(x) : x.toPrecision(d);
const TYPES = { int32: Int32Array, uint32: Uint32Array, int16: Int16Array, uint16: Uint16Array, uint8: Uint8Array };
const WINDOW = 180, NO_DT = 65535, CONT = ['North America', 'South America', 'Europe', 'Africa', 'Asia', 'Oceania'];
const toast = msg => { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 3500); };

/* ---------- records (same bundle as the Hot Spot Explorer) ---------- */
let META, R, N, NM, T0, SERVER = null, harm, mMatched, gStr, vStr;
async function readAll(url, onProgress) {
  const res = await fetch(url); if (!res.ok) throw new Error(url + ' HTTP ' + res.status);
  const total = +res.headers.get('content-length') || 0, reader = res.body.getReader(), parts = []; let got = 0;
  for (;;) { const { done, value } = await reader.read(); if (done) break; parts.push(value); got += value.length; if (onProgress) onProgress(got, total); }
  const buf = new Uint8Array(got); let o = 0; for (const p of parts) { buf.set(p, o); o += p.length; } return buf;
}
async function gunzip(buf) {
  if (buf[0] !== 0x1f || buf[1] !== 0x8b) return buf;
  return new Uint8Array(await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
}
async function load() {
  [META, SERVER] = await Promise.all([fetch('app-data/meta.json').then(r => r.json()), F.serverStatus()]);
  const buf = await gunzip(await readAll('app-data/records.bin.gz', (g, t) => { if (t) $('simLoadBar').style.width = Math.min(100, 100 * g / t) + '%'; $('simLoadTxt').textContent = (g / 1e6).toFixed(1) + (t ? ' of ' + (t / 1e6).toFixed(1) : '') + ' MB'; }));
  R = {}; for (const c of META.columns) R[c.name] = new TYPES[c.type](buf.buffer, buf.byteOffset + c.offset, META.n);
  N = META.n; NM = META.n_modis; T0 = Date.parse(META.t0);
  // harmonized layer at the default window, with the same strength rules as the Lab (src/hotspots/harmonize.py)
  harm = new Uint8Array(N); harm.fill(1, 0, NM); mMatched = new Uint8Array(NM); gStr = new Uint8Array(NM); vStr = new Uint8Array(N);
  for (let i = NM; i < N; i++) {
    if (R.dt[i] > WINDOW) { harm[i] = 1; continue; }
    const m = R.mi[i]; mMatched[m] = 1;
    if (R.dist) {
      const core = R.dist[i] <= 0.5 * Math.min(R.scan[m], R.track[m]), amb = R.dt2[i] <= WINDOW && R.dt2[i] - R.dt[i] <= 15;
      const st = R.dt[i] <= 30 && core && !amb ? 1 : (R.dt[i] <= 30 || (R.dt[i] <= 120 && core && !amb)) ? 2 : 3;
      vStr[i] = st; if (!gStr[m] || st < gStr[m]) gStr[m] = st;
    }
  }
}
const hsId = i => i < NM ? 'HS-M' + String(i).padStart(6, '0') : 'HS-V' + String(i - NM).padStart(7, '0');
const idToIndex = id => { const m = /^HS-([MV])(\d+)$/.exec(id || ''); if (!m) return null; const i = m[1] === 'M' ? +m[2] : NM + +m[2]; return i >= 0 && i < N ? i : null; };
const satName = i => META.sat_names[R.sat[i]];
const isoTime = i => new Date(T0 + R.t[i] * 60000).toISOString().slice(0, 16).replace('T', ' ');
function place(i) {
  const p = R.place[i], pl = META.places, la = R.lat[i] / 1e5, lo = R.lon[i] / 1e5, r = Math.PI / 180;
  const x = Math.sin((pl.lat[p] - la) * r / 2) ** 2 + Math.cos(la * r) * Math.cos(pl.lat[p] * r) * Math.sin((pl.lon[p] - lo) * r / 2) ** 2, km = 12742 * Math.asin(Math.sqrt(x));
  return `${km < 300 ? 'near ' : ''}${pl.name[p]}${pl.country[p] ? ', ' + pl.country[p] : ''} (${Math.round(km)} km)`;
}
const STR = [null, 'strong', 'moderate', 'weak'];
function status(i) { if (i < NM) return mMatched[i] ? 'Matched · ' + (STR[gStr[i]] || '') : 'MODIS only'; return harm[i] ? 'VIIRS only' : 'Matched'; }

/* ---------- region ---------- */
let member = null;
function setRegion(name) {
  S.region = name;
  member = new Uint8Array(META.countries.length + 1);
  if (name === 'Global') member.fill(1);
  else META.countries.forEach((c, k) => { if (c === name || META.continents[k] === name) member[k + 1] = 1; });
}
function regionFires() {
  const out = [];
  for (let i = 0; i < N; i++) if (harm[i] && member[R.country[i] + 1]) out.push(i);
  out.sort((a, b) => R.frp[b] - R.frp[a]);
  return out;
}

/* ---------- state ---------- */
const S = { region: 'Global', fire: null, playing: null, pinned: null };
let anim = null, map, base, firesLayer, plumeLayer, ctx = null, last = null, plumeBounds = null, regionBounds = null, fitted = null, charts = {}, fires = [];

function fireInfo(i) {
  let frp = R.frp[i] / 100, n = 1;
  if ($('simCluster').checked) { // neighbours from the same satellite and overpass within 2 km, assumed to be one fire
    frp = 0; n = 0;
    const lat = R.lat[i], lon = R.lon[i], s = R.sat[i], t = R.t[i], lo = i < NM ? 0 : NM, hi = i < NM ? NM : N;
    const dLat = 2 / 111.195 * 1e5, dLon = dLat / Math.max(.2, Math.cos(lat / 1e5 * Math.PI / 180));
    for (let k = lo; k < hi; k++) if (R.sat[k] === s && Math.abs(R.t[k] - t) <= 10 && Math.abs(R.lat[k] - lat) <= dLat && Math.abs(R.lon[k] - lon) <= dLon) { frp += R.frp[k] / 100; n++; }
  }
  return { i, frp, n, lat: R.lat[i] / 1e5, lon: R.lon[i] / 1e5, iso: isoTime(i).replace(' ', 'T') + ':00Z', night: !!R.night[i] };
}

const facts = rows => rows.map(([k, v, wide]) => `<div class="fact${wide ? ' wide' : ''}"><span>${k}</span><b title="${String(v).replace(/<[^>]+>/g, '').replace(/"/g, '&quot;')}">${v}</b></div>`).join('');
function showTab(name) {
  document.querySelectorAll('.sim-tabs [role=tab]').forEach(t => t.setAttribute('aria-selected', t.dataset.tab === name));
  document.querySelectorAll('.sim-pane').forEach(p => { p.hidden = p.dataset.pane !== name; });
  requestAnimationFrame(() => Object.values(charts).forEach(c => c.resize()));
}

/* ---------- UI setup ---------- */
function initUI() {
  const names = [...new Set(META.countries)].sort();
  $('simRegion').innerHTML = `<option>Global</option><optgroup label="Regions">${CONT.map(c => `<option>${c}</option>`).join('')}</optgroup><optgroup label="Countries">${names.map(c => `<option>${esc(c)}</option>`).join('')}</optgroup>`;
  $('simBiome').innerHTML = F.BIOMES.map(b => `<option value="${b.k}">${b.label} · ${b.ef} ± ${b.sd} g/kg</option>`).join('');
  $('simLegend').innerHTML = `<div class="ttl">Added PM2.5 · µg/m³ · scenario</div><div class="bar">${F.BAND_COL.map(c => `<i style="background:${c}"></i>`).join('')}</div><div class="ticks">${F.BANDS.map(b => `<span>${b}</span>`).join('')}</div>`;
  $('simMethodList').innerHTML = [
    '<b>Observed:</b> each fire is one NASA FIRMS detection (MODIS C6.1 or VIIRS 375 m NRT): position, time and fire radiative power (FRP) at the overpass. The fires listed are the harmonized layer (180 min window), so a MODIS–VIIRS duplicate appears once.',
    `<b>Emission (scenario):</b> PM2.5 = FRP × ${F.COMBUSTION} kg/MJ (Wooster et al., 2005) × emission factor (Akagi et al., 2011, Table 1). The range shown uses the factor's mean ± 1 standard deviation. The fire is assumed to burn at the observed FRP for the hours chosen; real fires change within minutes. A single pixel's FRP undercounts a fire spread over several pixels; the 2 km option sums them, assuming one fire.`,
    '<b>Weather (modelled):</b> hourly 10 m and 100 m wind, boundary-layer height and cloud from Open-Meteo best-match models (ERA5 for older dates), at the hour nearest the overpass. Transport uses the 100 m wind. Play and the wind sweep keep that weather fixed and only extend time or change speed.',
    `<b>Dispersion (scenario):</b> steady-state Gaussian plume. Plume-top height from FRP and boundary-layer height (Sofiev et al., 2012, calibrated on MISR plume heights); smoke spread evenly up to the plume top, with only the share below the boundary-layer top reaching the ground unless the worst case is ticked; Pasquill–Turner stability; Briggs open-country σy, σz; ground reflection and a mixing-height lid. Straight-line wind, flat terrain, no chemistry, no secondary aerosol, no deposition, downwind only, up to ${F.MAX_KM} km.`,
    '<b>Population (modelled):</b> GHS-POP R2023A epoch 2025 (European Commission JRC), 0.025° cells. It counts residents, not people present or confirmed exposed.',
    '<b>CAMS PM2.5 (modelled):</b> Copernicus atmospheric composition model at the fire, all sources, for context. It is not a measurement and already includes some fire smoke.',
    '<b>Validation:</b> none. The plume has not been compared with ground monitors or satellite smoke for these fires. Treat values as an order of magnitude.',
  ].map(x => `<li>${x}</li>`).join('');

  map = L.map('simMap', { worldCopyJump: true, zoomControl: true, preferCanvas: true }).setView([10, 20], 3);
  base = L.layerGroup([L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, maxNativeZoom: 17, attribution: 'Imagery © Esri and its contributors' }), L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, maxNativeZoom: 17, attribution: 'Labels © Esri' })]).addTo(map);
  firesLayer = L.layerGroup().addTo(map); plumeLayer = L.layerGroup().addTo(map);
  anim = window.SIMANIM ? SIMANIM.create(map) : null;
  [['simAnimWind', 'wind'], ['simAnimSmoke', 'smoke']].forEach(([id, kind]) => {
    const b = $(id);
    if (!anim) { b.disabled = true; b.setAttribute('aria-pressed', 'false'); return; }
    b.setAttribute('aria-pressed', anim.on[kind]);
    b.addEventListener('click', () => { const on = b.getAttribute('aria-pressed') !== 'true'; b.setAttribute('aria-pressed', on); anim.set(kind, on); });
  });
  document.querySelectorAll('.sim-tabs [role=tab]').forEach(t => t.addEventListener('click', () => showTab(t.dataset.tab)));

  $('simRegion').addEventListener('change', () => { setRegion($('simRegion').value); buildFires(true); });
  $('simFire').addEventListener('change', () => selectFire(+$('simFire').value));
  $('simCluster').addEventListener('change', () => selectFire(S.fire, true));
  ['simBiome', 'simTrap', 'simRange'].forEach(id => $(id).addEventListener('change', schedule));
  $('simHours').addEventListener('input', () => { stopPlay(); schedule(); });
  $('simWindOverride').addEventListener('change', () => { $('simWindBox').hidden = !$('simWindOverride').checked; schedule(); });
  ['simWs', 'simWd'].forEach(id => $(id).addEventListener('input', schedule));
  $('simPlay').addEventListener('click', () => S.playing ? stopPlay() : startPlay());
  $('simPin').addEventListener('click', pin);
  $('simUnpin').addEventListener('click', () => { S.pinned = null; $('simUnpin').disabled = true; $('simPinned').textContent = 'Pin a scenario, change a setting or the fire, and the charts show A (dashed) beside the current run.'; schedule(); });
  $('simZoomPlume').addEventListener('click', () => plumeBounds && map.fitBounds(plumeBounds, { padding: [30, 30], maxZoom: 12 }));
  $('simZoomRegion').addEventListener('click', () => regionBounds && map.fitBounds(regionBounds, { padding: [20, 20] }));
  $('simShowFires').addEventListener('click', () => { const on = !map.hasLayer(firesLayer); if (on) firesLayer.addTo(map); else map.removeLayer(firesLayer); $('simShowFires').setAttribute('aria-pressed', on); });
  const stage = $('simStage');
  $('simFull').addEventListener('click', async () => {
    if (document.fullscreenElement === stage) { await document.exitFullscreen(); return; }
    if (stage.classList.contains('fullscreen')) { stage.classList.remove('fullscreen'); setTimeout(() => map.invalidateSize(), 100); return; }
    try { await stage.requestFullscreen(); } catch (e) { stage.classList.add('fullscreen'); setTimeout(() => map.invalidateSize(), 100); }
  });
  document.addEventListener('fullscreenchange', () => { $('simFull').textContent = document.fullscreenElement ? '✕' : '⛶'; setTimeout(() => map.invalidateSize(), 150); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { if (stage.classList.contains('fullscreen')) { stage.classList.remove('fullscreen'); setTimeout(() => map.invalidateSize(), 100); } if (!$('simHow').hidden) $('simHow').hidden = true; } });
  const placeGo = async () => {
    const q = $('simPlace').value.trim(); if (!q) return;
    try {
      const d = await F.getJSON('https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates?f=json&maxLocations=1&singleLine=' + encodeURIComponent(q), 10000), c = d.candidates && d.candidates[0];
      if (c && c.score >= 70) { map.flyTo([c.location.y, c.location.x], 8); toast('Flying to ' + c.address + '. Click an orange dot to simulate that fire.'); return; }
    } catch (e) { /* fall through */ }
    toast('Place not found. Try a city or country.');
  };
  $('simPlaceGo').addEventListener('click', placeGo); $('simPlace').addEventListener('keydown', e => { if (e.key === 'Enter') placeGo(); });
  const how = $('simHow');
  $('simHelp').addEventListener('click', () => { how.hidden = false; });
  $('simHowClose').addEventListener('click', () => { how.hidden = true; try { localStorage.setItem('simHow', '1'); } catch (e) { /* no storage */ } });
  how.addEventListener('click', e => { if (e.target === how) how.hidden = true; });
  $('themeToggle').addEventListener('click', () => { document.body.classList.toggle('light'); try { localStorage.setItem('theme', document.body.classList.contains('light') ? 'light' : 'dark'); } catch (e) { /* no storage */ } $('themeToggle').textContent = document.body.classList.contains('light') ? '☾' : '☼'; Object.values(charts).forEach(c => c.destroy()); charts = {}; schedule(); });
  window.addEventListener('resize', () => { clearTimeout(window._rz); window._rz = setTimeout(() => { map.invalidateSize(); Object.values(charts).forEach(c => c.resize()); }, 150); });
}

/* ---------- fires of the region ---------- */
function buildFires(fitRegion) {
  fires = regionFires();
  firesLayer.clearLayers();
  const show = fires.slice(0, 4000), rend = L.canvas({ padding: .3 });
  show.forEach(i => {
    const frp = R.frp[i] / 100;
    L.circleMarker([R.lat[i] / 1e5, R.lon[i] / 1e5], { renderer: rend, radius: Math.min(9, 2.5 + Math.log10(1 + frp) * 2), weight: 1, color: '#ffe4de', fillColor: '#ff7a1f', fillOpacity: .9, className: 'sim-fire-pt' })
      .bindTooltip(`<div class="hs-tip"><b class="t">🔥 ${hsId(i)} · ${frp.toFixed(1)} MW</b><hr><div>${esc(place(i))}</div><div>${esc(satName(i))} · ${isoTime(i)} UTC · ${R.night[i] ? 'night' : 'day'}</div><small>Click to simulate this fire</small></div>`, { direction: 'top' })
      .on('click', () => selectFire(i)).addTo(firesLayer);
  });
  // list: typical daytime fires (20–300 MW) spread through that range, then the strongest
  const mid = fires.filter(i => R.frp[i] >= 2000 && R.frp[i] <= 30000 && !R.night[i]), typ = [];
  for (let k = 0; k < 30 && mid.length; k++) { const i = mid[Math.floor(k * (mid.length - 1) / 29)]; if (!typ.includes(i)) typ.push(i); }
  const top = fires.slice(0, 30).filter(i => !typ.includes(i));
  const opt = i => `<option value="${i}">${hsId(i)} · ${(R.frp[i] / 100).toFixed(0)} MW · ${esc(place(i).replace(/ \(\d+ km\)$/, ''))} · ${isoTime(i).slice(5)}${R.night[i] ? ' · night' : ''}</option>`;
  const cur = S.fire != null && !typ.includes(S.fire) && !top.includes(S.fire) ? `<optgroup label="Selected">${opt(S.fire)}</optgroup>` : '';
  $('simFire').innerHTML = fires.length ? cur + (typ.length ? `<optgroup label="Typical daytime fires (20–300 MW)">${typ.map(opt).join('')}</optgroup>` : '') + `<optgroup label="Highest FRP">${top.map(opt).join('')}</optgroup>` : '<option>No fires in this region in the bundle</option>';
  if (S.fire != null) $('simFire').value = S.fire;
  if (fitRegion && fires.length) {
    let a = 1e9, b = -1e9, c = 1e9, d = -1e9; for (const i of fires) { a = Math.min(a, R.lat[i]); b = Math.max(b, R.lat[i]); c = Math.min(c, R.lon[i]); d = Math.max(d, R.lon[i]); }
    if (S.region !== 'Global' && d - c < 300e5) map.fitBounds([[a / 1e5, c / 1e5], [b / 1e5, d / 1e5]], { padding: [20, 20], animate: false });
    if (S.fire == null || !member[R.country[S.fire] + 1]) selectFire(typ[Math.floor(typ.length / 2)] ?? fires[0]);
  }
  $('simPill').textContent = `NASA FIRMS · ${META.days[0]} to ${META.days.at(-1)} · ${fmt(fires.length)} fires in ${S.region}${SERVER ? '' : ' · static mode'}`;
}

/* ---------- one fire: fetch its weather and population once, then every setting runs locally ---------- */
let selSeq = 0;
async function selectFire(i, keepView) {
  if (i == null || isNaN(i)) return;
  stopPlay();
  const seq = ++selSeq; S.fire = i;
  if ($('simFire').querySelector(`option[value="${i}"]`)) $('simFire').value = i; else buildFires(false);
  const f = fireInfo(i);
  history.replaceState(null, '', `?fire=${hsId(i)}`);
  $('simFireInfo').innerHTML = facts([['Location', esc(place(i)), 1], ['Fire power', `${f.frp.toFixed(1)} MW${f.n > 1 ? ` · ${f.n} px` : ''}`], ['Seen (UTC)', isoTime(i).slice(5)], ['Satellite', `${esc(satName(i))} · ${f.night ? 'night' : 'day'}`], ['Record', `${hsId(i)}`], ['Match', status(i), 1]]);
  const lat = Math.abs(f.lat); $('simBiome').value = lat >= 50 ? 'boreal' : lat >= 30 ? 'temperate' : 'savanna';
  $('simWx').className = 'sim-facts'; $('simWx').innerHTML = '<div class="fact wide"><span>Weather</span><b>Loading modelled weather…</b></div>';
  // nothing from the previous fire stays on screen while this one loads
  ctx = null; last = null; $('simPin').disabled = true; plumeLayer.clearLayers(); $('simOverlay').innerHTML = ''; $('simHud').hidden = true; if (anim) anim.setScene(null);
  ['rQ', 'rC', 'rP', 'rM'].forEach(id => { $(id).textContent = '…'; });
  $('simEmpty').textContent = `Loading modelled weather and population for ${hsId(i)}…`;
  L.marker([f.lat, f.lon], { icon: L.divIcon({ className: '', iconSize: [0, 0], html: `<div class="fl-fire"><div class="dot"></div><div class="lab">${hsId(i)} · ${f.frp.toFixed(0)} MW<small>loading…</small></div></div>` }), keyboard: false }).addTo(plumeLayer);
  if (!keepView) map.setView([f.lat, f.lon], Math.max(map.getZoom(), 7));
  const dom = F.domain(f.lat, f.lon);
  let wx, pop = null, popErr = null;
  try { wx = await F.weather(+f.lat.toFixed(3), +f.lon.toFixed(3), f.iso, !!SERVER); } catch (e) { wx = { errors: { weather: 'weather service unreachable' } }; }
  try { pop = await F.population(dom, SERVER); } catch (e) { popErr = e.message; }
  if (seq !== selSeq) return;
  const T = new Date(f.iso), hrs = wx.weather ? wx.weather.time : [];
  let k = hrs.findIndex(t => Math.abs(Date.parse(t + 'Z') - T) <= 30 * 60000); if (k < 0 && hrs.length) k = 0;
  const g = (n, d = null) => wx.weather && wx.weather[n] && wx.weather[n][k] != null ? wx.weather[n][k] : d;
  const camsK = wx.air_quality ? wx.air_quality.time.findIndex(t => Math.abs(Date.parse(t + 'Z') - T) <= 30 * 60000) : -1;
  ctx = { f, T, wx, k, grid: pop && pop.rows ? pop : F.plainGrid(dom), hasPop: !!(pop && pop.rows), popErr,
    ws: g('wind_speed_100m'), wd: g('wind_direction_100m'), u10: g('wind_speed_10m'), blh: g('boundary_layer_height'), cloud: g('cloud_cover', 50),
    cams: camsK >= 0 ? wx.air_quality.pm2_5[camsK] : null };
  if (!$('simWindOverride').checked && ctx.ws != null) { $('simWs').value = Math.min(20, Math.max(.5, Math.round(ctx.ws * 2) / 2)); $('simWd').value = Math.round(ctx.wd) % 360; }
  $('simWx').className = 'sim-facts';
  $('simWx').innerHTML = wx.weather ? facts([['Wind 100 m', `${sig(ctx.ws)} m/s from ${fmt(ctx.wd)}°`], ['Wind 10 m', `${sig(g('wind_speed_10m'))} m/s from ${fmt(g('wind_direction_10m'))}°`], ['Mixing layer', ctx.blh != null ? fmt(ctx.blh) + ' m' : '1,000 m assumed'], ['Cloud', fmt(ctx.cloud) + '%'], ['Air temp · RH', `${sig(g('temperature_2m'), 3)} °C · ${fmt(g('relative_humidity_2m'))}%`], ['Hour used', hrs[k].slice(5).replace('T', ' ') + ' UTC']]) + `<div class="panel-sub" style="grid-column:1/-1;margin-top:2px">${esc(wx.weather_source || '')}</div>`
    : `<div class="fact wide"><span>Weather</span><b style="white-space:normal">Modelled weather unavailable (${esc(Object.values(wx.errors || {}).join('; '))}). Open “More options” and set your own wind.</b></div>`;
  drawWx();
  $('simPin').disabled = false;
  if (!keepView) fitted = null;
  compute(true);
}

function params() {
  const ov = $('simWindOverride').checked, b = F.BIOMES.find(x => x.k === $('simBiome').value);
  const ws = ov ? +$('simWs').value : ctx.ws, wd = ov ? +$('simWd').value : ctx.wd;
  return { lat: ctx.f.lat, lon: ctx.f.lon, frp: ctx.f.frp, ws, wd, u10: ov ? ws * .75 : ctx.u10, blh: ctx.blh, cloud: ctx.cloud, time: ctx.T, ef: b.ef, sd: b.sd, biome: b, hours: +$('simHours').value, trap: $('simTrap').checked, override: ov };
}

let sched = null, sweepT = null;
function schedule() { clearTimeout(sched); sched = setTimeout(() => compute(true), 40); }

/* ---------- run the model and draw everything ---------- */
function compute(withSweep) {
  if (!ctx) return;
  $('simHoursV').textContent = $('simHours').value; $('simWsV').textContent = $('simWs').value; $('simWdV').textContent = $('simWd').value;
  $('simCompass').style.transform = `rotate(${(+$('simWd').value + 180) % 360}deg)`;
  const p = params();
  if (p.ws == null || p.wd == null) { plumeLayer.clearLayers(); if (anim) anim.setScene(null); $('simHud').hidden = true; $('simEmpty').textContent = 'No modelled wind for this fire. Open “More options” and set your own wind to run a scenario.'; return; }
  const range = $('simRange').checked, scales = range ? [1, Math.max(0, (p.ef - p.sd) / p.ef), (p.ef + p.sd) / p.ef] : [1];
  const r = F.simulate(p, ctx.grid, { scales });
  last = { p, r, range };
  drawPlume(p, r);
  drawResults(p, r, range);
  drawProfile(); drawBands();
  if (withSweep) { clearTimeout(sweepT); sweepT = setTimeout(drawSweep, S.playing ? 10 : 200); }
}

function drawPlume(p, r) {
  const f = ctx.f;
  plumeLayer.clearLayers();
  const g = ctx.grid, rend = L.canvas({ padding: .2 });
  r.cells.forEach(([la, lo, b, C, pop]) => L.rectangle([[la - g.dy / 2, lo - g.dx / 2], [la + g.dy / 2, lo + g.dx / 2]], { renderer: rend, stroke: false, fillColor: F.BAND_COL[b], fillOpacity: .42 })
    .bindTooltip(`Scenario · ${sig(C)} µg/m³ added (hourly mean, cell average)${ctx.hasPop ? ` · ${fmt(pop)} residents` : ''}`, { sticky: true }).addTo(plumeLayer));
  if (r.env[0].length > 1) L.polygon([[f.lat, f.lon], ...r.env[0], ...r.env[1].slice().reverse()], { color: '#ff7a3d', weight: 2, dashArray: '5 4', fill: false, interactive: false }).addTo(plumeLayer);
  const km = r.xmax / 1000, end = [f.lat + r.dn * km / 111.195, f.lon + r.de * km / (111.195 * r.clat)];
  L.polyline([[f.lat, f.lon], end], { color: '#21d9ee', weight: 2, dashArray: '6 6' }).bindTooltip(`Wind toward ${fmt(r.toward)}° at ${sig(r.u)} m/s (${p.override ? 'scenario' : 'modelled'}) · smoke front after ${p.hours} h`).addTo(plumeLayer);
  const peak = r.cmax >= .1 ? `peak ${sig(r.cmax)} µg/m³` : 'peak < 0.1 µg/m³', ppl = ctx.hasPop ? `${fmt(r.people[2])} people ≥ 15` : 'population: needs server';
  L.marker([f.lat, f.lon], { icon: L.divIcon({ className: '', iconSize: [0, 0], html: `<div class="fl-fire"><div class="arrow" style="transform:rotate(${r.toward}deg)"></div><div class="dot"></div><div class="lab">${hsId(f.i)} · ${f.frp.toFixed(0)} MW<small>${peak} · ${ppl}</small></div></div>` }), keyboard: false, zIndexOffset: 1000 }).addTo(plumeLayer);
  if (anim) anim.setScene({ f, p, r });
  $('simHud').hidden = false; $('simHudArrow').style.transform = `rotate(${r.toward}deg)`;
  $('simHudSpeed').textContent = `${sig(r.u)} m/s`; $('simHudDir').textContent = `from ${fmt(p.wd % 360)}° · ${p.override ? 'your wind' : 'modelled'}`;
  const pts = r.cells.map(c => [c[0], c[1]]).concat(r.env[0], r.env[1], [[f.lat, f.lon], end]);
  plumeBounds = L.latLngBounds(pts).pad(.15);
  const span = Math.max(3, 4 * km / 111.195); regionBounds = L.latLngBounds([[f.lat - span, f.lon - span / r.clat], [f.lat + span, f.lon + span / r.clat]]);
  if (fitted !== f.i) { fitted = f.i; const b = plumeBounds, fit = () => map.fitBounds(b, { padding: [30, 30], maxZoom: 12 }); if (map._animatingZoom) map.once('zoomend', fit); else fit(); } // Leaflet drops a new view while a zoom animation runs
  $('simEmpty').textContent = r.cells.length ? '' : `No ground-level PM2.5 above ${F.BANDS[0]} µg/m³ in this scenario (peak ${r.cmax >= .1 ? sig(r.cmax) + ' µg/m³' : 'below 0.1 µg/m³'}). Try more hours, the worst case, or a larger fire.`;
  $('simOverlay').innerHTML = `<b>${hsId(f.i)}</b> · ${f.frp.toFixed(1)} MW · ${isoTime(f.i)} UTC<br>Wind ${sig(r.u)} m/s toward ${fmt(r.toward)}° <span class="dtag ${p.override ? 'scn' : 'mod'}" style="padding:1px 5px">${p.override ? 'SCENARIO' : 'MODELLED'}</span><br>Plume top ${fmt(r.top)} m · ${Math.round(100 * r.share)}% in boundary layer · class ${r.cls}<br>${peak} · ${ppl} <span class="dtag scn" style="padding:1px 5px">SCENARIO</span>`;
  const air = { A: 'very unstable', B: 'unstable', C: 'slightly unstable', D: 'neutral', E: 'slightly stable', F: 'stable' }[r.cls];
  $('simStab').innerHTML = `Air is <b>${air}</b> (class ${r.cls}, sun ${r.elev.toFixed(0)}°). Smoke rises to about <b>${fmt(r.top)} m</b>; ${r.share < 1 ? `<b>${Math.round(100 * r.share)}%</b> stays below the ${fmt(r.Lmix)} m mixing layer and can reach the ground` : p.trap && r.top > r.Lmix ? 'worst case: all of it is held near the ground' : `all of it stays in the ${fmt(r.Lmix)} m mixing layer`}. It travels <b>${fmt(km)} km</b> in ${p.hours} h.`;
}

function drawResults(p, r, range) {
  $('rQ').textContent = `${sig(r.Q * 3.6 * p.hours, 3)} kg`; $('rQf').textContent = `PM2.5 in ${p.hours} h · ${sig(r.Q)} g/s · ${p.biome.label.toLowerCase()}`;
  $('rC').textContent = r.cmax >= .1 ? sig(r.cmax) : '< 0.1'; $('rCf').textContent = r.cmax >= .1 ? `µg/m³ added, ${sig(r.xAt / 1000)} km downwind` : 'µg/m³ added at ground level';
  const lo = range ? r.peopleS[1][2] : null, hi = range ? r.peopleS[2][2] : null;
  $('rP').textContent = ctx.hasPop ? fmt(r.people[2]) : 'Needs server';
  $('rPf').textContent = ctx.hasPop ? (range ? `range ${fmt(lo)}–${fmt(hi)} · residents` : 'residents · GHS-POP 2025') : (ctx.popErr ? 'population request failed' : 'start python -m hotspots.server');
  $('rM').textContent = ctx.cams != null ? `${sig(ctx.cams)} µg/m³` : 'n/a';
  $('simBands').innerHTML = F.BANDS.map((b, k) => `<tr><td style="text-align:left"><i style="display:inline-block;width:9px;height:9px;border-radius:2px;background:${F.BAND_COL[k]};margin-right:5px"></i>≥ ${b}</td><td>${fmt(r.area[k])}</td><td>${ctx.hasPop ? fmt(r.people[k]) : '—'}</td><td>${ctx.hasPop && range ? `${fmt(r.peopleS[1][k])}–${fmt(r.peopleS[2][k])}` : '—'}</td></tr>`).join('');
}

/* ---------- charts ---------- */
const muted = () => getComputedStyle(document.body).getPropertyValue('--muted').trim() || '#90a9b7';
function baseOpts(extra = {}) {
  const m = muted();
  return { responsive: true, maintainAspectRatio: false, animation: false, interaction: { mode: 'index', intersect: false },
    plugins: { legend: { labels: { color: m, boxWidth: 8, font: { size: 11 } } } },
    scales: { x: { ticks: { color: m, font: { size: 10.5 }, maxTicksLimit: 8 }, grid: { color: '#8ca5b31a' } }, y: { beginAtZero: true, ticks: { color: m, font: { size: 10.5 } }, grid: { color: '#8ca5b31a' } } }, ...extra };
}
function put(id, cfg) { if (charts[id]) { charts[id].data = cfg.data; charts[id].options = cfg.options; charts[id].update('none'); } else charts[id] = new Chart($(id), cfg); }
function drawProfile() {
  const cur = last.r.profile.filter(([, c]) => c != null).map(([x, c]) => ({ x, y: c }));
  const ds = [{ label: 'Current', data: cur, borderColor: '#ff7a1f', backgroundColor: '#ff7a1f33', fill: true, pointRadius: 0, borderWidth: 2 }];
  if (S.pinned) ds.push({ label: 'A · ' + S.pinned.label, data: S.pinned.profile, borderColor: '#21d9ee', borderDash: [5, 4], pointRadius: 0, borderWidth: 2, fill: false });
  const o = baseOpts(); o.scales.x = { type: 'logarithmic', min: .1, max: F.MAX_KM, title: { display: true, text: 'km downwind (log scale)', color: muted(), font: { size: 10.5 } }, ticks: { color: muted(), font: { size: 10.5 }, callback: v => [0.1, 1, 10, 100].includes(v) ? v : '' }, grid: { color: '#8ca5b31a' } };
  o.scales.y.title = { display: true, text: 'µg/m³ added', color: muted(), font: { size: 10.5 } };
  o.plugins.tooltip = { callbacks: { title: it => sig(it[0].parsed.x) + ' km', label: c => `${c.dataset.label}: ${sig(c.parsed.y)} µg/m³` } };
  put('cProfile', { type: 'line', data: { datasets: ds }, options: o });
}
function drawBands() {
  const labels = F.BANDS.map(b => '≥ ' + b), cur = ctx.hasPop ? last.r.people : last.r.area;
  const ds = [{ label: ctx.hasPop ? 'People, current' : 'Area km², current', data: cur, backgroundColor: F.BAND_COL.map(c => c + 'dd'), borderWidth: 0 }];
  if (S.pinned) ds.push({ label: 'A · ' + S.pinned.label, data: ctx.hasPop ? S.pinned.people : S.pinned.area, backgroundColor: '#21d9ee55', borderColor: '#21d9ee', borderWidth: 1 });
  const o = baseOpts(); o.scales.y.title = { display: true, text: ctx.hasPop ? 'residents (GHS-POP 2025)' : 'km² (start the server for people)', color: muted(), font: { size: 10.5 } };
  o.scales.x.title = { display: true, text: 'µg/m³ added, hourly mean', color: muted(), font: { size: 10.5 } };
  put('cBands', { type: 'bar', data: { labels, datasets: ds }, options: o });
}
function drawSweep() {
  if (!last) return;
  const speeds = []; for (let s = 1; s <= 15; s++) speeds.push(s);
  const peak = [], ppl = [];
  speeds.forEach(s => { const q = { ...last.p, ws: s, u10: s * .75 }; const r = F.simulate(q, ctx.grid, { noGrid: !ctx.hasPop }); peak.push(r.cmax); ppl.push(ctx.hasPop ? r.people[2] : null); });
  const curU = Math.max(1, last.p.ws), mark = speeds.map(s => Math.abs(s - curU) < .5 ? 6 : 0);
  const ds = [{ label: 'Peak µg/m³', data: peak, borderColor: '#ff7a1f', backgroundColor: '#ff7a1f', yAxisID: 'y', pointRadius: mark, borderWidth: 2 }];
  if (ctx.hasPop) ds.push({ label: 'People ≥ 15 µg/m³', data: ppl, borderColor: '#45e0a0', backgroundColor: '#45e0a0', yAxisID: 'y2', pointRadius: mark, borderWidth: 2 });
  const o = baseOpts(); o.scales.x.title = { display: true, text: 'wind speed, m/s', color: muted(), font: { size: 10.5 } };
  o.scales.y.title = { display: true, text: 'peak µg/m³', color: muted(), font: { size: 10.5 } };
  if (ctx.hasPop) o.scales.y2 = { position: 'right', beginAtZero: true, ticks: { color: muted(), font: { size: 10.5 } }, grid: { display: false }, title: { display: true, text: 'people', color: muted(), font: { size: 10.5 } } };
  put('cSweep', { type: 'line', data: { labels: speeds, datasets: ds }, options: o });
}
function drawWx() {
  const w = ctx.wx; if (!w.weather) { if (charts.cWx) { charts.cWx.destroy(); delete charts.cWx; } return; }
  const lab = w.weather.time.map(t => t.slice(5, 13).replace('T', ' ') + 'h');
  const pm = w.air_quality && w.air_quality.pm2_5 ? w.weather.time.map(t => { const j = w.air_quality.time.indexOf(t); return j >= 0 ? w.air_quality.pm2_5[j] : null; }) : [];
  const mark = w.weather.time.map((_, j) => j === ctx.k ? 5 : 0);
  const o = baseOpts(); o.scales.y.title = { display: true, text: 'm/s', color: muted(), font: { size: 10.5 } };
  o.scales.y2 = { position: 'right', beginAtZero: true, ticks: { color: muted(), font: { size: 10.5 } }, grid: { display: false }, title: { display: true, text: 'µg/m³', color: muted(), font: { size: 10.5 } } };
  put('cWx', { type: 'line', data: { labels: lab, datasets: [
    { label: 'Wind 100 m', data: w.weather.wind_speed_100m, borderColor: '#21d9ee', backgroundColor: '#21d9ee', pointRadius: mark, borderWidth: 2 },
    { label: 'Wind 10 m', data: w.weather.wind_speed_10m, borderColor: '#7fb3c4', backgroundColor: '#7fb3c4', pointRadius: 0, borderWidth: 1.5 },
    { label: 'CAMS PM2.5', data: pm, borderColor: '#ff791f', backgroundColor: '#ff791f', yAxisID: 'y2', pointRadius: mark, borderWidth: 2 }] }, options: o });
}

/* ---------- compare and play ---------- */
function pin() {
  if (!last) return;
  const p = last.p, r = last.r;
  S.pinned = { label: `${hsId(ctx.f.i)}, ${p.hours} h, ${sig(r.u)} m/s${p.trap ? ', worst case' : ''}`, profile: r.profile.filter(([, c]) => c != null).map(([x, c]) => ({ x, y: c })), people: r.people.slice(), area: r.area.slice(), cmax: r.cmax, p15: r.people[2] };
  $('simUnpin').disabled = false;
  $('simPinned').innerHTML = `<b>A:</b> ${esc(S.pinned.label)} · peak ${sig(r.cmax)} µg/m³${ctx.hasPop ? ` · ${fmt(r.people[2])} people ≥ 15` : ''}. Now change something: the charts compare.`;
  compute(false); toast('Pinned as A');
}
function startPlay() {
  if (!ctx) return;
  let h = 1; $('simHours').value = h; $('simPlay').textContent = '⏸ Stop';
  S.playing = setInterval(() => {
    $('simHours').value = h; $('simHoursBadge').textContent = `▶ ${h} h after the overpass`; compute(h === 24);
    if (++h > 24) stopPlay();
  }, 450);
}
function stopPlay() { if (S.playing) { clearInterval(S.playing); S.playing = null; } $('simPlay').textContent = '▶ Play'; $('simHoursBadge').textContent = ''; }

/* ---------- start ---------- */
async function main() {
  try { await load(); } catch (e) { $('simLoadTxt').textContent = 'Could not load the data bundle: ' + e.message + '. Run python -m hotspots.server and open this page from it.'; return; }
  initUI();
  const want = idToIndex(new URLSearchParams(location.search).get('fire'));
  setRegion('Global');
  if (want != null && R.country[want] >= 0) { setRegion(META.countries[R.country[want]]); $('simRegion').value = S.region; S.fire = want; }
  buildFires(want == null ? false : true);
  $('simLoading').hidden = true;
  if (want != null) selectFire(want);
  else { const typ = fires.filter(i => R.frp[i] >= 2000 && R.frp[i] <= 30000 && !R.night[i]); selectFire(typ[Math.floor(typ.length / 2)] ?? fires[0]); }
  let seen = false; try { seen = localStorage.getItem('simHow') === '1'; } catch (e) { /* no storage */ }
  if (!seen) $('simHow').hidden = false;
  if (!SERVER) toast('Static mode: start python -m hotspots.server for population exposure.');
}
main();
window.__SIM = { get last() { return last; }, get ctx() { return ctx; }, selectFire, map: () => map, S };
})();
