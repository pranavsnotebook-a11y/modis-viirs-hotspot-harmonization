/* ROUTE core: how much modelled smoke does each driving route meet, at the time the vehicle would be there?
   OBSERVED: the fire detections (NASA FIRMS). MAPPED: the roads and places (OpenStreetMap). MODELLED: the wind (Open-Meteo).
   SCENARIO: the plume (FIRECORE through DOWNWIND.scenario), with each fire held at its observed power for the whole trip.
   Pure functions plus an injected fetch: no DOM and no globals of its own, so the browser page and the Node tests run the same code.
   Needs FIRECORE (firelab-core.js), DOWNWIND (downwind-core.js) and WATCH (watch-core.js) loaded first. Nothing here is a measurement of smoke. */
(function (root) {
'use strict';
const D = () => root.DOWNWIND, W = () => root.WATCH, F = () => root.FIRECORE;
const NAMES = ['A', 'B', 'C'];
const RULES = Object.freeze({ stepKm: 1, reachKm: 25, minConc: 1, clusterKm: 1.5, minFrp: 5, hours: 24, scenarioHours: 3, oldHours: 12, maxRoutes: 3, maxWaypoints: 8, exampleKm: 20, exampleEndKm: 30, examplePlaceKm: 25 });
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
  const routes = (o.routes || []).slice(0, R.maxRoutes).map((rt, i) => ({ name: NAMES[i], route: rt, ...sampleRoute(rt, depMs, R.stepKm) }));
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
function normRoutes(j) {
  const out = [];
  for (const r of (j && j.routes) || []) {
    const c = (r.coords || (r.geometry && r.geometry.coordinates));
    if (Array.isArray(c) && c.length >= 2 && isFinite(r.distance) && isFinite(r.duration)) out.push({ coords: c, distance: +r.distance, duration: +r.duration });
  }
  return out.slice(0, RULES.maxRoutes);
}
/* our own server first (it caches and keeps to one request a second); a static host has none, so then the public OSRM demo server directly.
   Returns { routes, source } or throws Error('routing') when neither answered. getJSON(url, ms) is injected. */
async function fetchRoutes(from, to, getJSON, o = {}) {
  const ll = p => `${fix(p.lat)},${fix(p.lon)}`, lonlat = p => `${fix(p.lon)},${fix(p.lat)}`;
  if (o.server !== false) {
    try { const j = await getJSON(`api/route?from=${ll(from)}&to=${ll(to)}`, 40000); if (j && Array.isArray(j.routes)) return { routes: normRoutes(j), source: 'server' }; } catch (e) { /* no server, or it could not reach OSRM: try OSRM itself */ }
  }
  try {
    const j = await getJSON(`https://router.project-osrm.org/route/v1/driving/${lonlat(from)};${lonlat(to)}?alternatives=3&overview=full&geometries=geojson&steps=false`, 30000);
    if (j && (j.code === 'Ok' || j.code === 'NoRoute') && Array.isArray(j.routes || [])) return { routes: normRoutes({ routes: (j.routes || []).map(r => ({ coords: r.geometry && r.geometry.coordinates, distance: r.distance, duration: r.duration })) }), source: 'osrm' };
  } catch (e) { /* falls through */ }
  throw new Error('routing');
}

/* ---------- hand-off ---------- */
/* a Google Maps directions link: origin, destination and up to maxWaypoints points sampled along the route, so Google follows about the same way.
   Google may still change the path between two points. The link is only built here; the page opens it on a click. */
function gmapsUrl(route, max = RULES.maxWaypoints) {
  const c = route.coords, ll = p => `${(+p[1]).toFixed(5)},${(+p[0]).toFixed(5)}`;
  const o = ll(c[0]), d = ll(c[c.length - 1]), r = { coords: c };
  const total = sampleRoute(r, 0, 1e9).km, n = Math.max(0, Math.min(Math.floor(max), RULES.maxWaypoints, Math.floor(total / 5)));
  const pts = []; for (let k = 1; k <= n; k++) { const p = pointAlong(r, total * k / (n + 1)); pts.push(`${p[0].toFixed(5)},${p[1].toFixed(5)}`); }
  // the numbers hold only digits, '-', '.' and ','; the one character that must be encoded is the pipe between waypoints
  return 'https://www.google.com/maps/dir/?api=1&origin=' + o + '&destination=' + d + (pts.length ? '&waypoints=' + pts.join('%7C') : '') + '&travelmode=driving';
}
/* GeoJSON (RFC 7946, [lon, lat]): one LineString per route with its numbers, plus each in-smoke stretch as its own feature */
function geojson(res, meta = {}) {
  const labels = ['fires: OBSERVED (NASA FIRMS satellite detections)', 'wind: MODELLED (Open-Meteo)', 'smoke: SCENARIO (plume model, fires held at their observed power)'];
  const depart = new Date(res.depMs).toISOString(), through = meta.dataEnd ? new Date(meta.dataEnd).toISOString() : null;
  const num = x => x == null ? null : Math.round(x * 100) / 100;
  const base = r => ({ route: r.name, depart, data_through: through, labels });
  const feats = [];
  res.routes.forEach(r => {
    feats.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: r.route.coords.map(p => [+p[0], +p[1]]) },
      properties: { ...base(r), kind: 'route', name: 'Route ' + r.name, best: res.best === r.name, status: r.status, distance_km: num(r.route.distance / 1000), duration_min: num(r.route.duration / 60),
        km_in_smoke: num(r.kmInSmoke), peak_ugm3: num(r.peak), smoke_minutes: num(r.smokeMin), smoke_starts_km: r.start ? num(r.start.km) : null, smoke_starts_at: r.start ? new Date(r.start.ms).toISOString() : null, fires_not_assessed: r.unassessed } });
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
/* the one line above the cards. Real numbers only: every figure comes from the assessment. */
function summary(res, lang = 'en') {
  const T = UI[lang] || UI.en, rs = res.routes.filter(r => r.status !== 'notAssessed');
  if (!res.routes.length) return '';
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

root.ROUTE = Object.freeze({ NAMES, RULES, UI, fireClusters, sampleRoute, pointAlong, assess, metrics, rank, normRoutes, fetchRoutes, gmapsUrl, geojson, pickExample, summary, nf, r1 });
})(typeof globalThis !== 'undefined' ? globalThis : window);
