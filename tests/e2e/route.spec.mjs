// node tests/e2e/route.spec.mjs   End-to-end checks of route.html in the real Chrome on this machine (playwright-core, channel 'chrome').
// Wind (stubs.mjs), the routing service (api/route and router.project-osrm.org), map tiles and, where a test needs a known fire, the fire feed are all
// replaced by deterministic stand-ins, so the run is offline-safe. The synthetic feed and routes exist only to exercise the code. Screenshots: tests/e2e/shots/.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stubOutside } from './stubs.mjs';

const BASE = (process.env.BASE_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');
const HERE = path.dirname(fileURLToPath(import.meta.url)), SHOTS = path.join(HERE, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });

let failed = 0, total = 0;
async function check(name, fn) {
  total++;
  try { const note = await fn(); console.log('  ok   ' + name + (note ? '  [' + note + ']' : '')); }
  catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + String(e.message).split('\n').join('\n       ')); }
}
const assert = (c, m) => { if (!c) throw new Error(m || 'assertion failed'); };
const eq = (a, b, m) => assert(JSON.stringify(a) === JSON.stringify(b), `${m || 'not equal'}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

let browser;
try { browser = await chromium.launch({ channel: 'chrome', headless: true }); }
catch (e) { console.error('Could not launch Chrome with channel "chrome": ' + e.message); process.exit(2); }
console.log('Chrome ' + browser.version() + ' (headless, channel chrome)\n');

const VP = { desktop: { width: 1440, height: 900 }, phone: { width: 390, height: 844 } };
const shot = (page, name, full = false) => page.screenshot({ path: path.join(SHOTS, name + '.png'), fullPage: full });
const overflow = page => page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth, bad: [...document.querySelectorAll('body *')].filter(e => { if (e.closest('#rtMap')) return false; const r = e.getBoundingClientRect(); return r.width > 0 && (r.right > innerWidth + 1 || r.left < -1); }).slice(0, 4).map(e => e.tagName + '.' + e.className) }));

/* ---------- stand-ins ---------- */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const KM = 111.195;
/* up to three driving alternatives between two points: A straight, B bulging to the right of the direction of travel, C bulging to the left (more) */
function fakeRoutes(from, to) {
  const dx = to.lon - from.lon, dy = to.lat - from.lat, len = Math.hypot(dx, dy) || 1, nx = dy / len, ny = -dx / len; // right-hand normal, in degrees
  const mk = off => { const c = []; for (let i = 0; i <= 40; i++) { const t = i / 40, b = off * Math.sin(Math.PI * t); c.push([+(from.lon + dx * t + nx * b).toFixed(5), +(from.lat + dy * t + ny * b).toFixed(5)]); } return c; };
  const dist = c => { let s = 0; for (let i = 1; i < c.length; i++) s += Math.hypot((c[i][0] - c[i - 1][0]) * KM * Math.cos(c[i][1] * Math.PI / 180), (c[i][1] - c[i - 1][1]) * KM); return s * 1000; };
  return [0, .12, -.17].map(o => { const coords = mk(o), d = dist(coords); return { coords, distance: d, duration: d / 16.7 }; });
}
const parseLL = s => { const [a, b] = s.split(',').map(Number); return { lat: a, lon: b }; };
async function stubRouting(ctx, { fail = false, empty = false, onCall } = {}) {
  await ctx.route(/\/api\/route\?/, r => {
    const q = new URL(r.request().url()).searchParams; onCall && onCall('server');
    if (fail) return r.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: 'routing service unavailable (stub)' }) });
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ source: 'stub', code: empty ? 'NoRoute' : 'Ok', routes: empty ? [] : fakeRoutes(parseLL(q.get('from')), parseLL(q.get('to'))) }) });
  });
  await ctx.route(/router\.project-osrm\.org\//, r => {
    onCall && onCall('osrm');
    if (fail) return r.abort();
    const m = /driving\/([-\d.]+),([-\d.]+);([-\d.]+),([-\d.]+)/.exec(r.request().url());
    const routes = empty ? [] : fakeRoutes({ lat: +m[2], lon: +m[1] }, { lat: +m[4], lon: +m[3] }).map(x => ({ geometry: { type: 'LineString', coordinates: x.coords }, distance: x.distance, duration: x.duration }));
    r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ code: empty ? 'NoRoute' : 'Ok', routes }) });
  });
}
/* a small synthetic feed in the real feed's format (delta-coded arrays): fires [{lat, lon, frp, minAgo}], named places, data through `agoMin` minutes ago */
function synthFeed({ fires, places, agoMin = 60 }) {
  const through = Math.floor((Date.now() - agoMin * 6e4) / 6e4) * 6e4, t0 = through - 24 * 36e5, F = { n_modis: 0, idx: [], lat: [], lon: [], t: [], sat: [], frp: [] };
  let pi = 0, pla = 0, plo = 0, pt = 0;
  fires.forEach((f, k) => { const i = 1000 + k, la = Math.round(f.lat * 1e4), lo = Math.round(f.lon * 1e4), t = Math.round((through - (f.minAgo ?? 90) * 6e4 - t0) / 6e4);
    F.idx.push(i - pi); F.lat.push(la - pla); F.lon.push(lo - plo); F.t.push(t - pt); F.sat.push(2); F.frp.push(f.frp); pi = i; pla = la; plo = lo; pt = t; });
  return { region: 'PY', country: 'Paraguay', fire_hours: 72, place_kinds: ['city', 'town'], generated_utc: new Date(through).toISOString().slice(0, 19) + 'Z', source: 'synthetic test feed', t0: new Date(t0).toISOString().replace('Z', '+00:00'),
    units: 'test', places, data_through_utc: new Date(through).toISOString().slice(0, 16) + 'Z', sats: ['Terra', 'Aqua', 'S-NPP', 'NOAA-20', 'NOAA-21'], fires: F, passes: { 'S-NPP': [100, 700] } };
}
const FIRE = { lat: -25.30, lon: -57.25, frp: 200 };
const PLACES = [['Alfa', -25.25, -57.60], ['Omega', -25.25, -56.90], ['Asunción', -25.28, -57.634], ['Villa Lejana', -22.1, -57.1]];
const feedWith = o => synthFeed({ places: PLACES, ...o });

async function open({ vp = 'desktop', theme = 'dark', region = 'PY', stub = {}, routing = {}, feed, feed404 = false, expectBad = false, search = '', wait = true, extra } = {}) {
  const ctx = await browser.newContext({ viewport: VP[vp], deviceScaleFactor: 1, acceptDownloads: true });
  await ctx.addInitScript(t => { try { if (!localStorage.getItem('theme')) localStorage.setItem('theme', t === 'light' ? 'light' : 'dark'); } catch (e) {} }, theme);
  await stubOutside(ctx, { inpe: false, ...stub });
  await stubRouting(ctx, routing);
  await ctx.route(/arcgisonline\.com\//, r => r.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  if (feed404) await ctx.route(/app-data\/feed\//, r => r.fulfill({ status: 404, body: 'not found' }));
  else if (feed) await ctx.route(/app-data\/feed\/PY\.json/, r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(feed) }));
  if (extra) await extra(ctx);
  const page = await ctx.newPage(), problems = [], opened = [];
  ctx.on('page', p => opened.push(p.url()));
  page.on('console', m => { if (m.type() === 'error' && !(expectBad && /Failed to load resource/.test(m.text()))) problems.push('console: ' + m.text()); });
  page.on('pageerror', e => problems.push('pageerror: ' + e.message));
  page.on('requestfailed', r => { if (!expectBad) problems.push('failed: ' + r.url() + ' ' + (r.failure() || {}).errorText); });
  page.on('response', r => { if (r.status() >= 400 && !expectBad) problems.push('http ' + r.status() + ': ' + r.url()); });
  await page.goto(`${BASE}/route.html?r=${region}${search}`, { waitUntil: 'load' });
  if (wait) await page.waitForSelector('body[data-ready]', { timeout: 30000 });
  return { page, ctx, problems, opened };
}
const pick = async (page, which, q, name) => { await page.fill(which === 'from' ? '#rtFrom' : '#rtTo', q); const b = page.locator(`#rt${which === 'from' ? 'From' : 'To'}List button.rt-match`, { hasText: name }); await b.first().click(); };
const results = page => page.waitForSelector('body[data-result]', { timeout: 40000 });
const IDS = ['#rtFrom', '#rtTo', '#rtFromList', '#rtToList', '#rtDepart', '#rtGo', '#rtExample', '#rtMap', '#rtRoutes', '#rtBest', '#rtGmaps', '#rtGeojson', '#regionSel', '#themeToggle'];

/* =============== every viewport x theme =============== */
for (const vp of ['desktop', 'phone']) for (const theme of ['dark', 'light']) {
  console.log(`\n== route page, ${vp} ${VP[vp].width}x${VP[vp].height}, ${theme} ==`);
  await check(`[${vp}-${theme}] loads: required ids, Leave options, switch role, map, clock with OBSERVED tag, old-data warning follows the data age, safety line, OSRM credit, no overflow, no console errors`, async () => {
    const { page, ctx, problems } = await open({ vp, theme });
    for (const id of IDS) assert(await page.locator(id).count() === 1, 'missing ' + id);
    eq(await page.$$eval('#rtDepart option', o => o.map(x => x.textContent)), ['Now', 'In 1 h', 'In 2 h', 'In 3 h']);
    assert(await page.locator('#switchRole').isVisible() && (await page.getAttribute('#switchRole', 'href')) === 'start.html', 'switch role');
    eq(await page.evaluate(() => document.body.classList.contains('light')), theme === 'light');
    assert(await page.locator('.leaflet-container').count() === 1 && await page.locator('#rtMap').isVisible(), 'map');
    assert(/\d\d:\d\d/.test(await page.innerText('#lastLook')) && (await page.innerText('#tagObs')).includes('OBSERVED'));
    const old = await page.evaluate(async () => { const f = await (await fetch('app-data/feed/PY.json')).json(); return (Date.now() - Date.parse(f.data_through_utc)) / 36e5 > 12; });
    eq(await page.locator('#oldWarn').isVisible(), old, 'old warning follows the data age');
    if (old) assert((await page.innerText('#oldWarn')).startsWith('THIS DATA IS OLD'), await page.innerText('#oldWarn'));
    assert((await page.innerText('#rtSafety')) === 'A modelled scenario from satellite data, not a ground report. In an emergency, follow official instructions.');
    assert((await page.innerText('#rtCredit')).includes('Routes: OSRM demo server, OpenStreetMap data') && /light use/.test(await page.innerText('#rtCredit')));
    assert(/fire cluster\(s\) of 5 MW or more in the last 24 hours of data/.test(await page.innerText('#fireCount')), await page.innerText('#fireCount'));
    assert(await page.locator('#rtRoutes .rt-route').count() === 0 && await page.locator('#rtBestBox').isHidden() && await page.locator('#rtHand').isHidden(), 'nothing is shown before a search');
    const o = await overflow(page); assert(o.sw <= o.iw + 1 && !o.bad.length, `horizontal overflow: ${o.sw} > ${o.iw} ${o.bad}`);
    await shot(page, `route-load-${vp}-${theme}`, vp === 'phone'); eq(problems, [], 'problems'); await ctx.close();
  });
  await check(`[${vp}-${theme}] Try an example (real feed and road file, stubbed wind and routes): cards, #rtBest with numbers, one best route, links; no overflow, no console errors`, async () => {
    const { page, ctx, problems } = await open({ vp, theme });
    await page.click('#rtExample'); await results(page);
    const n = await page.locator('#rtRoutes .rt-route').count(); assert(n >= 2 && n <= 3, 'route cards: ' + n);
    eq(await page.$$eval('#rtRoutes .rt-route', l => l.map(x => x.dataset.route)), ['A', 'B', 'C'].slice(0, n));
    const best = await page.$$eval('#rtRoutes .rt-route[data-best=true]', l => l.map(x => x.dataset.route)); eq(best.length, 1, 'exactly one best: ' + best);
    const txt = (await page.innerText('#rtBest')).trim(); assert(txt.length > 30 && /Route [ABC]|No route meets|assess/.test(txt), 'summary: ' + txt);
    assert(/\d/.test(txt) || /No route meets/.test(txt));
    for (const t of ['OBSERVED', 'MAPPED', 'MODELLED', 'SCENARIO']) assert((await page.locator('#rtRoutes .rt-route').first().innerText()).includes(t), t);
    const card = await page.innerText('#rtRoutes .rt-route'); assert(/Time/.test(card) && /Distance/.test(card) && /In smoke/.test(card) && /Peak/.test(card), card);
    assert((await page.inputValue('#rtFrom')).length > 2 && (await page.inputValue('#rtTo')).length > 2 && (await page.inputValue('#rtFrom')) !== (await page.inputValue('#rtTo')), 'From and To were filled from the data');
    assert(/Example from the current data:/.test(await page.innerText('#rtStatus')), await page.innerText('#rtStatus'));
    assert(await page.locator('#rtHand').isVisible() && await page.locator('#rtGeojson').isVisible());
    const o = await overflow(page); assert(o.sw <= o.iw + 1 && !o.bad.length, `horizontal overflow: ${o.sw} > ${o.iw} ${o.bad}`);
    assert(await page.locator('.leaflet-container path.rt-line').count() >= 2, 'routes drawn on the map');
    await shot(page, `route-example-${vp}-${theme}`, true); eq(problems, [], 'problems'); await ctx.close();
    return `${n} routes, best ${best[0]}, "${txt.slice(0, 110)}"`;
  });
}

/* =============== a known fire: exposure, ranking, hand-off =============== */
console.log('\n== known fire (synthetic feed, constant wind from the south) ==');
const south = ctx => ctx.route(/\/api\/wind/, r => { const q = new URL(r.request().url()).searchParams, cells = {}; for (const c of q.get('cells').split(';')) { const time = [], n = 72; for (let t = Date.parse(q.get('d0') + 'T00:00:00Z'), k = 0; k < 24 * 11; t += 36e5, k++) time.push(new Date(t).toISOString().slice(0, 16)); const m = time.length; cells[c] = { time, wind_speed_100m: Array(m).fill(3), wind_direction_100m: Array(m).fill(180), wind_speed_10m: Array(m).fill(1.8), boundary_layer_height: Array(m).fill(1500), cloud_cover: Array(m).fill(0) }; void n; } r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ cells }) }); });
const known = (o = {}) => open({ feed: feedWith({ fires: [FIRE] }), extra: south, ...o });
let knownRun = null;
for (const [vp, theme] of [['desktop', 'light'], ['phone', 'dark']]) await check(`[${vp}-${theme}] search two places, Compare: Route A meets the plume, Route B avoids it and is marked best; the summary has real numbers; Google Maps link and GeoJSON`, async () => {
  const { page, ctx, problems, opened } = await known({ vp, theme });
  assert(!(await page.locator('#oldWarn').isVisible()), 'fresh synthetic data: no old-data warning');
  await pick(page, 'from', 'alf', 'Alfa'); await pick(page, 'to', 'omeg', 'Omega'); eq(await page.inputValue('#rtFrom'), 'Alfa');
  await page.click('#rtGo'); await results(page);
  eq(await page.$$eval('#rtRoutes .rt-route', l => l.map(x => [x.dataset.route, x.dataset.best])), [['A', 'false'], ['B', 'true'], ['C', 'false']].map(([a, b], i) => [a, b]).map(([a, b]) => [a, b]), 'cards and best marker');
  const num = async (r, label) => (await page.locator(`.rt-route[data-route=${r}] .rt-nums div`, { hasText: label }).locator('dd').innerText());
  const kmA = parseFloat(await num('A', 'In smoke')), kmB = parseFloat(await num('B', 'In smoke'));
  assert(kmA > 0 && kmB === 0, `A ${kmA} km, B ${kmB} km in smoke`);
  assert(parseFloat(await num('A', 'Peak')) >= 1, 'peak on A');
  const sum = (await page.innerText('#rtBest')).trim();
  assert(new RegExp(`^Route B avoids the modelled smoke: 0 km in smoke vs ${kmA} km on Route A, \\d+ min longer\\.$`).test(sum), sum);
  assert(/Smoke starts at km [\d.]+, around \d\d:\d\d/.test(await page.innerText('.rt-route[data-route=A]')), await page.innerText('.rt-route[data-route=A]'));
  assert(/No modelled smoke on this route/.test(await page.innerText('.rt-route[data-route=B]')));
  assert(await page.locator('.rt-route[data-route=B] .rt-besttag').count() === 1);
  // the map: smoke stretches drawn on A, none on B's own colour
  assert(await page.locator('.leaflet-container path.rt-smoke').count() >= 1, 'smoke stretch drawn');
  // Google Maps: only a link, never opened by the page
  const href = await page.getAttribute('#rtGmaps', 'href'), u = new URL(href), q = u.searchParams;
  eq(u.origin + u.pathname, 'https://www.google.com/maps/dir/'); eq(q.get('travelmode'), 'driving'); eq(q.get('api'), '1');
  const [oLa, oLo] = q.get('origin').split(',').map(Number), [dLa, dLo] = q.get('destination').split(',').map(Number);
  assert(Math.abs(oLa + 25.25) < 1e-3 && Math.abs(oLo + 57.6) < 1e-3 && Math.abs(dLa + 25.25) < 1e-3 && Math.abs(dLo + 56.9) < 1e-3, 'origin and destination are the two places: ' + href);
  const wps = q.get('waypoints').split('|'); assert(wps.length >= 1 && wps.length <= 8, 'waypoints: ' + wps.length);
  assert(wps.every(w => /^-?\d+\.\d+,-?\d+\.\d+$/.test(w)) && wps.some(w => parseFloat(w.split(',')[0]) < -25.3), 'waypoints follow route B (south of the fire)');
  eq(await page.getAttribute('#rtGmaps', 'target'), '_blank'); assert(/noopener/.test(await page.getAttribute('#rtGmaps', 'rel')));
  eq(opened, [], 'no window was opened by the page');
  // GeoJSON
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#rtGeojson')]);
  assert(/\.geojson$/.test(dl.suggestedFilename()), dl.suggestedFilename());
  const gj = JSON.parse(fs.readFileSync(await dl.path(), 'utf8'));
  eq(gj.type, 'FeatureCollection');
  const rf = gj.features.filter(f => f.properties.kind === 'route'), sf = gj.features.filter(f => f.properties.kind === 'smoke_segment');
  eq(rf.map(f => f.properties.name), ['Route A', 'Route B', 'Route C']); assert(sf.length >= 1 && sf.every(f => f.properties.route === 'A' || f.properties.route === 'C'), 'segments only where there is smoke');
  assert(Math.abs(rf[0].properties.km_in_smoke - kmA) < .06 && rf[1].properties.km_in_smoke === 0 && rf[1].properties.best === true);
  assert(rf.every(f => f.geometry.type === 'LineString' && f.properties.depart && f.properties.data_through && f.properties.labels.length === 3 && 'peak_ugm3' in f.properties && 'smoke_minutes' in f.properties));
  assert(/(?:wind: MODELLED)/.test(rf[0].properties.labels.join('|')) && /fires: OBSERVED/.test(rf[0].properties.labels.join('|')) && /smoke: SCENARIO/.test(rf[0].properties.labels.join('|')));
  assert(/ingest/.test(await page.innerText('#geoNote')) && /not only today/.test(await page.innerText('#geoNote')));
  const o = await overflow(page); assert(o.sw <= o.iw + 1 && !o.bad.length, `overflow ${o.sw} > ${o.iw} ${o.bad}`);
  await shot(page, `route-known-${vp}-${theme}`, true); eq(problems, [], 'problems'); await ctx.close();
  return `A ${kmA} km in smoke, B 0, "${sum}"`;
});
await check('departure +2 h asks the wind for the later hours and still compares (Leave is respected)', async () => {
  const winds = []; const { page, ctx, problems } = await known({ extra: async c => { await south(c); c.on('request', r => /api\/wind/.test(r.url()) && winds.push(r.url())); } });
  await pick(page, 'from', 'alf', 'Alfa'); await pick(page, 'to', 'omeg', 'Omega'); await page.selectOption('#rtDepart', '2'); await page.click('#rtGo'); await results(page);
  assert(await page.locator('.rt-route').count() === 3 && (await page.innerText('#rtBest')).startsWith('Route B avoids'), await page.innerText('#rtBest'));
  assert(winds.some(u => /d0=\d{4}-\d\d-\d\d&d1=\d{4}-\d\d-\d\d&old=0/.test(u)), 'wind requested with d0, d1 and old=0'); eq(problems, []); await ctx.close();
});
await check('no route meets modelled smoke: says so and keeps "no detection does not mean no fire" (fire far from the routes)', async () => {
  const { page, ctx, problems } = await open({ feed: feedWith({ fires: [{ lat: -23.5, lon: -57.25, frp: 200 }] }), extra: south });
  await pick(page, 'from', 'alf', 'Alfa'); await pick(page, 'to', 'omeg', 'Omega'); await page.click('#rtGo'); await results(page);
  const s = await page.innerText('#rtBest'); assert(/^No route meets modelled smoke/.test(s) && /no detection does not mean no fire/.test(s), s);
  eq(await page.locator('.rt-route[data-best=true]').count(), 1); assert(/No fire cluster within 25 km/.test(await page.innerText('.rt-route[data-route=A]')));
  eq(problems, []); await shot(page, 'route-nosmoke'); await ctx.close();
});
await check('wind from the north: the same fire puts no smoke on the route south of it... and the page says what it modelled, not "clear"', async () => {
  const north = ctx => ctx.route(/\/api\/wind/, r => { const q = new URL(r.request().url()).searchParams, cells = {}; for (const c of q.get('cells').split(';')) { const time = []; for (let t = Date.parse(q.get('d0') + 'T00:00:00Z'), k = 0; k < 264; t += 36e5, k++) time.push(new Date(t).toISOString().slice(0, 16)); const m = time.length; cells[c] = { time, wind_speed_100m: Array(m).fill(3), wind_direction_100m: Array(m).fill(0), wind_speed_10m: Array(m).fill(1.8), boundary_layer_height: Array(m).fill(1500), cloud_cover: Array(m).fill(0) }; } r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ cells }) }); });
  const { page, ctx, problems } = await open({ feed: feedWith({ fires: [FIRE] }), extra: north });
  await pick(page, 'from', 'alf', 'Alfa'); await pick(page, 'to', 'omeg', 'Omega'); await page.click('#rtGo'); await results(page);
  const kmB = parseFloat(await page.locator('.rt-route[data-route=B] .rt-nums div', { hasText: 'In smoke' }).locator('dd').innerText());
  assert(kmB > 0, 'with the wind from the north the plume goes south over route B: ' + kmB); assert((await page.innerText('#rtBest')).startsWith('Route A'), await page.innerText('#rtBest')); eq(problems, []); await ctx.close();
});

/* =============== failures =============== */
console.log('\n== failures ==');
await check('the routing service fails (our server 502 and OSRM unreachable): a plain message, no cards, no hand-off, no console errors, and it recovers', async () => {
  const calls = []; const { page, ctx, problems } = await known({ routing: { fail: true, onCall: c => calls.push(c) }, expectBad: true });
  await pick(page, 'from', 'alf', 'Alfa'); await pick(page, 'to', 'omeg', 'Omega'); await page.click('#rtGo');
  await page.waitForFunction(() => !document.getElementById('rtWarn').hidden, null, { timeout: 30000 });
  assert(/routing service could not be reached, so no routes can be compared/.test(await page.innerText('#rtWarn')), await page.innerText('#rtWarn'));
  eq(await page.locator('.rt-route').count(), 0); assert(await page.locator('#rtHand').isHidden() && await page.locator('#rtBestBox').isHidden());
  eq(calls, ['server', 'osrm'], 'our server first, then OSRM directly'); assert(await page.locator('#rtGo').isEnabled(), 'the button is usable again');
  await shot(page, 'route-fail-routing'); eq(problems, [], 'problems'); await ctx.close();
});
await check('no server (static hosting): api/route is 404 and the page asks OSRM directly', async () => {
  const calls = []; const { page, ctx, problems } = await known({ expectBad: true, extra: async c => { await c.route(/\/api\/route\?/, r => r.fulfill({ status: 404, contentType: 'text/html', body: '<h1>404</h1>' })); await c.route(/router\.project-osrm\.org\//, r => { calls.push('osrm'); const m = /driving\/([-\d.]+),([-\d.]+);([-\d.]+),([-\d.]+)/.exec(r.request().url()); r.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ code: 'Ok', routes: fakeRoutes({ lat: +m[2], lon: +m[1] }, { lat: +m[4], lon: +m[3] }).map(x => ({ geometry: { coordinates: x.coords }, distance: x.distance, duration: x.duration })) }) }); }); } });
  await pick(page, 'from', 'alf', 'Alfa'); await pick(page, 'to', 'omeg', 'Omega'); await page.click('#rtGo'); await results(page);
  assert(calls.length === 1 && await page.locator('.rt-route').count() === 3, 'OSRM called once: ' + calls); eq(problems.filter(p => !/404/.test(p)), []); await ctx.close();
});
await check('no driving route between the points: said plainly', async () => {
  const { page, ctx, problems } = await known({ routing: { empty: true } });
  await pick(page, 'from', 'alf', 'Alfa'); await pick(page, 'to', 'omeg', 'Omega'); await page.click('#rtGo');
  await page.waitForFunction(() => !document.getElementById('rtWarn').hidden); assert(/No driving route was found/.test(await page.innerText('#rtWarn'))); eq(await page.locator('.rt-route').count(), 0); eq(problems, []); await ctx.close();
});
await check('the wind fails: routes are shown but every route says "not assessed", nothing is called clear, no best route, no Google Maps link', async () => {
  const { page, ctx, problems } = await open({ feed: feedWith({ fires: [FIRE] }), stub: { windFail: true }, expectBad: true });
  await pick(page, 'from', 'alf', 'Alfa'); await pick(page, 'to', 'omeg', 'Omega'); await page.click('#rtGo'); await results(page);
  eq(await page.$$eval('.rt-route', l => l.map(x => x.dataset.status)).then(a => a.filter(s => s === 'notAssessed').length), 3, 'the routes within 25 km of the fire are not assessed');
  const best = await page.innerText('#rtBest'); assert(/not an all-clear/.test(best) && !/avoids|No route meets/.test(best), best);
  assert(/Modelled wind is unavailable/.test(await page.innerText('#rtWarn')), await page.innerText('#rtWarn'));
  eq(await page.locator('.rt-route[data-best=true]').count(), 0); assert(await page.locator('#rtGmaps').isHidden(), 'no link for a best route that does not exist');
  assert(/Not assessed/.test(await page.innerText('.rt-route[data-route=A]')) && !/0 km/.test(await page.innerText('.rt-route[data-route=A]')), await page.innerText('.rt-route[data-route=A]'));
  await shot(page, 'route-fail-wind'); eq(problems, [], 'problems'); await ctx.close();
});
await check('the fire feed is a 404: a plain message, search says why, routes can still be drawn from map points but are "not assessed", never "no fire"', async () => {
  const { page, ctx, problems } = await open({ feed404: true, expectBad: true });
  assert(/fire data for this region could not be loaded/.test(await page.innerText('#rtWarn')) && /not an all-clear/.test(await page.innerText('#rtWarn')));
  await page.fill('#rtFrom', 'asun'); assert(/could not be loaded: set the points on the map/.test(await page.innerText('#rtFromList')), await page.innerText('#rtFromList'));
  await page.evaluate(() => { const S = window.__ROUTE.S; S.from = { name: 'P1', lat: -25.25, lon: -57.6 }; S.to = { name: 'P2', lat: -25.25, lon: -56.9 }; });
  await page.click('#rtGo'); await results(page);
  eq(await page.$$eval('.rt-route', l => l.map(x => x.dataset.status)), ['notAssessed', 'notAssessed', 'notAssessed']);
  assert(/could not be assessed|not an all-clear/.test(await page.innerText('#rtBest')) && !/No fire cluster/.test(await page.innerText('#rtRoutes')));
  await page.click('#rtExample'); assert(/could not be loaded/.test(await page.innerText('#rtWarn')));
  await shot(page, 'route-fail-feed'); eq(problems, [], 'problems'); await ctx.close();
});
await check('Try an example says so when nothing qualifies (a feed with a single fire far from any mapped road)', async () => {
  const { page, ctx, problems } = await open({ feed: feedWith({ fires: [{ lat: -20.0, lon: -66.0, frp: 100 }] }), extra: south });
  await page.click('#rtExample'); await page.waitForFunction(() => !document.getElementById('rtWarn').hidden, null, { timeout: 40000 });
  assert(/No example can be built from the current data/.test(await page.innerText('#rtWarn')), await page.innerText('#rtWarn')); eq(await page.locator('.rt-route').count(), 0); eq(problems, []); await ctx.close();
});

/* =============== other behaviour =============== */
console.log('\n== behaviour ==');
await check('map clicks set the start, then the end; a third click starts again', async () => {
  const { page, ctx, problems } = await known();
  const box = await page.locator('#rtMap').boundingBox();
  await page.mouse.click(box.x + box.width * .3, box.y + box.height * .5); assert(/^Map point/.test(await page.inputValue('#rtFrom')) && (await page.inputValue('#rtTo')) === '');
  await page.waitForTimeout(250); await page.mouse.click(box.x + box.width * .7, box.y + box.height * .5); assert(/^Map point/.test(await page.inputValue('#rtTo')));
  await page.waitForTimeout(250); await page.mouse.click(box.x + box.width * .5, box.y + box.height * .3); assert((await page.inputValue('#rtTo')) === '' && /^Map point/.test(await page.inputValue('#rtFrom')));
  assert(await page.locator('.rt-pin').count() === 1); eq(problems, []); await ctx.close();
});
await check('"Use my location" asks only when pressed (no geolocation request on load) and fills From', async () => {
  const { page, ctx, problems } = await open({ feed: feedWith({ fires: [FIRE] }), extra: async c => { await c.grantPermissions(['geolocation']); await c.setGeolocation({ latitude: -25.3, longitude: -57.6 }); await south(c); await c.addInitScript(() => { window.__geo = 0; const g = navigator.geolocation, f = g.getCurrentPosition.bind(g); g.getCurrentPosition = (...a) => { window.__geo++; return f(...a); }; }); } });
  eq(await page.evaluate(() => window.__geo), 0, 'not asked on load'); await page.click('#rtFromLoc'); await page.waitForFunction(() => document.getElementById('rtFrom').value === 'My location');
  eq(await page.evaluate(() => window.__geo), 1); eq(await page.evaluate(() => window.__ROUTE.S.from.lat), -25.3); eq(problems, []); await ctx.close();
});
await check('Spanish and Portuguese: the page, the summary and the cards switch language; the not-reviewed note shows; the safety line is translated', async () => {
  const { page, ctx, problems } = await known();
  await pick(page, 'from', 'alf', 'Alfa'); await pick(page, 'to', 'omeg', 'Omega'); await page.click('#rtGo'); await results(page);
  await page.click('#langBox [data-lang=es]');
  assert(/^La Ruta B evita el humo modelado: 0 km en humo frente a [\d,]+ km en la Ruta A/.test(await page.innerText('#rtBest')), await page.innerText('#rtBest'));
  assert(/plantillas fijas/.test(await page.innerText('#esNote')) && /Un escenario modelado/.test(await page.innerText('#rtSafety')) && (await page.innerText('#rtGo')).includes('Comparar rutas'));
  assert(/OBSERVADO/.test(await page.innerText('.rt-route')) && /El humo empieza en el km/.test(await page.innerText('.rt-route[data-route=A]')));
  await page.click('#langBox [data-lang=pt]'); assert(/^A Rota B evita a fumaça modelada/.test(await page.innerText('#rtBest')), await page.innerText('#rtBest')); assert(/modelos fixos/.test(await page.innerText('#esNote')));
  assert(await page.locator('.rt-route[data-best=true]').count() === 1, 'the best marker survives a language switch'); await shot(page, 'route-pt');
  await page.click('#langBox [data-lang=en]'); assert(await page.locator('#esNote').isHidden()); eq(problems, []); await ctx.close();
});
await check('region switch: another region loads its own feed and clears the result; ?r= is respected', async () => {
  const { page, ctx, problems } = await open({ region: 'BO' });
  eq(await page.inputValue('#regionSel'), 'BO'); assert(/bolivia/i.test(await page.innerText('#rtMode')));
  await page.selectOption('#regionSel', 'AR'); await page.waitForFunction(() => /Argentina/.test(document.getElementById('rtMode').textContent) && document.body.dataset.ready);
  eq(await page.locator('.rt-route').count(), 0); assert(new URL(page.url()).searchParams.get('r') === 'AR'); eq(problems, []); await ctx.close();
});
await check('contrast >= 4.5:1 for text and tap targets >= 44 px, results shown, dark and light', async () => {
  for (const theme of ['dark', 'light']) {
    const { page, ctx } = await known({ vp: 'phone', theme });
    await pick(page, 'from', 'alf', 'Alfa'); await pick(page, 'to', 'omeg', 'Omega'); await page.click('#rtGo'); await results(page);
    const rows = await page.evaluate(() => {
      const px = s => { const c = document.createElement('canvas').getContext('2d'); c.fillStyle = s; c.fillRect(0, 0, 1, 1); const d = c.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3]]; };
      const lum = ([r, g, b]) => { const f = v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }; return .2126 * f(r) + .7152 * f(g) + .0722 * f(b); };
      const cr = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
      const tok = n => getComputedStyle(document.body).getPropertyValue(n).trim(), light = document.body.classList.contains('light');
      const surf = [tok('--bg-0'), tok('--bg-1'), tok('--bg-2'), ...(light ? [] : ['#0E3445'])];
      const blend = (fg, bg) => fg[3] === 255 ? fg : fg.slice(0, 3).map((v, i) => Math.round(v * fg[3] / 255 + bg[i] * (1 - fg[3] / 255)));
      const out = [];
      for (const e of document.querySelectorAll('h1,h2,h3,p,small,dd,dt,b,button,a,label,i,.dtag,.rt-note,.rt-besttag')) {
        if (!e.offsetParent || !(e.textContent || '').trim() || e.disabled || e.closest('#rtMap,.leaflet-container')) continue;
        const cs = getComputedStyle(e), fg = px(cs.color), own = px(cs.backgroundColor), bgs = own[3] > 200 ? [own.slice(0, 3)] : surf.map(s => px(s).slice(0, 3));
        const worst = Math.min(...bgs.map(b => { const bb = e.classList.contains('dtag') ? blend(own, b) : b; return cr(blend(fg, bb), bb); }));
        out.push({ t: e.textContent.trim().slice(0, 24), c: e.className, r: +worst.toFixed(2) });
      }
      return out;
    });
    const low = rows.filter(r => r.r < 4.5); assert(rows.length > 25 && !low.length, `${theme}: low contrast: ` + JSON.stringify(low.slice(0, 6)));
    const small = await page.evaluate(() => [...document.querySelectorAll('button,select,input,a.ghost-btn,.rt-brand')].filter(e => e.offsetParent && !e.closest('.leaflet-container')).map(e => { const r = e.getBoundingClientRect(); return { t: (e.id || e.textContent || e.className).slice(0, 20), w: Math.round(r.width), h: Math.round(r.height) }; }).filter(x => x.h < 44 || x.w < 44));
    assert(!small.length, `${theme}: small targets ` + JSON.stringify(small)); await ctx.close();
  }
});

await check('wiring: the road patrol page has the "Plan a smoke-aware route" card to route.html?r=, and DOWNWIND and the explorer link to Route', async () => {
  const ctx = await browser.newContext({ viewport: VP.desktop }); await stubOutside(ctx, { inpe: false });
  const page = await ctx.newPage(); await page.goto(`${BASE}/role.html?role=road&r=PY`); await page.waitForSelector('body[data-ready]');
  eq(await page.getAttribute('a.rl-routelink', 'href'), 'route.html?r=PY'); assert(/Plan a smoke-aware route/.test(await page.innerText('a.rl-routelink')));
  await page.goto(`${BASE}/role.html?role=grid&r=PY`); await page.waitForSelector('body[data-ready]'); eq(await page.locator('a.rl-routelink').count(), 0, 'only the road patrol');
  await page.goto(`${BASE}/downwind.html`); eq(await page.getAttribute('#dwRouteLink', 'href'), 'route.html');
  await page.goto(`${BASE}/index.html`); assert(await page.locator('a.nav-item[href="route.html"]').count() >= 1); await ctx.close();
});

await browser.close();
console.log(`\n${total - failed} of ${total} checks passed${failed ? `, ${failed} FAILED` : ''}. Screenshots: tests/e2e/shots/`);
process.exit(failed ? 1 : 0);
