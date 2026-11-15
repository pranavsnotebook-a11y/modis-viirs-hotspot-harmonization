/* DOWNWIND core: which mapped assets does the modelled smoke of an observed fire reach?
   OBSERVED: the fire detections. MAPPED: the assets (OpenStreetMap). MODELLED: wind. SCENARIO: the plume (FIRECORE).
   Pure functions, no DOM and no network, so the browser page and the Node replay script run the same code. */
(function (root) {
'use strict';
const F = root.FIRECORE, R = Math.PI / 180, KM = 111.195;

/* Group detections of one overpass (same satellite, within 10 minutes) that sit within `km` of each other: one fire
   is often split across pixels. FRP is summed (assuming one fire), the position is the FRP-weighted mean.
   Different satellites and different overpasses are never merged, so no fire is counted twice inside a cluster. */
function cluster(dets, km = 1.5) {
  const out = [], by = new Map();
  dets.forEach(d => { if (!by.has(d.sat)) by.set(d.sat, []); by.get(d.sat).push(d); });
  for (const g of by.values()) {
    g.sort((a, b) => a.lat - b.lat);
    const seen = new Array(g.length).fill(false), ms = g.map(d => Date.parse(d.time)), dLat = km / KM;
    for (let i = 0; i < g.length; i++) {
      if (seen[i]) continue;
      const q = [i], m = []; seen[i] = true;
      while (q.length) {
        const ai = q.pop(), a = g[ai]; m.push(a);
        for (let j = ai - 1; j >= 0 && a.lat - g[j].lat <= dLat; j--) if (!seen[j] && Math.abs(ms[j] - ms[ai]) <= 6e5 && dist(a.lat, a.lon, g[j].lat, g[j].lon) <= km) { seen[j] = true; q.push(j); }
        for (let j = ai + 1; j < g.length && g[j].lat - a.lat <= dLat; j++) if (!seen[j] && Math.abs(ms[j] - ms[ai]) <= 6e5 && dist(a.lat, a.lon, g[j].lat, g[j].lon) <= km) { seen[j] = true; q.push(j); }
      }
      m.sort((a, b) => b.frp - a.frp);
      const w = m.reduce((s, d) => s + Math.max(d.frp, .01), 0);
      out.push({ lat: m.reduce((s, d) => s + d.lat * Math.max(d.frp, .01), 0) / w, lon: m.reduce((s, d) => s + d.lon * Math.max(d.frp, .01), 0) / w,
        frp: m.reduce((s, d) => s + d.frp, 0), n: m.length, time: m[0].time, sat: m[0].sat, product: m[0].product, id: m[0].id, members: m });
    }
  }
  return out.sort((a, b) => a.time < b.time ? -1 : a.time > b.time ? 1 : b.frp - a.frp);
}
function dist(la1, lo1, la2, lo2) { return Math.hypot((la2 - la1) * KM, (lo2 - lo1) * KM * Math.cos((la1 + la2) / 2 * R)); }
function bearing(la1, lo1, la2, lo2) { return (Math.atan2((lo2 - lo1) * Math.cos(la1 * R), la2 - la1) / R + 360) % 360; }
const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
const compass = deg => COMPASS[Math.round(((deg % 360) + 360) % 360 / 45) % 8];

/* The scenario for one fire and one hour of modelled weather. wx: {ws, wd, u10, blh, cloud}. */
function scenario(fire, wx, o = {}) {
  const p = { lat: fire.lat, lon: fire.lon, frp: fire.frp, ws: wx.ws, wd: wx.wd, u10: wx.u10, blh: wx.blh, cloud: wx.cloud ?? 50,
    time: new Date(o.time || fire.time), ef: o.ef ?? F.BIOMES[0].ef, hours: o.hours ?? 3, trap: !!o.trap };
  return { p, r: F.simulate(p, null, { noGrid: true }) };
}
// downwind (x) and crosswind (y) metres of a point, relative to the fire
function xy(s, lat, lon) {
  const e = (lon - s.p.lon) * KM * 1000 * s.r.clat, n = (lat - s.p.lat) * KM * 1000;
  return [e * s.r.de + n * s.r.dn, e * s.r.dn - n * s.r.de];
}
const at = (s, lat, lon) => { const [x, y] = xy(s, lat, lon); return x > 0 && x <= s.r.xmax ? F.conc(s.r.Qg, s.r.u, s.r.he, s.r.Lmix, s.r.cls, x, y, 0) : 0; };

/* A line asset (pts: [[lat, lon], ...]). Reports where the plume axis crosses it, the nearest approach, and the peak
   modelled ground-level PM2.5 added along the line, sampled every `step` metres. */
function crossLine(s, pts, step = 100) {
  let cross = null, near = null, peak = 0, peakAt = null;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i], b = pts[i + 1], [xa, ya] = xy(s, a[0], a[1]), [xb, yb] = xy(s, b[0], b[1]);
    if (Math.max(xa, xb) < -5000 && Math.min(Math.hypot(xa, ya), Math.hypot(xb, yb)) > 60000) continue;
    if (ya * yb <= 0 && ya !== yb) { // the segment passes over the plume axis
      const t = ya / (ya - yb), x = xa + t * (xb - xa);
      if (x > 0 && (!cross || x < cross.x)) cross = { x, lat: a[0] + t * (b[0] - a[0]), lon: a[1] + t * (b[1] - a[1]) };
    }
    const len = Math.hypot(xb - xa, yb - ya), n = Math.max(1, Math.ceil(len / step));
    for (let k = 0; k <= n; k++) {
      const t = k / n, x = xa + t * (xb - xa), y = ya + t * (yb - ya), d = Math.hypot(x, y);
      if (!near || d < near.d) near = { d, lat: a[0] + t * (b[0] - a[0]), lon: a[1] + t * (b[1] - a[1]) };
      if (x > 0 && x <= s.r.xmax) { const c = F.conc(s.r.Qg, s.r.u, s.r.he, s.r.Lmix, s.r.cls, x, y, 0); if (c > peak) { peak = c; peakAt = [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]), x]; } }
    }
  }
  if (!near) return null;
  const brg = bearing(s.p.lat, s.p.lon, near.lat, near.lon);
  let off = Math.abs(brg - s.r.toward) % 360; if (off > 180) off = 360 - off;
  return { nearestKm: near.d / 1000, nearest: [near.lat, near.lon], bearing: brg, offAxisDeg: off,
    crosses: !!cross && cross.x <= s.r.xmax, crossKm: cross ? cross.x / 1000 : null, crossAt: cross ? [cross.lat, cross.lon] : null,
    etaMin: cross ? cross.x / s.r.u / 60 : null, peak, peakAt };
}
/* A point asset. */
function atPoint(s, lat, lon) {
  const [x, y] = xy(s, lat, lon), brg = bearing(s.p.lat, s.p.lon, lat, lon);
  let off = Math.abs(brg - s.r.toward) % 360; if (off > 180) off = 360 - off;
  return { km: Math.hypot(x, y) / 1000, bearing: brg, offAxisDeg: off, downwind: x > 0, etaMin: x > 0 ? x / s.r.u / 60 : null, conc: at(s, lat, lon) };
}

root.DOWNWIND = { cluster, dist, bearing, compass, scenario, crossLine, atPoint, at };
})(typeof window !== 'undefined' ? window : globalThis);
