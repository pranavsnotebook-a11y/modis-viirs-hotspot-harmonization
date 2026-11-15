/* ROUTE core: how much modelled smoke does each driving route meet, at the time the vehicle would be there?
   OBSERVED: the fire detections (NASA FIRMS). MAPPED: the roads and places (OpenStreetMap). MODELLED: the wind (Open-Meteo).
   SCENARIO: the plume (FIRECORE through DOWNWIND.scenario), with each fire held at its observed power for the whole trip.
   Pure functions plus an injected fetch: no DOM and no globals of its own, so the browser page and the Node tests run the same code.
   Needs FIRECORE (firelab-core.js), DOWNWIND (downwind-core.js) and WATCH (watch-core.js) loaded first. Nothing here is a measurement of smoke. */
(function (root) {
'use strict';
const D = () => root.DOWNWIND, W = () => root.WATCH, F = () => root.FIRECORE;
const NAMES = ['A', 'B', 'C', 'D'];   // D is only ever a detour
const RULES = Object.freeze({ stepKm: 1, reachKm: 25, minConc: 1, clusterKm: 1.5, minFrp: 5, hours: 24, scenarioHours: 3, oldHours: 12, maxRoutes: 3, maxWaypoints: 8, exampleKm: 20, exampleEndKm: 30, examplePlaceKm: 25,
  detourKm: [8, 15, 25], maxDetourTries: 6, detourCut: .5, detourMaxAddMin: 45, detourMaxAddShare: .6, maxVia: 3,
  driveAhead: [5, 1], reassessMin: 10, gpsMaxOffKm: 2, simSpeed: 30, leaveHours: [0, 1, 2, 3] });
const hourOf = ms => Math.floor(ms / 36e5) * 36e5;
const day = ms => new Date(ms).toISOString().slice(0, 10);
const r1 = x => Math.round(x * 10) / 10;

/* ---------- fires ---------- */
/* the fires that count: detections of the last `hours` of data (counted back from the data end), grouped per pass, at least minFrp MW summed */
function fireClusters(fires, end, o = {}) {
  const hours = o.hours ?? RULES.hours, minFrp = o.minFrp ?? RULES.minFrp, km = o.clusterKm ?? RULES.clusterKm;
  const dets = fires.filter(d => d.ms > end - hours * 36e5 && d.ms <= end);
  const all = D().cluster(dets, km).map(f => ({ ...f, ms: Date.parse(f.time) }));
  const clusters = all.filter(f => f.frp >= minFrp);
  return { clusters, small: all.length - clusters.length, detections: dets.length };
}

/* ---------- sampling ---------- */
/* route: { coords: [[lon, lat], ...], distance (m), duration (s) }. Samples every <= stepKm along the line; the arrival time at a sample is
   the departure plus the duration times the share of the distance covered. w is the km a sample stands for (the weights add up to the length). */
function sampleRoute(route, depMs, stepKm = RULES.stepKm) {
  const c = route.coords, d = D().dist, cum = [0];
  for (let i = 1; i < c.length; i++) cum.push(cum[i - 1] + d(c[i - 1][1], c[i - 1][0], c[i][1], c[i][0]));
  const total = cum[cum.length - 1], n = Math.max(1, Math.ceil(total / stepKm)), out = [];
  const dur = (route.duration || 0) * 1000;
  let seg = 1;
  for (let k = 0; k <= n; k++) {
    const km = total * k / n;
    while (seg < c.length - 1 && cum[seg] < km) seg++;
    const span = cum[seg] - cum[seg - 1], t = span > 0 ? Math.min(1, Math.max(0, (km - cum[seg - 1]) / span)) : 0;
    const a = c[seg - 1] || c[0], b = c[seg] || c[0];
    const w = total === 0 ? 0 : (k === 0 || k === n ? .5 : 1) * total / n;
    out.push({ lat: a[1] + (b[1] - a[1]) * t, lon: a[0] + (b[0] - a[0]) * t, km, w, ms: depMs + (total > 0 ? dur * km / total : 0), min: total > 0 ? dur / 6e4 * w / total : 0, conc: 0 });
  }
  return { samples: out, km: total };
}
/* the point at a distance along the route (km from the start), by the route's own geometry */
function pointAlong(route, km) {
  const c = route.coords, d = D().dist; let acc = 0;
  for (let i = 1; i < c.length; i++) {
    const L = d(c[i - 1][1], c[i - 1][0], c[i][1], c[i][0]);
    if (acc + L >= km || i === c.length - 1) { const t = L > 0 ? Math.min(1, Math.max(0, (km - acc) / L)) : 0; return [c[i - 1][1] + (c[i][1] - c[i - 1][1]) * t, c[i - 1][0] + (c[i][0] - c[i - 1][0]) * t]; }
    acc += L;
  }
  return [c[0][1], c[0][0]];
}

/* ---------- exposure ---------- */
/* o: { routes: [{coords, distance, duration}], depMs, clusters, wind (WATCH.createWind-like: fetch, has, at), rules }
   Returns { routes: [...], best, depMs, range, fires: {relevant, assessed, noWind, capped}, windFailed } */
async function assess(o) {
  const R = { ...RULES, ...(o.rules || {}) }, DW = D(), wind = o.wind, depMs = o.depMs;
  const names = o.names || NAMES, routes = (o.routes || []).slice(0, R.maxRoutes).map((rt, i) => ({ name: names[i], detour: !!rt.detour, route: rt, ...sampleRoute(rt, depMs, R.stepKm) }));
  if (o.noFireData) { // no fire data at all: nothing can be said about the smoke, and "no fires near the route" must not be claimed
    routes.forEach((r, i) => { r.fires = 0; r.unassessed = 0; r.fireIdx = []; r.status = 'notAssessed'; r.rank = i + 1; r.best = false; metrics(r, R); });
    return { routes, best: null, depMs, range: null, rules: R, fires: { relevant: 0, assessed: 0, noWind: 0, capped: 0 }, relFires: [], windFailed: false, noFireData: true };
  }
  // fires that matter: within reachKm of any sample of any route
  const fires = [], byRoute = routes.map(() => new Set());
  const dLat = R.reachKm / 111.195;
  (o.clusters || []).forEach((f, fi) => {
    const dLon = dLat / Math.max(.2, Math.cos(f.lat * Math.PI / 180));
    routes.forEach((r, ri) => {
      for (const s of r.samples) { if (Math.abs(s.lat - f.lat) > dLat || Math.abs(s.lon - f.lon) > dLon) continue; if (DW.dist(s.lat, s.lon, f.lat, f.lon) <= R.reachKm) { byRoute[ri].add(fi); break; } }
    });
  });
  const relevant = new Set(); byRoute.forEach(s => s.forEach(i => relevant.add(i)));
  const rel = [...relevant].map(i => ({ i, f: o.clusters[i] }));
  // wind: at most MAX_CELLS cells, the strongest fires first (a weaker fire in a chosen cell costs nothing)
  const lastMs = routes.reduce((m, r) => Math.max(m, r.samples[r.samples.length - 1].ms), depMs);
  const range = { d0: day(depMs), d1: day(lastMs), old: false };
  const cells = new Set(), keep = new Set(); let capped = 0;
  for (const x of rel.slice().sort((a, b) => b.f.frp - a.f.frp)) { const k = W().cellKey(x.f.lat, x.f.lon); if (cells.has(k) || cells.size < W().MAX_CELLS) { cells.add(k); keep.add(x.i); } else capped++; }
  const failed = cells.size ? await wind.fetch(cells, range) : 0;
  const assessedSet = new Set([...keep].filter(i => wind.has(o.clusters[i].lat, o.clusters[i].lon, range)));
  const scen = new Map(); // fire index + hour -> scenario or null (no wind at that hour)
  const scenOf = (i, ms) => {
    const key = i + '|' + hourOf(ms); if (scen.has(key)) return scen.get(key);
    const f = o.clusters[i], wx = wind.at(f.lat, f.lon, ms, range);
    const s = wx ? DW.scenario(f, wx, { time: new Date(hourOf(ms)), hours: R.scenarioHours }) : null;
    scen.set(key, s); return s;
  };
  routes.forEach((r, ri) => {
    const mine = [...byRoute[ri]], ok = mine.filter(i => assessedSet.has(i)), missing = new Set(mine.filter(i => !assessedSet.has(i)));
    for (const s of r.samples) {
      let sum = 0;
      for (const i of ok) {
        const sc = scenOf(i, s.ms); if (!sc) { missing.add(i); continue; }
        const f = o.clusters[i]; if (DW.dist(s.lat, s.lon, f.lat, f.lon) * 1000 > sc.r.xmax) continue; // beyond the plume's reach
        sum += DW.atPoint(sc, s.lat, s.lon).conc;
      }
      s.conc = sum;
    }
    r.fires = mine.length; r.unassessed = missing.size; r.fireIdx = mine;
    r.status = !mine.length ? 'nofires' : missing.size >= mine.length ? 'notAssessed' : missing.size ? 'partial' : 'ok';
    metrics(r, R);
  });
  const ranked = rank(routes);
  ranked.forEach((r, k) => { r.rank = k + 1; r.best = k === 0 && r.status !== 'notAssessed'; });
  const best = ranked.length && ranked[0].status !== 'notAssessed' ? ranked[0].name : null;
  return { routes, best, depMs, range, rules: R, fires: { relevant: rel.length, assessed: assessedSet.size, noWind: rel.length - assessedSet.size - capped, capped }, relFires: rel.map(x => x.f), windFailed: !!failed && assessedSet.size < keep.size };
}
/* km in smoke, peak, smoke-minutes, where the smoke starts, the in-smoke stretches */
function metrics(r, R) {
  if (r.status === 'notAssessed') { r.kmInSmoke = r.peak = r.smokeMin = null; r.start = null; r.segments = []; return r; }
  const S = r.samples, min = R.minConc;
  r.kmInSmoke = 0; r.peak = 0; r.smokeMin = 0; r.start = null; r.segments = [];
  let run = null;
  S.forEach((s, k) => {
    if (s.conc > r.peak) r.peak = s.conc;
    if (s.conc >= min) {
      r.kmInSmoke += s.w; r.smokeMin += s.min;
      if (!r.start) r.start = { km: s.km, ms: s.ms };
      if (!run) run = { from: k, to: k, peak: s.conc }; else { run.to = k; run.peak = Math.max(run.peak, s.conc); }
    } else if (run) { r.segments.push(run); run = null; }
  });
  if (run) r.segments.push(run);
  r.segments = r.segments.map(g => {
    const pts = []; // the stretch from half a step before its first sample to half a step after its last, along the route
    const a = S[g.from], b = S[g.to], lo = Math.max(0, a.km - a.w), hi = Math.min(r.km, b.km + b.w);
    pts.push(pointAlong(r.route, lo)); for (let k = g.from; k <= g.to; k++) pts.push([S[k].lat, S[k].lon]); pts.push(pointAlong(r.route, hi));
    return { fromKm: lo, toKm: hi, peak: g.peak, pts };
  });
  return r;
}
/* least smoke-minutes, then least peak, then the shortest trip; a route that was not assessed goes last */
function rank(routes) {
  const k = r => [r.status === 'notAssessed' ? 1 : 0, r.smokeMin == null ? 0 : Math.round(r.smokeMin * 10) / 10, r.peak == null ? 0 : Math.round(r.peak * 10) / 10, r.route.duration || 0];
  return routes.slice().sort((a, b) => { const x = k(a), y = k(b); for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] - y[i]; return NAMES.indexOf(a.name) - NAMES.indexOf(b.name); });
}

/* ---------- routing service ---------- */
const fix = x => (+x).toFixed(5);
/* turn-by-turn steps in one shape: { type, mod, name, dist (m), dur (s), at: [lon, lat], exit }. Our server sends them in this shape already;
   OSRM sends legs[].steps[].maneuver. A waypoint (via point) ends one leg and starts the next: its "arrive" and "depart" are dropped. */
function osrmSteps(legs) {
  const out = [];
  (legs || []).forEach((lg, li, all) => (lg.steps || []).forEach(s => {
    const m = s.maneuver || {};
    if (m.type === 'arrive' && li < all.length - 1) return;
    if (m.type === 'depart' && li > 0) return;
    out.push({ type: String(m.type || 'continue'), mod: m.modifier || null, name: s.name || s.ref || '', dist: +s.distance || 0, dur: +s.duration || 0, at: Array.isArray(m.location) ? [+m.location[0], +m.location[1]] : null, exit: m.exit ?? null });
  }));
  return out;
}
function normSteps(a) {
  return (Array.isArray(a) ? a : []).filter(s => s && typeof s.type === 'string').map(s => ({ type: s.type, mod: s.mod || null, name: s.name || '', dist: +s.dist || 0, dur: +s.dur || 0, at: Array.isArray(s.at) && s.at.length >= 2 ? [+s.at[0], +s.at[1]] : null, exit: s.exit ?? null }));
}
function normRoutes(j) {
  const out = [];
  for (const r of (j && j.routes) || []) {
    const c = (r.coords || (r.geometry && r.geometry.coordinates));
    if (Array.isArray(c) && c.length >= 2 && isFinite(r.distance) && isFinite(r.duration)) out.push({ coords: c, distance: +r.distance, duration: +r.duration, steps: normSteps(r.steps || osrmSteps(r.legs)) });
  }
  return out.slice(0, RULES.maxRoutes);
}
/* our own server first (it caches and keeps to one request a second); a static host has none, so then the public OSRM demo server directly.
   o.via: up to 3 [{lat, lon}] the route must pass through, in order (a detour); with via points only one route comes back.
   Returns { routes, source } or throws Error('routing') when neither answered. getJSON(url, ms) is injected.
   Direct OSRM calls are kept at least o.paceMs (1000) apart, as the demo server's policy asks; o.sleep is injected in tests. */
let lastDirect = 0;
async function fetchRoutes(from, to, getJSON, o = {}) {
  const ll = p => `${fix(p.lat)},${fix(p.lon)}`, lonlat = p => `${fix(p.lon)},${fix(p.lat)}`;
  const via = (o.via || []).slice(0, RULES.maxVia);
  if (o.server !== false) {
    try { const j = await getJSON(`api/route?from=${ll(from)}&to=${ll(to)}${via.map(v => '&via=' + ll(v)).join('')}`, 40000); if (j && Array.isArray(j.routes)) return { routes: normRoutes(j), source: 'server' }; } catch (e) { /* no server, or it could not reach OSRM: try OSRM itself */ }
  }
  try {
    const pace = o.paceMs ?? 1000, wait = lastDirect + pace - Date.now();
    if (wait > 0) await (o.sleep || (ms => new Promise(r => setTimeout(r, ms))))(wait);
    lastDirect = Date.now();
    const pts = [from, ...via, to].map(lonlat).join(';');
    const j = await getJSON(`https://router.project-osrm.org/route/v1/driving/${pts}?alternatives=${via.length ? 'false' : '3'}&overview=full&geometries=geojson&steps=true`, 30000);
    if (j && (j.code === 'Ok' || j.code === 'NoRoute') && Array.isArray(j.routes || [])) return { routes: normRoutes({ routes: (j.routes || []).map(r => ({ coords: r.geometry && r.geometry.coordinates, distance: r.distance, duration: r.duration, steps: osrmSteps(r.legs) })) }), source: 'osrm' };
  } catch (e) { /* falls through */ }
  throw new Error('routing');
}

/* ---------- hand-off ---------- */
/* a Google Maps directions link: origin, destination and up to maxWaypoints points sampled along the route, so Google follows about the same way.
   A detour carries its via point(s) (route.via) as waypoints, in their place along the route, and the sampled points close to them are left out,
   so Google goes through the via point instead of back to the smoky direct road. Google may still change the path between two points.
   The link is only built here; the page opens it on a click. */
function gmapsUrl(route, max = RULES.maxWaypoints) {
  const c = route.coords, ll = p => `${(+p[1]).toFixed(5)},${(+p[0]).toFixed(5)}`;
  const o = ll(c[0]), d = ll(c[c.length - 1]), r = { coords: c };
  const cap = Math.max(0, Math.min(Math.floor(max), RULES.maxWaypoints)), via = (route.via || []).slice(0, Math.min(cap, RULES.maxVia));
  const total = sampleRoute(r, 0, 1e9).km, n = Math.max(0, Math.min(cap - via.length, Math.floor(total / 5)));
  const items = via.map(v => ({ km: project(r, v.lat, v.lon).km, txt: `${(+v.lat).toFixed(5)},${(+v.lon).toFixed(5)}`, via: true }));
  for (let k = 1; k <= n; k++) {
    const km = total * k / (n + 1), p = pointAlong(r, km);
    if (items.some(x => Math.abs(x.km - km) < 3)) continue;   // too close to a via point: the via point does that job
    items.push({ km, txt: `${p[0].toFixed(5)},${p[1].toFixed(5)}` });
  }
  items.sort((x, y) => x.km - y.km);
  // the numbers hold only digits, '-', '.' and ','; the one character that must be encoded is the pipe between waypoints
  return 'https://www.google.com/maps/dir/?api=1&origin=' + o + '&destination=' + d + (items.length ? '&waypoints=' + items.map(x => x.txt).join('%7C') : '') + '&travelmode=driving';
}
/* GeoJSON (RFC 7946, [lon, lat]): one LineString per route with its numbers, plus each in-smoke stretch as its own feature.
   A route's turn-by-turn steps (English) go in its properties with the smoke warning at the step where smoke starts. A detour says so and lists its via points. */
function geojson(res, meta = {}) {
  const labels = ['fires: OBSERVED (NASA FIRMS satellite detections)', 'wind: MODELLED (Open-Meteo)', 'smoke: SCENARIO (plume model, fires held at their observed power)'];
  const depart = new Date(res.depMs).toISOString(), through = meta.dataEnd ? new Date(meta.dataEnd).toISOString() : null;
  const num = x => x == null ? null : Math.round(x * 100) / 100;
  const base = r => ({ route: r.name, detour: !!r.detour, depart, data_through: through, labels });
  const utc = ms => new Date(ms).toISOString().slice(11, 16) + 'Z';
  const feats = [];
  res.routes.forEach(r => {
    const steps = directions(r, 'en', { hhmm: utc }).map(s => ({ n: s.n, instruction: s.text, distance_km: num(s.distKm), at_km: num(s.startKm), smoke_warnings: s.warns.map(w => ({ text: w.text, in_km: num(w.inKm), stretch_km: num(w.lenKm), around_utc: new Date(w.ms).toISOString(), peak_ugm3: num(w.peak) })) }));
    feats.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: r.route.coords.map(p => [+p[0], +p[1]]) },
      properties: { ...base(r), kind: 'route', name: r.detour ? 'Route D (detour)' : 'Route ' + r.name, best: res.best === r.name, status: r.status, distance_km: num(r.route.distance / 1000), duration_min: num(r.route.duration / 60),
        km_in_smoke: num(r.kmInSmoke), peak_ugm3: num(r.peak), smoke_minutes: num(r.smokeMin), smoke_starts_km: r.start ? num(r.start.km) : null, smoke_starts_at: r.start ? new Date(r.start.ms).toISOString() : null, fires_not_assessed: r.unassessed,
        via_points: r.detour && r.route.via ? r.route.via.map(v => [+(+v.lon).toFixed(5), +(+v.lat).toFixed(5)]) : null, steps } });
    r.segments.forEach((g, k) => feats.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: g.pts.map(p => [p[1], p[0]]) },
      properties: { ...base(r), kind: 'smoke_segment', name: `Route ${r.name}, smoke stretch ${k + 1}`, from_km: num(g.fromKm), to_km: num(g.toKm), peak_ugm3: num(g.peak) } }));
  });
  return { type: 'FeatureCollection', features: feats, properties: { generated_by: 'FIREVERSE smoke-aware route', note: 'A modelled scenario from satellite data, not a ground report. Routes: OSRM demo server, OpenStreetMap data.', labels } };
}

/* ---------- the example ---------- */
/* From the watch list of main roads (WATCH.computeLive rows, strongest modelled smoke first): follow the road about endKm each way from
   the crossing and take the named places nearest its two ends, at least minKm apart. places: [[name, lat, lon], ...]. Null when nothing qualifies. */
function pickExample(o) {
  const d = D().dist, minKm = o.minKm ?? RULES.exampleKm, endKm = o.endKm ?? RULES.exampleEndKm, maxPlace = o.placeKm ?? RULES.examplePlaceKm;
  const places = (o.places || []).filter(p => p && p[0]);
  const nearest = (lat, lon, not) => { let b = null; for (const p of places) { if (not && p[0] === not) continue; if (Math.abs(p[1] - lat) > .5 || Math.abs(p[2] - lon) > .5) continue; const k = d(lat, lon, p[1], p[2]); if (k <= maxPlace && (!b || k < b.km)) b = { name: p[0], lat: p[1], lon: p[2], km: k }; } return b; };
  for (const row of (o.rows || []).slice(0, o.tries ?? 60)) {
    const pts = row.asset && row.asset.pts, at = row.at; if (!pts || pts.length < 2 || !at) continue;
    let k0 = 0, best = Infinity; pts.forEach((p, i) => { const k = d(at[0], at[1], p[0], p[1]); if (k < best) { best = k; k0 = i; } });
    const walk = dir => { let i = k0, acc = 0; while (i + dir >= 0 && i + dir < pts.length && acc < endKm) { acc += d(pts[i][0], pts[i][1], pts[i + dir][0], pts[i + dir][1]); i += dir; } return pts[i]; };
    const a = walk(-1), b = walk(1), pa = nearest(a[0], a[1]); if (!pa) continue;
    const pb = nearest(b[0], b[1], pa.name); if (!pb) continue;
    if (d(pa.lat, pa.lon, pb.lat, pb.lon) < minKm) continue;
    return { from: { name: pa.name, lat: pa.lat, lon: pa.lon }, to: { name: pb.name, lat: pb.lat, lon: pb.lon }, row: { key: row.key, peak: row.peak, road: row.asset.name || row.asset.ref || null, at } };
  }
  return null;
}

/* ---------- words ---------- */
const L3 = (en, es, pt) => ({ en, es, pt });
const nf = (x, lang, dp = 1) => { const s = String(+(+x).toFixed(dp)); return lang === 'en' ? s : s.replace('.', ','); };
const UI = {
  en: { title: 'Smoke-aware route', q: 'Where will the smoke be when I am on the road?', from: 'From', to: 'To', search: 'Search a town by name', depart: 'Leave', now: 'Now', inH: n => `In ${n} h`, go: 'Compare routes', example: 'Try an example', clickMap: 'Or click the map to set the start, then the end.', myLoc: 'My location', mapPoint: 'Map point', tagFires: 'Fires', tagRoad: 'Road', tagWind: 'Wind', tagSmoke: 'Smoke', regionL: 'Region', planH: 'Plan', clockH: 'Satellite clock', handH: 'Hand-off to map apps', fireCount: 'Fires used', noPlaces: 'The named places of this region could not be loaded: set the points on the map.',
    useLoc: 'Use my location', locFail: 'Your location could not be found. Search by name instead.', locDenied: 'Location was not allowed. That is fine: search by name instead.', noMatch: 'No match. Try fewer letters.', setFrom: 'Start set from the map', setTo: 'End set from the map',
    fires: (n, mw, h) => `${n} fire cluster(s) of ${mw} MW or more in the last ${h} hours of data`, through: t => `data through ${t}`, held: 'Each fire is held at its observed power for the whole trip: a scenario, not a forecast of the fire.',
    need: 'Choose a start and an end first.', working: 'Finding routes and checking the wind…', routingFail: 'The routing service could not be reached, so no routes can be compared. Try again in a minute.', noRoute: 'No driving route was found between these two points.',
    windFail: 'Modelled wind is unavailable, so the smoke along the routes could not be assessed. This is not an all-clear.', feedFail: 'The fire data for this region could not be loaded, so smoke cannot be assessed. This is not an all-clear.',
    someNoWind: n => `${n} fire(s) near the routes could not be assessed (no modelled wind, or over the wind request limit). That is not "clear".`,
    exNone: 'No example can be built from the current data: no main road has modelled smoke on it with two named places at least 20 km apart. Pick a start and an end yourself.', exWorking: 'Looking for a road with modelled smoke on it…', exFailAssets: 'The main roads of this region could not be loaded, so no example could be built.',
    exFound: (a, b, road) => `Example from the current data: ${a} to ${b}${road ? ` (along ${road})` : ''}.`,
    route: n => `Route ${n}`, bestTag: 'LEAST MODELLED SMOKE', time: 'Time', dist: 'Distance', inSmoke: 'In smoke', peak: 'Peak', smokeMin: 'Smoke minutes', minShort: 'min', kmShort: 'km',
    starts: (km, t) => `Smoke starts at km ${km}, around ${t}`, noSmokeOn: 'No modelled smoke on this route.', noFires: 'No fire cluster within 25 km of this route.', notAssessedR: 'Not assessed: no modelled wind for the fires near this route. This is not "clear".', partialR: n => `${n} nearby fire(s) not assessed: the numbers are a minimum.`,
    obsFires: n => `${n} fire(s) within 25 km`, tagObs: 'OBSERVED', tagMap: 'MAPPED', tagMod: 'MODELLED', tagScn: 'SCENARIO',
    sumNone: 'No route meets modelled smoke in this window. Satellites miss some fires: no detection does not mean no fire.',
    sumNotAssessed: 'The smoke along the routes could not be assessed. This is not an all-clear.',
    sumOne: (name, km, pk) => km > 0 ? `Only one route was found. Route ${name} has ${km} km in modelled smoke (peak ${pk} µg/m³).` : `Only one route was found. Route ${name} meets no modelled smoke; no detection does not mean no fire.`,
    sumAvoid: (b, km, o, okm, dt) => `Route ${b} avoids the modelled smoke: ${km} km in smoke vs ${okm} km on Route ${o}, ${dt}.`,
    sumLeast: (b, km, o, okm, dt) => `Route ${b} has the least modelled smoke: ${km} km in smoke vs ${okm} km on Route ${o}, ${dt}.`,
    sumSame: (b, km, n) => `All ${n} routes meet about the same modelled smoke (${km} km). Route ${b} is the quickest.`,
    longer: m => `${m} min longer`, shorter: m => `${m} min shorter`, sameTime: 'about the same time',
    gmaps: 'Open this route in Google Maps', gmapsNote: 'Opens only when you click. Google Maps may adjust the path between the points, so check it matches the route shown.', geojson: 'Download smoke along route (GeoJSON)',
    geoNote: 'A map provider could ingest this file to show the smoke ahead on a route, not only today\'s air quality. Nothing is sent anywhere by this page.', legendSmoke: 'Modelled smoke (1 µg/m³ or more)', legendFire: 'Fire cluster (observed)', legendRoute: 'Route',
    credit: 'Routes: OSRM demo server, OpenStreetMap data', creditNote: 'The demo server is for light use: please do not run many routes at once.',
    safety: 'A modelled scenario from satellite data, not a ground report. In an emergency, follow official instructions.', mapLabel: 'Map of the routes and modelled smoke', routesH: 'Routes', mapH: 'Map', fromTo: 'Route', noMapLib: 'The map could not be loaded. The route cards below still work.' },
  es: { title: 'Ruta con humo en cuenta', q: '¿Dónde estará el humo cuando yo esté en el camino?', from: 'Desde', to: 'Hasta', search: 'Buscar una localidad por nombre', depart: 'Salida', now: 'Ahora', inH: n => `En ${n} h`, go: 'Comparar rutas', example: 'Probar un ejemplo', clickMap: 'O haga clic en el mapa para fijar el inicio y luego el final.', myLoc: 'Mi ubicación', mapPoint: 'Punto del mapa', tagFires: 'Fuegos', tagRoad: 'Camino', tagWind: 'Viento', tagSmoke: 'Humo', regionL: 'Región', planH: 'Plan', clockH: 'Reloj de los satélites', handH: 'Pasar a otra app', fireCount: 'Fuegos usados', noPlaces: 'No se pudieron cargar las localidades de esta región: fije los puntos en el mapa.',
    useLoc: 'Usar mi ubicación', locFail: 'No se pudo encontrar su ubicación. Busque por nombre.', locDenied: 'No se permitió la ubicación. No pasa nada: busque por nombre.', noMatch: 'Sin coincidencias. Pruebe con menos letras.', setFrom: 'Inicio fijado desde el mapa', setTo: 'Final fijado desde el mapa',
    fires: (n, mw, h) => `${n} grupo(s) de fuego de ${mw} MW o más en las últimas ${h} horas de datos`, through: t => `datos hasta ${t}`, held: 'Cada fuego se mantiene con su potencia observada durante todo el viaje: un escenario, no un pronóstico del fuego.',
    need: 'Elija primero un inicio y un final.', working: 'Buscando rutas y revisando el viento…', routingFail: 'No se pudo conectar con el servicio de rutas, así que no se pueden comparar rutas. Intente de nuevo en un minuto.', noRoute: 'No se encontró una ruta en auto entre estos dos puntos.',
    windFail: 'El viento modelado no está disponible, así que no se pudo evaluar el humo en las rutas. Esto no es una señal de que todo esté bien.', feedFail: 'No se pudieron cargar los datos de fuegos de esta región, así que no se puede evaluar el humo. Esto no es una señal de que todo esté bien.',
    someNoWind: n => `${n} fuego(s) cerca de las rutas no se pudieron evaluar (sin viento modelado, o más allá del límite de pedidos de viento). Eso no es "despejado".`,
    exNone: 'No se puede armar un ejemplo con los datos actuales: ninguna ruta principal tiene humo modelado con dos localidades con nombre a 20 km o más. Elija usted el inicio y el final.', exWorking: 'Buscando una ruta con humo modelado…', exFailAssets: 'No se pudieron cargar las rutas principales de esta región, así que no se armó un ejemplo.',
    exFound: (a, b, road) => `Ejemplo con los datos actuales: de ${a} a ${b}${road ? ` (por ${road})` : ''}.`,
    route: n => `Ruta ${n}`, bestTag: 'MENOS HUMO MODELADO', time: 'Tiempo', dist: 'Distancia', inSmoke: 'En humo', peak: 'Pico', smokeMin: 'Minutos en humo', minShort: 'min', kmShort: 'km',
    starts: (km, t) => `El humo empieza en el km ${km}, hacia las ${t}`, noSmokeOn: 'Sin humo modelado en esta ruta.', noFires: 'Ningún grupo de fuego a menos de 25 km de esta ruta.', notAssessedR: 'No evaluada: sin viento modelado para los fuegos cerca de esta ruta. Esto no es "despejado".', partialR: n => `${n} fuego(s) cercanos no evaluados: las cifras son un mínimo.`,
    obsFires: n => `${n} fuego(s) a menos de 25 km`, tagObs: 'OBSERVADO', tagMap: 'MAPEADO', tagMod: 'MODELADO', tagScn: 'ESCENARIO',
    sumNone: 'Ninguna ruta encuentra humo modelado en este período. Los satélites no ven todos los fuegos: que no haya detección no significa que no haya fuego.',
    sumNotAssessed: 'No se pudo evaluar el humo en las rutas. Esto no es una señal de que todo esté bien.',
    sumOne: (name, km, pk) => km > 0 ? `Solo se encontró una ruta. La Ruta ${name} tiene ${km} km en humo modelado (pico ${pk} µg/m³).` : `Solo se encontró una ruta. La Ruta ${name} no encuentra humo modelado; que no haya detección no significa que no haya fuego.`,
    sumAvoid: (b, km, o, okm, dt) => `La Ruta ${b} evita el humo modelado: ${km} km en humo frente a ${okm} km en la Ruta ${o}, ${dt}.`,
    sumLeast: (b, km, o, okm, dt) => `La Ruta ${b} tiene menos humo modelado: ${km} km en humo frente a ${okm} km en la Ruta ${o}, ${dt}.`,
    sumSame: (b, km, n) => `Las ${n} rutas encuentran casi el mismo humo modelado (${km} km). La Ruta ${b} es la más rápida.`,
    longer: m => `${m} min más larga`, shorter: m => `${m} min más corta`, sameTime: 'casi el mismo tiempo',
    gmaps: 'Abrir esta ruta en Google Maps', gmapsNote: 'Se abre solo si usted hace clic. Google Maps puede cambiar el camino entre los puntos: compruebe que coincide con la ruta mostrada.', geojson: 'Descargar el humo a lo largo de la ruta (GeoJSON)',
    geoNote: 'Un proveedor de mapas podría usar este archivo para mostrar el humo que viene en una ruta, y no solo la calidad del aire de hoy. Esta página no envía nada a ningún lado.', legendSmoke: 'Humo modelado (1 µg/m³ o más)', legendFire: 'Grupo de fuego (observado)', legendRoute: 'Ruta',
    credit: 'Rutas: servidor de demostración de OSRM, datos de OpenStreetMap', creditNote: 'El servidor de demostración es para uso ligero: no pida muchas rutas a la vez.',
    safety: 'Un escenario modelado con datos de satélite, no un informe en terreno. En una emergencia, siga las instrucciones oficiales.', mapLabel: 'Mapa de las rutas y del humo modelado', routesH: 'Rutas', mapH: 'Mapa', fromTo: 'Ruta', noMapLib: 'No se pudo cargar el mapa. Las tarjetas de rutas siguen funcionando.' },
  pt: { title: 'Rota com a fumaça em conta', q: 'Onde estará a fumaça quando eu estiver na estrada?', from: 'De', to: 'Para', search: 'Buscar uma cidade pelo nome', depart: 'Saída', now: 'Agora', inH: n => `Em ${n} h`, go: 'Comparar rotas', example: 'Experimentar um exemplo', clickMap: 'Ou clique no mapa para marcar o início e depois o fim.', myLoc: 'Minha localização', mapPoint: 'Ponto do mapa', tagFires: 'Fogos', tagRoad: 'Estrada', tagWind: 'Vento', tagSmoke: 'Fumaça', regionL: 'Região', planH: 'Plano', clockH: 'Relógio dos satélites', handH: 'Levar para outro app', fireCount: 'Fogos usados', noPlaces: 'Não foi possível carregar as cidades desta região: marque os pontos no mapa.',
    useLoc: 'Usar minha localização', locFail: 'Não foi possível encontrar sua localização. Busque por nome.', locDenied: 'A localização não foi permitida. Sem problema: busque por nome.', noMatch: 'Sem resultados. Tente menos letras.', setFrom: 'Início marcado no mapa', setTo: 'Fim marcado no mapa',
    fires: (n, mw, h) => `${n} grupo(s) de fogo de ${mw} MW ou mais nas últimas ${h} horas de dados`, through: t => `dados até ${t}`, held: 'Cada fogo é mantido com a potência observada durante toda a viagem: um cenário, não uma previsão do fogo.',
    need: 'Escolha primeiro um início e um fim.', working: 'Buscando rotas e conferindo o vento…', routingFail: 'Não foi possível acessar o serviço de rotas, então não dá para comparar rotas. Tente de novo em um minuto.', noRoute: 'Nenhuma rota de carro foi encontrada entre estes dois pontos.',
    windFail: 'O vento modelado está indisponível, então a fumaça nas rotas não pôde ser avaliada. Isto não é um sinal de que está tudo bem.', feedFail: 'Não foi possível carregar os dados de fogo desta região, então a fumaça não pode ser avaliada. Isto não é um sinal de que está tudo bem.',
    someNoWind: n => `${n} fogo(s) perto das rotas não puderam ser avaliados (sem vento modelado, ou acima do limite de pedidos de vento). Isso não é "limpo".`,
    exNone: 'Não dá para montar um exemplo com os dados atuais: nenhuma rodovia principal tem fumaça modelada com duas cidades com nome a 20 km ou mais. Escolha você o início e o fim.', exWorking: 'Procurando uma rodovia com fumaça modelada…', exFailAssets: 'Não foi possível carregar as rodovias principais desta região, então nenhum exemplo foi montado.',
    exFound: (a, b, road) => `Exemplo com os dados atuais: de ${a} a ${b}${road ? ` (pela ${road})` : ''}.`,
    route: n => `Rota ${n}`, bestTag: 'MENOS FUMAÇA MODELADA', time: 'Tempo', dist: 'Distância', inSmoke: 'Na fumaça', peak: 'Pico', smokeMin: 'Minutos na fumaça', minShort: 'min', kmShort: 'km',
    starts: (km, t) => `A fumaça começa no km ${km}, por volta das ${t}`, noSmokeOn: 'Sem fumaça modelada nesta rota.', noFires: 'Nenhum grupo de fogo a menos de 25 km desta rota.', notAssessedR: 'Não avaliada: sem vento modelado para os fogos perto desta rota. Isto não é "limpo".', partialR: n => `${n} fogo(s) próximos não avaliados: os números são um mínimo.`,
    obsFires: n => `${n} fogo(s) a menos de 25 km`, tagObs: 'OBSERVADO', tagMap: 'MAPEADO', tagMod: 'MODELADO', tagScn: 'CENÁRIO',
    sumNone: 'Nenhuma rota encontra fumaça modelada neste período. Os satélites não veem todos os fogos: não haver detecção não significa que não há fogo.',
    sumNotAssessed: 'A fumaça nas rotas não pôde ser avaliada. Isto não é um sinal de que está tudo bem.',
    sumOne: (name, km, pk) => km > 0 ? `Só uma rota foi encontrada. A Rota ${name} tem ${km} km em fumaça modelada (pico ${pk} µg/m³).` : `Só uma rota foi encontrada. A Rota ${name} não encontra fumaça modelada; não haver detecção não significa que não há fogo.`,
    sumAvoid: (b, km, o, okm, dt) => `A Rota ${b} evita a fumaça modelada: ${km} km na fumaça contra ${okm} km na Rota ${o}, ${dt}.`,
    sumLeast: (b, km, o, okm, dt) => `A Rota ${b} tem a menor fumaça modelada: ${km} km na fumaça contra ${okm} km na Rota ${o}, ${dt}.`,
    sumSame: (b, km, n) => `As ${n} rotas encontram quase a mesma fumaça modelada (${km} km). A Rota ${b} é a mais rápida.`,
    longer: m => `${m} min mais longa`, shorter: m => `${m} min mais curta`, sameTime: 'quase o mesmo tempo',
    gmaps: 'Abrir esta rota no Google Maps', gmapsNote: 'Só abre quando você clica. O Google Maps pode mudar o caminho entre os pontos: confira se bate com a rota mostrada.', geojson: 'Baixar a fumaça ao longo da rota (GeoJSON)',
    geoNote: 'Um provedor de mapas poderia usar este arquivo para mostrar a fumaça à frente numa rota, e não só a qualidade do ar de hoje. Esta página não envia nada a lugar nenhum.', legendSmoke: 'Fumaça modelada (1 µg/m³ ou mais)', legendFire: 'Grupo de fogo (observado)', legendRoute: 'Rota',
    credit: 'Rotas: servidor de demonstração do OSRM, dados do OpenStreetMap', creditNote: 'O servidor de demonstração é para uso leve: não peça muitas rotas de uma vez.',
    safety: 'Um cenário modelado com dados de satélite, não um relato de campo. Em uma emergência, siga as instruções oficiais.', mapLabel: 'Mapa das rotas e da fumaça modelada', routesH: 'Rotas', mapH: 'Mapa', fromTo: 'Rota', noMapLib: 'Não foi possível carregar o mapa. Os cartões das rotas continuam funcionando.' },
};
/* the words of detours, directions, the drive and the best time to leave (merged into UI above, same three languages) */
const plus = m => m >= 0 ? `+${m} min` : `-${-m} min`;
const MORE = {
  en: { roleDriver: 'Driver', routeD: 'Route D (detour)', chooseRoute: 'Use this route', chosenRoute: 'Chosen route', chosenNote: n => `Directions, hand-off and drive follow ${n}.`,
    detourSearching: 'The best route still meets modelled smoke. Looking for a detour…', detourVia: (km, side) => `Routed through a point ${km} km to the ${side === 'upwind' ? 'upwind' : side === 'downwind' ? 'downwind' : side} side of the smoke.`,
    detourOk: (km, was, dt) => `Detour avoids the modelled smoke: ${km} km in smoke vs ${was} km, ${dt}.`, detourCuts: (km, was, dt) => `Detour cuts the modelled smoke: ${km} km in smoke vs ${was} km, ${dt}.`,
    detourNone: (lim, n) => `No detour within +${lim} min avoids the modelled smoke (${n} tried). The comparison above stands.`, detourFail: 'The detour search could not reach the routing service. The comparison above stands.',
    detourNote: 'A detour is tried only when the best route meets modelled smoke: up to 6 routes through points beside the smoke, kept only if they cut the smoke-minutes by half or more without adding too much time.', plusMin: plus,
    stepsH: 'Directions', stepsFor: n => `${n}: ${'turn by turn'}`, stepsNone: 'This route came without turn-by-turn steps.', stepsCount: n => `${n} steps`, stepsNote: 'Steps are from the routing service (OpenStreetMap). The smoke warnings are the modelled scenario for this route and departure time.',
    warnHere: (len, t) => `Here: modelled smoke for ${len} km, around ${t}`, warnIn: (inKm, len, t) => `In ${inKm} km: modelled smoke for ${len} km, around ${t}`,
    step: (t, m, n, x, d) => { const on = n ? ` onto ${n}` : '', dir = { left: 'left', right: 'right', 'slight left': 'slightly left', 'slight right': 'slightly right', 'sharp left': 'sharp left', 'sharp right': 'sharp right' }[m];
      switch (t) {
        case 'depart': return n ? `Start on ${n}` : 'Start'; case 'arrive': return 'Arrive';
        case 'turn': case 'end of road': return m === 'uturn' ? 'Make a U-turn' : dir ? `Turn ${dir}${on}` : `Continue straight${on}`;
        case 'fork': return m && /left/.test(m) ? `Keep left at the fork${on}` : m && /right/.test(m) ? `Keep right at the fork${on}` : `Take the fork${on}`;
        case 'merge': return `Merge${on}`; case 'on ramp': case 'ramp': return `Take the ramp${on}`; case 'off ramp': return `Take the exit${on}`;
        case 'roundabout': case 'rotary': return x ? `At the roundabout take exit ${x}${on}` : `Enter the roundabout${on}`;
        case 'roundabout turn': return dir ? `At the roundabout turn ${dir}${on}` : `At the roundabout go straight${on}`;
        case 'exit roundabout': case 'exit rotary': return `Leave the roundabout${on}`;
        default: return `Continue${n ? ' on ' + n : ''}${d ? ' for ' + d : ''}`;
      } },
    driveH: 'Drive', driveStart: 'Start drive', driveStop: 'End drive', simulate: 'Simulate the drive', mute: 'Mute spoken alerts', unmute: 'Unmute spoken alerts', driveFor: n => `Drive ${n}`,
    driveLooking: 'Looking for your position…', driveGps: 'GPS: following your position', driveSimTag: 'SIMULATION', driveSimNote: n => `This is not your position. A marker moves along the route at ${n} times real time.`,
    driveNoGps: 'Your location was not available, so GPS cannot follow the drive. You can simulate the drive instead.', driveOff: km => `You are ${km} km from this route, more than 2 km, so GPS cannot follow it. You can simulate the drive instead.`,
    driveNext: (txt, d) => `Next: ${txt} in ${d}`, driveNoTurn: 'No more turns ahead.', driveArrived: 'End of the route.', driveProgress: (a, b) => `${a} of ${b} km`,
    driveInSmoke: (left, min, t) => `In modelled smoke now: ${left} km to the end of this stretch (about ${min} min, around ${t}).`, driveAhead: (d, min, t, len) => `Modelled smoke ahead in ${d} km (about ${min} min, around ${t}), for ${len} km.`, driveClear: km => `Clear of modelled smoke ahead for the ${km} km left.`, driveNotAssessed: 'The smoke along this route could not be assessed. This is not an all-clear.',
    alertAhead: (d, len) => `Modelled smoke ahead in ${d} km, for ${len} km.`, alertEnter: len => `Entering modelled smoke, about ${len} km.`, alertLeave: 'Out of modelled smoke.', simSay: 'Simulation.',
    driveDone: 'You have reached the end of the route.', driveDoneSim: 'The simulated drive is finished. It was a simulation, not a real position.', driveReassessed: t => `Smoke re-assessed at ${t} with the current wind hour.`, driveStopped: 'Drive ended.',
    driveSafety: 'This is not an emergency navigation system. In an emergency, follow official instructions and road signs.', noSpeech: 'Spoken alerts are not available in this browser: alerts are shown on screen.',
    leaveH: 'Best time to leave', leaveWorking: 'Checking leaving now and in the next three hours…', leaveUnknown: 'The departure hours could not be compared (no modelled wind for leaving now, or no later hour). This is not an all-clear.',
    leaveLater: (t, km, now) => `Leaving at ${t} meets the least modelled smoke: ${km} km vs ${now} km now.`, leaveNow: (km, worst) => `Leaving now meets the least modelled smoke: ${km} km, against up to ${worst} km at the later times.`,
    leaveSame: km => `Leaving now or in the next three hours meets about the same modelled smoke (${km} km).`, leaveNote: 'The same routes, the wind of each hour; no new routing requests. Each fire is held at its observed power.' },
  es: { roleDriver: 'Conductor', routeD: 'Ruta D (desvío)', chooseRoute: 'Usar esta ruta', chosenRoute: 'Ruta elegida', chosenNote: n => `Las indicaciones, el traspaso y el viaje siguen la ${n}.`,
    detourSearching: 'La mejor ruta todavía encuentra humo modelado. Buscando un desvío…', detourVia: (km, side) => `Pasa por un punto a ${km} km del lado ${side === 'upwind' ? 'de donde viene el viento (barlovento)' : side === 'downwind' ? 'hacia donde va el humo (sotavento)' : side} del humo.`,
    detourOk: (km, was, dt) => `El desvío evita el humo modelado: ${km} km en humo frente a ${was} km, ${dt}.`, detourCuts: (km, was, dt) => `El desvío reduce el humo modelado: ${km} km en humo frente a ${was} km, ${dt}.`,
    detourNone: (lim, n) => `Ningún desvío de hasta +${lim} min evita el humo modelado (se probaron ${n}). Sigue valiendo la comparación de arriba.`, detourFail: 'La búsqueda de desvíos no pudo conectar con el servicio de rutas. Sigue valiendo la comparación de arriba.',
    detourNote: 'Solo se prueba un desvío cuando la mejor ruta encuentra humo modelado: hasta 6 rutas por puntos al lado del humo, que se conservan solo si reducen a la mitad o más los minutos en humo sin añadir demasiado tiempo.', plusMin: plus,
    stepsH: 'Indicaciones', stepsFor: n => `${n}: giro a giro`, stepsNone: 'Esta ruta llegó sin indicaciones paso a paso.', stepsCount: n => `${n} pasos`, stepsNote: 'Los pasos vienen del servicio de rutas (OpenStreetMap). Los avisos de humo son el escenario modelado para esta ruta y esta hora de salida.',
    warnHere: (len, t) => `Aquí: humo modelado por ${len} km, hacia las ${t}`, warnIn: (inKm, len, t) => `En ${inKm} km: humo modelado por ${len} km, hacia las ${t}`,
    step: (t, m, n, x, d) => { const on = n ? ` hacia ${n}` : '', dir = { left: 'a la izquierda', right: 'a la derecha', 'slight left': 'ligeramente a la izquierda', 'slight right': 'ligeramente a la derecha', 'sharp left': 'cerrado a la izquierda', 'sharp right': 'cerrado a la derecha' }[m];
      switch (t) {
        case 'depart': return n ? `Salga por ${n}` : 'Salida'; case 'arrive': return 'Llegada';
        case 'turn': case 'end of road': return m === 'uturn' ? 'Haga un cambio de sentido' : dir ? `Gire ${dir}${on}` : `Siga recto${n ? ' por ' + n : ''}`;
        case 'fork': return m && /left/.test(m) ? `Tome la bifurcación de la izquierda${on}` : m && /right/.test(m) ? `Tome la bifurcación de la derecha${on}` : `Tome la bifurcación${on}`;
        case 'merge': return `Incorpórese${on}`; case 'on ramp': case 'ramp': return `Tome el acceso${on}`; case 'off ramp': return `Tome la salida${on}`;
        case 'roundabout': case 'rotary': return x ? `En la rotonda tome la salida ${x}${on}` : `Entre en la rotonda${on}`;
        case 'roundabout turn': return dir ? `En la rotonda gire ${dir}${on}` : `En la rotonda siga recto${on}`;
        case 'exit roundabout': case 'exit rotary': return `Salga de la rotonda${on}`;
        default: return `Continúe${n ? ' por ' + n : ''}${d ? ' durante ' + d : ''}`;
      } },
    driveH: 'Viaje', driveStart: 'Empezar el viaje', driveStop: 'Terminar el viaje', simulate: 'Simular el viaje', mute: 'Silenciar los avisos hablados', unmute: 'Activar los avisos hablados', driveFor: n => `Viaje por la ${n}`,
    driveLooking: 'Buscando su posición…', driveGps: 'GPS: siguiendo su posición', driveSimTag: 'SIMULACIÓN', driveSimNote: n => `Esta no es su posición. Un marcador avanza por la ruta a ${n} veces el tiempo real.`,
    driveNoGps: 'No se pudo obtener su ubicación, así que el GPS no puede seguir el viaje. Puede simular el viaje.', driveOff: km => `Usted está a ${km} km de esta ruta, más de 2 km, así que el GPS no puede seguirla. Puede simular el viaje.`,
    driveNext: (txt, d) => `Siguiente: ${txt} en ${d}`, driveNoTurn: 'No hay más giros adelante.', driveArrived: 'Fin de la ruta.', driveProgress: (a, b) => `${a} de ${b} km`,
    driveInSmoke: (left, min, t) => `En humo modelado ahora: faltan ${left} km para salir de este tramo (unos ${min} min, hacia las ${t}).`, driveAhead: (d, min, t, len) => `Humo modelado adelante en ${d} km (unos ${min} min, hacia las ${t}), por ${len} km.`, driveClear: km => `Sin humo modelado adelante en los ${km} km que faltan.`, driveNotAssessed: 'No se pudo evaluar el humo en esta ruta. Esto no es una señal de que todo esté bien.',
    alertAhead: (d, len) => `Humo modelado adelante en ${d} km, por ${len} km.`, alertEnter: len => `Entrando en humo modelado, unos ${len} km.`, alertLeave: 'Fuera del humo modelado.', simSay: 'Simulación.',
    driveDone: 'Llegó al final de la ruta.', driveDoneSim: 'El viaje simulado terminó. Fue una simulación, no una posición real.', driveReassessed: t => `Humo reevaluado a las ${t} con la hora de viento actual.`, driveStopped: 'Viaje terminado.',
    driveSafety: 'Este no es un sistema de navegación de emergencia. En una emergencia, siga las instrucciones oficiales y las señales del camino.', noSpeech: 'Los avisos hablados no están disponibles en este navegador: los avisos se muestran en pantalla.',
    leaveH: 'Mejor hora para salir', leaveWorking: 'Revisando salir ahora y en las próximas tres horas…', leaveUnknown: 'No se pudieron comparar las horas de salida (sin viento modelado para salir ahora, o para ninguna hora posterior). Esto no es una señal de que todo esté bien.',
    leaveLater: (t, km, now) => `Salir a las ${t} encuentra el menor humo modelado: ${km} km frente a ${now} km si sale ahora.`, leaveNow: (km, worst) => `Salir ahora encuentra el menor humo modelado: ${km} km, frente a hasta ${worst} km más tarde.`,
    leaveSame: km => `Salir ahora o en las próximas tres horas encuentra casi el mismo humo modelado (${km} km).`, leaveNote: 'Las mismas rutas, con el viento de cada hora; sin nuevos pedidos de rutas. Cada fuego se mantiene con su potencia observada.' },
  pt: { roleDriver: 'Motorista', routeD: 'Rota D (desvio)', chooseRoute: 'Usar esta rota', chosenRoute: 'Rota escolhida', chosenNote: n => `As instruções, o envio e a viagem seguem a ${n}.`,
    detourSearching: 'A melhor rota ainda encontra fumaça modelada. Procurando um desvio…', detourVia: (km, side) => `Passa por um ponto a ${km} km do lado ${side === 'upwind' ? 'de onde vem o vento (barlavento)' : side === 'downwind' ? 'para onde vai a fumaça (sotavento)' : side} da fumaça.`,
    detourOk: (km, was, dt) => `O desvio evita a fumaça modelada: ${km} km na fumaça contra ${was} km, ${dt}.`, detourCuts: (km, was, dt) => `O desvio reduz a fumaça modelada: ${km} km na fumaça contra ${was} km, ${dt}.`,
    detourNone: (lim, n) => `Nenhum desvio de até +${lim} min evita a fumaça modelada (${n} testados). A comparação acima continua valendo.`, detourFail: 'A busca de desvios não conseguiu acessar o serviço de rotas. A comparação acima continua valendo.',
    detourNote: 'Um desvio só é testado quando a melhor rota encontra fumaça modelada: até 6 rotas por pontos ao lado da fumaça, mantidas só se reduzirem à metade ou mais os minutos na fumaça sem somar muito tempo.', plusMin: plus,
    stepsH: 'Instruções', stepsFor: n => `${n}: passo a passo`, stepsNone: 'Esta rota veio sem instruções passo a passo.', stepsCount: n => `${n} passos`, stepsNote: 'Os passos vêm do serviço de rotas (OpenStreetMap). Os avisos de fumaça são o cenário modelado para esta rota e este horário de saída.',
    warnHere: (len, t) => `Aqui: fumaça modelada por ${len} km, por volta das ${t}`, warnIn: (inKm, len, t) => `Em ${inKm} km: fumaça modelada por ${len} km, por volta das ${t}`,
    step: (t, m, n, x, d) => { const on = n ? ` para ${n}` : '', dir = { left: 'à esquerda', right: 'à direita', 'slight left': 'levemente à esquerda', 'slight right': 'levemente à direita', 'sharp left': 'acentuadamente à esquerda', 'sharp right': 'acentuadamente à direita' }[m];
      switch (t) {
        case 'depart': return n ? `Comece em ${n}` : 'Início'; case 'arrive': return 'Chegada';
        case 'turn': case 'end of road': return m === 'uturn' ? 'Faça o retorno' : dir ? `Vire ${dir}${on}` : `Siga em frente${n ? ' por ' + n : ''}`;
        case 'fork': return m && /left/.test(m) ? `Pegue a bifurcação da esquerda${on}` : m && /right/.test(m) ? `Pegue a bifurcação da direita${on}` : `Pegue a bifurcação${on}`;
        case 'merge': return `Entre na via${on}`; case 'on ramp': case 'ramp': return `Pegue o acesso${on}`; case 'off ramp': return `Pegue a saída${on}`;
        case 'roundabout': case 'rotary': return x ? `Na rotatória, pegue a saída ${x}${on}` : `Entre na rotatória${on}`;
        case 'roundabout turn': return dir ? `Na rotatória, vire ${dir}${on}` : `Na rotatória, siga em frente${on}`;
        case 'exit roundabout': case 'exit rotary': return `Saia da rotatória${on}`;
        default: return `Continue${n ? ' por ' + n : ''}${d ? ' por ' + d : ''}`;
      } },
    driveH: 'Viagem', driveStart: 'Iniciar a viagem', driveStop: 'Encerrar a viagem', simulate: 'Simular a viagem', mute: 'Silenciar os avisos falados', unmute: 'Ativar os avisos falados', driveFor: n => `Viagem pela ${n}`,
    driveLooking: 'Procurando sua posição…', driveGps: 'GPS: acompanhando sua posição', driveSimTag: 'SIMULAÇÃO', driveSimNote: n => `Esta não é a sua posição. Um marcador anda pela rota a ${n} vezes o tempo real.`,
    driveNoGps: 'Sua localização não estava disponível, então o GPS não pode acompanhar a viagem. Você pode simular a viagem.', driveOff: km => `Você está a ${km} km desta rota, mais de 2 km, então o GPS não pode acompanhá-la. Você pode simular a viagem.`,
    driveNext: (txt, d) => `Próximo: ${txt} em ${d}`, driveNoTurn: 'Sem mais curvas à frente.', driveArrived: 'Fim da rota.', driveProgress: (a, b) => `${a} de ${b} km`,
    driveInSmoke: (left, min, t) => `Na fumaça modelada agora: faltam ${left} km para sair deste trecho (cerca de ${min} min, por volta das ${t}).`, driveAhead: (d, min, t, len) => `Fumaça modelada à frente em ${d} km (cerca de ${min} min, por volta das ${t}), por ${len} km.`, driveClear: km => `Sem fumaça modelada à frente nos ${km} km que faltam.`, driveNotAssessed: 'A fumaça nesta rota não pôde ser avaliada. Isto não é um sinal de que está tudo bem.',
    alertAhead: (d, len) => `Fumaça modelada à frente em ${d} km, por ${len} km.`, alertEnter: len => `Entrando na fumaça modelada, cerca de ${len} km.`, alertLeave: 'Fora da fumaça modelada.', simSay: 'Simulação.',
    driveDone: 'Você chegou ao fim da rota.', driveDoneSim: 'A viagem simulada terminou. Foi uma simulação, não uma posição real.', driveReassessed: t => `Fumaça reavaliada às ${t} com a hora de vento atual.`, driveStopped: 'Viagem encerrada.',
    driveSafety: 'Este não é um sistema de navegação de emergência. Em uma emergência, siga as instruções oficiais e a sinalização da estrada.', noSpeech: 'Os avisos falados não estão disponíveis neste navegador: os avisos aparecem na tela.',
    leaveH: 'Melhor hora para sair', leaveWorking: 'Conferindo sair agora e nas próximas três horas…', leaveUnknown: 'Não foi possível comparar os horários de saída (sem vento modelado para sair agora, ou para nenhuma hora depois). Isto não é um sinal de que está tudo bem.',
    leaveLater: (t, km, now) => `Sair às ${t} encontra a menor fumaça modelada: ${km} km contra ${now} km saindo agora.`, leaveNow: (km, worst) => `Sair agora encontra a menor fumaça modelada: ${km} km, contra até ${worst} km mais tarde.`,
    leaveSame: km => `Sair agora ou nas próximas três horas encontra quase a mesma fumaça modelada (${km} km).`, leaveNote: 'As mesmas rotas, com o vento de cada hora; sem novos pedidos de rotas. Cada fogo é mantido com a potência observada.' },
};
for (const l of Object.keys(MORE)) Object.assign(UI[l], MORE[l]);
/* the one line above the cards. Real numbers only: every figure comes from the assessment. */
function summary(res, lang = 'en') {
  const T = UI[lang] || UI.en, rs = res.routes.filter(r => r.status !== 'notAssessed');
  if (!res.routes.length) return '';
  if (res.detour && res.best === res.detour.name) {   // a kept detour is the answer: its numbers against the route it replaces
    const d = res.detour, dm = Math.round(d.addMin), args = [nf(d.kmAfter, lang), nf(d.kmBefore, lang), T.plusMin(dm)];
    return d.kmAfter > 0 ? T.detourCuts(...args) : T.detourOk(...args);
  }
  if (!rs.length) return T.sumNotAssessed;
  const best = rs.find(r => r.name === res.best) || rs[0], km = r => nf(r.kmInSmoke, lang);
  if (rs.length === 1) return rs[0].kmInSmoke > 0 ? T.sumOne(rs[0].name, km(rs[0]), nf(rs[0].peak, lang)) : T.sumOne(rs[0].name, 0, 0);
  if (rs.every(r => !(r.kmInSmoke > 0))) return T.sumNone;
  const fastest = rs.slice().sort((a, b) => a.route.duration - b.route.duration)[0];
  const others = rs.filter(r => r !== best);
  const ref = fastest !== best ? fastest : others.slice().sort((a, b) => b.kmInSmoke - a.kmInSmoke)[0];
  if (rs.every(r => Math.abs(r.kmInSmoke - best.kmInSmoke) < .05)) return T.sumSame(best.name, km(best), rs.length);
  const dm = Math.round((best.route.duration - ref.route.duration) / 60), dt = dm >= 1 ? T.longer(dm) : dm <= -1 ? T.shorter(-dm) : T.sameTime;
  return best.kmInSmoke > 0 ? T.sumLeast(best.name, km(best), ref.name, km(ref), dt) : T.sumAvoid(best.name, nf(0, lang), ref.name, km(ref), dt);
}

/* ---------- where on the route ---------- */
const cumOf = new WeakMap();
function cumKm(c) {
  let k = cumOf.get(c); if (k) return k;
  const d = D().dist; k = [0]; for (let i = 1; i < c.length; i++) k.push(k[i - 1] + d(c[i - 1][1], c[i - 1][0], c[i][1], c[i][0]));
  cumOf.set(c, k); return k;
}
/* the nearest point of the route to a position: { km along the route from its start, off: km away from the line } */
function project(route, lat, lon) {
  const c = route.coords, cum = cumKm(c), K = 111.195; let best = { km: 0, off: Infinity };
  for (let i = 1; i < c.length; i++) {
    const la0 = c[i - 1][1], lo0 = c[i - 1][0], cs = Math.cos(la0 * Math.PI / 180);
    const ex = (c[i][0] - lo0) * K * cs, ey = (c[i][1] - la0) * K, px = (lon - lo0) * K * cs, py = (lat - la0) * K, L2 = ex * ex + ey * ey;
    const t = L2 > 0 ? Math.min(1, Math.max(0, (px * ex + py * ey) / L2)) : 0, off = Math.hypot(px - ex * t, py - ey * t);
    if (off < best.off) best = { off, km: cum[i - 1] + (cum[i] - cum[i - 1]) * t };
  }
  return best;
}
/* the clock time at a km of an assessed route (constant speed, as in the assessment) */
function msAtKm(r, km) { const S = r.samples; return S[0].ms + (S[S.length - 1].ms - S[0].ms) * (r.km > 0 ? Math.min(1, Math.max(0, km / r.km)) : 0); }

/* ---------- detour ---------- */
const dest = (lat, lon, brg, km) => [lat + km * Math.cos(brg * Math.PI / 180) / 111.195, lon + km * Math.sin(brg * Math.PI / 180) / (111.195 * Math.cos(lat * Math.PI / 180))];
const angDiff = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };
/* Candidate via points for a detour: perpendicular to the route at the middle of the smoke stretch `seg` (fromKm, toKm), at each distance of `dists`
   on each side, the upwind side first (smoke drifts downwind, so the upwind side is where the wind comes from, wd degrees; null when unknown:
   then the left of travel goes first). At most `max` points. Each: { lat, lon, km, side: 'upwind' | 'downwind' | 'left' | 'right' } */
function viaCandidates(route, seg, wd, o = {}) {
  const dists = o.dists || RULES.detourKm, max = o.max ?? RULES.maxDetourTries, dd = D();
  const mid = (seg.fromKm + seg.toKm) / 2, p = pointAlong(route, mid);
  let a = pointAlong(route, Math.max(0, mid - 1)), b = pointAlong(route, mid + 1);
  if (a[0] === b[0] && a[1] === b[1]) { a = pointAlong(route, 0); b = pointAlong(route, 1e9); }
  const brg = dd.bearing(a[0], a[1], b[0], b[1]), sides = [(brg + 270) % 360, (brg + 90) % 360];   // left of travel, right of travel
  const known = wd != null && isFinite(wd);
  let order = [{ brg: sides[0], name: 'left' }, { brg: sides[1], name: 'right' }];
  if (known) { order.sort((x, y) => angDiff(x.brg, wd) - angDiff(y.brg, wd)); order[0].name = 'upwind'; order[1].name = 'downwind'; }
  const out = [];
  for (const s of order) for (const km of dists) { const q = dest(p[0], p[1], s.brg, km); out.push({ lat: +q[0].toFixed(5), lon: +q[1].toFixed(5), km, side: s.name }); }
  return out.slice(0, max);
}
/* Is a detour worth showing? base: the best assessed route; cand: the detour, assessed the same way.
   It must be assessed in full, cut smoke-minutes by at least detourCut (50 %), and add no more than detourMaxAddMin (45 min) and no more than
   detourMaxAddShare (60 %) of the trip time (so the limit is the smaller of the two). */
function detourVerdict(base, cand, rules) {
  const R = { ...RULES, ...(rules || {}) }, tripMin = base.route.duration / 60, addMin = (cand.route.duration - base.route.duration) / 60;
  const maxAdd = Math.min(R.detourMaxAddMin, R.detourMaxAddShare * tripMin);
  const assessed = cand.status === 'ok' || cand.status === 'nofires';
  const cut = base.smokeMin > 0 && cand.smokeMin != null ? 1 - cand.smokeMin / base.smokeMin : 0;
  let reason = null;
  if (!assessed) reason = 'notAssessed'; else if (!(cut >= R.detourCut - 1e-9)) reason = 'smoke'; else if (addMin > maxAdd + 1e-9) reason = 'time';
  return { ok: !reason, reason, addMin, maxAdd, cut };
}
/* The search. o: { res (an assessment), clusters, wind, depMs, noFireData, fetchVia(viaPoints) -> Promise<routes>, rules }.
   Only when the best route still meets modelled smoke. At most maxDetourTries routing requests; stops early on a detour with no modelled smoke;
   stops after two routing failures in a row. Returns { res, info }: res is a new assessment with the detour as Route D (res.detour describes it),
   or the same res with res.detour = null; info = { status: 'notNeeded' | 'found' | 'none' | 'unavailable', tried: [...], limitMin }. */
async function searchDetour(o) {
  const res = o.res, R = { ...RULES, ...(o.rules || {}) }, base = res.routes.find(r => r.name === res.best);
  const info = { status: 'notNeeded', tried: [], limitMin: null };
  res.detour = null; res.detourSearch = info;
  if (!base || !base.segments.length || !(base.peak >= R.minConc)) return { res, info };
  const seg = base.segments[0], mid = (seg.fromKm + seg.toKm) / 2, mp = pointAlong(base.route, mid);
  let wd = null, nearest = Infinity;
  for (const i of base.fireIdx || []) {
    const f = o.clusters[i], k = D().dist(mp[0], mp[1], f.lat, f.lon); if (k >= nearest) continue;
    const wx = o.wind.at(f.lat, f.lon, msAtKm(base, mid), res.range); if (wx && isFinite(wx.wd)) { nearest = k; wd = wx.wd; }
  }
  info.limitMin = Math.floor(Math.min(R.detourMaxAddMin, R.detourMaxAddShare * base.route.duration / 60));
  let keep = null, failures = 0;
  for (const c of viaCandidates(base.route, seg, wd, { dists: R.detourKm, max: R.maxDetourTries })) {
    let routes;
    try { routes = await o.fetchVia([{ lat: c.lat, lon: c.lon }]); failures = 0; } catch (e) { info.tried.push({ via: c, status: 'failed' }); if (++failures >= 2) break; continue; }
    if (!routes || !routes.length) { info.tried.push({ via: c, status: 'noRoute' }); continue; }
    const rt = { ...routes[0], detour: true, via: [{ lat: c.lat, lon: c.lon }] };
    const a = (await assess({ routes: [rt], names: ['D'], depMs: o.depMs, clusters: o.clusters, wind: o.wind, rules: o.rules, noFireData: o.noFireData })).routes[0];
    const v = detourVerdict(base, a, o.rules);
    info.tried.push({ via: c, status: v.ok ? 'kept' : v.reason, kmInSmoke: a.kmInSmoke, smokeMin: a.smokeMin, addMin: v.addMin });
    if (v.ok) { if (!keep || a.smokeMin < keep.a.smokeMin) keep = { a, rt, c, v }; if (!(a.kmInSmoke > 0)) break; }   // a clean one: stop asking the routing service
  }
  if (!keep) { info.status = !info.tried.length || info.tried.every(t => t.status === 'failed') ? 'unavailable' : 'none'; return { res, info }; }
  info.status = 'found';
  const full = await assess({ routes: res.routes.map(r => r.route).concat([keep.rt]), names: res.routes.map(r => r.name).concat(['D']), depMs: o.depMs, clusters: o.clusters, wind: o.wind, rules: { ...(o.rules || {}), maxRoutes: 4 }, noFireData: o.noFireData });
  const d = full.routes.find(r => r.detour);
  full.detour = { name: 'D', vs: base.name, kmBefore: base.kmInSmoke, kmAfter: d.kmInSmoke, smokeMinBefore: base.smokeMin, smokeMinAfter: d.smokeMin, addMin: keep.v.addMin, cut: keep.v.cut, via: keep.rt.via, side: keep.c.side, viaKm: keep.c.km };
  full.detourSearch = info;
  return { res: full, info };
}

/* ---------- turn by turn ---------- */
function fmtDist(km, lang = 'en') { return km < .95 ? `${Math.max(10, Math.round(km * 100) * 10)} m` : `${nf(km, lang, km < 10 ? 1 : 0)} km`; }
/* The steps of an assessed route as short instructions in `lang`, each with where it starts along the route (km) and the smoke warnings of the
   in-smoke stretches that begin within it: "In 3.2 km: modelled smoke for 2 km, around 09:53". o.hhmm(ms) formats clock times (UTC if omitted). */
function directions(r, lang = 'en', o = {}) {
  const steps = r.route.steps || [], T = UI[lang] || UI.en, hhmm = o.hhmm || (ms => new Date(ms).toISOString().slice(11, 16));
  if (!steps.length) return [];
  const scale = r.km > 0 && r.route.distance > 0 ? r.km / (r.route.distance / 1000) : 1;   // the steps' metres are the router's, the km here are along the drawn line
  let cum = 0;
  const out = steps.map((s, i) => {
    const startKm = cum * scale / 1000, distKm = s.dist * scale / 1000; cum += s.dist;
    const lead = ['new name', 'continue', 'notification'].includes(s.type);
    return { n: i + 1, type: s.type, text: T.step(s.type, s.mod, s.name, s.exit, lead ? fmtDist(distKm, lang) : ''), startKm, distKm, distText: fmtDist(distKm, lang), inText: lead, at: s.at ? [s.at[1], s.at[0]] : null, warns: [] };
  });
  if (r.status !== 'notAssessed') (r.segments || []).forEach(g => {
    let k = 0; for (let i = 0; i < out.length; i++) if (out[i].startKm <= g.fromKm + 1e-9) k = i;
    const s = out[k], inKm = Math.max(0, g.fromKm - s.startKm), lenKm = g.toKm - g.fromKm, ms = msAtKm(r, g.fromKm);
    s.warns.push({ inKm, lenKm, ms, peak: g.peak, text: inKm < .05 ? T.warnHere(nf(lenKm, lang), hhmm(ms)) : T.warnIn(nf(inKm, lang), nf(lenKm, lang), hhmm(ms)) });
  });
  return out;
}

/* ---------- drive ---------- */
/* Where the drive stands at `km` along an assessed route, at clock time nowMs: whether it is in a modelled-smoke stretch, how far to its end,
   and the next stretch ahead (distance, minutes and clock time at the route's own average speed). */
function driveState(r, km, nowMs) {
  const total = r.km, kmh = r.route.duration > 0 ? total / (r.route.duration / 3600) : 60, segs = r.status === 'notAssessed' ? [] : (r.segments || []);
  const cur = segs.findIndex(g => km >= g.fromKm && km <= g.toKm), nxt = segs.findIndex(g => g.fromKm > km);
  const mk = i => { const g = segs[i], d = g.fromKm - km; return { idx: i, fromKm: g.fromKm, toKm: g.toKm, lenKm: g.toKm - g.fromKm, distKm: d, etaMin: d / kmh * 60, etaMs: nowMs + d / kmh * 36e5, peak: g.peak }; };
  const left = cur >= 0 ? segs[cur].toKm - km : null;
  return { km, total, remainingKm: Math.max(0, total - km), done: km >= total - .05, kmh, assessed: r.status !== 'notAssessed',
    inSmoke: cur >= 0 ? { idx: cur, leftKm: left, leftMin: left / kmh * 60, leftMs: nowMs + left / kmh * 36e5, peak: segs[cur].peak } : null, next: nxt >= 0 ? mk(nxt) : null };
}
/* The next maneuver still ahead: { step, inKm } or null */
function nextStep(dirs, km) { const s = dirs.find(x => x.startKm > km + .02); return s ? { step: s, inKm: s.startKm - km } : null; }
/* Alerts to give at this position. `fired` (a Set) records what was already said, so each is given once per stretch: 5 km ahead, 1 km ahead
   (if the position jumps from beyond 5 km to within 1 km, only the 1 km alert is given), on entering, on leaving. At the first call (o.first),
   a stretch already behind the vehicle says nothing. Returns [{ type: 'ahead' | 'enter' | 'leave', level, idx, distKm, lenKm, leftKm }]. */
function driveAlerts(r, km, fired, o = {}) {
  const [a5, a1] = o.ahead || RULES.driveAhead, ev = [], segs = r.status === 'notAssessed' ? [] : (r.segments || []), mark = (i, ...t) => t.forEach(x => fired.add(i + ':' + x));
  segs.forEach((g, i) => {
    const inside = km >= g.fromKm && km <= g.toKm, past = km > g.toKm, dist = g.fromKm - km, len = g.toKm - g.fromKm, has = t => fired.has(i + ':' + t);
    if (!inside && !past) {
      if (dist <= a1 && !has('1')) { mark(i, '5', '1'); ev.push({ type: 'ahead', level: a1, idx: i, distKm: dist, lenKm: len }); }
      else if (dist <= a5 && dist > a1 && !has('5')) { mark(i, '5'); ev.push({ type: 'ahead', level: a5, idx: i, distKm: dist, lenKm: len }); }
    }
    if (inside && !has('enter')) { mark(i, '5', '1', 'enter'); ev.push({ type: 'enter', idx: i, lenKm: len, leftKm: g.toKm - km }); }
    if (past && !has('leave')) {
      if (!has('enter')) { if (o.first) { mark(i, '5', '1', 'enter', 'leave'); return; } mark(i, '5', '1', 'enter'); ev.push({ type: 'enter', idx: i, lenKm: len, leftKm: 0 }); }
      mark(i, 'leave'); ev.push({ type: 'leave', idx: i, lenKm: len });
    }
  });
  return ev;
}
/* After a re-assessment the stretches may have moved a little: carry over what was already said to the stretch that overlaps the old one most. */
function remapFired(oldSegs, newSegs, fired) {
  const out = new Set();
  oldSegs.forEach((g, i) => {
    let bj = -1, bo = 0; newSegs.forEach((h, j) => { const ov = Math.min(g.toKm, h.toKm) - Math.max(g.fromKm, h.fromKm); if (ov > bo) { bo = ov; bj = j; } });
    if (bj >= 0) ['5', '1', 'enter', 'leave'].forEach(t => { if (fired.has(i + ':' + t)) out.add(bj + ':' + t); });
  });
  return out;
}
/* the words of an alert (the same text is shown and spoken); sim puts "Simulation." in front of every one */
function alertText(ev, lang = 'en', sim = false) {
  const T = UI[lang] || UI.en, n = x => nf(x, lang), d = x => x < 10 ? n(x) : n(x, 0);
  const t = ev.type === 'ahead' ? T.alertAhead(d(Math.max(.1, ev.distKm)), d(ev.lenKm)) : ev.type === 'enter' ? T.alertEnter(d(ev.lenKm)) : T.alertLeave;
  return (sim ? T.simSay + ' ' : '') + t;
}
/* the three lines of the drive panel */
function driveLines(r, st, dirs, lang, o = {}) {
  const T = UI[lang] || UI.en, n = x => nf(x, lang), hhmm = o.hhmm || (ms => new Date(ms).toISOString().slice(11, 16)), ns = nextStep(dirs, st.km);
  const lines = { next: st.done ? T.driveArrived : ns ? T.driveNext(ns.step.text, fmtDist(ns.inKm, lang)) : T.driveNoTurn, smoke: '', progress: T.driveProgress(n(Math.min(st.km, st.total)), n(st.total)) };
  if (st.done) lines.smoke = '';
  else if (!st.assessed) lines.smoke = T.driveNotAssessed;
  else if (st.inSmoke) lines.smoke = T.driveInSmoke(n(st.inSmoke.leftKm), n(Math.max(1, Math.round(st.inSmoke.leftMin))), hhmm(st.inSmoke.leftMs));
  else if (st.next) lines.smoke = T.driveAhead(n(st.next.distKm), n(Math.max(1, Math.round(st.next.etaMin))), hhmm(st.next.etaMs), n(st.next.lenKm));
  else lines.smoke = T.driveClear(n(st.remainingKm));
  return lines;
}

/* ---------- best time to leave ---------- */
/* options: [{ h (hours from now), depMs, best: { kmInSmoke, smokeMin, peak, status } | null }] where best is the least-smoke route of that departure.
   Ranks by least smoke-minutes, then peak, then the earlier. kind: 'unknown' (leaving now could not be assessed), 'same' (no real difference),
   'now' (now is the least) or 'later' (an hour h is). */
function leaveRanking(options) {
  const ok = options.filter(x => x.best && x.best.status !== 'notAssessed' && x.best.smokeMin != null).sort((a, b) => a.h - b.h);
  const now = ok.find(x => x.h === options[0].h && options[0].best && options[0].best.status !== 'notAssessed');
  if (!now || ok.length < 2) return { kind: 'unknown', ranked: ok, now: now || null, best: null };
  const key = x => [Math.round(x.best.smokeMin * 10), Math.round(x.best.peak * 10), x.h];
  const ranked = ok.slice().sort((a, b) => { const p = key(a), q = key(b); for (let i = 0; i < 3; i++) if (p[i] !== q[i]) return p[i] - q[i]; return 0; });
  const best = ranked[0], near = x => Math.abs(x.best.smokeMin - now.best.smokeMin) < .1 && Math.abs(x.best.kmInSmoke - now.best.kmInSmoke) < .05, same = ok.every(near) || (best.h !== now.h && near(best));
  const worst = Math.max(...ok.map(x => x.best.kmInSmoke));
  return { kind: same ? 'same' : best.h === now.h ? 'now' : 'later', ranked, now, best, worstKm: worst, assessed: ok.length, asked: options.length };
}
function leaveSummary(rk, lang = 'en', hhmm) {
  const T = UI[lang] || UI.en, n = x => nf(x, lang), f = hhmm || (ms => new Date(ms).toISOString().slice(11, 16));
  if (!rk || rk.kind === 'unknown') return T.leaveUnknown;
  if (rk.kind === 'same') return T.leaveSame(n(rk.now.best.kmInSmoke));
  if (rk.kind === 'now') return T.leaveNow(n(rk.now.best.kmInSmoke), n(rk.worstKm));
  return T.leaveLater(f(rk.best.depMs), n(rk.best.best.kmInSmoke), n(rk.now.best.kmInSmoke));
}

root.ROUTE = Object.freeze({ NAMES, RULES, UI, fireClusters, sampleRoute, pointAlong, assess, metrics, rank, normRoutes, osrmSteps, fetchRoutes, gmapsUrl, geojson, pickExample, summary, nf, r1,
  project, msAtKm, viaCandidates, detourVerdict, searchDetour, fmtDist, directions, driveState, nextStep, driveAlerts, remapFired, alertText, driveLines, leaveRanking, leaveSummary });
})(typeof globalThis !== 'undefined' ? globalThis : window);
