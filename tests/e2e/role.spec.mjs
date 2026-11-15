// node tests/e2e/role.spec.mjs   End-to-end checks of role.html in the real Chrome on this machine (playwright-core, channel 'chrome').
// Wind and INPE are stubbed (tests/e2e/stubs.mjs), so the run is offline-safe and deterministic. Screenshots: tests/e2e/shots/.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stubOutside } from './stubs.mjs';
import { load, regions } from '../unit/load.mjs';

const BASE = (process.env.BASE_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');
const HERE = path.dirname(fileURLToPath(import.meta.url)), SHOTS = path.join(HERE, 'shots'), WEB = path.join(HERE, '../../web');
fs.mkdirSync(SHOTS, { recursive: true });
load('regions', 'firelab-core', 'downwind-core', 'fast-core', 'watch-core', 'bulletin-core', 'place', 'role-core', 'roles');
globalThis.REGIONS.load(regions());
const ROLES = JSON.parse(JSON.stringify(globalThis.ROLES.list)).filter(r => r.mode === 'simplified' && /^role\.html/.test(r.href));   // the driver opens route.html (checked in route.spec.mjs)
const SIMPLE = ROLES.map(r => r.id);

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
async function open(role, { vp = 'desktop', theme = 'dark', region = 'PY', reduced = false, stub = {}, routes, expectBad = false, ctxOpts = {}, search = '', wait = true } = {}) {
  const { permissions = [], ...rest } = ctxOpts;
  const ctx = await browser.newContext({ viewport: VP[vp], reducedMotion: reduced ? 'reduce' : 'no-preference', deviceScaleFactor: 1, ...rest });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write', ...permissions], { origin: BASE }).catch(() => {});
  await ctx.addInitScript(t => { try { if (!localStorage.getItem('theme')) localStorage.setItem('theme', t === 'light' ? 'light' : 'dark'); } catch (e) {} }, theme); // the Paper (light) theme is the default, so dark is asked for
  await stubOutside(ctx, stub);
  const page = await ctx.newPage(), problems = [], bytes = { n: 0, kb: 0, list: [] };
  page.on('console', m => { if (m.type() === 'error' && !(expectBad && /Failed to load resource/.test(m.text()))) problems.push('console: ' + m.text()); });
  page.on('pageerror', e => problems.push('pageerror: ' + e.message));
  page.on('requestfailed', r => { if (!expectBad) problems.push('failed: ' + r.url() + ' ' + (r.failure() || {}).errorText); });
  page.on('response', async r => { if (r.status() >= 400 && !expectBad) problems.push('http ' + r.status() + ': ' + r.url()); try { const b = await r.body(); bytes.n++; bytes.kb += b.length / 1024; bytes.list.push([r.url().replace(BASE + '/', ''), r.request().resourceType(), b.length]); } catch (e) {} });
  if (routes) await routes(ctx, page);
  await page.goto(`${BASE}/role.html?role=${role}&r=${region}${search}`, { waitUntil: 'load' });
  if (wait) await page.waitForSelector('body[data-ready]', { timeout: 30000 });
  return { page, ctx, problems, bytes };
}
const shot = (page, name, full = false) => page.screenshot({ path: path.join(SHOTS, name + '.png'), fullPage: full });
const overflow = page => page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth, bad: [...document.querySelectorAll('body *')].filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.right > innerWidth + 1 || r.left < -1) && !e.closest('.rl-toast,.vh,.skip'); }).slice(0, 3).map(e => e.className || e.tagName) }));
const rect = (page, sel) => page.$eval(sel, e => { const r = e.getBoundingClientRect(); return { w: r.width, h: r.height, l: r.left, r: r.right, t: r.top, b: r.bottom }; });
const wait = (ms) => new Promise(r => setTimeout(r, ms));
const ready = page => page.waitForSelector('body[data-ready]', { timeout: 30000 });
const steps = page => page.$$eval('.rl-step', l => l.map(s => s.dataset.done));
const prog = page => page.$eval('#ringTxt', e => e.textContent);

/* a place with several recent fires within 50 km, found from the real feed on disk */
const feed = JSON.parse(fs.readFileSync(path.join(WEB, 'app-data/feed/PY.json'), 'utf8'));
const fires = globalThis.PLACE.decodeFeed(feed), END = globalThis.PLACE.dataEnd(feed), Dc = globalThis.DOWNWIND;
globalThis.PLACE.setRegion(globalThis.REGIONS.get('PY'));
const recent = fires.filter(f => f.ms > END - 24 * 36e5);
let hot = null;
for (const p of feed.places) { const n = Dc.cluster(recent.filter(f => Dc.dist(p[1], p[2], f.lat, f.lon) <= 50), 1.5).length; if (!hot || n > hot.n) hot = { name: p[0], n }; }

/* =============== every role x viewport x theme =============== */
const weights = {};
for (const vp of ['desktop', 'phone']) for (const theme of ['dark', 'light']) {
  console.log(`\n== role pages, ${vp} ${VP[vp].width}x${VP[vp].height}, ${theme} ==`);
  for (const role of SIMPLE) await check(`[${vp}-${theme}] ${role}: loads, role title and question, clock, briefing 0/3, no overflow, no console errors or failed requests`, async () => {
    const { page, ctx, problems, bytes } = await open(role, { vp, theme });
    const r = ROLES.find(x => x.id === role);
    eq(await page.innerText('#rTitle'), r.title); eq(await page.innerText('#rQuestion'), r.question);
    assert(/\d\d:\d\d/.test(await page.innerText('#lastLook')), 'last satellite look shown'); assert((await page.innerText('#nextLook')).length > 3);
    eq(await prog(page), '0/3'); eq(await page.$$eval('.rl-step', l => l.length), 3); eq(await page.$$eval('#week li', l => l.length), 7);
    eq(await page.evaluate(() => document.body.classList.contains('light')), theme === 'light');
    for (const t of ['OBSERVED', 'ESTIMATE']) assert((await page.innerText('#clockCard')).includes(t), t + ' tag in the clock');
    assert(await page.locator('#switchRole').isVisible() && (await page.getAttribute('#switchRole', 'href')) === 'start.html', 'switch role link');
    assert((await page.getAttribute('#fullLink', 'href')).startsWith('downwind.html'), 'full DOWNWIND link');
    const o = await overflow(page); assert(o.sw <= o.iw + 1 && !o.bad.length, `horizontal overflow: ${o.sw} > ${o.iw} ${o.bad}`);
    // the role's own panel
    if (role === 'grid' || role === 'road') { assert(await page.locator('.rcard').count() > 0, 'cards listed (stubbed wind)'); assert((await page.innerText('.rl-scope')).includes('MW or more'), 'scope line'); }
    if (role === 'firefighter') assert(await page.locator('#pickQ').isVisible());
    if (role === 'care' || role === 'resident') assert(await page.locator('#pickQ').isVisible());
    // tags
    if (role === 'grid') for (const t of ['OBSERVED', 'MAPPED', 'MODELLED', 'SCENARIO']) assert((await page.innerText('.rcard')).includes(t), t);
    await shot(page, `role-${role}-${vp}-${theme}`, vp === 'phone');
    if (vp === 'desktop') weights[role] = bytes;
    eq(problems, [], 'problems'); await ctx.close();
  });
}

/* contrast of text on the role page (dark and light), tap targets */
for (const theme of ['dark', 'light']) await check(`[${theme}] contrast >= 4.5:1 for text and tags on the role page, tap targets >= 44 px`, async () => {
  const { page, ctx } = await open('grid', { theme, vp: 'phone' });
  const rows = await page.evaluate(() => {
    const px = s => { const c = document.createElement('canvas').getContext('2d'); c.fillStyle = s; c.fillRect(0, 0, 1, 1); const d = c.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3]]; };
    const lum = ([r, g, b]) => { const f = v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }; return .2126 * f(r) + .7152 * f(g) + .0722 * f(b); };
    const cr = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
    const tok = n => getComputedStyle(document.body).getPropertyValue(n).trim(), light = document.body.classList.contains('light');
    const surf = [tok('--bg-0'), tok('--bg-1'), tok('--bg-2'), ...(light ? [] : ['#0E3445'])];
    const blend = (fg, bg) => fg[3] === 255 ? fg : fg.slice(0, 3).map((v, i) => Math.round(v * fg[3] / 255 + bg[i] * (1 - fg[3] / 255)));
    const out = [];
    for (const e of document.querySelectorAll('h1,h2,p,small,dd,dt,b,button,a,label,.rl-line,.rc-hint,.rl-dow,.dtag,.rl-step-body b,.rc-title,.rl-scope')) {
      if (!e.offsetParent && e.tagName !== 'BODY') continue; if (e.closest('.rcard[data-face=front] .rc-back,[inert]') || !(e.textContent || '').trim()) continue;
      if (e.disabled) continue;
      const cs = getComputedStyle(e), fg = px(cs.color), own = px(cs.backgroundColor);
      const bgs = own[3] > 200 ? [own.slice(0, 3)] : surf.map(s => px(s).slice(0, 3));
      const tg = e.classList.contains('dtag') ? bgs.map(b => blend(px(cs.backgroundColor), b)) : bgs;
      const worst = Math.min(...(e.classList.contains('dtag') ? bgs.map(b => cr(blend(fg, blend(own, b)), blend(own, b))) : bgs.map(b => cr(blend(fg, b), b))));
      out.push({ t: (e.textContent || '').trim().slice(0, 22), c: e.className, r: +worst.toFixed(2) }); void tg;
    }
    return out;
  });
  const low = rows.filter(r => r.r < 4.5); assert(rows.length > 25 && !low.length, 'low contrast: ' + JSON.stringify(low.slice(0, 6)));
  const small = await page.evaluate(() => [...document.querySelectorAll('button,select,input,.rl-switch,.rl-brand,.rc-flip,.rl-fast summary')].filter(e => e.offsetParent && !e.closest('[inert]')).map(e => { const r = e.getBoundingClientRect(); return { id: e.id || e.className, w: Math.round(r.width), h: Math.round(r.height) }; }).filter(r => r.h < 43.5));
  assert(!small.length, 'small targets: ' + JSON.stringify(small));
  await ctx.close(); return `lowest text contrast ${Math.min(...rows.map(r => r.r))}:1 over ${rows.length} elements`;
});

/* =============== cards: flip by click and by keyboard =============== */
console.log('\n== behaviour ==');
await check('grid: a card flips on click to show its bulletin (full and SMS length), flips back; transform and opacity only', async () => {
  const { page, ctx, problems } = await open('grid');
  const first = page.locator('.rcard').first();
  eq(await first.getAttribute('data-face'), 'front'); assert(await first.locator('.rc-front').evaluate(e => !e.inert)); assert(await first.locator('.rc-back').evaluate(e => e.inert), 'turned-away side is inert');
  await first.locator('.rc-flip').click(); await page.waitForTimeout(700);
  eq(await first.getAttribute('data-face'), 'back');
  const txt = await first.locator('[data-k=text]').innerText();
  assert(/^SMOKE WATCH\./.test(txt) && /No detection does not mean no fire\./.test(txt), 'full bulletin text: ' + txt.slice(0, 80));
  await shot(page, 'role-grid-flipped');
  await first.locator('[data-fmt=short]').click(); const short = await first.locator('[data-k=text]').innerText();
  assert(short.length <= 160 && /^SMOKE WATCH /.test(short), 'short: ' + short); assert(/\d+ of 160 characters/.test(await first.locator('[data-k=count]').innerText()));
  assert((await first.locator('[data-act=wa]').getAttribute('href')).startsWith('https://wa.me/?text=' + encodeURIComponent('SMOKE WATCH')));
  const props = await page.evaluate(() => { const s = new Set(); document.querySelectorAll('.rcard *').forEach(e => e.getAnimations().forEach(a => a.transitionProperty && s.add(a.transitionProperty))); return [...s]; });
  assert(props.every(p => ['transform', 'opacity', 'max-height'].includes(p)), 'animated properties: ' + props);
  await first.locator('[data-back]').click(); await page.waitForTimeout(700); eq(await first.getAttribute('data-face'), 'front');
  eq(problems, []); await ctx.close();
});
await check('grid: keyboard only (Tab to a card, Enter/Space flips, focus moves to Back, Escape returns, focus returns to the card)', async () => {
  const { page, ctx } = await open('grid');
  await page.focus('.rcard >> nth=1 >> .rc-flip');
  eq(await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle), 'solid', 'focus ring on the card');
  await page.keyboard.press('Enter'); await page.waitForTimeout(100);
  eq(await page.evaluate(() => document.activeElement.dataset.back !== undefined), true, 'focus moved to Back'); eq(await page.locator('.rcard').nth(1).getAttribute('data-face'), 'back');
  await page.keyboard.press('Escape'); await page.waitForTimeout(100);
  eq(await page.locator('.rcard').nth(1).getAttribute('data-face'), 'front'); eq(await page.evaluate(() => document.activeElement.className), 'rc-flip');
  await page.keyboard.press('Space'); await page.waitForTimeout(100); eq(await page.locator('.rcard').nth(1).getAttribute('data-face'), 'back');
  await page.keyboard.press('Tab'); eq(await page.evaluate(() => !!document.activeElement.closest('.rc-back')), true, 'Tab stays on the back side controls (front is inert)');
  eq(await prog(page), '0/3'.replace('0', '0'), 'flipping one card is one review of three'); // 1 review does not complete a step
  eq(await page.$eval('[data-step=review] small', e => e.textContent), '1 of 3 reviewed');
  await ctx.close();
});
await check('road: SMS-length bulletin first, read aloud and copy present', async () => {
  const { page, ctx } = await open('road');
  const c = page.locator('.rcard').first(); await c.locator('.rc-flip').click(); await page.waitForTimeout(650);
  assert(/^SMOKE WATCH /.test(await c.locator('[data-k=text]').innerText()) && (await c.locator('[data-fmt=short]').getAttribute('aria-pressed')) === 'true', 'short form shown first');
  assert(await c.locator('[data-act=speak]').isVisible() && await c.locator('[data-act=copy]').isVisible());
  await shot(page, 'role-road-flipped'); await ctx.close();
});

/* =============== briefing =============== */
await check('briefing: three real steps reach "Briefing complete", mark today, survive a reload, and are kept per role and region', async () => {
  const { page, ctx } = await open('grid');
  await page.click('#clockBtn'); eq(await steps(page), ['true', 'false', 'false']); eq(await prog(page), '1/3');
  for (let i = 0; i < 3; i++) { await page.locator('.rcard').nth(i).locator('.rc-flip').click(); await page.waitForTimeout(150); await page.locator('.rcard').nth(i).locator('[data-back]').click(); await page.waitForTimeout(150); }
  eq(await steps(page), ['true', 'true', 'false']); eq(await prog(page), '2/3'); assert(await page.locator('#doneBox').isHidden());
  await page.locator('.rcard').first().locator('.rc-flip').click(); await page.waitForTimeout(650); await page.locator('.rcard').first().locator('[data-act=copy]').click(); await page.waitForTimeout(200);
  eq(await prog(page), '3/3'); assert(await page.locator('#doneBox').isVisible()); eq(await page.innerText('#doneH'), 'Briefing complete');
  eq(await page.$eval('#week li[data-today]', e => e.dataset.complete), 'true'); eq(await page.$$eval('#week li[data-complete=true]', l => l.length), 1);
  assert(!/points|level|badge|score|streak/i.test(await page.innerText('#briefCard')), 'no points, levels, badges, scores or streaks');
  await shot(page, 'role-grid-briefing-complete');
  await page.reload(); await ready(page);
  eq(await prog(page), '3/3', 'after reload'); assert(await page.locator('#doneBox').isVisible()); eq(await page.$$eval('#week li[data-complete=true]', l => l.length), 1);
  await page.selectOption('#regionSel', 'BO'); await ready(page); eq(await prog(page), '0/3', 'another region has its own briefing');
  await page.selectOption('#regionSel', 'PY'); await ready(page); eq(await prog(page), '3/3');
  const keys = await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('fv.briefing')));
  eq(keys, ['fv.briefing.grid.PY']);
  await ctx.close();
  const o = await open('road'); eq(await prog(o.page), '0/3', 'another role starts at 0'); await o.ctx.close();
});
const emptyFeed = async ctx => ctx.route('**/app-data/feed/PY.json', async r => { const resp = await r.fetch(); const j = await resp.json(); j.fires = { n_modis: j.fires.n_modis, idx: [], lat: [], lon: [], t: [], sat: [], frp: [] }; r.fulfill({ response: resp, json: j }); });
await check('a day with nothing in the path: the statement, an all-clear line that says satellite data and "no detection does not mean no fire", briefing completes by reading and copying it', async () => {
  const { page, ctx } = await open('grid', { routes: emptyFeed });
  eq(await page.locator('.rcard:not([data-plain])').count(), 0); assert((await page.innerText('.rl-statement')).includes('No modelled smoke path reaches any power line'));
  const txt = await page.locator('.rcard[data-plain] [data-k=text]').innerText();
  assert(/ALL CLEAR, SATELLITE DATA/.test(txt) && /three hours/.test(txt) && /No detection does not mean no fire/.test(txt), txt);
  await page.click('#clockBtn'); await page.click('[data-readnone]'); eq(await steps(page), ['true', 'true', 'false']);
  await page.locator('.rcard[data-plain] [data-act=copy]').click(); await page.waitForTimeout(200);
  eq(await prog(page), '3/3'); assert(await page.locator('#doneBox').isVisible()); assert((await page.evaluate(() => navigator.clipboard.readText())).startsWith('ALL CLEAR'));
  await shot(page, 'role-grid-no-items'); await ctx.close();
});
await check('wind API blocked: it says so, lists nothing as "not downwind", and offers a NOT ASSESSED line, never an all-clear', async () => {
  const { page, ctx, problems } = await open('grid', { stub: { windFail: true }, expectBad: true });
  assert(/could not be loaded/.test(await page.innerText('#work .rl-warn')), 'warning shown');
  eq(await page.locator('.rcard:not([data-plain])').count(), 0);
  const body = await page.innerText('#work'); assert(!/not downwind/i.test(body.replace(/Modelled wind could not.*?\"not downwind\"\./s, '')), 'no asset is called not downwind');
  const txt = await page.locator('.rcard[data-plain] [data-k=text]').innerText(); assert(/NOT ASSESSED/.test(txt) && !/ALL CLEAR/.test(txt) && /not an all-clear/i.test(txt), txt);
  await shot(page, 'role-grid-wind-blocked'); eq(problems, []); await ctx.close();
  const f = await open('firefighter', { stub: { windFail: true }, expectBad: true }); // fire brigade without wind: fires are listed, heading unknown
  await f.page.fill('#pickQ', hot.name); await f.page.locator('.rl-match', { hasText: hot.name }).first().click(); await f.page.waitForSelector('.rcard', { timeout: 20000 });
  assert((await f.page.innerText('.rcard')).includes('Wind not available'), 'heading unknown'); assert(!/No mapped asset in the modelled path/.test(await f.page.innerText('.rcard')), 'no claim about assets without wind');
  await f.ctx.close();
});
await check('fire data 404 and asset file 404: both say so; nothing is called clear', async () => {
  const a = await open('grid', { expectBad: true, routes: ctx => ctx.route('**/app-data/feed/PY.json', r => r.fulfill({ status: 404, body: 'no' })) });
  assert((await a.page.innerText('#work .rl-warn')).includes('could not be loaded')); assert(!/ALL CLEAR/.test(await a.page.innerText('#work'))); assert(/NOT ASSESSED/.test(await a.page.locator('.rcard[data-plain] [data-k=text]').innerText()));
  eq(await a.page.innerText('#lastLook'), 'unknown'); await shot(a.page, 'role-grid-feed-404'); await a.ctx.close();
  const b = await open('road', { expectBad: true, routes: ctx => ctx.route('**/app-data/assets/PY.json.gz', r => r.fulfill({ status: 404, body: 'no' })) });
  assert((await b.page.innerText('#work .rl-warn')).includes('could not be loaded')); assert(!/ALL CLEAR/.test(await b.page.innerText('#work'))); await b.ctx.close();
  const c = await open('care', { expectBad: true, routes: ctx => ctx.route('**/app-data/feed/PY.json', r => r.fulfill({ status: 404, body: 'no' })) });
  assert((await c.page.innerText('#work .rl-warn')).includes('could not be loaded')); await c.ctx.close();
});

/* =============== firefighter, care, resident =============== */
await check(`firefighter: set a base by name, fires within 50 km ranked by power with wind, heading and what is in the path; bulletin on the back  [base: ${hot.name}, ${hot.n} fires]`, async () => {
  const { page, ctx, problems } = await open('firefighter');
  await page.fill('#pickQ', hot.name.slice(0, 5)); assert(await page.locator('.rl-match').count() > 0, 'matches listed');
  await page.locator('.rl-match', { hasText: hot.name }).first().click(); await page.waitForSelector('.rcard', { timeout: 20000 });
  assert((await page.innerText('.rl-picked')).includes(hot.name), 'base shown');
  const n = await page.locator('.rcard').count(); assert(n >= 2, 'several fires: ' + n);
  const mw = await page.$$eval('.rcard .rc-lines .rc-line:first-child', l => l.map(e => parseFloat(/·\s*([\d.,]+) MW/.exec(e.textContent)[1])));
  assert(mw.every((v, i) => i === 0 || mw[i - 1] >= v), 'ranked by power: ' + mw);
  const c = page.locator('.rcard').first(), front = await c.innerText();
  assert(/Wind from the .* at .* m\/s: smoke heads/.test(front), 'wind and heading: ' + front); assert(/mapped asset|No mapped asset/.test(front), 'assets in path');
  assert(/km .* of base/.test(await c.locator('.rc-title').first().innerText()), 'distance and bearing from base');
  await shot(page, 'role-firefighter-list');
  await c.locator('.rc-flip').click(); await page.waitForTimeout(650);
  const txt = await c.locator('[data-k=text]').innerText(); assert(/^FIRE WATCH\./.test(txt) && /modelled scenario/.test(txt), txt.slice(0, 90));
  await c.locator('[data-fmt=short]').click(); assert((await c.locator('[data-k=text]').innerText()).length <= 160);
  await shot(page, 'role-firefighter-flipped');
  await page.reload(); await ready(page); assert((await page.innerText('.rl-picked')).includes(hot.name), 'the base is remembered');
  await page.click('[data-change]'); assert(await page.locator('#pickQ').isVisible());
  eq(problems, []); await ctx.close();
});
await check('firefighter: device location only on request (Use my location sets the base)', async () => {
  const { page, ctx } = await open('firefighter', { ctxOpts: { permissions: ['geolocation'], geolocation: { latitude: -25.28, longitude: -57.63 } } });
  eq(await page.evaluate(() => !!document.querySelector('.rl-picked')), false, 'nothing is read before the person asks');
  await page.click('[data-geo]'); await page.waitForSelector('.rl-picked', { timeout: 20000 }); assert((await page.innerText('.rl-picked')).includes('-25.28'));
  await ctx.close();
  const d = await open('firefighter', { ctxOpts: { permissions: [] } }); await d.page.click('[data-geo]'); await d.page.waitForTimeout(500);
  assert(/not allowed|could not be found|cannot give/i.test(await d.page.innerText('#pickMsg')), 'denied location is explained'); await d.ctx.close();
});
for (const role of ['care', 'resident']) await check(`${role}: one site/place, one answer by the My place logic; share by WhatsApp; flips; language switch`, async () => {
  const { page, ctx, problems } = await open(role);
  const q = role === 'care' ? 'Hospital' : hot.name.slice(0, 5);
  await page.fill('#pickQ', q); const m = page.locator('.rl-match').first(); assert(await m.count() > 0, 'matches'); const picked = (await m.innerText()).split(' · ')[0].trim();
  await m.click(); await page.waitForSelector('.rcard', { timeout: 20000 });
  eq(await page.locator('.rcard').count(), 1); const c = page.locator('.rcard');
  const head = await c.locator('.rc-title').first().innerText(); assert(/SMOKE|FIRE|NO SATELLITE|WIND UNKNOWN|OUTSIDE/.test(head), 'status headline: ' + head);
  await shot(page, `role-${role}-answer`);
  await c.locator('.rc-flip').click(); await page.waitForTimeout(650);
  const txt = await c.locator('[data-k=text]').innerText(); assert(txt.includes(picked) && /No detection does not mean no fire/.test(txt), txt.slice(0, 120));
  const wa = await c.locator('[data-act=wa]').getAttribute('href'); assert(wa.startsWith('https://wa.me/?text=') && decodeURIComponent(wa).includes('place.html?r=PY&lat='), 'WhatsApp link with the place link');
  await c.locator('[data-back]').click(); await page.waitForTimeout(650);
  await page.click('[data-lang=es]'); assert(/[ÁÉÍÓÚ]/.test(await c.locator('.rc-title').first().innerText()) || /NINGÚN|LA TRAYECTORIA|FUEGO|VIENTO|FUERA/.test(await c.locator('.rc-title').first().innerText()), 'Spanish headline');
  eq(problems, []); await ctx.close();
});

/* =============== region, language, redirects, reduced motion =============== */
await check('region switch: all four regions load for the grid and road roles with the region name, time zone and URL; AR and BR say schools are not loaded only where it matters', async () => {
  const { page, ctx, problems } = await open('road');
  for (const iso of ['BO', 'AR', 'BR', 'PY']) {
    await page.selectOption('#regionSel', iso); await ready(page);
    assert(page.url().includes('r=' + iso), 'url has r=' + iso); eq(await page.$eval('#regionSel', e => e.value), iso);
    assert((await page.innerText('#rMode')).toLowerCase().includes({ BO: 'bolivia', AR: 'argentina', BR: 'brazil', PY: 'paraguay' }[iso]), 'region name in the header');
    assert(await page.locator('.rcard').count() + await page.locator('.rl-statement').count() > 0, 'a list or a statement for ' + iso);
    assert(/\(.*(Bolivia|Argentina|Brasília|Paraguay) time\)/.test(await page.innerText('#lastLook')), 'region time zone in the clock: ' + await page.innerText('#lastLook'));
  }
  eq(await page.evaluate(() => localStorage.getItem('fv.region')), 'PY', 'last region remembered');
  eq(problems, []); await ctx.close();
  for (const iso of ['AR', 'BR']) { const o = await open('care', { region: iso }); await o.page.fill('#pickQ', 'escuela'); await o.page.waitForTimeout(200); assert(await o.page.locator('.rl-match:has-text("school")').count() === 0, 'no schools offered where the layer was not built'); await o.ctx.close(); }
});
await check('region from the last region used when ?r is absent, then PY', async () => {
  const { page, ctx } = await open('grid', { region: 'BO' }); await page.goto(`${BASE}/role.html?role=grid`); await ready(page); eq(await page.$eval('#regionSel', e => e.value), 'BO'); await ctx.close();
  const c2 = await browser.newContext(); const p2 = await c2.newPage(); await stubOutside(c2); await p2.goto(`${BASE}/role.html?role=grid`); await ready(p2); eq(await p2.$eval('#regionSel', e => e.value), 'PY'); await c2.close();
});
await check('language switch EN / ES / PT: title, question, labels, bulletin language, note about unreviewed templates', async () => {
  const { page, ctx } = await open('grid');
  eq(await page.$$eval('#langBox button', l => l.map(b => b.textContent)), ['English', 'Español', 'Português']); assert(await page.locator('#esNote').isHidden(), 'no note in English');
  await page.click('[data-lang=es]'); eq(await page.innerText('#rTitle'), 'Operador de red'); assert((await page.innerText('#rQuestion')).startsWith('¿Qué líneas')); eq(await page.getAttribute('html', 'lang'), 'es');
  assert((await page.innerText('#switchTxt')) === 'Cambiar de rol'); assert((await page.innerText('#esNote')).includes('no los ha revisado un hablante nativo'));
  await page.locator('.rcard').first().locator('.rc-flip').click(); await page.waitForTimeout(650); assert(/^VIGILANCIA DE HUMO/.test(await page.locator('.rcard').first().locator('[data-k=text]').innerText()));
  await page.click('[data-lang=pt]'); eq(await page.innerText('#rTitle'), 'Operador de rede'); assert(/^VIGILÂNCIA DE FUMAÇA/.test(await page.locator('.rcard').first().locator('[data-k=text]').innerText()), 'open card re-texts');
  assert((await page.innerText('#esNote')).includes('não foram revisados por um falante nativo')); eq(await page.evaluate(() => localStorage.getItem('fv.role.lang')), '"pt"');
  await page.reload(); await ready(page); eq(await page.innerText('#rTitle'), 'Operador de rede', 'language remembered');
  await page.click('[data-lang=en]'); eq(await page.innerText('#rTitle'), 'Grid operator'); await ctx.close();
});
await check('bad role redirects: unknown and missing go to start.html, analyst goes to index.html', async () => {
  for (const [q, want] of [['?role=nope', '/start.html'], ['', '/start.html'], ['?role=analyst', '/index.html'], ['?role=GRID', '/start.html']]) {
    const ctx = await browser.newContext(); const page = await ctx.newPage(); await stubOutside(ctx);
    await page.goto(`${BASE}/role.html${q}`, { waitUntil: 'commit' }); await page.waitForURL(u => u.pathname === want, { waitUntil: 'commit', timeout: 10000 }); eq(new URL(page.url()).pathname, want, q); await ctx.close();
  }
  const ctx = await browser.newContext(); const page = await ctx.newPage(); await page.goto(`${BASE}/role.html?role=nope&r=BO`, { waitUntil: 'commit' }); await page.waitForURL(/start\.html/, { waitUntil: 'commit' }); assert(page.url().includes('r=BO'), 'region carried'); await ctx.close();
});
await check('start.html: choosing each card lands on the right role page with r= carried and the region applied; "/" is the front door', async () => {
  for (const r of ROLES) {
    const ctx = await browser.newContext({ viewport: VP.desktop }); await stubOutside(ctx); const page = await ctx.newPage();
    await page.goto(`${BASE}/start.html?r=BO`); await page.click('#dealBtn'); await page.waitForFunction(() => document.getElementById('deck').dataset.state === 'shown');
    await page.click(`.card[data-role="${r.id}"]`, { noWaitAfter: true }); await page.waitForURL(u => u.pathname === '/role.html', { waitUntil: 'commit', timeout: 10000 });
    const u = new URL(page.url()); eq([u.searchParams.get('role'), u.searchParams.get('r')], [r.id, 'BO']);
    await ready(page); eq(await page.$eval('#regionSel', e => e.value), 'BO'); eq(await page.innerText('#rTitle'), r.title); eq(await page.evaluate(() => localStorage.getItem('fv.role')), r.id);
    await ctx.close();
  }
  const ctx = await browser.newContext(); const page = await ctx.newPage(); await page.goto(BASE + '/'); eq(await page.title(), 'Choose your role · FIREVERSE'); await ctx.close();
});
await check('reduced motion: the card swaps sides with a fade and no transform at any moment; content intact', async () => {
  const { page, ctx, problems } = await open('grid', { reduced: true });
  await page.evaluate(() => { window.__s = []; const tick = () => { window.__s.push([...document.querySelectorAll('.rc-inner')].filter(e => getComputedStyle(e).transform !== 'none').length + (document.getAnimations().some(a => a.transitionProperty === 'transform') ? 1000 : 0)); if (window.__s.length < 120) requestAnimationFrame(tick); }; requestAnimationFrame(tick); });
  const c = page.locator('.rcard').first(); await c.locator('.rc-flip').click(); await page.waitForTimeout(500);
  eq(await c.getAttribute('data-face'), 'back'); assert(await c.locator('.rc-front').evaluate(e => getComputedStyle(e).display === 'none'), 'front hidden'); assert(await c.locator('.rc-back').isVisible());
  assert(/^SMOKE WATCH/.test(await c.locator('[data-k=text]').innerText()));
  const s = await page.evaluate(() => window.__s); assert(s.length > 10 && s.every(x => x === 0), 'a frame had a transform: ' + s.filter(Boolean).slice(0, 3));
  await shot(page, 'role-grid-reduced-motion'); eq(problems, []); await ctx.close();
});
await check('phone: a flipped card and the open fast look cause no horizontal overflow', async () => {
  const { page, ctx } = await open('grid', { vp: 'phone' });
  await page.locator('.rcard').first().locator('.rc-flip').click(); await page.waitForTimeout(700);
  let o = await overflow(page); assert(o.sw <= o.iw + 1 && !o.bad.length, `overflow ${o.sw}>${o.iw} ${o.bad}`);
  await shot(page, 'role-grid-phone-flipped', true);
  await page.click('#fastSum'); await page.waitForSelector('#fastBody .rcard, #fastBody .rl-statement, #fastBody .rl-warn', { timeout: 20000 });
  o = await overflow(page); assert(o.sw <= o.iw + 1 && !o.bad.length, `overflow with fast look ${o.sw}>${o.iw} ${o.bad}`); await ctx.close();
});
await check('grid: the fast 10-minute look is a secondary block, loaded on request, with coarse-pixel cards and the FAST tag', async () => {
  const { page, ctx, problems } = await open('grid');
  eq(await page.locator('#fastBox').isVisible(), true); assert(!(await page.locator('#fastBox').evaluate(e => e.open)), 'closed until asked');
  eq(await page.locator('#fastBody .rcard').count(), 0, 'nothing fetched before it is opened');
  await page.click('#fastSum'); await page.waitForSelector('#fastBody .rcard', { timeout: 20000 });
  assert(/FAST · COARSE/.test(await page.innerText('#fastBody')) && /no fire size/.test(await page.innerText('#fastBody'))); await shot(page, 'role-grid-fast');
  const c = page.locator('#fastBody .rcard').first(); await c.locator('.rc-flip').click(); await page.waitForTimeout(650); assert(/^SMOKE WATCH, FAST VIEW/.test(await c.locator('[data-k=text]').innerText()));
  eq(await prog(page), '0/3', 'fast-look cards do not count as the briefing review'); eq(problems, []); await ctx.close();
  const r = await open('road'); eq(await r.page.locator('#fastBox').isVisible(), false, 'road has no fast block'); await r.ctx.close();
});

await browser.close();
console.log('\nPage weight of role.html per role (PY, desktop, dark, requests and kB on the wire as served; includes the shared css, js, feed and asset file; same-origin files only: excludes Google Fonts and the wind service):');
for (const [role, b] of Object.entries(weights)) { const own = b.list.filter(x => !/^https?:/.test(x[0])), ext = b.list.filter(x => /open-meteo/.test(x[0])); console.log(`  ${role.padEnd(12)} ${String(own.length).padStart(3)} requests  ${(own.reduce((s, x) => s + x[2], 0) / 1024).toFixed(0).padStart(5)} kB   (${own.filter(x => /feed|assets/.test(x[0])).map(x => x[0].split('/').pop() + ' ' + (x[2] / 1024).toFixed(0) + ' kB').join(', ') || 'no data files'}); wind requests (stubbed here): ${ext.length}`); }
console.log(`\n${total - failed} of ${total} checks passed${failed ? `, ${failed} FAILED` : ''}. Screenshots: tests/e2e/shots/`);
process.exit(failed ? 1 : 0);
