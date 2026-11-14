/* FIRELAB map animation: wind streaks and drifting smoke on canvases inside a Leaflet pane.
   It draws the scenario FIRECORE.simulate already computed; it is not a second model.
   - Wind: one uniform vector from the run's wind-from direction, converted once in the core
     (toward = from + 180°; de = sin(toward) east, dn = cos(toward) north). Streaks move along (de, -dn) on screen,
     with speed in proportion to sqrt(u), only inside the 200 km model domain, because the model has one wind value.
   - Smoke: puffs drift downwind, spread sideways by the same Briggs sigma_y as the plume, and are drawn ONLY where
     the run produced a concentration cell (r.cells), with opacity from that cell's band. The footprint on screen is
     therefore the computed footprint; puffs only add texture and a sense of drift. Time is sped up.
   Budgets: about 260 streaks on a desktop and 90 on a phone, at most 30 / 20 frames a second, fixed object pools,
   paused while the map moves, while the tab is hidden, or when nothing is switched on.
   prefers-reduced-motion: nothing moves by default; a static field of wind arrows is drawn instead. */
(function () {
'use strict';
const F = window.FIRECORE;
const reduce = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
const mobile = () => (window.matchMedia && matchMedia('(pointer: coarse)').matches) || innerWidth < 768;

function gauss() { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
function sprite(rgb) { // a soft round puff, drawn once and stamped many times
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, `rgba(${rgb},1)`); gr.addColorStop(.45, `rgba(${rgb},.55)`); gr.addColorStop(1, `rgba(${rgb},0)`);
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return c;
}

function create(map) {
  const pane = map.createPane('simAnim'); pane.style.zIndex = 450; pane.style.pointerEvents = 'none';
  const wind = L.DomUtil.create('canvas', 'leaflet-zoom-hide sim-anim', pane), smoke = L.DomUtil.create('canvas', 'leaflet-zoom-hide sim-anim', pane);
  const wc = wind.getContext('2d'), sc = smoke.getContext('2d');
  const PUFF = sprite('214,214,220'), PUFF_DARK = sprite('150,140,134'), GLOW = sprite('255,140,50');
  const NB = F.BANDS.length;
  const st = { on: { wind: !reduce, smoke: !reduce }, scene: null, origin: L.point(0, 0), w: 0, h: 0, raf: 0, moving: false, t0: 0, last: 0, fps: 30 };

  /* fixed pools: no objects are created while animating */
  const SMAX = 340, PMAX = 900;
  const S = Array.from({ length: SMAX }, () => ({ x: 0, y: 0, age: 0, life: 0 })); let sN = 0;
  const P = Array.from({ length: PMAX }, () => ({ x: 0, z: 0, ph: 0, sp: 1, a: 0 })); let pN = 0;
  const SEG = new Float32Array(SMAX * 4 * 4); // four tail steps of (x1, y1, x2, y2) per streak

  function size() {
    const s = map.getSize(), dpr = Math.min(2, window.devicePixelRatio || 1); st.w = s.x; st.h = s.y; st.fps = mobile() ? 20 : 30;
    for (const c of [wind, smoke]) { c.width = s.x * dpr; c.height = s.y * dpr; c.style.width = s.x + 'px'; c.style.height = s.y + 'px'; }
    st.origin = map.containerPointToLayerPoint([0, 0]);
    L.DomUtil.setPosition(wind, st.origin); L.DomUtil.setPosition(smoke, st.origin);
    wc.setTransform(dpr, 0, 0, dpr, 0, 0); sc.setTransform(dpr, 0, 0, dpr, 0, 0);
    wc.clearRect(0, 0, st.w, st.h); sN = 0;
  }
  const px = (lat, lon) => { const p = map.latLngToLayerPoint([lat, lon]); return [p.x - st.origin.x, p.y - st.origin.y]; };

  /* ---- scene from the model run ---- */
  function setScene(sc0) {
    if (!sc0) { st.scene = null; pN = 0; sN = 0; clear(); return; }
    const { f, p, r, g } = sc0;
    const s = { lat: f.lat, lon: f.lon, u: r.u, de: r.de, dn: r.dn, clat: r.clat, xmax: r.xmax, cls: r.cls, hours: p.hours, band: null, g };
    // band of every computed cell, looked up by grid index; -1 where the run has no cell
    if (g && r.cells.length) {
      s.band = new Int8Array(g.rows * g.cols).fill(-1);
      for (const [la, lo, b] of r.cells) { const row = Math.floor((g.north - la) / g.dy), col = Math.floor((lo - g.west) / g.dx); if (row >= 0 && row < g.rows && col >= 0 && col < g.cols) s.band[row * g.cols + col] = b; }
    }
    const same = st.scene && st.scene.lat === s.lat && st.scene.lon === s.lon;
    st.scene = s;
    if (!same) { pN = 0; sN = 0; wc.clearRect(0, 0, st.w, st.h); }
    else { let k = 0; for (let i = 0; i < pN; i++) if (P[i].x <= s.xmax) { const t = P[k]; P[k] = P[i]; P[i] = t; k++; } pN = k; } // keep the stream when only a setting changes
    if (reduce && !st.on.wind) drawStatic();
    kick();
  }
  // metres downwind (x) and crosswind (y) from the fire -> lat/lon
  const toLL = (s, x, y) => { const e = x * s.de + y * s.dn, n = x * s.dn - y * s.de; return [s.lat + n / 111195, s.lon + e / (111195 * s.clat)]; };
  const bandAt = (s, la, lo) => { if (!s.band) return -1; const g = s.g, row = Math.floor((g.north - la) / g.dy), col = Math.floor((lo - g.west) / g.dx); return row < 0 || row >= g.rows || col < 0 || col >= g.cols ? -1 : s.band[row * g.cols + col]; };

  /* ---- wind ---- */
  function domainPx(s) {
    const c = px(s.lat, s.lon), e = px(s.lat, s.lon + F.MAX_KM / (111.195 * s.clat));
    return { cx: c[0], cy: c[1], R: Math.max(20, Math.abs(e[0] - c[0])) };
  }
  function budget(d) { // the device budget, scaled by how much of the screen the domain covers
    const vis = Math.min(Math.PI * d.R * d.R, st.w * st.h), cap = mobile() ? 90 : 260;
    return Math.round(Math.max(30, cap * Math.min(1, vis / Math.max(1, st.w * st.h))));
  }
  function spawn(q, d) { // uniform over the part of the domain circle that is on screen
    const x0 = Math.max(-20, d.cx - d.R), x1 = Math.min(st.w + 20, d.cx + d.R), y0 = Math.max(-20, d.cy - d.R), y1 = Math.min(st.h + 20, d.cy + d.R);
    if (x1 <= x0 || y1 <= y0) return false;
    for (let k = 0; k < 8; k++) {
      const x = x0 + Math.random() * (x1 - x0), y = y0 + Math.random() * (y1 - y0);
      if ((x - d.cx) ** 2 + (y - d.cy) ** 2 <= d.R * d.R) { q.x = x; q.y = y; q.age = 0; q.life = 60 + Math.random() * 80; return true; }
    }
    return false;
  }
  const ALPHA = [.8, .5, .28, .12];
  function drawWind(s, dt) {
    wc.clearRect(0, 0, st.w, st.h);
    const d = domainPx(s), want = budget(d);
    while (sN < want && spawn(S[sN], d)) sN++;
    if (sN > want) sN = want;
    const sp = .5 + Math.sqrt(s.u) * .75, ux = s.de, uy = -s.dn, seg = 3 + sp * 2.4; // px per 60 Hz frame; screen y grows south
    for (let k = sN - 1; k >= 0; k--) {
      const q = S[k]; q.x += ux * sp * dt; q.y += uy * sp * dt; q.age += dt;
      if (q.age > q.life || (q.x - d.cx) ** 2 + (q.y - d.cy) ** 2 > d.R * d.R || q.x < -40 || q.y < -40 || q.x > st.w + 40 || q.y > st.h + 40) {
        if (!spawn(q, d)) { S[k] = S[sN - 1]; S[sN - 1] = q; SEG.copyWithin(k * 16, (sN - 1) * 16, sN * 16); sN--; continue; } // the swapped-in streak was already drawn into slot sN-1
      }
      const grow = Math.min(1, q.age / 20, (q.life - q.age) / 20);
      let x = q.x, y = q.y;
      for (let n = 0; n < 4; n++) { const o = (k * 4 + n) * 4, x2 = x - ux * seg * grow, y2 = y - uy * seg * grow; SEG[o] = x; SEG[o + 1] = y; SEG[o + 2] = x2; SEG[o + 3] = y2; x = x2; y = y2; }
    }
    const rgb = document.body.classList.contains('light') ? '4,86,104' : '214,248,255';
    wc.lineCap = 'round';
    for (let n = 0; n < 4; n++) {
      wc.beginPath();
      for (let k = 0; k < sN; k++) { const o = (k * 4 + n) * 4; wc.moveTo(SEG[o], SEG[o + 1]); wc.lineTo(SEG[o + 2], SEG[o + 3]); }
      wc.lineWidth = n ? 1.3 : 1.8; wc.strokeStyle = `rgba(${rgb},${ALPHA[n]})`; wc.stroke();
    }
  }
  function drawStatic() { // reduced motion: a still field of arrows along the same vector
    const s = st.scene; wc.clearRect(0, 0, st.w, st.h); if (!s) return;
    const d = domainPx(s), ux = s.de, uy = -s.dn, step = 70, L0 = 14;
    wc.strokeStyle = document.body.classList.contains('light') ? 'rgba(4,86,104,.55)' : 'rgba(214,248,255,.5)'; wc.lineWidth = 1.5; wc.lineCap = 'round';
    wc.beginPath();
    for (let y = step / 2; y < st.h; y += step) for (let x = step / 2; x < st.w; x += step) {
      if ((x - d.cx) ** 2 + (y - d.cy) ** 2 > d.R * d.R) continue;
      const x2 = x + ux * L0, y2 = y + uy * L0;
      wc.moveTo(x - ux * L0, y - uy * L0); wc.lineTo(x2, y2);
      wc.moveTo(x2, y2); wc.lineTo(x2 - ux * 6 + uy * 4, y2 - uy * 6 - ux * 4);
      wc.moveTo(x2, y2); wc.lineTo(x2 - ux * 6 - uy * 4, y2 - uy * 6 + ux * 4);
    }
    wc.stroke();
  }

  /* ---- smoke: drifts downwind, visible only over computed cells ---- */
  function drawSmoke(s, dt, now) {
    sc.clearRect(0, 0, st.w, st.h);
    const crossSec = Math.min(9, Math.max(3.5, 2.2 + s.hours * .45)), vx = s.xmax / (crossSec * 60); // metres per frame
    const rate = (mobile() ? 1.2 : 2.2) * dt, cap = mobile() ? 420 : PMAX;
    for (let k = 0; k < rate && pN < cap; k++) { const q = P[pN++]; q.x = 60 + Math.random() * vx * 2; q.z = gauss(); q.ph = Math.random() * 6.28; q.sp = .75 + Math.random() * .5; q.a = 0; }
    const c0 = px(s.lat, s.lon), m1 = px(s.lat + 1000 / 111195, s.lon), mPerPx = 1000 / Math.max(1e-6, Math.abs(m1[1] - c0[1]));
    const cellM = s.g ? s.g.dy * 111195 : 2800;
    const pulse = 1 + .12 * Math.sin(now / 280), gr = Math.max(14, Math.min(60, 1500 / mPerPx)) * pulse;
    sc.globalAlpha = .75; sc.drawImage(GLOW, c0[0] - gr, c0[1] - gr, gr * 2, gr * 2);
    const ease = Math.min(1, .12 * dt);
    for (let k = pN - 1; k >= 0; k--) {
      const q = P[k]; q.x += vx * q.sp * dt;
      if (q.x > s.xmax) { P[k] = P[pN - 1]; P[pN - 1] = q; pN--; continue; }
      const sy = F.SIG[s.cls](q.x)[0], y = q.z * sy + Math.sin(q.ph + now / 900 + q.x / 4000) * .25 * sy;
      const ll = toLL(s, q.x, y), b = bandAt(s, ll[0], ll[1]);
      const target = b < 0 ? 0 : .1 + .32 * b / Math.max(1, NB - 1);
      q.a += (target - q.a) * ease; // soft edges where the computed footprint ends
      if (q.a < .01) continue;
      const p = px(ll[0], ll[1]), rad = Math.max(4, Math.min(40, Math.min(sy * .7 + 90, cellM * 1.1) / mPerPx));
      if (p[0] < -rad || p[1] < -rad || p[0] > st.w + rad || p[1] > st.h + rad) continue;
      const fadeIn = Math.min(1, q.x / Math.max(200, s.xmax * .04));
      sc.globalAlpha = q.a * fadeIn; sc.drawImage(b >= NB - 2 ? PUFF_DARK : PUFF, p[0] - rad, p[1] - rad, rad * 2, rad * 2);
    }
    sc.globalAlpha = 1;
  }

  function frame(now) {
    st.raf = 0;
    const s = st.scene; if (!s || st.moving || document.hidden || (!st.on.wind && !st.on.smoke)) return;
    st.raf = requestAnimationFrame(frame);
    if (st.last && now - st.last < 1000 / st.fps - 2) return; // frame cap
    const dt = st.t0 ? Math.min(3, (now - st.t0) / 16.7) : 1; st.t0 = now; st.last = now;
    if (st.on.wind) drawWind(s, dt);
    if (st.on.smoke) drawSmoke(s, dt, now);
  }
  function kick() { if (!st.raf && st.scene && !st.moving && !document.hidden && (st.on.wind || st.on.smoke)) { st.t0 = 0; st.last = 0; st.raf = requestAnimationFrame(frame); } }
  function clear() { wc.clearRect(0, 0, st.w, st.h); sc.clearRect(0, 0, st.w, st.h); }
  function stop() { if (st.raf) cancelAnimationFrame(st.raf); st.raf = 0; }

  map.on('movestart zoomstart', () => { st.moving = true; stop(); clear(); });
  map.on('moveend zoomend resize viewreset', () => { st.moving = false; size(); if (reduce && !st.on.wind) drawStatic(); kick(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); else kick(); });
  size();

  return {
    setScene,
    set(kind, on) {
      st.on[kind] = on;
      if (!on) (kind === 'wind' ? wc : sc).clearRect(0, 0, st.w, st.h);
      if (kind === 'wind' && !on && reduce) drawStatic();
      kick();
    },
    get on() { return { ...st.on }; },
    reducedMotion: reduce,
    // for checks: the screen direction every streak moves in, and a live streak's position
    probe() { const s = st.scene; return s ? { ux: s.de, uy: -s.dn, streaks: sN, puffs: pN, first: sN ? { x: S[0].x, y: S[0].y } : null } : null; },
  };
}
window.SIMANIM = { create };
})();
