/* FIRELAB map animation: wind streaks and drifting smoke drawn on a canvas inside a Leaflet pane.
   It is a picture of the scenario already computed by FIRECORE.simulate, not a second model:
   - wind streaks move in the modelled (or overridden) wind direction, with speed in proportion to wind speed,
     only inside the 200 km simulation domain, because one wind value at the fire is all the model uses;
   - smoke puffs leave the fire, travel downwind to the smoke front reached in the chosen hours, spread sideways by
     the same Briggs sigma_y used for the plume, and are drawn more opaque where the scenario concentration is higher.
   Time is compressed so each puff crosses the plume in a few seconds. */
(function () {
'use strict';
const F = window.FIRECORE;
const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

function gauss() { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
function sprite(rgb) { // soft round puff, drawn once and stamped many times
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
  const st = { on: { wind: !reduce, smoke: !reduce }, scene: null, origin: L.point(0, 0), w: 0, h: 0, dpr: 1, streaks: [], puffs: [], raf: 0, moving: false, t0: 0 };

  function size() {
    const s = map.getSize(); st.dpr = Math.min(2, window.devicePixelRatio || 1); st.w = s.x; st.h = s.y;
    for (const c of [wind, smoke]) { c.width = s.x * st.dpr; c.height = s.y * st.dpr; c.style.width = s.x + 'px'; c.style.height = s.y + 'px'; }
    st.origin = map.containerPointToLayerPoint([0, 0]);
    L.DomUtil.setPosition(wind, st.origin); L.DomUtil.setPosition(smoke, st.origin);
    wc.setTransform(st.dpr, 0, 0, st.dpr, 0, 0); sc.setTransform(st.dpr, 0, 0, st.dpr, 0, 0);
    wc.clearRect(0, 0, st.w, st.h);
    st.streaks = [];
  }
  const px = (lat, lon) => { const p = map.latLngToLayerPoint([lat, lon]); return [p.x - st.origin.x, p.y - st.origin.y]; };

  /* ---- scene from the model run ---- */
  function setScene(sc0) {
    if (!sc0) { st.scene = null; st.puffs = []; clear(); return; }
    const { f, p, r } = sc0, s = { lat: f.lat, lon: f.lon, u: r.u, de: r.de, dn: r.dn, clat: r.clat, xmax: r.xmax, cls: r.cls, Qg: r.Qg, he: r.he, Lmix: r.Lmix, cmax: r.cmax, hours: p.hours };
    const same = st.scene && st.scene.lat === s.lat && st.scene.lon === s.lon;
    st.scene = s;
    if (!same) st.puffs = [];
    else st.puffs = st.puffs.filter(q => q.x <= s.xmax); // keep the stream when only a setting changes
    if (!same) { st.streaks = []; wc.clearRect(0, 0, st.w, st.h); }
    kick();
  }
  // metres downwind (x) and crosswind (y) from the fire -> lat/lon
  const toLL = (s, x, y) => { const e = x * s.de + y * s.dn, n = x * s.dn - y * s.de; return [s.lat + n / 111195, s.lon + e / (111195 * s.clat)]; };

  /* ---- wind streaks: uniform field from the one modelled wind, inside the domain only ---- */
  function domainPx(s) {
    const c = px(s.lat, s.lon), e = px(s.lat, s.lon + F.MAX_KM / (111.195 * s.clat));
    return { cx: c[0], cy: c[1], R: Math.max(20, Math.abs(e[0] - c[0])) };
  }
  function spawnStreak(d) {
    // spawn inside the visible part of the domain circle
    for (let k = 0; k < 8; k++) {
      const a = Math.random() * 2 * Math.PI, rr = d.R * Math.sqrt(Math.random()), x = d.cx + rr * Math.cos(a), y = d.cy + rr * Math.sin(a);
      if (x >= -20 && y >= -20 && x <= st.w + 20 && y <= st.h + 20) return { x, y, age: 0, life: 50 + Math.random() * 70 };
    }
    return null;
  }
  const ALPHA = [.75, .45, .25, .1];
  function drawWind(s, dt) {
    // each streak is drawn as a short tail in four fading steps, so nothing is left behind between frames
    wc.clearRect(0, 0, st.w, st.h);
    const d = domainPx(s), vis = Math.min(d.R * 2, Math.hypot(st.w, st.h)), want = Math.round(Math.min(700, Math.max(50, vis * vis / 2200)));
    while (st.streaks.length < want) { const q = spawnStreak(d); if (!q) break; st.streaks.push(q); }
    const sp = .6 + Math.sqrt(s.u) * .8, ux = s.de, uy = -s.dn; // pixels per frame; screen y grows southward
    const seg = 3 + sp * 2.2; // length of one tail step, px
    const light = document.body.classList.contains('light'), rgb = light ? '4,86,104' : '205,245,255';
    const paths = ALPHA.map(() => new Path2D());
    for (let k = st.streaks.length - 1; k >= 0; k--) {
      const q = st.streaks[k]; q.x += ux * sp * dt; q.y += uy * sp * dt; q.age += dt;
      if (q.age > q.life || (q.x - d.cx) ** 2 + (q.y - d.cy) ** 2 > d.R * d.R || q.x < -40 || q.y < -40 || q.x > st.w + 40 || q.y > st.h + 40) { st.streaks.splice(k, 1); continue; }
      const grow = Math.min(1, q.age / 25, (q.life - q.age) / 25); // tails grow in and shrink out
      let x = q.x, y = q.y;
      for (let n = 0; n < ALPHA.length; n++) { const x2 = x - ux * seg * grow, y2 = y - uy * seg * grow; paths[n].moveTo(x, y); paths[n].lineTo(x2, y2); x = x2; y = y2; }
    }
    wc.lineCap = 'round';
    paths.forEach((pa, n) => { wc.lineWidth = n ? 1.3 : 1.7; wc.strokeStyle = `rgba(${rgb},${ALPHA[n]})`; wc.stroke(pa); });
  }

  /* ---- smoke puffs: same direction, front and sideways spread as the scenario ---- */
  function drawSmoke(s, dt, now) {
    sc.clearRect(0, 0, st.w, st.h);
    const crossSec = Math.min(9, Math.max(3.5, 2.2 + s.hours * .45)), vx = s.xmax / (crossSec * 60); // metres per frame
    const rate = 2.4 * dt, maxN = 1000;
    for (let k = 0; k < rate && st.puffs.length < maxN; k++) st.puffs.push({ x: 60 + Math.random() * vx * 2, z: gauss(), ph: Math.random() * 6.28, sp: .75 + Math.random() * .5 });
    const c0 = px(s.lat, s.lon), m1 = px(s.lat + 1000 / 111195, s.lon), mPerPx = 1000 / Math.max(1e-6, Math.abs(m1[1] - c0[1]));
    const logMax = Math.log10(Math.max(2, s.cmax));
    // source glow, pulsing
    const pulse = 1 + .12 * Math.sin(now / 280), gr = Math.max(14, Math.min(60, 1500 / mPerPx)) * pulse;
    sc.globalAlpha = .75; sc.drawImage(GLOW, c0[0] - gr, c0[1] - gr, gr * 2, gr * 2);
    for (let k = st.puffs.length - 1; k >= 0; k--) {
      const q = st.puffs[k]; q.x += vx * q.sp * dt;
      if (q.x > s.xmax) { st.puffs.splice(k, 1); continue; }
      const sy = F.SIG[s.cls](q.x)[0], y = q.z * sy + Math.sin(q.ph + now / 900 + q.x / 4000) * .25 * sy;
      const ll = toLL(s, q.x, y), p = px(ll[0], ll[1]);
      const rad = Math.max(5, Math.min(48, (sy * .8 + 100) / mPerPx));
      if (p[0] < -rad || p[1] < -rad || p[0] > st.w + rad || p[1] > st.h + rad) continue;
      const c = F.conc(s.Qg, s.u, s.he, s.Lmix, s.cls, Math.max(60, q.x), y, 0);
      const dens = c > .05 ? Math.max(0, Math.min(1, (Math.log10(c) + 1.3) / (logMax + 1.3))) : 0;
      const fadeIn = Math.min(1, q.x / Math.max(200, s.xmax * .04)), fadeOut = Math.min(1, (s.xmax - q.x) / Math.max(200, s.xmax * .12));
      const a = (.1 + .3 * dens) * fadeIn * fadeOut;
      if (a < .01) continue;
      sc.globalAlpha = a; sc.drawImage(dens > .6 ? PUFF_DARK : PUFF, p[0] - rad, p[1] - rad, rad * 2, rad * 2);
    }
    sc.globalAlpha = 1;
  }

  function frame(now) {
    st.raf = 0;
    const s = st.scene; if (!s || st.moving || (!st.on.wind && !st.on.smoke)) return;
    const dt = st.t0 ? Math.min(3, (now - st.t0) / 16.7) : 1; st.t0 = now;
    if (st.on.wind) drawWind(s, dt);
    if (st.on.smoke) drawSmoke(s, dt, now);
    st.raf = requestAnimationFrame(frame);
  }
  function kick() { if (!st.raf && st.scene && !st.moving && (st.on.wind || st.on.smoke)) { st.t0 = 0; st.raf = requestAnimationFrame(frame); } }
  function clear() { wc.clearRect(0, 0, st.w, st.h); sc.clearRect(0, 0, st.w, st.h); }
  function stop() { if (st.raf) cancelAnimationFrame(st.raf); st.raf = 0; }

  map.on('movestart zoomstart', () => { st.moving = true; stop(); wc.clearRect(0, 0, st.w, st.h); });
  map.on('moveend zoomend resize viewreset', () => { st.moving = false; size(); kick(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); else kick(); });
  size();

  return {
    setScene,
    set(kind, on) { st.on[kind] = on; if (!on) (kind === 'wind' ? wc : sc).clearRect(0, 0, st.w, st.h); kick(); },
    get on() { return { ...st.on }; },
    reducedMotion: reduce,
  };
}
window.SIMANIM = { create };
})();
