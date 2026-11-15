// WATCH: asset prep, wind cache with injected fetch, the watch-list computation, the fast look. Offline, fixed fixtures.
import test from 'node:test';
import assert from 'node:assert/strict';
import { load, J, constantWind } from './load.mjs';
load('firelab-core', 'downwind-core', 'fast-core', 'watch-core');
const W = globalThis.WATCH, D = globalThis.DOWNWIND;

// A fire at (-25,-57), wind from the south at 3 m/s (so the smoke goes north): a line 5 km north is crossed, a line 5 km south is not.
const T = '2025-01-08T17:00Z', END = Date.parse(T);
const fire = { id: 'HS-V0000001', lat: -25, lon: -57, frp: 20, time: T, ms: END, sat: 'S-NPP' };
const assets = () => ({
  layers: { power: { built: true }, roads: { built: true }, health: { built: true }, schools: { built: false, reason: 'not mapped here' } },
  power: [{ id: 1, kv: 500, pts: [[-24.955, -57.2], [-24.955, -56.8]] }, { id: 2, kv: 220, pts: [[-25.03, -57.2], [-25.03, -56.8]] }],
  roads: [{ id: 3, ref: '9', name: 'Ruta 9', pts: [[-24.955, -57.2], [-24.955, -56.8]] }],
  health: [{ id: 'n1', name: 'Clinic North', kind: 'clinic', lat: -24.96, lon: -57 }, { id: 'n2', name: 'Clinic South', kind: 'clinic', lat: -25.04, lon: -57 }, { id: 'n3', name: 'Clinic North', kind: 'clinic', lat: -24.9601, lon: -57.0001 }],
  schools: [], places: [{ name: 'Pueblo', lat: -24.97, lon: -57.01 }],
});
const R5 = () => ({ ...W.rules(), minFrp: 5 });
const live = (P, kind, wind, extra = {}) => W.computeLive({ kind, dets: [fire], assets: P, rules: R5(), wind, range: W.liveRange(END, 24, R5()), live: true, ...extra });

test('layerInfo and kindBuilt: a layer that was not built is not "empty"', () => {
  const P = W.prepAssets(assets());
  assert.equal(W.kindBuilt(P, 'power'), true); assert.equal(W.kindBuilt(P, 'schools'), false); assert.equal(W.kindBuilt(null, 'power'), false);
  assert.deepEqual(J(W.layerInfo({ power: [] }, 'power')), { built: true }); assert.deepEqual(J(W.layerInfo({}, 'power')), { built: false });
});
test('prepAssets: lines split into short pieces, duplicate points within 150 m merged, grid built for every kind', () => {
  const long = { id: 9, kv: 220, pts: Array.from({ length: 60 }, (_, i) => [-25 + i * .001, -57]) };
  const P = W.prepAssets({ ...assets(), power: [long] });
  assert.equal(P.pieces.power.length, 3); assert.ok(P.pieces.power.every(p => p.pts.length <= 25 && p.key === 'p9'));
  assert.equal(P.points.health.length, 2, 'two entries with the same name 15 m apart are one clinic');
  for (const k of W.KIND_LIST) assert.ok(P.grid[k] instanceof Map);
  assert.equal(W.nearAssets(P, 'health', -24.96, -57).size, 2);
});
test('nearPlace: nearest named place within 40 km', () => {
  const P = W.prepAssets(assets());
  assert.equal(W.nearPlace(P, -24.97, -57.0).name, 'Pueblo'); assert.equal(W.nearPlace(P, -20, -50), null);
});
test('wind cache: one request per batch of cells, cached afterwards, storage reused, failures counted', async () => {
  const cw = constantWind(), store = new Map(), storage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  const range = { d0: '2025-01-08', d1: '2025-01-09', old: true };
  const keys = Array.from({ length: 130 }, (_, i) => (-30 + i * .25).toFixed(2) + ',-57.00');
  const w = W.createWind({ getJSON: cw.getJSON, storage });
  assert.equal(await w.fetch(keys, range), 0); assert.equal(cw.calls.length, 3, '130 cells = 3 requests of at most 60');
  assert.ok(cw.calls[0].startsWith('https://archive-api.open-meteo.com/'), 'old data uses the archive');
  assert.equal(await w.fetch(keys, range), 0); assert.equal(cw.calls.length, 3, 'cached');
  const w2 = W.createWind({ getJSON: cw.getJSON, storage }); await w2.fetch(keys.slice(0, 10), range); assert.equal(cw.calls.length, 3, 'a second cache reads storage');
  assert.deepEqual(J(w.at(-30, -57, END, range)).ws, 3);
  const bad = W.createWind({ getJSON: constantWind({ fail: true }).getJSON }); assert.equal(await bad.fetch(keys.slice(0, 5), range), 1);
  assert.equal(bad.has(-30, -57, range), false); assert.equal(bad.at(-30, -57, END, range), null);
});
test('computeLive: the line downwind is listed, the line upwind is "not downwind" only when wind was assessed', async () => {
  const P = W.prepAssets(assets()), cw = constantWind();
  const r = await live(P, 'power', W.createWind({ getJSON: cw.getJSON }));
  assert.deepEqual(J(r.rows.map(x => x.key)), ['p1']);
  const row = r.rows[0]; assert.ok(row.peak > 0 && row.km > 4 && row.km < 6 && row.eta > 0); assert.equal(D.compass(row.bearing + 180), 'south');
  assert.deepEqual(J(r.near.map(x => x.key)), ['p2'], 'the line 3 km south is near but not downwind');
  assert.equal(r.fires, 1); assert.equal(r.small, 0); assert.equal(r.wxErr, null); assert.equal(r.noWind, 0);
});
test('computeLive: points (clinics) are deduplicated and only the downwind one is listed', async () => {
  const r = await live(W.prepAssets(assets()), 'health', W.createWind({ getJSON: constantWind().getJSON }));
  assert.deepEqual(J(r.rows.map(x => x.asset.name)), ['Clinic North']); assert.deepEqual(J(r.near.map(x => x.asset.name)), ['Clinic South']);
});
test('computeLive: the size filter drops small fires and counts them', async () => {
  const r = await W.computeLive({ kind: 'power', dets: [{ ...fire, frp: 2 }], assets: W.prepAssets(assets()), rules: R5(), wind: W.createWind({ getJSON: constantWind().getJSON }), range: W.liveRange(END, 24, R5()), live: true });
  assert.equal(r.rows.length, 0); assert.equal(r.small, 1); assert.equal(r.fires, 0);
});
test('computeLive: no wind means NOT ASSESSED, never "not downwind"', async () => {
  const r = await live(W.prepAssets(assets()), 'power', W.createWind({ getJSON: constantWind({ fail: true }).getJSON }));
  assert.equal(r.rows.length, 0); assert.equal(r.near.length, 0, 'unassessed assets are not listed as near-but-not-downwind');
  assert.equal(r.noWind, 1); assert.match(r.wxErr, /wind is unavailable/i);
});
test('computeLive: kinds that were not built or are empty say so instead of returning an empty list', async () => {
  const P = W.prepAssets(assets()), w = W.createWind({ getJSON: constantWind().getJSON });
  const a = await live(P, 'schools', w); assert.equal(a.noAssets, true); assert.equal(a.notBuilt, true);
  const b = await live(W.prepAssets({ ...assets(), layers: undefined, health: [] }), 'health', w); assert.equal(b.noAssets, true); assert.equal(b.empty, true);
  const c = await live(null, 'power', w); assert.equal(c.noAssets, true); assert.equal(!!c.notBuilt, false);
});
test('computeLive: wind is requested for at most MAX_CELLS areas and the rest is counted as skipped', async () => {
  const dets = Array.from({ length: 300 }, (_, i) => ({ ...fire, id: 'x' + i, lat: -25 + (i % 30) * .3, lon: -57 + Math.floor(i / 30) * .3, frp: 10 + i }));
  const line = { id: 5, kv: 220, pts: [[-30, -62], [-16, -62], [-16, -50], [-30, -50], [-30, -62]] };
  const A = { ...assets(), power: [line] }; A.power[0].pts = Array.from({ length: 200 }, (_, i) => [-30 + i * .08, -57 + Math.sin(i) * 3]);
  const cw = constantWind(), r = await W.computeLive({ kind: 'power', dets, assets: W.prepAssets(A), rules: { ...R5(), reachKm: 2000 }, wind: W.createWind({ getJSON: cw.getJSON }), range: W.liveRange(END, 24, R5()), live: true });
  const cells = cw.calls.reduce((s, u) => s + new URL(u).searchParams.get('latitude').split(',').length, 0);
  assert.ok(cells <= W.MAX_CELLS, 'cells requested: ' + cells); assert.ok(r.skipped > 0 && r.cand <= W.MAX_CELLS * 2, 'the weaker fires beyond the cap are counted as skipped: ' + r.skipped);
});
test('computeLive with a fixed wind (replay): nothing is fetched, hours after the cut-off are ignored', async () => {
  const P = W.prepAssets(assets()), H = (await constantWind().getJSON('https://x/?latitude=1&longitude=1&start_date=2025-01-08&end_date=2025-01-08')).hourly;
  const w = W.fixedWind(H); assert.equal(w.fetched, false);
  const ok = await W.computeLive({ kind: 'power', dets: [fire], assets: P, rules: R5(), wind: w, live: false, until: END + 2 * 36e5 }); assert.deepEqual(J(ok.rows.map(x => x.key)), ['p1']);
  const cut = await W.computeLive({ kind: 'power', dets: [fire], assets: P, rules: R5(), wind: w, live: false, until: END - 36e5 }); assert.equal(cut.rows.length, 0); assert.equal(cut.noWind, 1);
});
test('computeFast: coarse pixels, no fire power, wind not available is not assessed', async () => {
  const P = W.prepAssets(assets()), now = END + 36e5;
  const px = { lat: -25, lon: -57, firstMs: END, lastMs: END, scans: 3 };
  const base = { kind: 'power', assets: P, rules: R5(), now, fd: { pixels: [px], unreachable: false } };
  const r = await W.computeFast({ ...base, wind: W.createWind({ getJSON: async url => (await constantWind().getJSON(url)) }) });
  assert.equal(r.fast, true); assert.deepEqual(J(r.rows.map(x => [x.key, x.scans, x.peak, x.fire.frp])), [['p1', 3, null, null]]);
  const nw = await W.computeFast({ ...base, wind: W.createWind({ getJSON: constantWind({ fail: true }).getJSON }) }); assert.equal(nw.rows.length, 0); assert.equal(nw.noWind, 1); assert.match(nw.wxErr, /unavailable/);
  const un = await W.computeFast({ ...base, fd: { pixels: [], unreachable: true }, wind: W.fixedWind(null) }); assert.match(un.fastErr, /INPE could not be reached/);
  const nb = await W.computeFast({ ...base, kind: 'schools', wind: W.fixedWind(null) }); assert.equal(nb.notBuilt, true);
});
