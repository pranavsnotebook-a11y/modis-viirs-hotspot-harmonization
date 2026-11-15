/* WATCH: the DOM-free core of DOWNWIND and the role pages. Plain script: attaches WATCH to window/globalThis, loads in Node via vm.
   Needs FIRECORE (firelab-core.js), DOWNWIND (downwind-core.js) and, for computeFast, FAST (fast-core.js) loaded first.
   It holds: asset preparation and the grid index; the wind cache and its fetch (the fetch function is injected, so tests
   run offline); the watch-list computation for one kind of asset (computeLive) and the fast look (computeFast).
   Nothing here touches the page. Every number comes from the cores; no number here is a measurement of smoke. */
(function (root) {
'use strict';
const F = () => root.FIRECORE, D = () => root.DOWNWIND, FASTC = () => root.FAST;

const KINDS = Object.freeze({
  power: Object.freeze({ line: true, en: 'power lines', badge: 'nPower' }), roads: Object.freeze({ line: true, en: 'main roads', badge: 'nRoads' }),
  health: Object.freeze({ line: false, en: 'hospitals and clinics', badge: 'nHealth' }), schools: Object.freeze({ line: false, en: 'schools', badge: 'nSchools' }),
});
const KIND_LIST = Object.freeze(['power', 'roads', 'health', 'schools']);
const MAX_CELLS = 240; // wind is requested for at most this many 0.25 degree cells per computation (the free Open-Meteo API counts every location as a call)
const FAST_HOURS = 3;
const rules = () => ({ reachKm: 25, nearKm: 5, minConc: F().BANDS[0], hoursAfterPass: 3, scenarioHours: 3, lightWind: 3, clusterKm: 1.5, minFrp: 5 });

/* ---------- assets: split long lines into short pieces, index everything on a 0.25 degree grid ---------- */
/* which layers the file holds: a file records what was built; an older file without that record holds all five */
function layerInfo(A, kind) {
  const L = A.layers && A.layers[kind];
  return L ? L : { built: Array.isArray(A[kind]) };
}
const kindBuilt = (P, kind) => !!P && layerInfo(P.raw, kind).built;
function prepAssets(A) {
  const dist = D().dist;
  // the same building is often mapped twice (a node and an outline): keep one within 150 m unless both carry different names
  const uniq = list => { const kept = [], g = new Map(); for (const p of list || []) { const k = Math.round(p.lat * 200) + ',' + Math.round(p.lon * 200); let dup = false; for (let a = -1; a <= 1 && !dup; a++) for (let b = -1; b <= 1 && !dup; b++) for (const q of g.get((Math.round(p.lat * 200) + a) + ',' + (Math.round(p.lon * 200) + b)) || []) if (dist(p.lat, p.lon, q.lat, q.lon) < .15 && (!p.name || !q.name || p.name === q.name)) { dup = true; if (p.name && !q.name) q.name = p.name; break; } if (!dup) { kept.push(p); if (!g.has(k)) g.set(k, []); g.get(k).push(p); } } return kept; };
  const P = { raw: A, pieces: { power: [], roads: [] }, points: { health: uniq(A.health), schools: uniq(A.schools) }, grid: {}, places: A.places || [] };
  const split = (kind, list, label) => list.forEach(w => {
    for (let a = 0; a + 1 < w.pts.length; a += 24) P.pieces[kind].push({ kind, asset: w, key: label(w), pts: w.pts.slice(a, a + 25) });
  });
  split('power', A.power || [], w => 'p' + w.id);
  split('roads', A.roads || [], w => 'r' + (w.ref || w.name || w.id));
  for (const kind of Object.keys(KINDS)) {
    const g = P.grid[kind] = new Map(), put = (la, lo, o) => { const k = Math.floor(la * 4) + ',' + Math.floor(lo * 4); let s = g.get(k); if (!s) g.set(k, s = new Set()); s.add(o); };
    if (KINDS[kind].line) P.pieces[kind].forEach(p => { for (let i = 0; i + 1 < p.pts.length; i++) { const a = p.pts[i], b = p.pts[i + 1], n = Math.max(1, Math.ceil(dist(a[0], a[1], b[0], b[1]) / 5)); for (let j = 0; j <= n; j++) put(a[0] + (b[0] - a[0]) * j / n, a[1] + (b[1] - a[1]) * j / n, p); } });
    else P.points[kind].forEach(p => put(p.lat, p.lon, p));
  }
  return P;
}
function nearAssets(P, kind, lat, lon, reachKm) {
  const out = new Set(), g = P.grid[kind], r = Math.ceil((reachKm == null ? 25 : reachKm) / 27.8 / Math.max(.3, Math.cos(lat * Math.PI / 180)));
  for (let a = -1; a <= 1; a++) for (let b = -r; b <= r; b++) { const s = g.get((Math.floor(lat * 4) + a) + ',' + (Math.floor(lon * 4) + b)); if (s) s.forEach(o => out.add(o)); }
  return out;
}
function nearPlace(P, lat, lon) {
  let best = null;
  for (const p of P.places) { if (Math.abs(p.lat - lat) > .6 || Math.abs(p.lon - lon) > .6) continue; const d = D().dist(lat, lon, p.lat, p.lon); if (!best || d < best.km) best = { name: p.name, km: d }; }
  return best && best.km <= 40 ? best : null;
}

/* ---------- weather: one call for many grid cells ---------- */
const cellKey = (lat, lon) => (Math.round(lat * 4) / 4).toFixed(2) + ',' + (Math.round(lon * 4) / 4).toFixed(2);
/* the hour of `ms` in an Open-Meteo hourly object, mapped to the fields the plume model reads; null when the hour is missing */
function wxAtHour(H, ms) {
  if (!H) return null;
  const k = H.time.indexOf(new Date(Math.floor(ms / 36e5) * 36e5).toISOString().slice(0, 13) + ':00');
  if (k < 0 || H.wind_speed_100m[k] == null) return null;
  return { hour: H.time[k], ws: H.wind_speed_100m[k], wd: H.wind_direction_100m[k], u10: H.wind_speed_10m[k], blh: H.boundary_layer_height ? H.boundary_layer_height[k] : null, cloud: H.cloud_cover ? H.cloud_cover[k] : 50 };
}
/* the date range of one computation: fixed by the data window, so every tab reuses the same cells */
function liveRange(end, hours, r) {
  const t0 = end - hours * 36e5, t1 = end + r.hoursAfterPass * 36e5;
  return { d0: new Date(t0).toISOString().slice(0, 10), d1: new Date(t1).toISOString().slice(0, 10), old: (Date.now() - t0) / 864e5 > 80 };
}
const fastRange = now => ({ d0: new Date(now - (FAST_HOURS + 1) * 36e5).toISOString().slice(0, 10), d1: new Date(now).toISOString().slice(0, 10), old: false });

/* A wind cache. opts.getJSON(url, ms) is injected (the page passes FIRECORE.getJSON, tests pass a stub);
   opts.storage is an optional sessionStorage-like object, so a second page in the same tab reuses cells. */
function createWind(opts) {
  const getJSON = (opts && opts.getJSON) || F().getJSON, storage = opts && opts.storage, cells = new Map();
  let server = (opts && opts.server) || null; // e.g. 'api/wind' on the Python server
  const id = (k, r) => k + '|' + r.d0 + '|' + r.d1;
  const ssGet = i => { try { const v = storage && storage.getItem('fv.wx.' + i); return v ? JSON.parse(v) : undefined; } catch (e) { return undefined; } };
  const ssSet = (i, v) => { try { storage && storage.setItem('fv.wx.' + i, JSON.stringify(v)); } catch (e) { /* storage full or blocked: carry on without the cache */ } };
  const H = 'wind_speed_10m,wind_speed_100m,wind_direction_100m,boundary_layer_height,cloud_cover';
  return {
    cells,
    /* cells: keys of the 0.25 degree cells to have wind for. Cells already fetched are not requested again.
       Returns the number of batches that failed; cells of a failed batch stay missing and their fires are reported as not assessed. */
    async fetch(keys, range) {
      const need = [];
      for (const k of keys) { const i = id(k, range); if (cells.has(i)) continue; const c = ssGet(i); if (c) cells.set(i, c); else need.push(k); }
      if (!need.length) return 0;
      const base = range.old ? 'https://archive-api.open-meteo.com/v1/archive' : 'https://api.open-meteo.com/v1/forecast';
      let failed = 0;
      for (let i = 0; i < need.length; i += 60) {
        const part = need.slice(i, i + 60); let la = part.map(k => k.split(',')[0]).join(','), lo = part.map(k => k.split(',')[1]).join(',');
        let left = part;
        // our own server first, when the page names one: it keeps every cell on disk, so repeat visits do not spend the free wind service's quota
        if (server) {
          try {
            const j = await getJSON(`${server}?cells=${part.join(';')}&d0=${range.d0}&d1=${range.d1}&old=${range.old ? 1 : 0}`, 60000);
            if (!j || !j.cells) throw new Error('no cells');
            left = part.filter(k => { const h = j.cells[k]; if (h && h.time) { cells.set(id(k, range), h); ssSet(id(k, range), h); return false; } return true; });
          } catch (e) { if (!/^HTTP 5|unavailable/.test(e.message || '')) server = null; } // a static host has no such endpoint: stop asking and go direct
        }
        if (!left.length) continue;
        if (left.length !== part.length) { la = left.map(k => k.split(',')[0]).join(','); lo = left.map(k => k.split(',')[1]).join(','); }
        try {
          let j = await getJSON(`${base}?latitude=${la}&longitude=${lo}&hourly=${H}&start_date=${range.d0}&end_date=${range.d1}&wind_speed_unit=ms&timezone=GMT`, 45000);
          if (!Array.isArray(j)) j = [j];
          left.forEach((k, n) => { const h = j[n] && j[n].hourly ? j[n].hourly : null; if (h) { cells.set(id(k, range), h); ssSet(id(k, range), h); } });
        } catch (e) { failed++; }
      }
      return failed;
    },
    has: (lat, lon, range) => cells.has(id(cellKey(lat, lon), range)),
    at: (lat, lon, ms, range) => wxAtHour(cells.get(id(cellKey(lat, lon), range)), ms),
    fetched: true,
  };
}
/* a fixed hourly series (the replay's archived wind): same interface, nothing to fetch */
function fixedWind(hourly) {
  return { fetch: async () => 0, has: () => !!hourly, at: (lat, lon, ms) => wxAtHour(hourly, ms), fetched: false };
}

/* ---------- the watch list ---------- */
/* o: { kind, dets (observations already limited to the window), assets (prepared), rules, wind, range (live only), until (replay: ms), live (fetch wind?) }
   Returns { rows, near, fires, small, cand, wxErr, skipped, noWind } or the noAssets shapes. */
async function computeLive(o) {
  const kind = o.kind, P = o.assets, R = o.rules || rules(), isLine = KINDS[kind].line, until = o.until || null, DW = D();
  if (!P || !kindBuilt(P, kind)) return { rows: [], near: [], fires: 0, small: 0, noAssets: true, notBuilt: !!P };
  if ((!isLine && !P.points[kind].length) || (isLine && !P.pieces[kind].length)) return { rows: [], near: [], fires: 0, small: 0, noAssets: true, empty: true };
  const allFires = DW.cluster(o.dets, R.clusterKm).map(f => ({ ...f, ms: Date.parse(f.time) }));
  const fires = allFires.filter(f => f.frp >= R.minFrp), small = allFires.length - fires.length; // the size filter is on the summed power of the cluster
  let cand = fires.map(f => ({ f, near: nearAssets(P, kind, f.lat, f.lon, R.reachKm) })).filter(c => c.near.size);
  let wxErr = null, skipped = 0, noWind = 0;
  const wind = o.wind, range = o.range;
  if (o.live) {
    // at most MAX_CELLS cells: the strongest fires first; a weaker fire in a cell already chosen costs nothing and is kept
    const cells = new Set(), keep = new Set();
    for (const c of cand.slice().sort((a, b) => b.f.frp - a.f.frp)) { const k = cellKey(c.f.lat, c.f.lon); if (cells.has(k) || cells.size < MAX_CELLS) { cells.add(k); keep.add(c); } }
    skipped = cand.length - keep.size; cand = cand.filter(c => keep.has(c));
    const failed = await wind.fetch(cells, range);
    const have = cand.filter(c => wind.has(c.f.lat, c.f.lon, range));
    noWind = cand.length - have.length; cand = have;
    if (noWind) wxErr = failed && noWind === keep.size ? 'Modelled wind is unavailable right now, so smoke paths cannot be drawn.' : `Modelled wind could not be loaded for ${noWind} fire${noWind === 1 ? '' : 's'}; they were not assessed and are not listed as "not downwind".`;
  }
  const best = new Map(), near = new Map();
  for (const { f, near: set } of cand) {
    const scen = [];
    for (let h = 0; h < R.hoursAfterPass; h++) {
      const t = f.ms + h * 36e5; if (until && Math.floor(t / 36e5) * 36e5 > until) break;
      const wx = wind.at(f.lat, f.lon, t, range); if (wx) scen.push({ wx, s: DW.scenario(f, wx, { time: new Date(t), hours: R.scenarioHours }) });
    }
    if (!scen.length) { noWind++; continue; } // no wind for this fire: it was not assessed, so none of its assets may be called "not downwind"
    for (const a of set) {
      const key = isLine ? a.key : kind[0] + a.id, spot = Math.round(f.lat * 50) + ',' + Math.round(f.lon * 50); // about 2 km: the same fire on another pass
      let hit = null, nearest = null;
      for (const { wx, s } of scen) {
        if (isLine) {
          const c = DW.crossLine(s, a.pts, 150); if (!c) continue;
          if (!nearest || c.nearestKm < nearest.km) nearest = { km: c.nearestKm, bearing: c.bearing, at: c.nearest };
          if (c.crosses && c.crossKm <= R.reachKm && c.peak >= R.minConc && (!hit || c.peak > hit.peak)) hit = { peak: c.peak, km: c.crossKm, at: c.crossAt, eta: c.etaMin, off: c.offAxisDeg, bearing: c.bearing, nearestKm: c.nearestKm, wx, s };
        } else {
          const c = DW.atPoint(s, a.lat, a.lon);
          if (!nearest || c.km < nearest.km) nearest = { km: c.km, bearing: c.bearing, at: [a.lat, a.lon] };
          if (c.km <= R.reachKm && c.conc >= R.minConc && (!hit || c.conc > hit.peak)) hit = { peak: c.conc, km: c.km, at: [a.lat, a.lon], eta: c.etaMin, off: c.offAxisDeg, bearing: c.bearing, nearestKm: c.km, wx, s };
        }
      }
      const k2 = key + '|' + spot;
      if (hit) {
        const e = best.get(k2);
        if (!e) best.set(k2, { key, kind, asset: isLine ? a.asset : a, fire: f, ...hit, passes: new Set([f.sat + f.time]) });
        else { e.passes.add(f.sat + f.time); if (f.ms > e.fire.ms || (f.ms === e.fire.ms && hit.peak > e.peak)) Object.assign(e, { fire: f, ...hit }); }
      } else if (nearest && nearest.km <= R.nearKm) {
        const e = near.get(k2);
        if (!e || nearest.km < e.km) near.set(k2, { key, kind, asset: isLine ? a.asset : a, fire: f, ...nearest, wx: scen[0].wx, s: scen[0].s });
      }
    }
  }
  // one row per asset: the strongest crossing, with the count of other fires on the same asset
  const byAsset = new Map();
  for (const r of best.values()) { const e = byAsset.get(r.key); if (!e) byAsset.set(r.key, { ...r, others: 0 }); else if (r.peak > e.peak) byAsset.set(r.key, { ...r, others: e.others + 1 }); else e.others++; }
  const rows = [...byAsset.values()].sort((a, b) => b.peak - a.peak);
  const nearRows = [...near.values()].filter(r => !byAsset.has(r.key)).sort((a, b) => a.km - b.km);
  const seen = new Set(), nearOne = nearRows.filter(r => !seen.has(r.key) && seen.add(r.key));
  return { rows, near: nearOne, fires: fires.length, small, cand: cand.length, wxErr, skipped, noWind };
}

/* fast look: INPE 10-minute GOES-19 pixels. ~2 km pixels, no fire power: no plume is run and no µg/m³ is shown.
   o: { kind, assets, rules, wind, now, fd: { pixels, unreachable, ... } } */
async function computeFast(o) {
  const kind = o.kind, P = o.assets, isLine = KINDS[kind].line, FD = o.fd, FA = FASTC();
  const base = { rows: [], near: [], fires: 0, small: 0, fast: true, fd: FD, skipped: 0, noWind: 0 };
  if (!P || !kindBuilt(P, kind)) return { ...base, noAssets: true, notBuilt: !!P };
  if (FD.unreachable) return { ...base, fastErr: 'INPE could not be reached, so the fast look is unavailable. The Latest data tab is not affected.' };
  if ((!isLine && !P.points[kind].length) || (isLine && !P.pieces[kind].length)) return { ...base, noAssets: true, empty: true };
  const R = o.rules || rules(), wind = o.wind;
  let cand = FD.pixels.map(px => ({ px, near: nearAssets(P, kind, px.lat, px.lon, R.reachKm) })).filter(c => c.near.size);
  // strongest evidence first = most scans; at most MAX_CELLS cells of wind per computation
  const range = fastRange(o.now == null ? Date.now() : o.now);
  cand.sort((a, b) => b.px.scans - a.px.scans || b.px.lastMs - a.px.lastMs);
  const cells = new Set(), keep = [];
  for (const c of cand) { const k = cellKey(c.px.lat, c.px.lon); if (cells.has(k) || cells.size < MAX_CELLS) { cells.add(k); keep.push(c); } }
  const skipped = cand.length - keep.length, failed = await wind.fetch(cells, range);
  let noWind = 0;
  const best = new Map();
  for (const { px, near } of keep) {
    const wx = wind.at(px.lat, px.lon, px.lastMs, range);
    if (!wx) { noWind++; continue; } // no wind for this pixel: not assessed
    const w = { ws: wx.ws, wd: wx.wd };
    for (const a of near) {
      const u = isLine ? FA.upwindOfLine(px, w, a.pts) : FA.upwindOfPoint(px, w, a.lat, a.lon);
      if (!(u.downwind || u.inPixel) || (u.distKm != null && u.distKm > 10)) continue;
      const key = isLine ? a.key : kind[0] + a.id, e = best.get(key);
      const at = u.crossAt || (isLine ? [px.lat, px.lon] : [a.lat, a.lon]);
      const row = { key, kind, fast: true, asset: isLine ? a.asset : a, px, u, wx, scans: px.scans, fire: { lat: px.lat, lon: px.lon, sat: 'GOES-19', ms: px.lastMs, frp: null, firstMs: px.firstMs }, at,
        bearing: u.bearing, km: u.distKm, nearestKm: u.distKm, eta: u.travelMin, peak: null, others: 0, passes: null };
      if (!e) best.set(key, row);
      else { row.others = e.others + 1; if (row.scans > e.scans || (row.scans === e.scans && row.km < e.km)) best.set(key, row); else e.others++; }
    }
  }
  const rows = [...best.values()].sort((a, b) => b.scans - a.scans || a.km - b.km);
  const wxErr = noWind ? (failed && noWind === keep.length ? 'Modelled wind is unavailable right now, so the fast look cannot be assessed.' : `Modelled wind could not be loaded for ${noWind} pixel${noWind === 1 ? '' : 's'}; they were not assessed.`) : null;
  return { ...base, rows, fires: FD.pixels.length, cand: cand.length, skipped, noWind, wxErr };
}

root.WATCH = { KINDS, KIND_LIST, MAX_CELLS, FAST_HOURS, RULES: Object.freeze(rules()), rules, layerInfo, kindBuilt, prepAssets, nearAssets, nearPlace, cellKey, wxAtHour, liveRange, fastRange, createWind, fixedWind, computeLive, computeFast };
})(typeof globalThis !== 'undefined' ? globalThis : window);
