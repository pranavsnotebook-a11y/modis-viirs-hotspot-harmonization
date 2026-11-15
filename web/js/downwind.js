/* DOWNWIND page. Fires are real NASA FIRMS records (web/app-data); assets are OpenStreetMap features; wind is
   modelled (Open-Meteo); the smoke path is a FIRELAB scenario. No number here is a measurement of smoke.
   The rules that decide what is listed are in downwind-core.js and RULES below, and are shown in the Method dialog. */
(function () {
'use strict';
const F = window.FIRECORE, D = window.DOWNWIND, FAST = window.FAST, W = window.WATCH, B = window.BULLETIN;
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const sig = B.sig, sigEN = sig;
const toast = msg => { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.remove('show'), 3200); };
const TYPES = { int32: Int32Array, uint32: Uint32Array, int16: Int16Array, uint16: Uint16Array, uint8: Uint8Array };

const RULES = W.rules(), RG = window.REGIONS, MAX_CELLS = W.MAX_CELLS; // the rules and the wind-cell cap live in watch-core.js
let REGION = null; // the region whose time zone, view and words are in use: the selected one, or Paraguay while the replay is shown
const KINDS = W.KINDS;
const S = { mode: 'live', kind: 'power', hours: 24, lang: 'en', fmt: 'full', sel: null, region: 'PY' };
let FASTD = null, LIVE = null, REPLAY = null, ASSETS = null, BUNDLE = null, hits = {}, map, gAssets, gFires, gSel, speaking = false;

/* ---------- loading ---------- */
async function gz(url) {
  const r = await fetch(url); if (!r.ok) throw new Error(url + ' HTTP ' + r.status);
  const b = new Uint8Array(await r.arrayBuffer());
  const raw = b[0] === 0x1f && b[1] === 0x8b ? new Uint8Array(await new Response(new Blob([b]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()) : b;
  return raw;
}
const gzJSON = async url => JSON.parse(new TextDecoder().decode(await gz(url)));

async function loadBundle() { // the global bundle is downloaded once; each region is a filter on it
  if (BUNDLE) return BUNDLE;
  const META = await (await fetch('app-data/meta.json')).json();
  const buf = await gz('app-data/records.bin.gz');
  const R = {}; for (const c of META.columns) R[c.name] = new TYPES[c.type](buf.buffer, buf.byteOffset + c.offset, META.n);
  return (BUNDLE = { META, R });
}
async function loadLive(reg) {
  const { META, R } = await loadBundle();
  const N = META.n, NM = META.n_modis, T0 = Date.parse(META.t0), k = META.countries.indexOf(reg.country), W = META.default_window || 180;
  if (k < 0) throw new Error('"' + reg.country + '" is not in meta.json countries');
  const all = [], harm = [];
  for (let i = 0; i < N; i++) {
    if (R.country[i] !== k) continue;
    const d = { id: i < NM ? 'HS-M' + String(i).padStart(6, '0') : 'HS-V' + String(i - NM).padStart(7, '0'), lat: R.lat[i] / 1e5, lon: R.lon[i] / 1e5,
      ms: T0 + R.t[i] * 60000, sat: META.sat_names[R.sat[i]], frp: R.frp[i] / 100 };
    d.time = new Date(d.ms).toISOString().slice(0, 16) + 'Z';
    all.push(d);
    if (i < NM || R.dt[i] > W) harm.push(d); // the harmonized layer: every MODIS record, and VIIRS records with no MODIS partner
  }
  return { META, all, harm, end: all.reduce((m, d) => Math.max(m, d.ms), 0) };
}

/* ---------- assets: prepared by watch-core.js ---------- */
const layerInfo = W.layerInfo, prepAssets = W.prepAssets, nearPlace = W.nearPlace;

/* ---------- weather: the cache and the fetch live in watch-core.js; the page only chooses the date range ---------- */
const WIND = W.createWind({ getJSON: F.getJSON, server: 'api/wind', storage: (() => { try { return sessionStorage; } catch (e) { return null; } })() }); // sessionStorage: a second tab reuses cells already fetched in this tab
let wxr = null; // the date range of the current computation
const wxRange = () => W.liveRange(LIVE.end, S.hours, RULES);

/* ---------- the watch list ---------- */
function source() {
  if (S.mode === 'fast') return { dets: [], assets: ASSETS, until: null };
  if (S.mode === 'replay') { const trip = Date.parse(REPLAY.event.trip_utc); return { dets: REPLAY.detections.map(d => ({ ...d, ms: Date.parse(d.time) })).filter(d => d.ms < trip && d.ms > trip - 12 * 36e5), assets: REPLAY.assets, until: trip }; }
  return { dets: LIVE.harm.filter(d => d.ms > LIVE.end - S.hours * 36e5), assets: ASSETS, until: null };
}
const kindBuilt = W.kindBuilt;
async function compute(kind) {
  if (S.mode === 'fast') return computeFast(kind);
  const src = source(), live = S.mode === 'live';
  if (live) wxr = wxRange();
  return W.computeLive({ kind, dets: src.dets, assets: src.assets, rules: RULES, wind: live ? WIND : W.fixedWind(REPLAY.weather), range: wxr, until: src.until, live });
}


/* ---------- fast look: INPE 10-minute GOES-19 pixels (web/js/fast-core.js). ~2 km pixels, no fire power: no plume is run and no µg/m³ is shown ---------- */
const FAST_HOURS = W.FAST_HOURS;
async function ensureFast() {
  if (FASTD && FASTD.region === S.region && Date.now() - FASTD.at < 120000) return FASTD;
  const v = REGION.view, now = Date.now();
  let r = null, err = null;
  try { r = await FAST.load({ bbox: [v[0][1], v[0][0], v[1][1], v[1][0]], hours: FAST_HOURS, now }); } catch (e) { err = e; }
  FASTD = { region: S.region, at: now, err, ...(r || {}), pixels: r ? FAST.pixels(r.detections) : [], unreachable: !r || (r.files.loaded === 0 && r.files.failed > 0) };
  return FASTD;
}
async function computeFast(kind) {
  const FD = await ensureFast();
  return W.computeFast({ kind, assets: ASSETS, rules: RULES, wind: WIND, now: Date.now(), fd: FD });
}
function fastPanel(res) {
  const el = $('dwFast'); el.hidden = S.mode !== 'fast'; if (el.hidden) return;
  const FD = (res && res.fd) || FASTD; if (!FD) { el.innerHTML = ''; return; }
  const now = Date.now(), age = ms => ms == null ? 'none' : `${utc(ms)} UTC, ${sig((now - ms) / 6e4)} min ago`;
  const f = FD.files || { requested: 0, loaded: 0, missing: 0, failed: 0 };
  el.innerHTML = `<div class="dw-fast-head"><span class="dtag fast">FAST · COARSE</span> <b>${esc(FAST.SOURCE.name)}</b></div>
    <ul class="dw-fast-cav">${FAST.SOURCE.caveats.map(c => `<li>${esc(c)}</li>`).join('')}</ul>
    <p class="dw-fast-age">${FD.unreachable ? '<b>INPE could not be reached.</b> ' : ''}Files: ${f.loaded} of ${f.requested} loaded, ${f.missing} not yet published, ${f.failed} failed. Newest file: <b>${esc(age(FD.newestFileMs))}</b>. Newest GOES-19 detection inside the ${esc(REGION.name.en)} map box (it can include pixels over a neighbouring country): <b>${esc(age(FD.newestDetectionMs))}</b>. Pixels in the last ${FAST_HOURS} hours: <b>${(FD.pixels || []).length.toLocaleString('en-US')}</b>. No fire power, no confidence value, not validated against ground reports.</p>`;
}

/* ---------- words: the texts live in bulletin-core.js; the page passes the region it is showing ---------- */
const bctx = () => ({ region: REGION, assets: source().assets, compass: RG.COMPASS });
const timeLocal = ms => B.timeLocal(ms, REGION), utc = B.utc, tzWord = lang => B.tzWord(lang, REGION);
const { assetName, stable, NIGHT_ROW, SHORT_MAX, shortBulletin } = B;
const shortOf = (r, lang) => B.shortOf(r, lang, bctx()), bulletin = (r, lang) => B.bulletin(r, lang, bctx()), bulletinText = (r, lang, fmt) => B.bulletinText(r, lang, fmt, bctx());

/* ---------- drawing ---------- */
const css = v => getComputedStyle(document.body).getPropertyValue(v).trim();
function initMap() {
  map = L.map('dwMap', { zoomControl: true, preferCanvas: true }).fitBounds(REGION.view);
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 18, maxNativeZoom: 17, attribution: 'Imagery © Esri · Assets © OpenStreetMap contributors · Fires: NASA FIRMS' }).addTo(map);
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', { maxZoom: 18, maxNativeZoom: 17, opacity: .8 }).addTo(map);
  gAssets = L.layerGroup().addTo(map); gFires = L.layerGroup().addTo(map); gSel = L.layerGroup().addTo(map);
}
function drawBase(res) {
  gAssets.clearLayers(); gFires.clearLayers(); gSel.clearLayers();
  const P = source().assets, kind = S.kind, hot = new Set(res.rows.map(r => r.key));
  if (P && KINDS[kind].line) {
    const col = kind === 'power' ? '#FFD34D' : '#E6EEF2';
    P.pieces[kind].forEach(p => L.polyline(p.pts, { color: hot.has(p.key) ? '#FF8A3D' : col, weight: hot.has(p.key) ? 3.5 : kind === 'power' ? (p.asset.kv >= 500 ? 2.6 : 1.4) : 1.2, opacity: hot.has(p.key) ? 1 : .75, interactive: false }).addTo(gAssets));
  }
  const src = source(), drawn = new Set();
  [...res.rows, ...res.near].forEach(r => {
    if (!KINDS[kind].line) L.circleMarker([r.asset.lat, r.asset.lon], { radius: 5, color: '#fff', weight: 1.5, fillColor: res.rows.includes(r) ? '#FF8A3D' : '#9AB0B8', fillOpacity: 1 }).bindTooltip(esc(assetName(r, 'en'))).addTo(gAssets);
    const k = r.fire.lat + ',' + r.fire.lon; if (drawn.has(k)) return; drawn.add(k);
    L.circleMarker([r.fire.lat, r.fire.lon], { radius: 5, color: '#fff', weight: 1, fillColor: '#F05252', fillOpacity: .95 }).bindTooltip(r.fast ? `GOES-19 pixel · ${r.scans} scan${r.scans === 1 ? '' : 's'} · last ${utc(r.fire.ms)} UTC · no fire power` : `${esc(r.fire.sat)} · ${utc(r.fire.ms)} UTC · ${sig(r.fire.frp)} MW`).addTo(gFires);
  });
  if (S.mode === 'replay') {
    L.marker([REPLAY.event.park.lat, REPLAY.event.park.lon], { icon: L.divIcon({ className: 'dw-pin', html: 'Vapor Cué park', iconSize: null }) }).addTo(gAssets);
    const b = L.latLngBounds(REPLAY.lines.flatMap(l => l.pts)); map.fitBounds(b.pad(-.25));
  } else if (!S.sel) map.fitBounds(REGION.view);
  void src;
}
function drawSel(r) {
  gSel.clearLayers(); if (!r) return;
  const f = r.fire, b = L.latLngBounds([[f.lat, f.lon], r.at]);
  if (r.s) {
    const env = r.s.r.env;
    if (env[0].length > 1) { const poly = [[f.lat, f.lon], ...env[0], ...env[1].slice().reverse()]; L.polygon(poly, { color: '#FF8A3D', weight: 1, fillColor: '#FF8A3D', fillOpacity: .28, interactive: false }).addTo(gSel); poly.forEach(p => { if (D.dist(f.lat, f.lon, p[0], p[1]) < Math.max(8, 2.2 * (r.km || 3))) b.extend(p); }); }
    const len = Math.min(r.s.r.xmax, Math.max(6000, 1.6 * (r.km || 3) * 1000)), end = [f.lat + len * r.s.r.dn / 111195, f.lon + len * r.s.r.de / (111195 * r.s.r.clat)];
    L.polyline([[f.lat, f.lon], end], { color: '#36D5E8', weight: 2, dashArray: '6 6', interactive: false }).addTo(gSel);
  }
  L.circleMarker(r.at, { radius: 9, color: '#FF8A3D', weight: 3, fill: false }).addTo(gSel);
  L.circleMarker([f.lat, f.lon], { radius: 8, color: '#fff', weight: 2, fillColor: '#F05252', fillOpacity: 1 }).addTo(gSel);
  map.fitBounds(b.pad(.45), { maxZoom: 13 });
}

function fastRowHTML(r, i) {
  const pl = nearPlace(source().assets, r.at[0], r.at[1]), eta = r.eta == null ? '—' : Math.max(5, Math.round(r.eta / 5) * 5), light = r.wx.ws < RULES.lightWind;
  return `<button class="dw-row" role="listitem" data-row="c${i}">
    <span class="dw-rank">${i + 1}</span>
    <span class="dw-row-main"><b>${esc(assetName(r, 'en'))}</b><small>${pl ? 'near ' + esc(pl.name) + ' · ' : ''}Pixel ${sig(r.km)} km ${D.compass(r.bearing + 180)} of it · smoke could take about ${eta} min${r.u.inPixel ? ' · <i class="dw-light">in pixel: the fire may be on either side</i>' : ''}</small>
      <small class="dw-row-meta">GOES-19 · ${r.scans} scan${r.scans === 1 ? '' : 's'} · first ${utc(r.px.firstMs)} last ${utc(r.px.lastMs)} UTC · no fire power${r.others ? ` · ${r.others} more pixel${r.others > 1 ? 's' : ''} upwind` : ''}${light ? ' · <i class="dw-light">light wind</i>' : ''}</small></span>
    <span class="dw-val fastv"><span class="dtag fast">FAST · COARSE</span><small>${r.scans} scan${r.scans === 1 ? '' : 's'}</small></span></button>`;
}
const cap = t => t.charAt(0).toUpperCase() + t.slice(1);
/* what the asset file holds for a kind, in words: "hospitals" when clinics were not mapped, "main roads" or "motorways and trunk roads" */
function kindName(kind, P) {
  const L = P && P.raw && P.raw.layers && P.raw.layers[kind];
  if (kind === 'health' && L && L.amenity && !L.amenity.includes('clinic')) return 'hospitals';
  if (kind === 'roads' && L && L.highway && !L.highway.includes('primary')) return 'motorways and trunk roads';
  return KINDS[kind].en;
}
function notBuiltWhy(kind, P) { const L = P && P.raw.layers && P.raw.layers[kind]; return L && L.reason ? L.reason.charAt(0).toUpperCase() + L.reason.slice(1) + '.' : ''; }
function rowHTML(r, i, crossing) {
  if (r.fast) return fastRowHTML(r, i);
  const pl = nearPlace(source().assets, r.at[0], r.at[1]), light = r.wx && r.wx.ws < RULES.lightWind;
  const sub = crossing
    ? `Fire ${sig(r.nearestKm ?? r.km)} km ${D.compass(r.bearing + 180)} · smoke ${KINDS[r.kind].line ? 'crosses' : 'arrives'} after about ${r.eta == null ? '—' : Math.max(5, Math.round(r.eta / 5) * 5)} min`
    : `Fire ${sig(r.km)} km ${D.compass(r.bearing + 180)} · modelled smoke path misses it`;
  return `<button class="dw-row${crossing ? '' : ' near'}" role="listitem" data-row="${crossing ? 'c' : 'n'}${i}">
    <span class="dw-rank">${crossing ? i + 1 : '·'}</span>
    <span class="dw-row-main"><b>${esc(assetName(r, 'en'))}</b><small>${pl ? 'near ' + esc(pl.name) + ' · ' : ''}${esc(sub)}</small>
      <small class="dw-row-meta">${esc(r.fire.sat)} ${utc(r.fire.ms)} UTC · ${sig(r.fire.frp)} MW${r.passes && r.passes.size > 1 ? ` · seen on ${r.passes.size} passes` : ''}${r.others ? ` · ${r.others} more fire${r.others > 1 ? 's' : ''} upwind` : ''}${light ? ' · <i class="dw-light">light wind</i>' : ''}${stable(r) ? ` · <i class="dw-light">${NIGHT_ROW}</i>` : ''}</small></span>
    ${crossing ? `<span class="dw-val"><b>${sig(r.peak)}</b><small>µg/m³ added<br>scenario</small></span>` : '<span class="dw-val miss">not<br>downwind</span>'}</button>`;
}
let current = { rows: [], near: [] };
async function render() {
  const kind = S.kind, my = ++render.n;
  $('dwRows').innerHTML = '<div class="empty-state">Working out smoke paths…</div>';
  $('dwHoursL').hidden = S.mode !== 'live'; $('dwSizeL').hidden = S.mode === 'fast'; // the replay window and the fast window (3 hours) are fixed; fast pixels have no fire power, so no size filter
  let res;
  try { res = await compute(kind); } catch (e) { console.error(e); res = { rows: [], near: [], fires: 0, err: 'Something went wrong while computing this list.' }; }
  if (my !== render.n) return;
  current = res; hits[S.mode + kind] = res; fastPanel(res); S.sel = null; $('dwBulletin').hidden = true; map.invalidateSize();
  $(KINDS[kind].badge).textContent = res.noAssets ? '' : res.rows.length || '';
  const period = S.mode === 'replay' ? 'the 12 hours before the trip' : `the last ${S.hours === 168 ? '7 days' : S.hours + ' hours'} of data`;
  const sizeTxt = RULES.minFrp > 0 ? ` of ${RULES.minFrp} MW or more` : '';
  const leftOut = RULES.minFrp > 0 ? ` <b>${(res.small || 0).toLocaleString('en-US')}</b> fire cluster${res.small === 1 ? '' : 's'} under ${RULES.minFrp} MW ${res.small === 1 ? 'was' : 'were'} left out as too small.` : '';
  const capTxt = res.skipped && res.fast ? ` Wind was requested for the ${MAX_CELLS} areas with the most scans; <b>${res.skipped.toLocaleString('en-US')}</b> pixel${res.skipped === 1 ? '' : 's'} with fewer scans ${res.skipped === 1 ? 'was' : 'were'} not assessed.` : res.skipped ? ` Wind was requested for the ${MAX_CELLS} strongest fire areas; <b>${res.skipped.toLocaleString('en-US')}</b> smaller fire${res.skipped === 1 ? '' : 's'} ${res.skipped === 1 ? 'was' : 'were'} not assessed, so no asset is judged for ${res.skipped === 1 ? 'it' : 'them'}.` : '';
  const P = source().assets, kn = kindName(kind, P);
  if (res.fast) {
    const multi = (res.fd.pixels || []).filter(p => p.scans >= 2).length;
    $('dwScope').innerHTML = res.noAssets || res.fastErr ? '' : `<b>${res.rows.length}</b> ${kn} downwind of, or inside, a coarse fast-look pixel, from <b>${res.fires.toLocaleString('en-US')}</b> GOES-19 pixels (${multi.toLocaleString('en-US')} on 2 or more scans) in the last ${FAST_HOURS} hours.${capTxt} Ranked by number of scans, then distance. There is no fire power, so no smoke amount is shown.`;
  } else
  $('dwScope').innerHTML = res.noAssets ? '' : `<b>${res.rows.length}</b> ${kn} with modelled smoke reaching them, from <b>${res.fires.toLocaleString('en-US')}</b> fires${sizeTxt} in ${period}.${leftOut}${capTxt} Ranked by the scenario's PM2.5 added at the asset, which orders the list and is not a measurement.`;
  let html = '';
  if (res.noAssets) html = res.notBuilt ? `<div class="empty-state"><b>${cap(kn)} are not loaded for this region.</b><br>${esc(notBuiltWhy(kind, P))} This is not a result: nothing was checked.</div>`
    : `<div class="empty-state"><b>No mapped ${kn} in this view.</b><br>${S.mode === 'replay' ? 'The replay tests the two 500 kV lines only.' : `The asset file for ${esc(REGION.name.en)} is missing or empty: run <span class="mono">python -m hotspots.assets ${S.region}</span>.`}</div>`;
  else {
    if (res.fastErr) html = `<div class="dw-warn">${esc(res.fastErr)}</div>`;
    else {
    if (res.wxErr) html += `<div class="dw-warn">${esc(res.wxErr)}</div>`;
    if (res.skipped) html += `<div class="dw-warn">${res.skipped.toLocaleString('en-US')} ${res.fast ? 'pixel' : 'smaller fire'}${res.skipped === 1 ? '' : 's'} near these ${kn} ${res.skipped === 1 ? 'was' : 'were'} not assessed (the ${MAX_CELLS}-area wind limit). An empty list below does not mean no smoke path reaches an asset.</div>`;
    html += res.rows.length ? res.rows.map((r, i) => rowHTML(r, i, true)).join('') : res.fast ? `<div class="empty-state"><b>No fast-look pixel of the last ${FAST_HOURS} hours has a ${kn.replace(/s$/, '')} downwind of it${res.skipped || res.noWind ? ' among those assessed' : ''}.</b><br>The fast view is coarse and misses small or short fires: this is not a statement that there is no fire.</div>` : `<div class="empty-state"><b>No modelled smoke path reaches any of the ${kn}${res.skipped || res.noWind ? ' that were assessed' : ''}.</b><br>That is a statement about this scenario and these satellite passes, not about the ground.</div>`;
    }
    if (res.near.length) html += `<div class="dw-sep">Within ${RULES.nearKm} km but not downwind <span>${res.near.length}</span></div><p class="dw-sep-note">A distance ring would flag these too. The modelled wind carries their smoke away from the asset.</p>` + res.near.slice(0, 40).map((r, i) => rowHTML(r, i, false)).join('');
  }
  $('dwRows').innerHTML = html;
  drawBase(res);
  if (S.mode === 'replay' && res.rows.length) select('c0');
}
render.n = 0;

function select(code) {
  const crossing = code[0] === 'c', r = (crossing ? current.rows : current.near)[+code.slice(1)]; if (!r) return;
  S.sel = { r, crossing };
  document.querySelectorAll('.dw-row').forEach(b => b.classList.toggle('on', b.dataset.row === code));
  drawSel(r); showBulletin();
}
function showBulletin() {
  const { r, crossing } = S.sel, B = $('dwBulletin'), was = B.hidden; B.hidden = false; stopSpeak();
  $('bTitle').textContent = assetName(r, S.lang);
  const f = r.fire;
  if (crossing) {
    const txt = bulletinText(r, S.lang, S.fmt); $('bText').textContent = txt;
    const cn = $('bCount'); cn.hidden = S.fmt !== 'short'; cn.textContent = S.lang === 'en' ? `${txt.length} of ${SHORT_MAX} characters` : `${txt.length} de ${SHORT_MAX} caracteres`; cn.classList.toggle('over', txt.length > SHORT_MAX);
    $('bCopy').disabled = false; $('bSpeak').disabled = !('speechSynthesis' in window);
    $('bShare').hidden = false; $('bShare').href = 'https://wa.me/?text=' + encodeURIComponent(txt);
  } else {
    $('bText').textContent = r.wx ? `No bulletin: the fire is ${sig(r.km)} km away, but the modelled wind (from the ${D.compass(r.wx.wd)} at ${sig(r.wx.ws)} m/s) carries its smoke away from this asset.` : 'No bulletin: there is no modelled wind for this fire.';
    $('bCopy').disabled = true; $('bSpeak').disabled = true; $('bShare').hidden = true; $('bCount').hidden = true;
  }
  const facts = [['Fire', `${f.sat} · ${utc(f.ms)} UTC · ${sig(f.frp)} MW${f.n > 1 ? ` in ${f.n} pixels` : ''}`, 'obs'], ['Asset', `OpenStreetMap ${r.kind === 'power' || r.kind === 'roads' ? 'way ' + r.asset.id + (r.asset.n > 1 ? ' and ' + (r.asset.n - 1) + ' joined ways' : '') : r.asset.id}`, 'map']];
  if (r.wx) facts.push(['Wind, 100 m', `${sig(r.wx.ws)} m/s from ${Math.round(r.wx.wd)}° · hour ${r.wx.hour.slice(11, 16)} UTC`, 'mod']);
  if (stable(r)) facts.push(['Air stability', `class ${r.s.r.cls} · ${NIGHT_ROW}`, 'mod']);
  if (r.fast) { facts.length = 0; facts.push(['Fire pixel', `GOES-19 · ${r.scans} scan${r.scans === 1 ? '' : 's'} · first ${utc(r.px.firstMs)} last ${utc(r.px.lastMs)} UTC · about 2 km wide · no fire power`, 'fast'], ['Asset', `OpenStreetMap ${r.kind === 'power' || r.kind === 'roads' ? 'way ' + r.asset.id + (r.asset.n > 1 ? ' and ' + (r.asset.n - 1) + ' joined ways' : '') : r.asset.id}`, 'map']); facts.push(['Wind, 100 m', `${sig(r.wx.ws)} m/s from ${Math.round(r.wx.wd)}° · hour ${r.wx.hour.slice(11, 16)} UTC`, 'mod']); }
  else if (crossing) facts.push(['Smoke at the asset', `${sig(r.peak)} µg/m³ PM2.5 added at ground level, ${sig(r.km)} km from the fire`, 'scn']);
  $('bFacts').innerHTML = facts.map(([k, v, t]) => `<div><span>${k} <i class="dtag ${t}">${{ obs: 'OBSERVED', map: 'MAPPED', mod: 'MODELLED', scn: 'SCENARIO', fast: 'FAST · COARSE' }[t]}</i></span><b>${esc(v)}</b></div>`).join('');
  const lab = $('bLab'); lab.hidden = S.mode === 'replay' || !f.id; if (f.id) lab.href = 'firelab.html?fire=' + f.id;
  if (was) { map.invalidateSize(); drawSel(r); }
  $('bNote').textContent = { es: 'Texto en español generado con una plantilla fija, aún no revisada por un hablante nativo; revíselo antes de difundirlo.', pt: 'Texto em português gerado com um modelo fixo, ainda não revisado por um falante nativo; revise antes de divulgar.',
    en: 'Check with people on the ground before acting. Not an operational alert service.' }[S.lang];
}
function stopSpeak() { if ('speechSynthesis' in window) speechSynthesis.cancel(); speaking = false; $('bSpeak').setAttribute('aria-pressed', 'false'); $('bSpeak').querySelector('span').textContent = 'Read aloud'; }

/* ---------- sky clock ---------- */
function clock() {
  if (S.mode === 'replay') {
    const trip = Date.parse(REPLAY.event.trip_utc), dets = REPLAY.detections.map(d => Date.parse(d.time)).filter(t => t < trip), last = Math.max(...dets);
    $('ckLast').textContent = `${utc(last)} UTC · ${timeLocal(last)} ${tzWord('en')}`; $('ckLastSub').textContent = `${sig((trip - last) / 36e5)} h before the trip at ${timeLocal(trip)} ${tzWord('en')}`;
    $('ckNext').textContent = '—'; $('ckNextSub').textContent = 'Replay of archived data';
    return;
  }
  if (!LIVE.all.length) { $('ckLast').textContent = '—'; $('ckLastSub').textContent = `no ${REGION.country} records in this data bundle`; $('ckNext').textContent = '—'; $('ckNextSub').textContent = ''; return; }
  const passes = {}; // per satellite: start times of passes that recorded a fire in the region
  LIVE.all.slice().sort((a, b) => a.ms - b.ms).forEach(d => { const p = passes[d.sat] = passes[d.sat] || []; if (!p.length || d.ms - p[p.length - 1] > 30 * 6e4) p.push(d.ms); });
  const last = LIVE.end, now = Date.now(), lastSat = LIVE.all.find(d => d.ms === last).sat;
  const age = (now - last) / 36e5;
  $('ckLast').textContent = `${utc(last)} UTC · ${timeLocal(last)} ${tzWord('en')} · ${lastSat}`;
  $('ckLastSub').textContent = `${new Date(last).toISOString().slice(0, 10)} · ${age < 48 ? sig(age) + ' hours ago' : Math.round(age / 24) + ' days ago'}${age > 12 ? ' · this data bundle is old: run a refresh' : ''}`;
  let next = null;
  for (const [sat, p] of Object.entries(passes)) for (const t of p.filter(t => t > last - 3 * 864e5)) { const n = t + Math.ceil((now - t) / 864e5) * 864e5; if (!next || n < next.t) next = { t: n, sat }; }
  if (next) { $('ckNext').textContent = `${utc(next.t)} UTC · ${timeLocal(next.t)} ${tzWord('en')} · ${next.sat}`; $('ckNextSub').textContent = 'from recent pass times, give or take an hour; data follows up to 3 h later'; }
}

/* ---------- replay panel ---------- */
function replayPanel() {
  const el = $('dwReplay');
  el.hidden = S.mode !== 'replay'; if (el.hidden) return;
  const E = REPLAY.event, R = REPLAY.result;
  const sel = RG.get(S.region), other = S.region !== 'PY';
  el.innerHTML = (other ? `<p class="dw-rp-away"><b>The replay is an event in Paraguay, so the map, clock and times switch to Paraguay while it is shown.</b> ${esc(sel.name.en)} returns when you go back to Latest data.</p>` : '') + `<div class="dw-rp-head"><div class="eyebrow">Replay of a real event</div><h2>8 January 2025, 17:01 in Paraguay: a 500 kV line trips</h2>
    <p>The utility, ANDE, said smoke from a fire <i>near</i> the line, not under it, was blown between the conductors. Press reports name the Ayolas to Villa Hayes line and place the fire near Vapor Cué National Park. We fixed two questions, then ran the archive through the same code as this page.</p></div>
    <div class="dw-rp-grid">
      <div><span class="dtag obs">OBSERVED</span><b>Did the satellites see a fire first? Yes.</b><p>${R.before} fire clusters within 30 km of the park in the 12 hours before the trip. The last passes were S-NPP at 14:05, NOAA-20 at 14:28 and Aqua at 15:08 local, two to three hours before the trip. Fires at the same spots were also recorded the day before.</p></div>
      <div><span class="dtag scn">SCENARIO</span><b>Does the modelled smoke cross a 500 kV line? Yes, in two places.</b><ul>${R.summary.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>
      <div><span class="dtag demo">LIMITS</span><b>What this does not show.</b><p>It does not show which fire caused the trip, and the model does not predict a fault: the smoke it puts at the line is a few µg/m³ at ground level. The line names come from the mapped endpoints in OpenStreetMap; the line it puts 1 km from the park runs to Itaipú, not Ayolas, so the press account and the map disagree. The reanalysis wind was light (about 2 to 4 m/s), so its direction is uncertain. With public data arriving up to three hours after a pass, the same-day detections could have reached a control room only around the time of the trip; the day-before detections would have arrived a day ahead.</p></div>
    </div>
    <p class="dw-rp-src">Sources: ${E.sources.map(u => `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(new URL(u).hostname.replace('www.', ''))}</a>`).join(', ')} · FIRMS archive (MODIS, S-NPP, NOAA-20) · ERA5 wind via Open-Meteo · lines from OpenStreetMap. Full write-up: docs/research/replay_2025-01-08.md</p>`;
}

/* ---------- wiring ---------- */
function setTabs(sel, attr, val) { document.querySelectorAll(sel + ' [role=tab]').forEach(b => { const on = b.dataset[attr] === val; b.setAttribute('aria-selected', on); b.tabIndex = on ? 0 : -1; }); }
const clearBadges = () => Object.values(KINDS).forEach(k => { $(k.badge).textContent = ''; });
/* asset tabs: a layer that was not built for this region is a disabled tab with a tooltip, never an empty list that reads as "no smoke" */
function updateKindTabs() {
  const P = S.mode === 'replay' ? REPLAY && REPLAY.assets : ASSETS;
  document.querySelectorAll('#dwKinds [role=tab]').forEach(b => {
    const k = b.dataset.kind, built = kindBuilt(P, k);
    b.disabled = !built;
    b.title = built ? '' : S.mode === 'replay' ? 'The replay tests the two 500 kV lines only.' : !P ? 'The asset file for this region has not been built.' : `${cap(kindName(k, P))} are not loaded for ${REGION.name.en}. ${notBuiltWhy(k, P)}`.trim();
  });
}
function buildLangButtons() {
  const order = RG.langOrder(S.region), box = document.querySelector('.dw-lang');
  box.innerHTML = order.map(l => `<button role="tab" aria-selected="${l === S.lang}" data-lang="${l}" tabindex="${l === S.lang ? 0 : -1}">${RG.LANG_NAME[l]}</button>`).join('');
}
function effectiveRegion() { return S.mode === 'replay' ? RG.get('PY') : RG.get(S.region); }
function paintRegion() { // everything that says which region: pill, view, words, Method
  REGION = effectiveRegion();
  document.documentElement.dataset.region = S.region;
  const m = S.mode === 'fast' ? `${REGION.name.en} · fast look, last ${FAST_HOURS} hours · INPE GOES-19` : S.mode === 'replay' ? 'Replay · Paraguay · 8 January 2025' : LIVE ? `${REGION.name.en} · ${LIVE.harm.length.toLocaleString('en-US')} harmonized records · ${LIVE.META.days[0]} to ${LIVE.META.days.at(-1)}` : `${REGION.name.en} · loading…`;
  $('dwPill').textContent = m;
  methodText();
}
function methodText() {
  const sel = RG.get(S.region), P = ASSETS, L = P && P.raw.layers, parts = [];
  const lay = (k, txt) => { if (!P) return; (layerInfo(P.raw, k).built ? parts : miss).push(txt); };
  const miss = [];
  const roadWords = L && L.roads && L.roads.highway ? L.roads.highway.join(' and ').replace('motorway and trunk', 'motorway and trunk') : 'trunk and primary';
  lay('power', `power lines of ${L && L.power && L.power.min_kv ? L.power.min_kv : 220} kV and above`); lay('roads', `${roadWords} roads`);
  lay('health', L && L.health && L.health.amenity ? L.health.amenity.map(x => x + 's').join(' and ') : 'hospitals and clinics'); lay('schools', 'schools');
  const tol = P && P.raw.simplify_m ? ` Lines were simplified to within ${[P.raw.simplify_m.power && 'about ' + P.raw.simplify_m.power + ' m for power lines', P.raw.simplify_m.roads && P.raw.simplify_m.roads + ' m for roads'].filter(Boolean).join(' and ')}.` : '';
  $('mAssets').innerHTML = `<span class="dtag map">MAPPED</span> <b>Assets.</b> OpenStreetMap, for ${esc(sel.name.en)}: ${parts.length ? parts.join(', ') : 'no asset file has been built for this region'}.${miss.length ? ` Not loaded for this region: ${miss.join(', ')}.` : ''}${tol} Volunteer data: it can be incomplete or mislabelled and it is not the operator's record. Regions: ${RG.codes().map(c => RG.name(c, 'en')).join(', ')}.`;
  $('mTime').innerHTML = `<b>Times.</b> Times in bulletins use the time zone of the selected region: ${esc(RG.get('PY').tzLabel.en)}, ${esc(RG.get('BO').tzLabel.en)}, ${esc(RG.get('AR').tzLabel.en)} or ${esc(RG.get('BR').tzLabel.en)}. Brazil has several time zones and the bulletin uses Brasília time. Now showing: ${esc(sel.tzLabel.en)} (${esc(sel.tz)}).`;
}
async function setMode(m) {
  if (m === 'replay' && !REPLAY) {
    try {
      const C = await (await fetch('app-data/replay/2025-01-08.json')).json();
      let places = []; // the replay is in Paraguay: its places come from the Paraguay file, whichever region is selected
      if (S.region === 'PY' && ASSETS) places = ASSETS.places; else { try { places = (await gzJSON('app-data/assets/PY.json.gz')).places || []; } catch (e) { places = []; } }
      REPLAY = C; REPLAY.assets = prepAssets({ power: C.lines.map(l => ({ id: l.osm_way, kv: l.voltage_kv, pts: l.pts })), places });
    } catch (e) { toast('The replay file is missing: run node scripts/replay_line_trip.mjs'); return; }
  }
  S.mode = m; setTabs('.dw-mode', 'mode', m); paintRegion();
  if (m === 'replay') { S.kind = 'power'; setTabs('#dwKinds', 'kind', 'power'); map.fitBounds(REGION.view); }
  else { const first = ['power', 'roads', 'health', 'schools'].find(k => kindBuilt(ASSETS, k)); if (!kindBuilt(ASSETS, S.kind) && first) S.kind = first; setTabs('#dwKinds', 'kind', S.kind); map.fitBounds(REGION.view); }
  updateKindTabs(); clearBadges();
  if (m === 'replay' || LIVE) clock();
  replayPanel(); await render();
}
let regionToken = 0;
async function setRegion(iso, first) {
  const my = ++regionToken; S.region = iso; RG.remember(iso);
  $('dwRegion').value = iso;
  try { const u = new URL(location.href); u.searchParams.set('r', iso); u.searchParams.delete('replay'); history.replaceState(null, '', u); } catch (e) { /* file or sandboxed URL */ }
  S.mode = 'live'; S.sel = null; $('dwBulletin').hidden = true; setTabs('.dw-mode', 'mode', 'live');
  REGION = RG.get(iso);
  S.lang = REGION.lang; buildLangButtons();
  $('dwRows').innerHTML = '<div class="empty-state">Loading ' + esc(REGION.name.en) + '…</div>'; $('dwScope').textContent = ''; clearBadges();
  LIVE = null; ASSETS = null; paintRegion(); map.fitBounds(REGION.view);
  let A = null, L = null, err = null;
  [A, L] = await Promise.all([gzJSON(`app-data/assets/${iso}.json.gz`).then(prepAssets).catch(() => null), loadLive(REGION).catch(e => { err = e; return null; })]);
  if (my !== regionToken) return false;
  ASSETS = A; LIVE = L;
  if (!LIVE) { console.error(err); $('dwPill').textContent = 'Fire records could not be loaded'; $('dwRows').innerHTML = '<div class="empty-state"><b>Fire records could not be loaded.</b><br>Run <span class="mono">python -m hotspots.refresh</span> and reload.</div>'; return false; }
  if (!first) await setMode('live');
  return true;
}
async function init() {
  await RG.ready;
  const fill = $('dwRegion'); fill.innerHTML = RG.codes().map(c => `<option value="${c}">${esc(RG.name(c, 'en'))}</option>`).join('');
  S.region = RG.initial(location.search); REGION = RG.get(S.region);
  initMap();
  fill.addEventListener('change', e => setRegion(e.target.value));
  document.querySelector('.dw-mode').addEventListener('click', e => { const b = e.target.closest('[data-mode]'); if (b && !b.disabled) setMode(b.dataset.mode); });
  $('dwKinds').addEventListener('click', e => { const b = e.target.closest('[data-kind]'); if (!b || b.disabled) return; S.kind = b.dataset.kind; setTabs('#dwKinds', 'kind', S.kind); render(); });
  $('dwHours').addEventListener('change', e => { S.hours = +e.target.value; clearBadges(); render(); });
  $('dwRows').addEventListener('click', e => { const b = e.target.closest('[data-row]'); if (b) select(b.dataset.row); });
  document.querySelector('.dw-lang').addEventListener('click', e => { const b = e.target.closest('[data-lang]'); if (!b) return; S.lang = b.dataset.lang; setTabs('.dw-lang', 'lang', S.lang); if (S.sel) showBulletin(); });
  document.querySelector('.dw-fmt').addEventListener('click', e => { const b = e.target.closest('[data-fmt]'); if (!b) return; S.fmt = b.dataset.fmt; setTabs('.dw-fmt', 'fmt', S.fmt); if (S.sel) showBulletin(); });
  $('dwMinFrp').addEventListener('change', e => { RULES.minFrp = +e.target.value; clearBadges(); render(); });
  $('bCopy').addEventListener('click', async () => { try { await navigator.clipboard.writeText($('bText').textContent); toast('Bulletin copied'); } catch (e) { toast('Copy failed: select the text and copy it by hand'); } });
  $('bSpeak').addEventListener('click', () => {
    if (speaking) return stopSpeak();
    const u = new SpeechSynthesisUtterance($('bText').textContent); u.lang = { es: 'es-ES', pt: 'pt-BR', en: 'en-GB' }[S.lang]; u.rate = .95; u.onend = stopSpeak;
    speaking = true; $('bSpeak').setAttribute('aria-pressed', 'true'); $('bSpeak').querySelector('span').textContent = 'Stop'; speechSynthesis.speak(u);
  });
  const wantReplay = new URLSearchParams(location.search).get('replay') != null; // read before setRegion rewrites the URL
  const ok = await setRegion(S.region, true);
  if (ok) await setMode(wantReplay ? 'replay' : 'live');
  window.__DW = { S, RULES, MAX_CELLS, get current() { return current; }, get ASSETS() { return ASSETS; }, get LIVE() { return LIVE; }, select, setMode, setRegion, bulletin, shortBulletin, shortOf, bulletinText, render: () => render() };
}
init();
})();
