/* FAST: fast, coarse fire detections from INPE Programa Queimadas 10-minute files (GOES-19 rows only).
   Plain script: attaches FAST to window/globalThis. Needs DOWNWIND (downwind-core.js) loaded first for the geometry.
   Second, coarser observation source: ~2 km pixels, no fire power, no confidence. Not validated against ground reports. */
(function (root) {
  'use strict';
  const BASE = 'https://dataserver-coids.inpe.br/queimadas/queimadas/focos/csv/10min/';
  const STEP = 6e5, PIXEL_KM = 2, MAX_CONC = 6;
  const SOURCE = Object.freeze({
    name: 'INPE Programa Queimadas, 10-minute files, GOES-19',
    url: BASE,
    caveats: Object.freeze([
      'About 2 km pixels: the fire can be anywhere in the pixel.',
      'No fire power and no confidence value in these files.',
      'More false alarms than MODIS or VIIRS.',
      'Small or short fires can be missed.',
      'Cloud hides fires.',
      'Coverage is South America only.'
    ])
  });
  const cache = new Map(); // file name -> { status:'ok'|'missing', rows:[{lat,lon,ms}] }, only definitive answers are cached
  const p2 = n => String(n).padStart(2, '0');
  const stamp = ms => { const d = new Date(ms); return `${d.getUTCFullYear()}${p2(d.getUTCMonth() + 1)}${p2(d.getUTCDate())}_${p2(d.getUTCHours())}${p2(d.getUTCMinutes())}`; };
  const fileName = ms => `focos_10min_${stamp(ms)}.csv`;

  /* 10-minute stamps (ms, UTC) covering the last `hours` hours, newest first. Starts at the stamp of the current
     10-minute slot (the file is often not published yet; a 404 is tolerated by load). */
  function fileTimes(nowMs, hours) {
    const top = Math.floor(nowMs / STEP) * STEP, from = nowMs - hours * 36e5, out = [];
    for (let t = top; t >= from - STEP + 1; t -= STEP) out.push(t);
    return out;
  }

  const num = s => (s == null || String(s).trim() === '') ? NaN : Number(String(s).trim());
  /* Rows with a full date AND time only. "YYYY-MM-DD HH:MM[:SS]" in UTC; a date alone is dropped. */
  function parseCsv(text, fileMs) {
    const rows = [];
    const lines = String(text).split(/\r?\n/);
    for (const line of lines) {
      const c = line.split(',');
      if (c.length < 4) continue;
      const lat = num(c[0]), lon = num(c[1]);
      const sat = c[2].trim().toUpperCase(), dt = c.slice(3).join(',').trim();
      if (sat !== 'GOES-19' || !isFinite(lat) || !isFinite(lon)) continue;
      const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(dt);
      if (!m) continue;
      const ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
      if (isNaN(ms)) continue;
      rows.push({ lat, lon, ms });
    }
    return rows;
  }

  async function fetchOne(name, fetchImpl) {
    if (cache.has(name)) return cache.get(name);
    let res;
    try { res = await fetchImpl(BASE + name); } catch (e) { return { status: 'failed' }; }
    if (!res) return { status: 'failed' };
    if (res.status === 404) { const r = { status: 'missing' }; return r; } // not cached: the newest file may appear later
    if (!res.ok) return { status: 'failed' };
    let text; try { text = await res.text(); } catch (e) { return { status: 'failed' }; }
    const r = { status: 'ok', text };
    cache.set(name, r);
    return r;
  }

  async function load(o) {
    o = o || {};
    const bbox = o.bbox, hours = o.hours == null ? 6 : o.hours, now = o.now == null ? Date.now() : o.now;
    const fetchImpl = o.fetchImpl || (typeof fetch === 'function' ? fetch.bind(root) : null);
    if (!fetchImpl) throw new Error('FAST.load: no fetch available');
    const times = fileTimes(now, hours), results = new Array(times.length);
    let next = 0;
    const worker = async () => { while (next < times.length) { const i = next++; results[i] = await fetchOne(fileName(times[i]), fetchImpl); } };
    await Promise.all(Array.from({ length: Math.min(MAX_CONC, times.length) }, worker));
    const files = { requested: times.length, loaded: 0, missing: 0, failed: 0 };
    const detections = [];
    let newestFileMs = null, newestDetectionMs = null;
    results.forEach((r, i) => {
      if (r.status === 'missing') { files.missing++; return; }
      if (r.status !== 'ok') { files.failed++; return; }
      files.loaded++;
      if (newestFileMs == null || times[i] > newestFileMs) newestFileMs = times[i];
      for (const d of parseCsv(r.text)) {
        if (bbox && (d.lon < bbox[0] || d.lat < bbox[1] || d.lon > bbox[2] || d.lat > bbox[3])) continue;
        detections.push({ lat: d.lat, lon: d.lon, ms: d.ms, time: new Date(d.ms).toISOString(), fileMs: times[i] });
        if (newestDetectionMs == null || d.ms > newestDetectionMs) newestDetectionMs = d.ms;
      }
    });
    return { detections, files, newestFileMs, newestDetectionMs };
  }

  /* Same pixel (lat, lon equal to 3 decimals) -> one entry. scans = distinct 10-minute scans (file time stamps)
     that flagged it. One scan is weak evidence; several consecutive scans are stronger. Sorted by scans, then recency. */
  function pixels(detections) {
    const m = new Map();
    for (const d of detections) {
      const k = d.lat.toFixed(3) + ',' + d.lon.toFixed(3);
      let p = m.get(k);
      if (!p) { p = { lat: +d.lat.toFixed(3), lon: +d.lon.toFixed(3), firstMs: d.ms, lastMs: d.ms, _s: new Set() }; m.set(k, p); }
      p.firstMs = Math.min(p.firstMs, d.ms); p.lastMs = Math.max(p.lastMs, d.ms);
      p._s.add(Math.round(d.ms / STEP)); // by detection slot, so the same scan repeated in two files counts once
    }
    return [...m.values()].map(p => ({ lat: p.lat, lon: p.lon, firstMs: p.firstMs, lastMs: p.lastMs, scans: p._s.size }))
      .sort((a, b) => b.scans - a.scans || b.lastMs - a.lastMs);
  }

  const D = () => { if (!root.DOWNWIND) throw new Error('FAST needs DOWNWIND (downwind-core.js) loaded first'); return root.DOWNWIND; };
  const KM = 111.195;
  const angDiff = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
  const travel = (km, ws) => km * 1000 / Math.max(1, ws || 0) / 60;
  const base = (pixel, wx, extra) => Object.assign({ uncertainKm: PIXEL_KM, wind: { ws: wx.ws, wd: wx.wd, toward: (wx.wd + 180) % 360 } }, extra);

  function upwindOfPoint(pixel, wx, lat, lon, opts) {
    const d = D(), reach = (opts && opts.reachKm) || 10, half = (opts && opts.halfAngle) || 30;
    const distKm = d.dist(pixel.lat, pixel.lon, lat, lon), brg = d.bearing(pixel.lat, pixel.lon, lat, lon);
    const toward = (wx.wd + 180) % 360, off = angDiff(brg, toward);
    const along = distKm * Math.cos(off * Math.PI / 180);
    const inPixel = distKm < PIXEL_KM;
    return base(pixel, wx, {
      distKm, bearing: brg, compass: d.compass(brg), offAxisDeg: off, alongKm: along,
      downwind: !inPixel && distKm <= reach && off <= half,
      inPixel, travelMin: along > 0 ? travel(along, wx.ws) : null
    });
  }

  function upwindOfLine(pixel, wx, pts, opts) {
    const d = D(), reach = (opts && opts.reachKm) || 10;
    const kx = KM * Math.cos(pixel.lat * Math.PI / 180);
    const xy = p => [(p[1] - pixel.lon) * kx, (p[0] - pixel.lat) * KM]; // pts are [lat, lon]; pixel at origin, x east, y north
    const toward = (wx.wd + 180) % 360, ux = Math.sin(toward * Math.PI / 180), uy = Math.cos(toward * Math.PI / 180);
    let best = null, cross = null;
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = xy(pts[i]), b = xy(pts[i + 1]), sx = b[0] - a[0], sy = b[1] - a[1], L2 = sx * sx + sy * sy;
      // nearest point on the segment to the origin
      const t0 = L2 ? Math.max(0, Math.min(1, -(a[0] * sx + a[1] * sy) / L2)) : 0;
      const nx = a[0] + t0 * sx, ny = a[1] + t0 * sy, nd = Math.hypot(nx, ny);
      if (!best || nd < best.km) best = { km: nd, x: nx, y: ny };
      // ray origin + r*u crosses segment a + s*(b-a)
      const den = ux * sy - uy * sx;
      if (Math.abs(den) < 1e-12) continue;
      const r = (a[0] * sy - a[1] * sx) / den, s = (a[0] * uy - a[1] * ux) / den;
      if (r >= 0 && s >= 0 && s <= 1 && (!cross || r < cross.r)) cross = { r, x: r * ux, y: r * uy };
    }
    if (!best) return base(pixel, wx, { distKm: null, bearing: null, compass: null, downwind: false, inPixel: false, alongKm: null, travelMin: null });
    const nLat = pixel.lat + best.y / KM, nLon = pixel.lon + best.x / kx;
    const brg = d.bearing(pixel.lat, pixel.lon, nLat, nLon), dKm = d.dist(pixel.lat, pixel.lon, nLat, nLon);
    const inPixel = dKm < PIXEL_KM;
    const hit = cross && cross.r <= reach;
    return base(pixel, wx, {
      distKm: dKm, bearing: brg, compass: d.compass(brg),
      downwind: !inPixel && !!hit, inPixel,
      alongKm: hit ? cross.r : null, travelMin: hit ? travel(cross.r, wx.ws) : null,
      crossAt: hit ? [pixel.lat + cross.y / KM, pixel.lon + cross.x / kx] : null
    });
  }

  root.FAST = { SOURCE, fileTimes, fileName, parseCsv, load, pixels, upwindOfLine, upwindOfPoint, _cache: cache };
})(typeof window !== 'undefined' ? window : globalThis);
