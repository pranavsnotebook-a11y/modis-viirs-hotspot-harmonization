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
  r = await RT.fetchRoutes(A, B, async u => { urls.push(u); if (u.startsWith('api/')) throw new Error('HTTP 404'); return osrm; });
  assert.equal(r.source, 'osrm'); assert.equal(r.routes.length, 2); assert.equal(r.routes[1].duration, 3300); assert.match(urls[1], /^https:\/\/router\.project-osrm\.org\/route\/v1\/driving\/-57\.50000,-25\.25000;-57\.00000,-25\.25000\?alternatives=3&overview=full&geometries=geojson&steps=false$/);
  await assert.rejects(RT.fetchRoutes(A, B, async () => { throw new Error('offline'); }), /routing/);
  r = await RT.fetchRoutes(A, B, async u => u.startsWith('api/') ? { routes: [] } : osrm); assert.equal(r.routes.length, 0, 'the server said there is no route: that is an answer');
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
