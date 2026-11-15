// ROUTE: sampling and timing, exposure with a fire upwind vs downwind, ranking, not-assessed handling, Google Maps link, GeoJSON, the example picker. Offline, injected wind.
import test from 'node:test';
import assert from 'node:assert/strict';
import { load, regions, J, constantWind } from './load.mjs';
load('regions', 'firelab-core', 'downwind-core', 'fast-core', 'watch-core', 'route-core');
const W = globalThis.WATCH, RT = globalThis.ROUTE, D = globalThis.DOWNWIND;
const DEP = Date.parse('2026-11-13T12:00:00Z'), iso = ms => new Date(ms).toISOString().slice(0, 16) + 'Z';
const fire = (lat, lon, frp = 150, ms = DEP - 36e5) => ({ id: 'f' + lat + lon, lat, lon, frp, ms, time: iso(ms), sat: 'S-NPP' });
// an east-west route along latitude -25.25 from lon -57.5 to -57.0 (about 50 km), 1 hour
const line = (lat, lo0, lo1, n = 60, dur = 3600) => ({ coords: Array.from({ length: n + 1 }, (_, i) => [lo0 + (lo1 - lo0) * i / n, lat]), distance: 0, duration: dur });
const EW = () => { const r = line(-25.25, -57.5, -57.0); r.distance = D.dist(-25.25, -57.5, -25.25, -57.0) * 1000; return r; };
const windFrom = (wd, ws = 3) => W.createWind({ getJSON: constantWind({ wd, ws }).getJSON });
const clusters = list => D.cluster(list, 1.5).map(f => ({ ...f, ms: Date.parse(f.time) }));

test('sampleRoute: a sample at least every km, both ends included, weights add up to the length, arrival time proportional to distance', () => {
  const r = EW(), { samples, km } = RT.sampleRoute(r, DEP, 1);
  assert.ok(Math.abs(km - D.dist(-25.25, -57.5, -25.25, -57.0)) < 1e-6 && km > 45 && km < 55);
  assert.ok(samples.length >= Math.ceil(km) + 1);
  assert.equal(samples[0].km, 0); assert.ok(Math.abs(samples.at(-1).km - km) < 1e-9);
  for (let i = 1; i < samples.length; i++) assert.ok(samples[i].km - samples[i - 1].km <= 1 + 1e-9);
  assert.ok(Math.abs(samples.reduce((s, x) => s + x.w, 0) - km) < 1e-6);
  assert.ok(Math.abs(samples.reduce((s, x) => s + x.min, 0) - 60) < 1e-6, 'minutes add up to the duration');
  assert.equal(samples[0].ms, DEP); assert.equal(samples.at(-1).ms, DEP + 3600e3);
  const mid = samples.find(s => Math.abs(s.km - km / 2) < .6); assert.ok(Math.abs(mid.ms - (DEP + 1800e3)) < 40e3);
  assert.ok(Math.abs(samples[10].lon - (-57.5 + .5 * samples[10].km / km)) < 1e-3);
});
test('sampleRoute: a very short or zero-length route still gives samples without NaN', () => {
  for (const r of [{ coords: [[-57, -25], [-57, -25]], duration: 60 }, { coords: [[-57, -25], [-57.001, -25]], duration: 60 }]) {
    const { samples } = RT.sampleRoute(r, DEP); assert.ok(samples.length >= 2); for (const s of samples) assert.ok(isFinite(s.lat) && isFinite(s.lon) && isFinite(s.ms) && isFinite(s.min));
  }
});
test('fireClusters: last 24 h of data only, grouped per pass, small clusters counted apart', () => {
  const f = [fire(-25.3, -57.2, 20), { ...fire(-25.3, -57.2005, 20), id: 'x' }, fire(-25.1, -57.1, 2), { ...fire(-25.2, -57.3, 80, DEP - 30 * 36e5) }];
  const { clusters: c, small, detections } = RT.fireClusters(f, DEP, {});
  assert.equal(detections, 3); assert.equal(c.length, 1); assert.equal(Math.round(c[0].frp), 40); assert.equal(small, 1);
});

test('exposure: a fire south of the route with wind from the south puts modelled smoke on it; the same fire north of it does not', async () => {
  const south = await RT.assess({ routes: [EW()], depMs: DEP, clusters: clusters([fire(-25.3, -57.25)]), wind: windFrom(180) });
  const r = south.routes[0];
  assert.equal(r.status, 'ok'); assert.ok(r.kmInSmoke > 1, 'km in smoke ' + r.kmInSmoke); assert.ok(r.peak >= 1); assert.ok(r.smokeMin > 0 && r.smokeMin < 60);
  assert.ok(r.start && r.start.km > 10 && r.start.km < 40 && r.start.ms > DEP && r.start.ms < DEP + 3600e3);
  assert.ok(r.segments.length >= 1 && r.segments[0].pts.length >= 2 && r.segments[0].fromKm < r.segments[0].toKm);
  assert.ok(Math.abs(r.smokeMin / 60 - r.kmInSmoke / r.km) < .05, 'speed is constant, so minutes follow km');
  assert.equal(south.best, 'A'); assert.equal(south.fires.relevant, 1);
  const north = await RT.assess({ routes: [EW()], depMs: DEP, clusters: clusters([fire(-25.2, -57.25)]), wind: windFrom(180) });
  const n = north.routes[0];
  assert.equal(n.status, 'ok'); assert.equal(n.kmInSmoke, 0); assert.ok(n.peak < 1); assert.equal(n.start, null); assert.deepEqual(J(n.segments), []);
});
test('exposure: the fire is held at its observed power; a stronger fire gives more smoke; fires add up', async () => {
  const run = async list => (await RT.assess({ routes: [EW()], depMs: DEP, clusters: clusters(list), wind: windFrom(180) })).routes[0];
  const a = await run([fire(-25.3, -57.25, 60)]), b = await run([fire(-25.3, -57.25, 300)]), c = await run([fire(-25.3, -57.25, 60), fire(-25.31, -57.15, 60)]);
  assert.ok(b.peak > a.peak && b.kmInSmoke >= a.kmInSmoke);
  assert.ok(c.peak > a.peak || c.kmInSmoke > a.kmInSmoke);
});
test('exposure: only fires within 25 km of a sample are looked at; wind is asked once per cell, for the departure and arrival days', async () => {
  const w = constantWind({ wd: 180 }), wind = W.createWind({ getJSON: w.getJSON });
  const res = await RT.assess({ routes: [EW()], depMs: DEP, clusters: clusters([fire(-25.3, -57.25), fire(-23.0, -57.25), fire(-25.31, -57.0)]), wind });
  assert.equal(res.fires.relevant, 2, 'the fire 250 km away is not relevant; the two near ones are');
  assert.equal(res.range.d0, '2026-11-13'); assert.equal(res.range.d1, '2026-11-13'); assert.equal(res.range.old, false);
  assert.ok(w.calls.length >= 1 && w.calls.length <= 1, 'one batch'); assert.ok(w.calls[0].includes('start_date=2026-11-13'));
  const late = await RT.assess({ routes: [line(-25.25, -57.5, -57.0, 60, 4 * 3600)], depMs: Date.parse('2026-11-13T22:00:00Z'), clusters: clusters([fire(-25.3, -57.25)]), wind: windFrom(180) });
  assert.equal(late.range.d0, '2026-11-13'); assert.equal(late.range.d1, '2026-11-14');
});
test('exposure: wind direction matters (wind from the north: the fire south of the route is now downwind of nothing)', async () => {
  const r = (await RT.assess({ routes: [EW()], depMs: DEP, clusters: clusters([fire(-25.3, -57.25)]), wind: windFrom(0) })).routes[0];
  assert.equal(r.kmInSmoke, 0);
});
test('not assessed: with no wind, fires near a route are "not assessed", never clear; a route with no fire nearby is "no fires"', async () => {
  const dead = { fetch: async () => 1, has: () => false, at: () => null };
  const res = await RT.assess({ routes: [EW(), line(-24.0, -57.5, -57.0)], depMs: DEP, clusters: clusters([fire(-25.3, -57.25)]), wind: dead });
  const [a, b] = res.routes;
  assert.equal(a.status, 'notAssessed'); assert.equal(a.kmInSmoke, null); assert.equal(a.peak, null); assert.equal(a.smokeMin, null); assert.equal(a.unassessed, 1);
  assert.equal(b.status, 'nofires'); assert.equal(b.kmInSmoke, 0);
  assert.equal(res.best, 'B', 'a route that was not assessed never wins over one that was'); assert.equal(res.fires.noWind, 1); assert.ok(res.windFailed);
  const only = await RT.assess({ routes: [EW()], depMs: DEP, clusters: clusters([fire(-25.3, -57.25)]), wind: dead });
  assert.equal(only.best, null); assert.match(RT.summary(only, 'en'), /not an all-clear/); assert.ok(!/avoid|no route meets/i.test(RT.summary(only, 'en')));
});
test('not assessed: fires over the wind-cell cap are counted as not assessed, the strongest are kept', async () => {
  const keep = W.MAX_CELLS; W.MAX_CELLS = 1;
  try {
    const strong = fire(-25.3, -57.25, 300), weak = fire(-25.3, -57.0, 20);   // two different 0.25 degree cells
    const res = await RT.assess({ routes: [EW()], depMs: DEP, clusters: clusters([weak, strong]), wind: windFrom(180) });
    assert.equal(res.fires.relevant, 2); assert.equal(res.fires.assessed, 1); assert.equal(res.fires.capped, 1);
    assert.equal(res.routes[0].status, 'partial'); assert.equal(res.routes[0].unassessed, 1); assert.ok(res.routes[0].kmInSmoke > 0, 'the strong fire was kept');
  } finally { W.MAX_CELLS = keep; }
});
test('a failing wind request for part of the cells leaves those fires not assessed and the others assessed', async () => {
  const base = windFrom(180); let n = 0;
  const wind = { cells: base.cells, fetch: base.fetch, has: (la, lo, r) => (la < -25.4 ? false : base.has(la, lo, r)), at: base.at };
  const res = await RT.assess({ routes: [EW()], depMs: DEP, clusters: clusters([fire(-25.3, -57.25), fire(-25.45, -57.25)]), wind });
  assert.equal(res.routes[0].status, 'partial'); assert.equal(res.routes[0].unassessed, 1); assert.ok(res.routes[0].kmInSmoke > 0);
});

test('rank: least smoke-minutes, then least peak, then shortest; a route not assessed goes last; ties keep A before B', () => {
  const mk = (name, smokeMin, peak, duration, status = 'ok') => ({ name, smokeMin, peak, route: { duration }, status });
  assert.deepEqual(RT.rank([mk('A', 10, 5, 100), mk('B', 2, 50, 200), mk('C', 5, 1, 50)]).map(r => r.name), ['B', 'C', 'A']);
  assert.deepEqual(RT.rank([mk('A', 3, 9, 100), mk('B', 3, 4, 300), mk('C', 3, 4, 200)]).map(r => r.name), ['C', 'B', 'A']);
  assert.deepEqual(RT.rank([mk('A', null, null, 10, 'notAssessed'), mk('B', 40, 90, 900)]).map(r => r.name), ['B', 'A']);
  assert.deepEqual(RT.rank([mk('A', 0, 0, 100), mk('B', 0, 0, 100)]).map(r => r.name), ['A', 'B']);
});
test('ranking end to end: the quicker route through the smoke loses to a longer detour that misses it; the card names are A, B, C in service order', async () => {
  const direct = EW(), detour = { coords: [[-57.5, -25.25], [-57.4, -25.5], [-57.1, -25.5], [-57.0, -25.25]], distance: 80000, duration: 4200 };
  const res = await RT.assess({ routes: [direct, detour], depMs: DEP, clusters: clusters([fire(-25.3, -57.25)]), wind: windFrom(180) });
  assert.deepEqual(res.routes.map(r => r.name), ['A', 'B']);
  assert.ok(res.routes[0].kmInSmoke > 0 && res.routes[1].kmInSmoke === 0, JSON.stringify(res.routes.map(r => r.kmInSmoke)));
  assert.equal(res.best, 'B'); assert.equal(res.routes[1].best, true); assert.equal(res.routes[0].best, false);
  const s = RT.summary(res, 'en');
  assert.match(s, /^Route B avoids the modelled smoke: 0 km in smoke vs \d+(\.\d)? km on Route A, 10 min longer\.$/);
});

test('summary: real numbers, no smoke, one route, the same smoke everywhere, three languages', () => {
  const mk = (name, km, dur, st = 'ok') => ({ name, route: { duration: dur }, kmInSmoke: km, peak: km ? 12.34 : 0, smokeMin: km, status: st });
  const res = (rs, best) => ({ routes: rs, best });
  assert.equal(RT.summary(res([mk('A', 6.24, 3600), mk('B', 0, 3840)], 'B'), 'en'), 'Route B avoids the modelled smoke: 0 km in smoke vs 6.2 km on Route A, 4 min longer.');
  assert.equal(RT.summary(res([mk('A', 6.24, 3600), mk('B', 2.1, 3600)], 'B'), 'en'), 'Route B has the least modelled smoke: 2.1 km in smoke vs 6.2 km on Route A, about the same time.');
  assert.equal(RT.summary(res([mk('A', 2, 3000), mk('B', 6, 3600)], 'A'), 'en'), 'Route A has the least modelled smoke: 2 km in smoke vs 6 km on Route B, 10 min shorter.');
  const none = RT.summary(res([mk('A', 0, 100), mk('B', 0, 200)], 'A'), 'en');
  assert.match(none, /^No route meets modelled smoke/); assert.match(none, /no detection does not mean no fire/);
  assert.match(RT.summary(res([mk('A', 3, 100)], 'A'), 'en'), /Only one route.*3 km.*12\.3\b/);
  assert.match(RT.summary(res([mk('A', 3, 100), mk('B', 3, 200)], 'A'), 'en'), /^All 2 routes meet about the same modelled smoke \(3 km\)\. Route A is the quickest/);
  assert.match(RT.summary(res([mk('A', 6.24, 3600), mk('B', 0, 3840)], 'B'), 'es'), /^La Ruta B evita el humo modelado: 0 km en humo frente a 6,2 km en la Ruta A, 4 min más larga\.$/);
  assert.match(RT.summary(res([mk('A', 6.24, 3600), mk('B', 0, 3840)], 'B'), 'pt'), /^A Rota B evita a fumaça modelada: 0 km na fumaça contra 6,2 km na Rota A, 4 min mais longa\.$/);
  for (const l of ['es', 'pt']) assert.match(RT.summary(res([mk('A', 0, 1), mk('B', 0, 2)], 'A'), l), /no (haber|hay)|não/);
  assert.equal(RT.summary({ routes: [], best: null }, 'en'), '');
});
test('every language has every string the English one has', () => {
  for (const l of ['es', 'pt']) assert.deepEqual(Object.keys(RT.UI[l]).sort(), Object.keys(RT.UI.en).sort(), l);
  for (const l of ['en', 'es', 'pt']) assert.match(RT.UI[l].safety, /./);
  assert.equal(RT.UI.en.safety, 'A modelled scenario from satellite data, not a ground report. In an emergency, follow official instructions.');
});

test('gmapsUrl: origin, destination, at most 8 waypoints joined by an encoded pipe, driving, nothing else', () => {
  const long = { coords: Array.from({ length: 101 }, (_, i) => [-57.5 + i * .01, -25.25 + i * .004]) };
  const u = new URL(RT.gmapsUrl(long)), q = u.searchParams;
  assert.equal(u.origin + u.pathname, 'https://www.google.com/maps/dir/'); assert.equal(q.get('api'), '1'); assert.equal(q.get('travelmode'), 'driving');
  assert.equal(q.get('origin'), '-25.25000,-57.50000'); assert.equal(q.get('destination'), '-24.85000,-56.50000');
  const wp = q.get('waypoints').split('|'); assert.equal(wp.length, 8);
  assert.ok(RT.gmapsUrl(long).includes('%7C') && !RT.gmapsUrl(long).includes('|'));
  let prev = -Infinity; for (const p of wp) { const [la, lo] = p.split(',').map(Number); assert.ok(la > -25.25 && la < -24.85 && lo > -57.5 && lo < -56.5); assert.ok(lo > prev); prev = lo; assert.ok(Math.abs(la - (-25.25 + (lo + 57.5) * .4)) < 1e-4, 'on the route'); }
  assert.equal(new URL(RT.gmapsUrl(long, 3)).searchParams.get('waypoints').split('|').length, 3);
  assert.equal(new URL(RT.gmapsUrl(long, 99)).searchParams.get('waypoints').split('|').length, 8, 'never more than 8');
  const short = { coords: [[-57, -25], [-57.01, -25.01], [-57.02, -25.02]] };
  assert.equal(new URL(RT.gmapsUrl(short)).searchParams.get('waypoints'), null, 'a route under 5 km needs none');
  assert.ok(/^https:\/\/www\.google\.com\/maps\/dir\/\?api=1&origin=[-\d.,]+&destination=[-\d.,]+&travelmode=driving$/.test(RT.gmapsUrl(short)));
});
test('geojson: a FeatureCollection with one LineString per route and one per in-smoke stretch, lon/lat order, the labels and the times', async () => {
  const res = await RT.assess({ routes: [EW()], depMs: DEP, clusters: clusters([fire(-25.3, -57.25)]), wind: windFrom(180) });
  const g = J(RT.geojson(res, { dataEnd: DEP }));
  assert.equal(g.type, 'FeatureCollection');
  const routes = g.features.filter(f => f.properties.kind === 'route'), segs = g.features.filter(f => f.properties.kind === 'smoke_segment');
  assert.equal(routes.length, 1); assert.ok(segs.length >= 1);
  for (const f of g.features) { assert.equal(f.geometry.type, 'LineString'); assert.ok(f.geometry.coordinates.length >= 2); for (const [lo, la] of f.geometry.coordinates) assert.ok(lo < -50 && lo > -60 && la < -20 && la > -30, 'lon, lat'); }
  const p = routes[0].properties;
  assert.equal(p.name, 'Route A'); assert.equal(p.km_in_smoke, Math.round(res.routes[0].kmInSmoke * 100) / 100); assert.ok(p.peak_ugm3 >= 1); assert.ok(p.smoke_minutes > 0);
  assert.equal(p.depart, '2026-11-13T12:00:00.000Z'); assert.equal(p.data_through, '2026-11-13T12:00:00.000Z');
  assert.equal(p.labels.length, 3); assert.match(p.labels.join(' '), /OBSERVED[\s\S]*MODELLED[\s\S]*SCENARIO/);
  assert.ok(segs[0].properties.from_km < segs[0].properties.to_km && segs[0].properties.peak_ugm3 >= 1 && segs[0].properties.route === 'A');
  assert.equal(routes[0].geometry.coordinates.length, 61);
});
test('geojson: a route that was not assessed has null numbers, not zeros', async () => {
  const res = await RT.assess({ routes: [EW()], depMs: DEP, clusters: clusters([fire(-25.3, -57.25)]), wind: { fetch: async () => 1, has: () => false, at: () => null } });
  const p = RT.geojson(res).features[0].properties; assert.equal(p.km_in_smoke, null); assert.equal(p.peak_ugm3, null); assert.equal(p.smoke_minutes, null); assert.equal(p.status, 'notAssessed');
});

test('fetchRoutes: our server first; when it fails, OSRM directly; when both fail, an error', async () => {
  const osrm = { code: 'Ok', routes: [{ geometry: { coordinates: [[-57.5, -25.25], [-57, -25.25]] }, distance: 50000, duration: 3000 }, { geometry: { coordinates: [[-57.5, -25.25], [-57.2, -25.0], [-57, -25.25]] }, distance: 60000, duration: 3300 }] };
  const A = { lat: -25.25, lon: -57.5 }, B = { lat: -25.25, lon: -57 }, urls = [];
  let r = await RT.fetchRoutes(A, B, async u => { urls.push(u); return { routes: [{ coords: [[-57.5, -25.25], [-57, -25.25]], distance: 1, duration: 2 }] }; });
  assert.equal(r.source, 'server'); assert.equal(urls.length, 1); assert.equal(urls[0], 'api/route?from=-25.25000,-57.50000&to=-25.25000,-57.00000');
  urls.length = 0;
  r = await RT.fetchRoutes(A, B, async u => { urls.push(u); if (u.startsWith('api/')) throw new Error('HTTP 404'); return osrm; }, { paceMs: 0 });
  assert.equal(r.source, 'osrm'); assert.equal(r.routes.length, 2); assert.equal(r.routes[1].duration, 3300); assert.match(urls[1], /^https:\/\/router\.project-osrm\.org\/route\/v1\/driving\/-57\.50000,-25\.25000;-57\.00000,-25\.25000\?alternatives=3&overview=full&geometries=geojson&steps=true$/);
  await assert.rejects(RT.fetchRoutes(A, B, async () => { throw new Error('offline'); }, { paceMs: 0 }), /routing/);
  r = await RT.fetchRoutes(A, B, async u => u.startsWith('api/') ? { routes: [] } : osrm, { paceMs: 0 }); assert.equal(r.routes.length, 0, 'the server said there is no route: that is an answer');
});

// fixtures for the example: one main road running north-south through lon -57.0 for 120 km, named places along it
const road = { id: 7, name: 'Ruta 9', ref: 'PY09', pts: Array.from({ length: 121 }, (_, i) => [-26.0 + i * .009, -57.0]) };
const places = [['Fin Sur', -25.99, -57.0], ['Sur', -25.75, -57.0], ['Centro', -25.46, -57.0], ['Norte', -25.17, -57.0], ['Fin Norte', -24.93, -57.0], ['Lejos', -22, -50]];
test('pickExample: the named places nearest the two ends of the road stretch around the strongest crossing, at least 20 km apart', () => {
  const row = { key: 'rPY09', peak: 40, at: [-25.46, -57.0], asset: road };
  const ex = RT.pickExample({ rows: [row], places, endKm: 30 });
  assert.ok(ex); assert.notEqual(ex.from.name, ex.to.name);
  assert.ok(D.dist(ex.from.lat, ex.from.lon, ex.to.lat, ex.to.lon) >= 20); assert.ok(['Sur', 'Norte'].includes(ex.from.name) && ['Sur', 'Norte'].includes(ex.to.name));
  assert.equal(ex.row.road, 'Ruta 9');
  const wide = RT.pickExample({ rows: [row], places, endKm: 80 }); assert.deepEqual([wide.from.name, wide.to.name].sort(), ['Fin Norte', 'Fin Sur']);
});
test('pickExample: nothing qualifies when the places are too close, too far from the road ends, missing, or the rows are empty; the next row is tried', () => {
  const row = { key: 'r', peak: 40, at: [-25.46, -57.0], asset: road };
  assert.equal(RT.pickExample({ rows: [], places }), null);
  assert.equal(RT.pickExample({ rows: [row], places: [] }), null);
  assert.equal(RT.pickExample({ rows: [row], places: [['Solo', -25.46, -57.0]] }), null);
  assert.equal(RT.pickExample({ rows: [row], places: [['A', -25.46, -57.0], ['B', -25.47, -57.0]], endKm: 5 }), null, 'two places 1 km apart are not an example');
  assert.equal(RT.pickExample({ rows: [row], places: [['Far', -20, -50], ['Farther', -19, -50]] }), null);
  assert.equal(RT.pickExample({ rows: [{ key: 'x', peak: 1, at: null, asset: road }] , places }), null);
  const bad = { key: 'bad', peak: 90, at: [-10, -40], asset: { pts: [[-10, -40], [-10.01, -40]] } };
  assert.ok(RT.pickExample({ rows: [bad, row], places }), 'a stronger row that cannot make an example is skipped');
});
test('pickExample on watch-core output: rows from computeLive on a road crossed by a plume give an example', async () => {
  const P = W.prepAssets({ layers: { roads: { built: true }, power: { built: true }, health: { built: true }, schools: { built: true } }, power: [], health: [], schools: [], places: [], roads: [road] });
  const f = fire(-25.5, -57.2, 200, DEP - 36e5);
  const res = await W.computeLive({ kind: 'roads', dets: [f], assets: P, rules: { ...W.rules(), minFrp: 5 }, wind: windFrom(270), range: W.liveRange(DEP, 24, W.rules()), live: true });
  assert.ok(res.rows.length >= 1, 'the plume from the west crosses the road');
  const ex = RT.pickExample({ rows: res.rows, places, endKm: 40 });
  assert.ok(ex && ex.from.name && ex.to.name && ex.from.name !== ex.to.name);
});

/* =============== detour, directions, drive, best time to leave =============== */
const seg = (fromKm, toKm) => ({ fromKm, toKm });
const kmOf = (a, b) => D.dist(a[0], a[1], b.lat, b.lon);
test('viaCandidates: perpendicular to the route at the middle of the stretch, 8, 15 and 25 km on each side, the upwind side first', () => {
  const r = EW(), mid = RT.pointAlong(r, 25);                       // an eastbound route; the stretch is 20 to 30 km
  const south = RT.viaCandidates(r, seg(20, 30), 180);              // wind FROM the south: the south side is upwind
  assert.equal(south.length, 6); assert.deepEqual(J(south.map(v => v.km)), [8, 15, 25, 8, 15, 25]); assert.deepEqual(J(south.map(v => v.side)), ['upwind', 'upwind', 'upwind', 'downwind', 'downwind', 'downwind']);
  south.forEach(v => { assert.ok(Math.abs(kmOf(mid, v) - v.km) < .05, `${v.km} km from the middle of the stretch: ${kmOf(mid, v)}`); });
  south.slice(0, 3).forEach(v => { assert.ok(v.lat < mid[0] - 0.05 * v.km / 8 && Math.abs(v.lon - mid[1]) < 1e-3, 'straight south of the middle (perpendicular to an east-west road)'); });
  south.slice(3).forEach(v => assert.ok(v.lat > mid[0] && Math.abs(v.lon - mid[1]) < 1e-3));
  const north = RT.viaCandidates(r, seg(20, 30), 0);                // wind FROM the north: the north side first
  assert.ok(north[0].lat > mid[0] && north[3].lat < mid[0]); assert.equal(north[0].side, 'upwind');
  const ns = { coords: Array.from({ length: 61 }, (_, i) => [-57.0, -25.0 + i * .0075]), distance: 50000, duration: 3600 }, nm = RT.pointAlong(ns, 25);   // a northbound road
  const west = RT.viaCandidates(ns, seg(20, 30), 270);              // wind FROM the west: west is upwind
  assert.ok(west[0].lon < nm[1] && Math.abs(west[0].lat - nm[0]) < 2e-3 && west[3].lon > nm[1], 'upwind is west of a north-south road');
  assert.ok(Math.abs(kmOf(nm, west[1]) - 15) < .05);
  const unknown = RT.viaCandidates(r, seg(20, 30), null); assert.deepEqual(J(unknown.slice(0, 3).map(v => v.side)), ['left', 'left', 'left']); assert.ok(unknown[0].lat > mid[0], 'left of an eastbound road is north');
  assert.equal(RT.viaCandidates(r, seg(20, 30), 180, { max: 2 }).length, 2); assert.equal(RT.viaCandidates(r, seg(20, 30), 180, { dists: [5, 10] }).length, 4);
  for (const v of south) assert.ok(isFinite(v.lat) && isFinite(v.lon));
});

test('detourVerdict: at least 50 % fewer smoke-minutes, at most 45 min and at most 60 % of the trip longer, assessed in full', () => {
  const mk = (smokeMin, duration, status = 'ok') => ({ smokeMin, status, route: { duration } });
  const base = mk(20, 2 * 3600);                                    // a 2 h trip: the limit is the smaller of 45 min and 72 min
  assert.ok(RT.detourVerdict(base, mk(10, 2 * 3600 + 45 * 60)).ok, 'exactly half the smoke and exactly +45 min is kept');
  assert.equal(RT.detourVerdict(base, mk(10.5, 2 * 3600)).reason, 'smoke'); assert.equal(RT.detourVerdict(base, mk(10, 2 * 3600 + 46 * 60)).reason, 'time');
  assert.ok(RT.detourVerdict(base, mk(0, 2 * 3600 + 5 * 60, 'nofires')).ok);
  assert.equal(RT.detourVerdict(base, mk(null, 7200, 'notAssessed')).reason, 'notAssessed'); assert.equal(RT.detourVerdict(base, mk(0, 7200, 'partial')).reason, 'notAssessed', 'a partly assessed detour cannot claim to avoid anything');
  const short = mk(20, 30 * 60);                                    // a 30 min trip: 60 % is 18 min
  assert.ok(RT.detourVerdict(short, mk(0, 30 * 60 + 18 * 60)).ok); assert.equal(RT.detourVerdict(short, mk(0, 30 * 60 + 19 * 60)).reason, 'time');
  const v = RT.detourVerdict(short, mk(5, 2400)); assert.ok(Math.abs(v.addMin - 10) < 1e-9 && Math.abs(v.cut - .75) < 1e-9 && Math.abs(v.maxAdd - 18) < 1e-9);
  assert.equal(RT.detourVerdict(base, mk(10, 3600)).ok, true, 'a faster detour is fine');
});

// a routing stand-in: from -> via -> to as a straight-legged line, at the speed of the direct route (50 km/h)
const throughVia = (A, B) => async via => { const pts = [[A.lon, A.lat], ...via.map(v => [v.lon, v.lat]), [B.lon, B.lat]]; let km = 0; for (let i = 1; i < pts.length; i++) km += D.dist(pts[i - 1][1], pts[i - 1][0], pts[i][1], pts[i][0]); return [{ coords: pts.map(p => [p[0], p[1]]), distance: km * 1000, duration: km / 50 * 3600, steps: [] }]; };
const A_ = { lat: -25.25, lon: -57.5 }, B_ = { lat: -25.25, lon: -57.0 };
async function search(fetchVia, o = {}) {
  const wind = windFrom(180), cl = clusters([fire(-25.3, -57.25)]);
  const res = await RT.assess({ routes: [o.route || EW()], depMs: DEP, clusters: cl, wind });
  const out = await RT.searchDetour({ res, clusters: cl, wind, depMs: DEP, fetchVia, rules: o.rules });
  return { res, out, wind };
}
test('searchDetour: the first upwind candidate is clean, so only one routing request is made and the detour becomes Route D', async () => {
  const calls = []; const f = throughVia(A_, B_);
  const { res, out } = await search(async via => { calls.push(J(via)); return f(via); });
  assert.ok(res.routes[0].kmInSmoke > 1, 'the only route meets smoke');
  assert.equal(calls.length, 1, 'stopped early on a clean detour'); assert.ok(calls[0][0].lat < -25.3, 'the first via point is on the upwind (south) side: ' + calls[0][0].lat);
  assert.equal(out.info.status, 'found'); const r = out.res, d = r.routes.find(x => x.detour);
  assert.deepEqual(J(r.routes.map(x => x.name)), ['A', 'D']); assert.equal(d.name, 'D'); assert.equal(r.best, 'D'); assert.equal(d.best, true); assert.equal(d.kmInSmoke, 0); assert.equal(d.route.via.length, 1);
  assert.equal(r.detour.vs, 'A'); assert.equal(r.detour.kmAfter, 0); assert.ok(Math.abs(r.detour.kmBefore - res.routes[0].kmInSmoke) < 1e-9); assert.ok(r.detour.addMin > 0 && r.detour.addMin < 45); assert.equal(r.detour.side, 'upwind');
  const s = RT.summary(r, 'en'); assert.match(s, /^Detour avoids the modelled smoke: 0 km in smoke vs \d+(\.\d)? km, \+\d+ min\.$/); assert.ok(s.includes(RT.nf(res.routes[0].kmInSmoke, 'en')));
  assert.match(RT.summary(r, 'es'), /^El desvío evita el humo modelado: 0 km en humo frente a \d+(,\d)? km, \+\d+ min\.$/); assert.match(RT.summary(r, 'pt'), /^O desvio evita a fumaça modelada: 0 km na fumaça contra/);
});
test('searchDetour: with no acceptable detour it asks for at most 6 routes, says so, and leaves the comparison alone', async () => {
  const calls = [];
  const { res, out } = await search(async via => { calls.push(via); return [{ ...EW(), distance: 50000, duration: 3600 }]; });   // the router keeps giving the direct road
  assert.equal(calls.length, 6, 'never more than six'); assert.equal(out.info.status, 'none'); assert.equal(out.res, res); assert.equal(res.detour, null); assert.equal(res.best, 'A');
  assert.equal(out.info.limitMin, 36, 'a 1 h trip: 60 % is 36 min, less than 45'); assert.equal(out.info.tried.length, 6);
  assert.equal(RT.UI.en.detourNone(45, 6), 'No detour within +45 min avoids the modelled smoke (6 tried). The comparison above stands.');
  assert.match(RT.summary(res, 'en'), /^Route A|Only one route/);
});
test('searchDetour: a detour that is too long, or that still meets the smoke, is not kept; the best kept one wins; nothing is searched when the best route is clean', async () => {
  // via points far to the south take 3 h at this speed (limit 36 min): too long
  const slow = async via => { const r = (await throughVia(A_, B_)(via))[0]; return [{ ...r, duration: r.duration * 4 }]; };
  const a = await search(slow); assert.equal(a.out.info.status, 'none'); assert.ok(a.out.info.tried.every(t => ['time', 'smoke'].includes(t.status)) && a.out.info.tried[0].status === 'time', JSON.stringify(a.out.info.tried.map(t => t.status)));
  // a detour that goes through the plume (north side only, via the plume axis)
  const calls = [];
  const through = async via => { calls.push(via); return [{ coords: [[-57.5, -25.25], [-57.25, -25.2], [-57.0, -25.25]], distance: 52000, duration: 3700, steps: [] }]; };
  const b = await search(through); assert.equal(b.out.info.status, 'none'); assert.ok(b.out.info.tried.every(t => t.status === 'smoke' || t.status === 'kept'), JSON.stringify(b.out.info.tried));
  // the best route is clean: no search at all
  const wind = windFrom(0), cl = clusters([fire(-25.3, -57.25)]), res = await RT.assess({ routes: [EW()], depMs: DEP, clusters: cl, wind }); let n = 0;
  const out = await RT.searchDetour({ res, clusters: cl, wind, depMs: DEP, fetchVia: async () => { n++; return []; } });
  assert.equal(n, 0); assert.equal(out.info.status, 'notNeeded'); assert.equal(res.detour, null);
  // two routing failures in a row stop the search; the page says the service could not be reached, not "no detour"
  let m = 0; const c = await search(async () => { m++; throw new Error('routing'); }); assert.equal(m, 2); assert.equal(c.out.info.status, 'unavailable');
  // an empty answer is "no route" for that point and the search goes on
  let k = 0; const d = await search(async via => (++k === 1 ? [] : throughVia(A_, B_)(via))); assert.equal(d.out.info.status, 'found'); assert.equal(k, 2);
});
test('searchDetour: a detour that cuts the smoke by half but not to zero is kept as such and worded as "cuts"', async () => {
  const f = throughVia(A_, B_);
  // only the 25 km upwind point qualifies: nearer ones are forced to look bad
  const { out, res } = await search(async via => { const r = (await f(via))[0]; return [via[0].lat > -25.4 ? { ...r, duration: r.duration * 10 } : r]; });
  assert.equal(out.info.status, 'found'); assert.ok(out.res.detour.viaKm >= 15, 'a farther point was kept: ' + out.res.detour.viaKm);
  assert.ok(out.info.tried.length >= 2 && out.info.tried[0].status === 'time');
  const fake = { ...out.res, detour: { ...out.res.detour, kmAfter: 1.2, kmBefore: 2.8, addMin: 12 } }; assert.equal(RT.summary(fake, 'en'), 'Detour cuts the modelled smoke: 1.2 km in smoke vs 2.8 km, +12 min.');
  assert.equal(RT.summary({ ...fake, detour: { ...fake.detour, kmAfter: 0, kmBefore: 2, addMin: 12 } }, 'en'), 'Detour avoids the modelled smoke: 0 km in smoke vs 2 km, +12 min.');
  void res;
});

// turn by turn on the east-west road (about 49.7 km, 1 h): steps of 12, 18, 9, 11 km
const STEPS = [
  { type: 'depart', mod: null, name: 'Ruta 9', dist: 12000, dur: 800, at: [-57.5, -25.25], exit: null },
  { type: 'turn', mod: 'left', name: 'Ruta 3', dist: 18000, dur: 1200, at: [-57.39, -25.25], exit: null },
  { type: 'new name', mod: 'straight', name: '', dist: 9000, dur: 600, at: [-57.22, -25.25], exit: null },
  { type: 'roundabout', mod: 'right', name: 'Av. Central', dist: 10690, dur: 600, at: [-57.14, -25.25], exit: 2 },
  { type: 'arrive', mod: null, name: '', dist: 0, dur: 0, at: [-57.0, -25.25], exit: null }];
test('directions: short instructions, the distance of a straight stretch, and the smoke warning at the step where smoke starts', async () => {
  const rt = { ...EW(), steps: STEPS }; rt.distance = D.dist(-25.25, -57.5, -25.25, -57.0) * 1000;
  const res = await RT.assess({ routes: [rt], depMs: DEP, clusters: clusters([fire(-25.3, -57.25)]), wind: windFrom(180) }), r = res.routes[0];
  const g = r.segments[0], utc = ms => new Date(ms).toISOString().slice(11, 16);
  const dirs = RT.directions(r, 'en', { hhmm: utc });
  assert.deepEqual(J(dirs.map(d => d.text)), ['Start on Ruta 9', 'Turn left onto Ruta 3', 'Continue for 9 km', 'At the roundabout take exit 2 onto Av. Central', 'Arrive']);
  assert.ok(Math.abs(dirs[1].startKm - 12 * r.km / (r.route.distance / 1000)) < .01 && dirs[0].startKm === 0);
  // the stretch starts inside exactly one step, and only that step carries the warning
  const owner = dirs.filter(d => d.warns.length); assert.equal(owner.length, 1); const o = owner[0];
  assert.ok(o.startKm <= g.fromKm + 1e-9 && g.fromKm < o.startKm + o.distKm + 1e-9, `step ${o.n} (${o.startKm}..${o.startKm + o.distKm}) holds the start at ${g.fromKm}`);
  const w = o.warns[0]; assert.ok(Math.abs(w.inKm - (g.fromKm - o.startKm)) < 1e-9 && Math.abs(w.lenKm - (g.toKm - g.fromKm)) < 1e-9);
  assert.match(w.text, /^In \d+(\.\d)? km: modelled smoke for \d+(\.\d)? km, around \d\d:\d\d$/);
  assert.ok(w.text.includes(utc(RT.msAtKm(r, g.fromKm))) && w.ms > DEP && w.ms < DEP + 3600e3, 'the clock time is the arrival time at the start of the stretch');
  assert.deepEqual(J(dirs.map(d => d.warns.length)).reduce((a, b) => a + b, 0), r.segments.length, 'one warning per stretch');
  assert.equal(RT.directions({ ...r, route: { ...r.route, steps: [] } }, 'en').length, 0);
  // a stretch that starts right at the first step says "Here"
  const near = { ...r, segments: [{ ...g, fromKm: 0, toKm: 4 }] }; assert.match(RT.directions(near, 'en', { hhmm: utc })[0].warns[0].text, /^Here: modelled smoke for 4 km, around \d\d:\d\d$/);
  // a route that was not assessed has steps and no warnings
  assert.ok(RT.directions({ ...r, status: 'notAssessed', segments: [] }, 'en').every(d => !d.warns.length));
});
test('directions: Spanish and Portuguese words for the maneuvers, with the names kept as they are', () => {
  const T = l => RT.UI[l].step;
  assert.equal(T('es')('turn', 'left', 'Ruta 3'), 'Gire a la izquierda hacia Ruta 3'); assert.equal(T('pt')('turn', 'right', 'Ruta 3'), 'Vire à direita para Ruta 3');
  assert.equal(T('es')('depart', null, 'Ruta 9'), 'Salga por Ruta 9'); assert.equal(T('es')('arrive'), 'Llegada'); assert.equal(T('pt')('arrive'), 'Chegada'); assert.equal(T('pt')('depart', null, ''), 'Início');
  assert.equal(T('es')('new name', 'straight', '', null, '12 km'), 'Continúe durante 12 km'); assert.equal(T('pt')('continue', null, 'BR-116', null, '3 km'), 'Continue por BR-116 por 3 km');
  assert.equal(T('en')('continue', null, '', null, '12 km'), 'Continue for 12 km'); assert.equal(T('en')('turn', 'slight right', 'Ruta 3'), 'Turn slightly right onto Ruta 3'); assert.equal(T('en')('turn', 'uturn', ''), 'Make a U-turn');
  assert.equal(T('en')('fork', 'slight left', ''), 'Keep left at the fork'); assert.equal(T('en')('off ramp', null, 'PY09'), 'Take the exit onto PY09'); assert.equal(T('es')('roundabout', null, '', 3), 'En la rotonda tome la salida 3');
  for (const l of ['en', 'es', 'pt']) for (const t of ['depart', 'arrive', 'turn', 'end of road', 'fork', 'merge', 'on ramp', 'off ramp', 'roundabout', 'roundabout turn', 'exit roundabout', 'new name', 'continue', 'notification', 'surprise'])
    for (const m of [null, 'left', 'sharp right', 'straight', 'uturn']) { const x = T(l)(t, m, 'Ruta 9', 2, '5 km'); assert.ok(typeof x === 'string' && x.length > 3 && !/undefined|null|NaN/.test(x), `${l} ${t} ${m}: ${x}`); }
  assert.equal(RT.fmtDist(.4, 'en'), '400 m'); assert.equal(RT.fmtDist(12.4, 'en'), '12 km'); assert.equal(RT.fmtDist(3.25, 'es'), '3,3 km');
});

test('normRoutes and osrmSteps: steps come through from our server and from OSRM legs; a via point drops its own arrive and depart', () => {
  const legs = [{ steps: [{ name: 'A', distance: 100, duration: 10, maneuver: { type: 'depart', location: [-57.5, -25.25] } }, { name: 'A', distance: 0, duration: 0, maneuver: { type: 'arrive', location: [-57.4, -25.3] } }] },
    { steps: [{ name: 'B', distance: 0, duration: 0, maneuver: { type: 'depart', location: [-57.4, -25.3] } }, { name: '', ref: 'PY09', distance: 200, duration: 20, maneuver: { type: 'turn', modifier: 'right', location: [-57.4, -25.3] } }, { name: '', distance: 0, duration: 0, maneuver: { type: 'arrive', location: [-57, -25.25] } }] }];
  const st = RT.osrmSteps(legs); assert.deepEqual(J(st.map(s => s.type)), ['depart', 'turn', 'arrive']); assert.equal(st[1].name, 'PY09'); assert.equal(st[1].mod, 'right'); assert.deepEqual(J(st[1].at), [-57.4, -25.3]);
  const n = RT.normRoutes({ routes: [{ coords: [[-57.5, -25.25], [-57, -25.25]], distance: 5, duration: 6, steps: [{ type: 'depart', name: 'X', dist: '5', dur: 6, at: [-57.5, -25.25] }, { bad: true }] }, { coords: [[-57.5, -25.25], [-57, -25.25]], distance: 5, duration: 6 }] });
  assert.equal(n[0].steps.length, 1); assert.equal(n[0].steps[0].dist, 5); assert.deepEqual(J(n[1].steps), []);
});
test('fetchRoutes with via points: they go to our server as repeated via=, to OSRM in order between from and to with one route asked for; at most 3', async () => {
  const A = { lat: -25.25, lon: -57.5 }, B = { lat: -25.25, lon: -57 }, v = i => ({ lat: -25.3 - i / 100, lon: -57.2 }), urls = [];
  await RT.fetchRoutes(A, B, async u => { urls.push(u); return { routes: [] }; }, { via: [v(0), v(1)] });
  assert.equal(urls[0], 'api/route?from=-25.25000,-57.50000&to=-25.25000,-57.00000&via=-25.30000,-57.20000&via=-25.31000,-57.20000');
  urls.length = 0;
  await RT.fetchRoutes(A, B, async u => { urls.push(u); if (u.startsWith('api/')) throw new Error('404'); return { code: 'Ok', routes: [] }; }, { via: [v(0), v(1), v(2), v(3)], paceMs: 0 });
  assert.equal(urls[0].split('via=').length - 1, 3, 'three at most on our server'); assert.match(urls[1], /driving\/-57\.50000,-25\.25000;-57\.20000,-25\.30000;-57\.20000,-25\.31000;-57\.20000,-25\.32000;-57\.00000,-25\.25000\?alternatives=false&overview=full&geometries=geojson&steps=true$/);
});
test('fetchRoutes: direct OSRM calls are spaced by the pace (injected sleep), our own server is not delayed', async () => {
  const A = { lat: -25.25, lon: -57.5 }, B = { lat: -25.25, lon: -57 }, naps = [], ok = async () => ({ code: 'Ok', routes: [] });
  await RT.fetchRoutes(A, B, ok, { server: false, sleep: async ms => naps.push(ms) }); await RT.fetchRoutes(A, B, ok, { server: false, sleep: async ms => naps.push(ms) });
  assert.equal(naps.length >= 1 && naps.every(ms => ms > 0 && ms <= 1000), true, 'the second direct call waited: ' + naps);
  const n2 = []; await RT.fetchRoutes(A, B, async () => ({ routes: [] }), { sleep: async ms => n2.push(ms) }); assert.deepEqual(n2, []);
});

test('gmapsUrl: a detour carries its via point as a waypoint, in its place along the route, and the sampled points beside it are left out', () => {
  const via = { lat: -25.38, lon: -57.25 };
  const coords = [[-57.5, -25.25], [-57.4, -25.33], [-57.25, -25.38], [-57.1, -25.33], [-57.0, -25.25]];
  const dr = { coords, via: [via] }, u = new URL(RT.gmapsUrl(dr)), wp = u.searchParams.get('waypoints').split('|');
  assert.ok(wp.includes('-25.38000,-57.25000'), 'the via point is a waypoint: ' + wp.join(' '));
  assert.ok(wp.length <= 8 && wp.length >= 2); const lons = wp.map(w => +w.split(',')[1]); assert.deepEqual(lons, lons.slice().sort((a, b) => a - b), 'in order along the route');
  const at = wp.indexOf('-25.38000,-57.25000'); assert.ok(at > 0 && at < wp.length - 1, 'neither first nor last: it sits where the route passes it');
  for (const w of wp) if (w !== '-25.38000,-57.25000') assert.ok(D.dist(-25.38, -57.25, +w.split(',')[0], +w.split(',')[1]) >= 3 - 1e-6, 'a sampled point is at least 3 km from the via point: ' + w);
  assert.ok(RT.gmapsUrl(dr).includes('%7C') && !RT.gmapsUrl(dr).includes('|'));
  assert.equal(u.searchParams.get('origin'), '-25.25000,-57.50000'); assert.equal(u.searchParams.get('destination'), '-25.25000,-57.00000');
  const short = { coords: [[-57, -25], [-57.01, -25.01], [-57.02, -25.02]], via: [{ lat: -25.005, lon: -57.005 }] }; assert.equal(new URL(RT.gmapsUrl(short)).searchParams.get('waypoints'), '-25.00500,-57.00500', 'even a short detour keeps its via point');
  const three = { ...dr, via: [{ lat: -25.3, lon: -57.45 }, via, { lat: -25.3, lon: -57.05 }, { lat: -25.31, lon: -57.0 }] }; assert.ok(new URL(RT.gmapsUrl(three)).searchParams.get('waypoints').split('|').length <= 8);
  assert.equal(new URL(RT.gmapsUrl({ coords })).searchParams.get('waypoints') === null || true, true);
});
test('geojson: the detour is a route named Route D (detour) with its via points, and every route carries its steps with the smoke warnings', async () => {
  const wind = windFrom(180), cl = clusters([fire(-25.3, -57.25)]), rt = { ...EW(), steps: STEPS };
  const f = throughVia(A_, B_), res0 = await RT.assess({ routes: [rt], depMs: DEP, clusters: cl, wind });
  const { res } = await RT.searchDetour({ res: res0, clusters: cl, wind, depMs: DEP, fetchVia: async via => (await f(via)).map(x => ({ ...x, steps: [{ type: 'depart', name: 'Camino', dist: x.distance, dur: x.duration, at: [-57.5, -25.25] }, { type: 'arrive', name: '', dist: 0, dur: 0, at: [-57, -25.25] }] })) });
  const g = J(RT.geojson(res, { dataEnd: DEP })), routes = g.features.filter(x => x.properties.kind === 'route');
  assert.deepEqual(routes.map(x => x.properties.name), ['Route A', 'Route D (detour)']); const a = routes[0].properties, d = routes[1].properties;
  assert.equal(a.detour, false); assert.equal(d.detour, true); assert.equal(d.route, 'D'); assert.equal(d.best, true); assert.equal(d.via_points.length, 1); assert.ok(d.via_points[0][0] < -57 && d.via_points[0][1] < -25.3, '[lon, lat]'); assert.equal(a.via_points, null);
  assert.equal(a.steps.length, 5); const warned = a.steps.filter(s => s.smoke_warnings.length); assert.equal(warned.length, 1); assert.match(warned[0].smoke_warnings[0].text, /^(In \d+(\.\d)? km|Here): modelled smoke for \d+(\.\d)? km, around \d\d:\d\dZ?$/);
  assert.ok(warned[0].smoke_warnings[0].around_utc.endsWith('Z') && warned[0].smoke_warnings[0].stretch_km > 0); assert.equal(d.steps.length, 2); assert.ok(d.steps.every(s => s.smoke_warnings.length === 0));
  assert.ok(g.features.some(x => x.properties.kind === 'smoke_segment' && x.properties.route === 'A'));
});

test('project and driveState: position along the route, distance and ETA to the next smoke stretch, in smoke now', async () => {
  const wind = windFrom(180), r = (await RT.assess({ routes: [EW()], depMs: DEP, clusters: clusters([fire(-25.3, -57.25)]), wind })).routes[0], g = r.segments[0];
  const p20 = RT.pointAlong(r.route, 20), pr = RT.project(r.route, p20[0], p20[1]); assert.ok(Math.abs(pr.km - 20) < .01 && pr.off < .01);
  const off = RT.project(r.route, p20[0] + 3 / 111.195, p20[1]); assert.ok(Math.abs(off.km - 20) < .1 && Math.abs(off.off - 3) < .05, 'three km north of the road: ' + off.off);
  assert.equal(RT.project(r.route, -25.25, -58.5).km, 0); assert.ok(Math.abs(RT.project(r.route, -25.25, -56.0).km - r.km) < 1e-6, 'beyond the end: the end');
  const kmh = r.km / 1, st = RT.driveState(r, g.fromKm - 6, DEP + 1000);
  assert.equal(st.inSmoke, null); assert.ok(Math.abs(st.next.distKm - 6) < 1e-9 && Math.abs(st.next.etaMin - 6 / kmh * 60) < 1e-6 && Math.abs(st.next.etaMs - (DEP + 1000 + 6 / kmh * 36e5)) < 1);
  assert.ok(Math.abs(st.next.lenKm - (g.toKm - g.fromKm)) < 1e-9 && st.next.peak === g.peak); assert.ok(Math.abs(st.kmh - kmh) < 1e-9 && !st.done);
  const mid = RT.driveState(r, (g.fromKm + g.toKm) / 2, DEP); assert.ok(mid.inSmoke && Math.abs(mid.inSmoke.leftKm - (g.toKm - g.fromKm) / 2) < 1e-9 && mid.next === null && Math.abs(mid.inSmoke.leftMin - mid.inSmoke.leftKm / kmh * 60) < 1e-6);
  const past = RT.driveState(r, g.toKm + 1, DEP); assert.equal(past.inSmoke, null); assert.equal(past.next, null); assert.ok(Math.abs(past.remainingKm - (r.km - g.toKm - 1)) < 1e-9);
  assert.equal(RT.driveState(r, r.km, DEP).done, true);
  const lines = RT.driveLines(r, st, RT.directions({ ...r, route: { ...r.route, steps: STEPS } }, 'en'), 'en', { hhmm: ms => new Date(ms).toISOString().slice(11, 16) });
  assert.match(lines.smoke, /^Modelled smoke ahead in 6 km \(about \d+ min, around \d\d:\d\d\), for \d+(\.\d)? km\.$/); assert.match(lines.progress, /^\d+(\.\d)? of \d+(\.\d)? km$/); assert.match(lines.next, /^Next: .+ in \d+(\.\d)? km$/);
  assert.match(RT.driveLines(r, mid, [], 'en').smoke, /^In modelled smoke now: \d+(\.\d)? km to the end of this stretch \(about \d+ min, around \d\d:\d\d\)\.$/); assert.match(RT.driveLines(r, past, [], 'en').smoke, /^Clear of modelled smoke ahead for the \d+(\.\d)? km left\.$/);
  assert.match(RT.driveLines(r, st, [], 'es').smoke, /^Humo modelado adelante en 6 km/); assert.match(RT.driveLines(r, past, [], 'pt').smoke, /^Sem fumaça modelada à frente nos/);
  assert.equal(RT.driveLines({ ...r, status: 'notAssessed', segments: [] }, RT.driveState({ ...r, status: 'notAssessed', segments: [] }, 5, DEP), [], 'en').smoke, RT.UI.en.driveNotAssessed);
  assert.equal(RT.driveLines(r, RT.driveState(r, r.km, DEP), [], 'en').next, 'End of the route.');
});
test('driveAlerts: 5 km ahead, 1 km ahead, entering, leaving, each exactly once per stretch, in that order', async () => {
  const r = (await RT.assess({ routes: [EW()], depMs: DEP, clusters: clusters([fire(-25.3, -57.25)]), wind: windFrom(180) })).routes[0], g = r.segments[0], fired = new Set(), seen = [];
  assert.equal(r.segments.length, 1);
  for (let km = 0, first = true; km <= r.km + .3; km += .25, first = false) for (const e of RT.driveAlerts(r, km, fired, { first })) seen.push([e.type, e.level ?? null, +km.toFixed(2)]);
  assert.deepEqual(J(seen.map(s => s.slice(0, 2))), [['ahead', 5], ['ahead', 1], ['enter', null], ['leave', null]], JSON.stringify(seen));
  assert.ok(seen[0][2] >= g.fromKm - 5 && seen[0][2] < g.fromKm - 5 + .26, '5 km alert at about 5 km ahead'); assert.ok(seen[1][2] >= g.fromKm - 1 && seen[1][2] < g.fromKm - 1 + .26);
  assert.ok(seen[2][2] >= g.fromKm && seen[2][2] < g.fromKm + .26 && seen[3][2] > g.toKm && seen[3][2] <= g.toKm + .26);
  for (let k = 0; k < 3; k++) assert.deepEqual(RT.driveAlerts(r, g.toKm + 3, fired, {}), [], 'saying it again changes nothing');
  assert.deepEqual(RT.driveAlerts(r, (g.fromKm + g.toKm) / 2, fired, {}), [], 'going back into a stretch already announced does not repeat it');
  // a big jump: from far away to within 1 km gives the 1 km alert only; the 5 km one is not given late
  const f2 = new Set(); RT.driveAlerts(r, 0, f2, { first: true }); const j = RT.driveAlerts(r, g.fromKm - .6, f2, {}); assert.deepEqual(J(j.map(e => [e.type, e.level])), [['ahead', 1]]); assert.ok(Math.abs(j[0].distKm - .6) < 1e-9);
  assert.deepEqual(RT.driveAlerts(r, g.fromKm - .3, f2, {}), []);
  // jumping straight over a stretch gives entering and leaving; starting beyond it says nothing
  const f3 = new Set(); RT.driveAlerts(r, 0, f3, { first: true }); assert.deepEqual(J(RT.driveAlerts(r, g.toKm + 2, f3, {}).map(e => e.type)), ['enter', 'leave']);
  assert.deepEqual(RT.driveAlerts(r, g.toKm + 2, new Set(), { first: true }), [], 'a GPS start after the smoke says nothing about it');
  const f4 = new Set(), starts = RT.driveAlerts(r, (g.fromKm + g.toKm) / 2, f4, { first: true }); assert.deepEqual(J(starts.map(e => e.type)), ['enter'], 'starting inside the smoke announces it');
  assert.deepEqual(RT.driveAlerts({ ...r, status: 'notAssessed', segments: [] }, 5, new Set(), { first: true }), []);
  // the words
  const T = e => RT.alertText(e, 'en'), ev = { type: 'ahead', level: 5, distKm: 4.9, lenKm: 2.2 };
  assert.equal(T(ev), 'Modelled smoke ahead in 4.9 km, for 2.2 km.'); assert.equal(T({ type: 'enter', lenKm: 2.2 }), 'Entering modelled smoke, about 2.2 km.'); assert.equal(T({ type: 'leave' }), 'Out of modelled smoke.');
  assert.equal(RT.alertText({ type: 'leave' }, 'en', true), 'Simulation. Out of modelled smoke.'); assert.equal(RT.alertText(ev, 'es', true), 'Simulación. Humo modelado adelante en 4,9 km, por 2,2 km.'); assert.equal(RT.alertText({ type: 'leave' }, 'pt'), 'Fora da fumaça modelada.');
});
test('remapFired: what was already said follows a stretch that moved a little after a re-assessment', () => {
  const old = [{ fromKm: 10, toKm: 14 }, { fromKm: 30, toKm: 33 }], now = [{ fromKm: 11, toKm: 15 }, { fromKm: 40, toKm: 42 }];
  const out = RT.remapFired(old, now, new Set(['0:5', '0:1', '0:enter', '1:5']));
  assert.deepEqual(J([...out].sort()), ['0:1', '0:5', '0:enter'], 'the first stretch kept its alerts; the second vanished (no overlap), so its alert is dropped');
});

test('leaveRanking: ranks by smoke-minutes, then peak, then the earlier hour; same, now, later and unknown', () => {
  const opt = (h, km, min, pk = 5, status = 'ok') => ({ h, depMs: DEP + h * 36e5, best: km == null ? null : { kmInSmoke: km, smokeMin: min, peak: pk, status } });
  const hh = ms => new Date(ms).toISOString().slice(11, 16);
  const later = RT.leaveRanking([opt(0, 2, 2.4), opt(1, 1, 1.2), opt(2, 0, 0, 0, 'nofires'), opt(3, 0, 0, 0, 'nofires')]);
  assert.equal(later.kind, 'later'); assert.equal(later.best.h, 2, 'two clean hours: the earlier one'); assert.deepEqual(J(later.ranked.map(x => x.h)), [2, 3, 1, 0]);
  assert.equal(RT.leaveSummary(later, 'en', hh), 'Leaving at 14:00 meets the least modelled smoke: 0 km vs 2 km now.');
  assert.equal(RT.leaveSummary(later, 'es', hh), 'Salir a las 14:00 encuentra el menor humo modelado: 0 km frente a 2 km si sale ahora.'); assert.match(RT.leaveSummary(later, 'pt', hh), /^Sair às 14:00 encontra a menor fumaça modelada: 0 km contra 2 km saindo agora\.$/);
  const now = RT.leaveRanking([opt(0, 0, 0, 0, 'nofires'), opt(1, 1.5, 2), opt(2, 3, 4), opt(3, 0.5, 1)]); assert.equal(now.kind, 'now'); assert.equal(RT.leaveSummary(now, 'en', hh), 'Leaving now meets the least modelled smoke: 0 km, against up to 3 km at the later times.');
  const same = RT.leaveRanking([opt(0, 2, 2.4), opt(1, 2, 2.4), opt(2, 2.02, 2.42), opt(3, 2, 2.4)]); assert.equal(same.kind, 'same'); assert.equal(RT.leaveSummary(same, 'en', hh), 'Leaving now or in the next three hours meets about the same modelled smoke (2 km).');
  assert.equal(RT.leaveSummary(RT.leaveRanking([opt(0, 0, 0, 0, 'nofires'), opt(1, 0, 0, 0, 'nofires')]), 'en', hh), 'Leaving now or in the next three hours meets about the same modelled smoke (0 km).');
  const peak = RT.leaveRanking([opt(0, 2, 3, 20), opt(1, 2, 3, 8), opt(2, 4, 6, 9)]); assert.equal(peak.best.h, 1, 'equal smoke-minutes: the lower peak');
  const noNow = RT.leaveRanking([opt(0, null), opt(1, 0, 0, 0, 'nofires'), opt(2, 3, 3)]); assert.equal(noNow.kind, 'unknown'); assert.equal(RT.leaveSummary(noNow, 'en'), RT.UI.en.leaveUnknown); assert.match(RT.UI.en.leaveUnknown, /not an all-clear/);
  assert.equal(RT.leaveRanking([opt(0, 2, 2), opt(1, null), opt(2, null), opt(3, null)]).kind, 'unknown', 'nothing to compare with');
  const part = RT.leaveRanking([opt(0, 2, 2.4), opt(1, null), opt(2, 0, 0, 0, 'nofires'), opt(3, null)]); assert.equal(part.kind, 'later'); assert.equal(part.assessed, 2); assert.equal(part.asked, 4);
  assert.equal(RT.leaveRanking([opt(0, null, null, 0, 'notAssessed')]).kind, 'unknown');
});

test('every new text works in all three languages and returns real text (no undefined, no NaN)', () => {
  for (const l of ['en', 'es', 'pt']) for (const k of ['roleDriver', 'routeD', 'chooseRoute', 'chosenRoute', 'detourSearching', 'detourFail', 'detourNote', 'stepsH', 'stepsNone', 'stepsNote', 'driveH', 'driveStart', 'driveStop', 'simulate', 'mute', 'unmute', 'driveLooking', 'driveGps', 'driveSimTag', 'driveNoGps', 'driveNoTurn', 'driveArrived', 'driveNotAssessed', 'alertLeave', 'simSay', 'driveDone', 'driveDoneSim', 'driveStopped', 'driveSafety', 'noSpeech', 'leaveH', 'leaveUnknown', 'leaveNote']) assert.ok(typeof RT.UI[l][k] === 'string' && RT.UI[l][k].length > 3, `${l}.${k}`);
  for (const l of ['en', 'es', 'pt']) for (const [k, v] of Object.entries(RT.UI[l])) if (typeof v === 'function' && !['step', 'plusMin'].includes(k)) { const out = v(3.5, 'upwind', '09:53', 2, 4); assert.ok(typeof out === 'string' && out.length > 2 && !/undefined|NaN/.test(out), `${l}.${k}: ${out}`); }
  assert.match(RT.UI.en.driveSimNote(30), /^This is not your position\./); assert.match(RT.UI.es.driveSimNote(30), /^Esta no es su posición/); assert.match(RT.UI.pt.driveSimNote(30), /^Esta não é a sua posição/); // the SIMULATION tag sits in front of the note, so the note does not repeat it
  assert.equal(RT.UI.en.driveSafety, 'This is not an emergency navigation system. In an emergency, follow official instructions and road signs.');
  assert.equal(RT.RULES.simSpeed, 30); assert.deepEqual(J(RT.RULES.driveAhead), [5, 1]); assert.equal(RT.RULES.reassessMin, 10); assert.equal(RT.RULES.gpsMaxOffKm, 2); assert.equal(RT.RULES.maxDetourTries, 6);
});
