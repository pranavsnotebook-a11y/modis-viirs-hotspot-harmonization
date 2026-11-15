// ROLEDATA: place and site search, the fire-brigade list, the single-place answer. Offline fixtures, injected wind.
import test from 'node:test';
import assert from 'node:assert/strict';
import { load, regions, J, constantWind } from './load.mjs';
load('regions', 'firelab-core', 'downwind-core', 'fast-core', 'watch-core', 'bulletin-core', 'place', 'role-core');
const W = globalThis.WATCH, RD = globalThis.ROLEDATA, PL = globalThis.PLACE, RG = globalThis.REGIONS; RG.load(regions()); PL.setRegion(RG.get('PY'));
const END = Date.parse('2026-11-13T12:00:00Z'), iso = ms => new Date(ms).toISOString().slice(0, 16) + 'Z';
const mk = (id, lat, lon, frp, back = 0) => ({ id, lat, lon, frp, ms: END - back * 36e5, time: iso(END - back * 36e5), sat: 'S-NPP' });

test('norm and searchPlaces: accents and case ignored, starts-with first, at least two letters', () => {
  assert.equal(RD.norm('Asunción'), 'asuncion');
  const list = [['San Lorenzo', -25.3, -57.5], ['Lorenzo', -25, -57], ['Encarnación', -27.3, -55.8], ['Asunción', -25.28, -57.63]];
  assert.deepEqual(J(RD.searchPlaces(list, 'lorenzo').map(h => h.name)), ['Lorenzo', 'San Lorenzo']);
  assert.deepEqual(J(RD.searchPlaces(list, 'ASUNC').map(h => [h.name, h.lat, h.lon])), [['Asunción', -25.28, -57.63]]);
  assert.deepEqual(RD.searchPlaces(list, 'a'), []); assert.deepEqual(RD.searchPlaces(null, 'abc'), []);
  assert.equal(RD.searchPlaces(list, 'e', 1).length, 0); assert.equal(RD.searchPlaces(list, 'en', 1).length, 1);
});
test('searchSites: clinics and schools with a name from the asset file, then towns; a layer that was not built is not searched', () => {
  const P = W.prepAssets({ layers: { power: { built: true }, roads: { built: true }, health: { built: true }, schools: { built: false } }, power: [], roads: [], health: [{ id: 'h1', name: 'Hospital Central', kind: 'hospital', lat: -25.3, lon: -57.6 }, { id: 'h2', name: '', kind: 'clinic', lat: -25.4, lon: -57.6 }], schools: [{ id: 's1', name: 'Escuela Central', lat: -25.3, lon: -57.7 }], places: [] });
  const feed = { places: [['Central', -25, -57]] };
  const hits = RD.searchSites(P, feed, 'central');
  assert.deepEqual(J(hits.map(h => [h.name, h.kind])), [['Central', 'place'], ['Hospital Central', 'health']].sort((a, b) => a[0].length - b[0].length));
  assert.ok(!hits.some(h => h.kind === 'schools'), 'schools not built for this fixture');
});
test('recentFires: only the last N hours of data, never after the end', () => {
  const f = [mk('a', 0, 0, 1, 1), mk('b', 0, 0, 1, 30), { ...mk('c', 0, 0, 1), ms: END + 1 }];
  assert.deepEqual(J(RD.recentFires(f, END, 24).map(x => x.id)), ['a']);
});
const assets = () => W.prepAssets({ layers: { power: { built: true }, roads: { built: true }, health: { built: true }, schools: { built: false } },
  power: [{ id: 1, kv: 500, pts: [[-24.955, -57.2], [-24.955, -56.8]] }], roads: [], health: [{ id: 'n1', name: 'Clinic North', kind: 'clinic', lat: -24.96, lon: -57 }], schools: [], places: [] });
const cfg = { engine: 'fires', radiusKm: 50, hours: 24, max: 12 };
test('fireItems: fires within 50 km, strongest first, wind and heading per fire, assets in the modelled path; schools reported as not loaded', async () => {
  const fires = [mk('weak', -25.2, -57.1, 8), mk('strong', -25, -57, 60), mk('far', -22, -57, 90), mk('old', -25, -57.05, 99, 30)];
  const r = await RD.fireItems({ cfg, base: { name: 'Base', lat: -25.1, lon: -57.1 }, fires, end: END, assets: assets(), wind: W.createWind({ getJSON: constantWind().getJSON }) });
  assert.equal(r.total, 2, 'the fire 330 km away and the fire older than 24 h are not counted'); assert.equal(r.hidden, 0);
  assert.deepEqual(J(r.items.map(i => i.fire.id)), ['strong', 'weak']);
  const s = r.items[0]; assert.equal(s.assessed, true); assert.equal(s.heading, 'north', 'wind from the south: smoke goes north'); assert.equal(s.wx.ws, 3);
  assert.ok(s.km > 10 && s.km < 16); assert.equal(Math.round(s.brg / 45) * 45, 45);
  assert.deepEqual(J(s.rows.map(x => x.kind).sort()), ['health', 'power']); assert.deepEqual(J(r.notBuilt), ['schools']);
  assert.equal(r.items[1].rows.length, 0, 'the weaker fire has nothing in its path, and says so only because wind was assessed');
});
test('fireItems: without wind a fire is listed but not assessed (heading unknown, no assets claimed)', async () => {
  const r = await RD.fireItems({ cfg, base: { name: 'Base', lat: -25.1, lon: -57.1 }, fires: [mk('strong', -25, -57, 60)], end: END, assets: assets(), wind: W.createWind({ getJSON: constantWind({ fail: true }).getJSON }) });
  const i = r.items[0]; assert.equal(i.assessed, false); assert.equal(i.wx, null); assert.equal(i.heading, null); assert.equal(i.rows.length, 0); assert.equal(r.anyUnassessed, true); assert.equal(r.failed, 1);
});
test('fireItems: shows at most cfg.max fires and counts the rest; no fires gives an empty list; works without an asset file', async () => {
  const many = Array.from({ length: 20 }, (_, i) => mk('f' + i, -25.1 + i * .02, -57.1, 10 + i));
  const r = await RD.fireItems({ cfg: { ...cfg, max: 5 }, base: { lat: -25.1, lon: -57.1 }, fires: many, end: END, assets: null, wind: W.createWind({ getJSON: constantWind().getJSON }) });
  assert.equal(r.items.length, 5); assert.equal(r.hidden, r.total - 5); assert.equal(r.items[0].fire.frp >= r.items[4].fire.frp, true); assert.equal(r.notBuilt.length, 4);
  const e = await RD.fireItems({ cfg, base: { lat: -25.1, lon: -57.1 }, fires: [], end: END, assets: assets(), wind: W.createWind({ getJSON: constantWind().getJSON }) });
  assert.equal(e.items.length, 0); assert.equal(e.total, 0);
});
test('watchList: grid-style list from feed fires, last 24 hours, 5 MW and up', async () => {
  const T = END, fires = [mk('a', -25, -57, 20), mk('tiny', -25, -57.3, 2), mk('old', -25, -57.1, 50, 30)];
  const r = await RD.watchList({ cfg: { kind: 'power', hours: 24, minFrp: 5 }, fires, end: T, assets: assets(), wind: W.createWind({ getJSON: constantWind().getJSON }) });
  assert.deepEqual(J(r.res.rows.map(x => x.key)), ['p1']); assert.equal(r.res.small, 1); assert.equal(r.res.fires, 1);
  assert.equal(RD.statusKind(r.res, false), 'clear'); assert.equal(RD.statusKind({ ...r.res, noWind: 1 }, false), 'notAssessed'); assert.equal(RD.statusKind(r.res, true), 'notAssessed'); assert.equal(RD.statusKind({ noAssets: true }, false), 'notAssessed');
});
test('siteAnswer: the same answer My place gives: smoke here, away, none, no wind, outside', async () => {
  const place = { lat: -24.96, lon: -57, name: 'Site' }, fires = [mk('a', -25, -57, 20)];
  const smoke = await RD.siteAnswer(place, fires, END, constantWind().getJSON); assert.equal(smoke.status, 'smoke'); assert.ok(smoke.items[0].conc >= 1);
  const away = await RD.siteAnswer({ ...place, lat: -25.04 }, fires, END, constantWind().getJSON); assert.equal(away.status, 'near');
  const none = await RD.siteAnswer({ ...place, lat: -23 }, fires, END, constantWind().getJSON); assert.equal(none.status, 'none');
  const nw = await RD.siteAnswer(place, fires, END, constantWind({ fail: true }).getJSON); assert.equal(nw.status, 'nowind'); assert.equal(nw.windFailed, true);
  const out = await RD.siteAnswer({ lat: 10, lon: 10 }, fires, END, constantWind().getJSON); assert.equal(out.status, 'outside');
  assert.match(PL.sentence(nw, 'en').full, /it is not known whether smoke is heading here/); assert.match(PL.sentence(none, 'en').full, /No detection does not mean no fire/);
});
