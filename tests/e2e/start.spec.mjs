// node tests/e2e/start.spec.mjs
// Drives the real Chrome installed on this machine (playwright-core, channel 'chrome', headless; no browser download).
// Needs the app server on BASE (default http://127.0.0.1:8000) serving web/. Screenshots go to tests/e2e/shots/.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const BASE = (process.env.BASE_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.join(HERE, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });

// the data under test comes from the same file the page loads
const ctx = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(HERE, '../../web/js/roles.js'), 'utf8'), ctx);
const ROLES = JSON.parse(JSON.stringify(ctx.ROLES.list));
const TITLES = ROLES.map(r => r.title);

const results = []; let failed = 0;
async function check(name, fn) {
  try { const note = await fn(); results.push({ name, ok: true, note }); console.log('  ok   ' + name + (note ? '  [' + note + ']' : '')); }
  catch (e) { failed++; results.push({ name, ok: false, note: e.message }); console.log('  FAIL ' + name + '\n       ' + String(e.message).split('\n').join('\n       ')); }
}
const assert = (c, m) => { if (!c) throw new Error(m || 'assertion failed'); };
const eq = (a, b, m) => assert(JSON.stringify(a) === JSON.stringify(b), `${m || 'not equal'}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

let browser;
try { browser = await chromium.launch({ channel: 'chrome', headless: true }); }
catch (e) {
  console.error('Could not launch Chrome with channel "chrome": ' + e.message);
  console.error('Nothing was run. Fall back to the Playwright MCP browser tools for the same checks, and say which ran where.');
  process.exit(2);
}
console.log('Chrome ' + browser.version() + ' (headless, channel chrome)\n');

/* ---------- helpers ---------- */
const VIEWPORTS = { desktop: { width: 1440, height: 900 }, phone: { width: 390, height: 844 } };
async function open({ vp = 'desktop', theme = 'dark', reduced = false, role = null, js = true } = {}) {
  const context = await browser.newContext({ viewport: VIEWPORTS[vp], reducedMotion: reduced ? 'reduce' : 'no-preference', javaScriptEnabled: js, deviceScaleFactor: 1 });
  if (js) await context.addInitScript(([t, r]) => { try { if (!localStorage.getItem('theme')) localStorage.setItem('theme', t === 'light' ? 'light' : 'dark'); /* the Paper (light) theme is the default, so dark is asked for */ if (r) localStorage.setItem('fv.role', r); } catch (e) {} }, [theme, role]);
  const page = await context.newPage();
  const problems = [];
  page.on('console', m => { if (m.type() === 'error') problems.push('console: ' + m.text()); });
  page.on('pageerror', e => problems.push('pageerror: ' + e.message));
  page.on('requestfailed', r => problems.push('failed: ' + r.url() + ' ' + (r.failure() || {}).errorText));
  page.on('response', r => { if (r.status() >= 400) problems.push('http ' + r.status() + ': ' + r.url()); });
  await page.goto(BASE + '/start.html', { waitUntil: 'load' });
  return { page, context, problems };
}
const state = page => page.getAttribute('#deck', 'data-state');
const waitState = (page, s, timeout = 5000) => page.waitForFunction(v => document.getElementById('deck').dataset.state === v, s, { timeout });
const shot = (page, name, full = false) => page.screenshot({ path: path.join(SHOTS, name + '.png'), fullPage: full });
const rects = (page, sel = '.card') => page.$$eval(sel, els => els.map(e => { const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height }; }));
const overlap = (a, b) => Math.max(0, Math.min(a.r, b.r) - Math.max(a.l, b.l)) * Math.max(0, Math.min(a.b, b.b) - Math.max(a.t, b.t));
async function assertLaidOut(page, label) {
  const rs = await rects(page), vw = page.viewportSize().width;
  eq(rs.length, 7, label + ': seven cards');
  rs.forEach((r, i) => { assert(r.w > 100 && r.h > 100, `${label}: card ${i} has a real size`); assert(r.l >= -0.5 && r.r <= vw + 0.5, `${label}: card ${i} inside the viewport horizontally (${r.l.toFixed(1)}..${r.r.toFixed(1)} of ${vw})`); });
  for (let i = 0; i < 7; i++) for (let j = i + 1; j < 7; j++) assert(overlap(rs[i], rs[j]) <= 1, `${label}: cards ${i} and ${j} overlap by ${overlap(rs[i], rs[j]).toFixed(0)} px2`);
  const bad = await page.$$eval('.card', els => els.filter(e => getComputedStyle(e).opacity !== '1' || getComputedStyle(e.closest('.slot')).display === 'none').length);
  eq(bad, 0, label + ': every card fully opaque');
}
async function dealAndWait(page) { await page.click('#dealBtn'); await waitState(page, 'shown'); }
const cardLink = (page, id) => page.getAttribute(`.card[data-role="${id}"]`, 'href');

// WCAG contrast of text against the surface it sits on; surfaces are theme tokens, so the worst of the candidates is used
const contrastProbe = () => {
  const px = s => { const c = document.createElement('canvas').getContext('2d'); c.fillStyle = s; c.fillRect(0, 0, 1, 1); const d = c.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2]]; };
  const lum = ([r, g, b]) => { const f = v => { v /= 255; return v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }; return .2126 * f(r) + .7152 * f(g) + .0722 * f(b); };
  const cr = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
  const tok = n => getComputedStyle(document.body).getPropertyValue(n).trim();
  const light = document.body.classList.contains('light');
  const page = light ? [tok('--bg-0')] : [tok('--bg-0'), '#0E3445'], card = [tok('--bg-1'), tok('--bg-2')];
  const own = e => getComputedStyle(e).backgroundColor;
  const rows = [], add = (sel, surfaces) => document.querySelectorAll(sel).forEach(e => {
    if (!e.offsetParent && e.tagName !== 'BODY') return;
    const fg = px(getComputedStyle(e).color);
    const worst = Math.min(...surfaces.map(s => cr(fg, px(s))));
    rows.push({ sel, text: (e.textContent || '').trim().slice(0, 24), ratio: +worst.toFixed(2) });
  });
  add('.st-hero h1', page); add('.st-hero p', page); add('.st-foot p', page); add('.st-foot a', page); add('.alt label', page);
  add('.face-front .title', card); add('.face-front .q', card); add('.face-front .tag', card); add('.face-front .mod', card.concat(light ? [tok('--bg-2')] : []));
  add('#dealBtn.primary-btn', [own(document.getElementById('dealBtn'))]); add('#gatherBtn', page); add('#openBtn', page);
  add('#roleSelect', [tok('--bg-1')]); add('.last', card);
  return rows;
};

async function pageStateShots() {}

/* =============== per viewport x theme =============== */
for (const vp of ['desktop', 'phone']) for (const theme of ['dark', 'light']) {
  const tag = `${vp}-${theme}`;
  console.log(`\n== ${vp} ${VIEWPORTS[vp].width}x${VIEWPORTS[vp].height}, ${theme} theme ==`);
  const { page, context, problems } = await open({ vp, theme });
  await page.waitForTimeout(500);

  await check(`[${tag}] stacked state: seven face-down cards, deal button, theme applied`, async () => {
    eq(await state(page), 'stacked');
    eq(await page.$$eval('.slot', l => l.length), 7);
    eq(await page.$$eval('.slot', l => l.every(s => s.inert && s.getAttribute('aria-hidden') === 'true')), true, 'face-down cards are inert and hidden from AT');
    eq(await page.$$eval('.card', l => l.every(c => c.tabIndex === -1)), true, 'face-down cards are not focusable');
    eq(await page.locator('#dealBtn').isVisible(), true); eq((await page.innerText('#dealBtn')).trim(), 'Deal the roles');
    eq(await page.locator('#gatherBtn').isVisible(), false);
    eq(await page.evaluate(() => document.body.classList.contains('light')), theme === 'light', 'theme class');
    // all seven backs sit on one spot (within the stack offsets)
    const rs = await rects(page, '.flip'); const cx = rs.map(r => (r.l + r.r) / 2), cy = rs.map(r => (r.t + r.b) / 2);
    assert(Math.max(...cx) - Math.min(...cx) < 16 && Math.max(...cy) - Math.min(...cy) < 20, 'cards are stacked together');
    const vw = VIEWPORTS[vp].width; rs.forEach(r => assert(r.l >= 0 && r.r <= vw, 'stack inside viewport'));
    assert(await page.locator('#dealBtn').evaluate(b => { const r = b.getBoundingClientRect(); return r.bottom <= innerHeight; }), 'deal button visible without scrolling');
    await shot(page, `${tag}-1-stacked`);
  });

  await check(`[${tag}] dealing: states pass dealing then shown; only transform and opacity animate`, async () => {
    await page.evaluate(() => { window.__t = new Promise(res => { document.getElementById('dealBtn').addEventListener('click', () => {
      const d = document.getElementById('deck'), t0 = performance.now(); let faceUp = null, started = false; const props = new Set();
      const tick = () => {
        const run = document.getAnimations().filter(a => a.playState === 'running' && a.effect.target && a.effect.target.closest && a.effect.target.closest('.slots'));
        if (run.length) started = true;
        run.forEach(a => { if (a.transitionProperty) props.add(a.transitionProperty); else if (a.animationName) a.effect.getKeyframes().forEach(k => Object.keys(k).forEach(p => { if (!['offset', 'easing', 'composite', 'computedOffset'].includes(p)) props.add(p); })); });
        if (started && !run.length && faceUp === null) faceUp = performance.now() - t0;
        if (d.dataset.state === 'shown' && faceUp !== null) res({ faceUp, shown: performance.now() - t0, props: [...props] }); else requestAnimationFrame(tick);
      }; requestAnimationFrame(tick); }, { once: true }); }); });
    await page.click('#dealBtn');
    await waitState(page, 'dealing', 1000).catch(() => {});
    await page.waitForTimeout(330);
    eq(await state(page), 'dealing', 'mid-deal the state is dealing');
    await shot(page, `${tag}-2-mid-deal`);
    const t = await page.evaluate(() => window.__t);
    assert(t.props.length > 0 && t.props.every(p => ['transform', 'opacity'].includes(p)), 'animated properties: ' + t.props.join(','));
    await waitState(page, 'shown');
    return `all cards face up after ${Math.round(t.faceUp)} ms, state shown at ${Math.round(t.shown)} ms; animated: ${t.props.join(',')}`;
  });

  await check(`[${tag}] shown: right titles in order, details, no overlap, inside viewport, live announcement, focus on first card`, async () => {
    await page.waitForTimeout(250);
    eq(await page.$$eval('.card .title', l => l.map(e => e.textContent)), TITLES, 'titles in order');
    const detail = await page.$$eval('.card', l => l.map(c => ({ q: c.querySelector('.q').textContent, mods: [...c.querySelectorAll('.mod')].map(m => m.textContent), tag: c.querySelector('.tag').textContent, svg: !!c.querySelector('.bubble svg path, .bubble svg circle') })));
    detail.forEach((d, i) => { eq(d.q, ROLES[i].question, 'question ' + i); eq(d.mods, ROLES[i].modules, 'modules ' + i); eq(d.tag, ROLES[i].mode === 'full' ? 'Full workspace' : 'Simplified view', 'tag ' + i); assert(d.svg, 'icon ' + i); });
    await assertLaidOut(page, tag);
    eq(await page.$$eval('.slot', l => l.every(s => !s.inert && s.getAttribute('aria-hidden') === 'false')), true, 'cards exposed once shown');
    eq((await page.innerText('#live')).trim(), 'Seven roles shown');
    eq(await page.evaluate(() => document.activeElement && document.activeElement.dataset.role), 'firefighter', 'focus on the first card');
    eq(await page.locator('#gatherBtn').isVisible(), true); eq(await page.locator('#dealBtn').isVisible(), false);
    // links are real anchors inside a list
    eq(await page.$$eval('ol#slots > li > a.card', l => l.length), 7);
    await page.mouse.move(2, 2); await page.waitForTimeout(250);
    await shot(page, `${tag}-3-shown`, vp === 'phone');
  });

  await check(`[${tag}] contrast >= 4.5:1 for text, tap targets >= 44 px`, async () => {
    const rows = await page.evaluate(contrastProbe);
    assert(rows.length > 15, 'probe found the text elements (' + rows.length + ')');
    const low = rows.filter(r => r.ratio < 4.5); assert(!low.length, 'low contrast: ' + JSON.stringify(low));
    const small = await page.evaluate(() => [...document.querySelectorAll('#dealBtn,#gatherBtn,#openBtn,#roleSelect,#themeToggle,.st-brand,.st-foot a,.card')].filter(e => e.offsetParent).map(e => { const r = e.getBoundingClientRect(); return { id: e.id || e.className || e.tagName, w: r.width, h: r.height }; }).filter(r => r.h < 43.9 || r.w < 43.9));
    assert(!small.length, 'small targets: ' + JSON.stringify(small));
    return `lowest text contrast ${Math.min(...rows.map(r => r.ratio))}:1`;
  });

  await check(`[${tag}] select list mirrors the cards and stays in sync`, async () => {
    eq(await page.$$eval('#roleSelect option', l => l.slice(1).map(o => o.textContent)), TITLES);
    eq(await page.$$eval('#roleSelect option', l => l.slice(1).map(o => o.value)), ROLES.map(r => r.id));
    eq(await page.$eval('label[for=roleSelect]', e => e.textContent.trim()), 'Or choose from a list');
    await page.selectOption('#roleSelect', 'road');
    eq(await page.$$eval('.slot[data-current]', l => l.map(s => s.dataset.role)), ['road'], 'card follows the select');
  });

  if (vp === 'desktop') await check(`[${tag}] hover lifts and tilts a card, brightens its edge, animates only transform and opacity`, async () => {
    const box = await page.locator('.card[data-role="grid"]').boundingBox();
    const idle = await page.$eval('.card[data-role="grid"] .tilt', e => getComputedStyle(e).transform);
    await page.mouse.move(box.x + box.width * .8, box.y + box.height * .25); await page.waitForTimeout(400);
    const hov = await page.$eval('.card[data-role="grid"]', c => ({ t: getComputedStyle(c.querySelector('.tilt')).transform, edge: getComputedStyle(c.querySelector('.face-front'), '::after').opacity }));
    assert(hov.t !== idle && hov.t !== 'none', 'tilt transform changed: ' + hov.t);
    eq(hov.edge, '1', 'accent edge visible on hover');
    const props = await page.evaluate(() => { const s = new Set(); document.querySelectorAll('.slots *').forEach(e => e.getAnimations().forEach(a => a.transitionProperty && s.add(a.transitionProperty))); return [...s]; });
    assert(props.every(p => ['transform', 'opacity'].includes(p)), 'transition properties: ' + props);
    await shot(page, `${tag}-4-hover`);
    await page.mouse.move(2, 2);
  });

  await check(`[${tag}] no console errors or failed requests (stacked, dealt, theme toggle)`, async () => {
    await page.click('#themeToggle'); await page.waitForTimeout(150);
    eq(await page.evaluate(() => document.body.classList.contains('light')), theme !== 'light', 'toggle flips the theme');
    eq(await page.evaluate(() => localStorage.getItem('theme')), theme === 'light' ? 'dark' : 'light', 'theme stored');
    await page.click('#themeToggle');
    eq(problems, [], 'problems');
  });
  await context.close();
}

/* =============== behaviour =============== */
console.log('\n== behaviour (desktop, dark unless noted) ==');

await check('keyboard only: Tab to Deal, Enter deals, Tab through cards, Escape gathers, Enter deals again, Enter on Analyst opens index.html and stores the role', async () => {
  const { page, context, problems } = await open();
  let found = false;
  for (let i = 0; i < 8 && !found; i++) { await page.keyboard.press('Tab'); found = await page.evaluate(() => document.activeElement.id === 'dealBtn'); }
  assert(found, 'Deal button reachable with Tab; no card or stack is in the tab order before it');
  eq(await page.evaluate(() => document.activeElement.matches(':focus-visible')), true, 'visible focus on the button');
  await page.keyboard.press('Enter'); await waitState(page, 'shown');
  eq(await page.evaluate(() => document.activeElement.dataset.role), 'firefighter', 'focus moved to the first card');
  eq(await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle), 'solid', 'focus ring visible');
  await shot(page, 'desktop-dark-5-keyboard-focus');
  for (let i = 1; i < 7; i++) { await page.keyboard.press('Tab'); eq(await page.evaluate(() => document.activeElement.dataset.role), ROLES[i].id, 'Tab order follows the card order'); }
  eq(await page.$eval('#roleSelect', s => s.value), 'analyst', 'the list follows keyboard focus');
  await page.keyboard.press('Escape'); await waitState(page, 'stacked');
  eq(await page.evaluate(() => document.activeElement.id), 'dealBtn', 'focus returns to the Deal button');
  await page.waitForTimeout(700);
  eq(await page.$$eval('.card', l => l.every(c => c.tabIndex === -1)), true, 'gathered cards are not focusable');
  await page.keyboard.press('Enter'); await waitState(page, 'shown');
  for (let i = 0; i < 6; i++) await page.keyboard.press('Tab');
  eq(await page.evaluate(() => document.activeElement.dataset.role), 'analyst');
  eq(problems, [], 'no problems before leaving');
  await Promise.all([page.waitForURL(/\/index\.html/, { waitUntil: 'commit', timeout: 8000 }), page.keyboard.press('Enter')]);
  eq(await page.evaluate(() => localStorage.getItem('fv.role')), 'analyst', 'role stored');
  await context.close();
});

await check('Space activates a focused card (opens role.html?role=road)', async () => {
  const { page, context } = await open();
  await dealAndWait(page);
  await page.focus('.card[data-role="road"]');
  await Promise.all([page.waitForURL(/role\.html\?role=road(&|$)/, { waitUntil: 'commit', timeout: 8000 }), page.keyboard.press('Space')]);
  eq(await page.evaluate(() => localStorage.getItem('fv.role')), 'road');
  await context.close();
});

await check('clicking Analyst: it lifts, the others dim and slide back, then index.html opens and the role is stored', async () => {
  const { page, context } = await open();
  await dealAndWait(page);
  const before = await rects(page);
  await page.click('.card[data-role="analyst"]', { noWaitAfter: true });
  await page.waitForTimeout(160);
  const mid = await page.evaluate(() => ({ s: document.getElementById('deck').dataset.state, picked: document.querySelector('.slot[data-picked]')?.dataset.role, dim: [...document.querySelectorAll('.slot:not([data-picked]) .card')].map(c => +getComputedStyle(c).opacity) }));
  eq(mid.s, 'leaving'); eq(mid.picked, 'analyst'); assert(mid.dim.every(o => o < 1), 'others are dimming: ' + mid.dim);
  await shot(page, 'desktop-dark-6-leaving');
  await page.waitForURL(/\/index\.html$/, { waitUntil: 'commit', timeout: 8000 });
  eq(await page.evaluate(() => localStorage.getItem('fv.role')), 'analyst');
  assert(before.length === 7);
  await context.close();
});

await check('double activation and fast repeated clicks navigate once and leave no stranded cards after Back', async () => {
  const { page, context } = await open();
  await dealAndWait(page);
  let navs = 0; page.on('load', () => { navs++; });   // document loads only: the role page's history.replaceState is not a navigation
  await page.click('.card[data-role="care"]', { clickCount: 3, delay: 10, noWaitAfter: true });
  await page.click('#gatherBtn', { noWaitAfter: true, timeout: 500 }).catch(() => {});
  await page.waitForURL(/role\.html\?role=care(&|$)/, { waitUntil: 'commit', timeout: 8000 });
  await page.waitForTimeout(300);
  assert(navs === 1, 'one navigation, got ' + navs);
  await page.goBack({ waitUntil: 'load' });
  await page.waitForFunction(() => document.getElementById('deck').dataset.state === 'shown', null, { timeout: 6000 });   // saved role deals again, or bfcache restores
  await page.waitForTimeout(300);
  await assertLaidOut(page, 'after Back');
  await context.close();
});

await check('rapid Deal / Gather / Deal never strands a card', async () => {
  const { page, context } = await open();
  await page.click('#dealBtn'); await page.waitForTimeout(120); await page.keyboard.press('Escape'); await page.waitForTimeout(80);
  await page.click('#dealBtn'); await page.waitForTimeout(60); await page.click('#dealBtn', { force: true, timeout: 500 }).catch(() => {});
  await waitState(page, 'shown'); await page.waitForTimeout(250);
  await assertLaidOut(page, 'after rapid toggling');
  eq(await page.$$eval('.flip', l => l.every(f => getComputedStyle(f).transform !== 'none')), true, 'all flipped');
  await page.keyboard.press('Escape'); await waitState(page, 'stacked'); await page.waitForTimeout(900);
  const rs = await rects(page, '.flip'), cx = rs.map(r => (r.l + r.r) / 2), cy = rs.map(r => (r.t + r.b) / 2);
  assert(Math.max(...cx) - Math.min(...cx) < 16 && Math.max(...cy) - Math.min(...cy) < 20, 'back in one stack');
  eq(await page.evaluate(() => document.getElementById('deck').hasAttribute('data-compact')), true);
  await context.close();
});

await check('a saved role: deals on load, marks "Last used", offers "Continue as ..." as the primary button', async () => {
  const { page, context, problems } = await open({ role: 'firefighter' });
  await waitState(page, 'shown', 6000); await page.waitForTimeout(250);
  eq(await page.$$eval('.last', l => l.map(e => e.textContent)), ['Last used']);
  eq(await page.$eval('.slot[data-last]', s => s.dataset.role), 'firefighter');
  eq((await page.innerText('#continueLink')).trim(), 'Continue as Fire brigade');
  assert(await page.$eval('#continueLink', e => e.classList.contains('primary-btn')), 'continue is primary');
  eq(await page.$eval('#roleSelect', s => s.value), 'firefighter');
  await assertLaidOut(page, 'saved role');
  await shot(page, 'desktop-dark-7-saved-role');
  await page.click('#gatherBtn'); await waitState(page, 'stacked'); await page.waitForTimeout(800);
  eq(await page.locator('#dealBtn').isVisible(), true, 'can deal again'); eq(await page.locator('#continueLink').isVisible(), true);
  eq(problems, [], 'problems on this page');
  await page.click('#continueLink', { noWaitAfter: true });
  await page.waitForURL(/role\.html\?role=firefighter(&|$)/, { waitUntil: 'commit', timeout: 8000 });
  await context.close();
});

await check('a stale or unknown saved role is ignored', async () => {
  const { page, context } = await open({ role: 'astronaut' });
  await page.waitForTimeout(600); eq(await state(page), 'stacked'); eq(await page.locator('#continueLink').isVisible(), false);
  await context.close();
});

await check('select and Open from the stacked state go to the same href as the card; from the shown state too', async () => {
  for (const startShown of [false, true]) for (const id of ['analyst', 'grid', 'resident']) {
    const { page, context } = await open();
    if (startShown) await dealAndWait(page);
    const want = new URL(await cardLink(page, id), BASE + '/start.html').href;
    await page.selectOption('#roleSelect', id);
    await Promise.all([page.waitForURL(u => u.href === want, { waitUntil: 'commit', timeout: 8000 }), page.click('#openBtn')]);
    eq(await page.evaluate(() => localStorage.getItem('fv.role')), id, 'role stored via the list');
    await context.close();
  }
  const { page, context } = await open();
  await page.click('#openBtn'); await page.waitForTimeout(300);
  eq(new URL(page.url()).pathname, '/start.html', 'Open with nothing chosen stays put');
  eq(await page.evaluate(() => document.activeElement.id), 'roleSelect', 'and moves focus to the list');
  await context.close();
});

await check('the region in the address (?r=PY) is carried to every role link and the list', async () => {
  const { page, context } = await open();
  await page.goto(BASE + '/start.html?r=py'); await page.waitForTimeout(300);
  eq(await page.$$eval('.card', l => l.map(c => c.getAttribute('href'))), ROLES.map(r => r.href + (r.href.includes('?') ? '&' : '?') + 'r=PY'));
  await context.close();
});

await check('clicking the stack itself deals', async () => {
  const { page, context } = await open();
  const box = await page.locator('#stackHit').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await waitState(page, 'shown'); await context.close();
});

await check('reduced motion: cards are face up and without transforms at every moment of the deal, with a short fade', async () => {
  const { page, context, problems } = await open({ reduced: true });
  eq(await state(page), 'stacked');
  await page.evaluate(() => { window.__s = []; const d = document.getElementById('deck'); const tick = () => { if (d.dataset.state !== 'stacked') window.__s.push({ s: d.dataset.state, tf: [...document.querySelectorAll('.card,.arc,.lob,.tilt,.flip')].filter(e => getComputedStyle(e).transform !== 'none').length, front: [...document.querySelectorAll('.face-front')].every(f => getComputedStyle(f).transform === 'none' && f.getBoundingClientRect().width > 100), back: [...document.querySelectorAll('.face-back')].every(f => getComputedStyle(f).display === 'none'), anim: document.getAnimations().some(a => a.transitionProperty && a.transitionProperty === 'transform') }); if (window.__s.length < 400) requestAnimationFrame(tick); }; requestAnimationFrame(tick); });
  await page.click('#dealBtn'); await waitState(page, 'shown'); await page.waitForTimeout(100);
  const s = await page.evaluate(() => window.__s);
  assert(s.length > 3, 'sampled the deal (' + s.length + ' frames)');
  assert(s.some(x => x.s === 'dealing'), 'a dealing frame was sampled');
  assert(s.every(x => x.tf === 0 && x.front && x.back && !x.anim), 'a frame had transforms: ' + JSON.stringify(s.find(x => x.tf || !x.front || !x.back || x.anim)));
  await assertLaidOut(page, 'reduced motion');
  eq(await page.$$eval('.card .title', l => l.map(e => e.textContent)), TITLES);
  eq((await page.innerText('#live')).trim(), 'Seven roles shown');
  await shot(page, 'desktop-dark-8-reduced-motion');
  await page.mouse.move((await page.locator('.card[data-role="grid"]').boundingBox()).x + 40, 300); await page.waitForTimeout(300);
  eq(await page.$eval('.card[data-role="grid"] .tilt', e => getComputedStyle(e).transform), 'none', 'no hover tilt');
  eq(problems, []);
  await context.close();
});

await check('resize after the deal, desktop to phone and back: seven visible, non-overlapping cards, no replay', async () => {
  const { page, context } = await open();
  await dealAndWait(page); await page.waitForTimeout(250);
  await page.evaluate(() => { window.__anim = 0; new MutationObserver(m => m.forEach(r => { if (r.attributeName === 'data-state') window.__anim++; })).observe(document.getElementById('deck'), { attributes: true }); });
  for (const [w, h, label] of [[390, 844, 'phone'], [820, 1100, 'tablet 3x2'], [1440, 900, 'desktop']]) {
    await page.setViewportSize({ width: w, height: h }); await page.waitForTimeout(350);
    eq(await state(page), 'shown'); await assertLaidOut(page, 'resized to ' + label);
    eq(await page.evaluate(() => document.getAnimations().length), 0, 'nothing animating after resize (no replay)');
    const cols = await page.$$eval('.slot', l => { const rows = {}; l.forEach(s => { const t = Math.round(s.getBoundingClientRect().top); rows[t] = (rows[t] || 0) + 1; }); return Math.max(...Object.values(rows)); });   // the most cards in one row (the last row of seven is centred)
    eq(cols, { phone: 2, 'tablet 3x2': 3, desktop: 4 }[label], 'columns at ' + label);
    if (label === 'phone') await shot(page, 'resize-after-deal-phone', true);
  }
  eq(await page.evaluate(() => window.__anim), 0, 'state never changed during resizes');
  await context.close();
});

await check('resize in the middle of the deal and of the resting stack never strands a card', async () => {
  const { page, context } = await open();
  await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(300);
  await page.click('#dealBtn'); await page.waitForTimeout(400);
  await page.setViewportSize({ width: 1440, height: 900 }); await page.waitForTimeout(150);
  await page.setViewportSize({ width: 820, height: 1100 });
  await waitState(page, 'shown'); await page.waitForTimeout(300);
  await assertLaidOut(page, 'resized mid-deal');
  await page.keyboard.press('Escape'); await waitState(page, 'stacked'); await page.waitForTimeout(900);
  await page.setViewportSize({ width: 1440, height: 900 }); await page.waitForTimeout(300);
  const rs = await rects(page, '.flip'), cx = rs.map(r => (r.l + r.r) / 2), cy = rs.map(r => (r.t + r.b) / 2);
  assert(Math.max(...cx) - Math.min(...cx) < 16 && Math.max(...cy) - Math.min(...cy) < 20, 'stack stays together after resizing at rest');
  await page.click('#dealBtn'); await waitState(page, 'shown'); await page.waitForTimeout(200);
  await assertLaidOut(page, 'dealt after a resize at rest');
  await context.close();
});

await check('no JavaScript: the noscript list shows seven links, the deck stays hidden', async () => {
  const { page, context } = await open({ js: false });
  eq(await page.$$eval('.ns-list a', l => l.map(a => [a.textContent, a.getAttribute('href')])), ROLES.map(r => [r.title, r.href]));
  eq(await page.locator('.ns-list').isVisible(), true); eq(await page.locator('#deck').isVisible(), false);
  await shot(page, 'desktop-dark-9-no-js');
  await context.close();
});

await check('JavaScript errors elsewhere do not matter: start.js runs even if ui.js fails to load', async () => {
  const { page, context } = await open();
  await page.route('**/js/ui.js*', r => r.abort()); await page.reload();
  await dealAndWait(page); await assertLaidOut(page, 'without ui.js');
  await page.click('#themeToggle'); eq(await page.evaluate(() => document.body.classList.contains('light')), true, 'theme toggle works');
  await context.close();
});

await check('limits and footer line are present and nothing contradicts them', async () => {
  const { page, context } = await open();
  eq((await page.innerText('.st-foot p')).replace(/\s+/g, ' ').trim(), 'Satellite data, modelled wind and smoke scenarios. Not an operational alert service. How it works');
  eq(await page.getAttribute('.st-foot a', 'href'), 'downwind.html');
  eq((await page.innerText('.st-hero h1')), 'Who are you today?');
  eq((await page.innerText('.st-hero p')), 'Pick a role. Each one opens a page built for that job.');
  const text = (await page.innerText('body')).toLowerCase();
  assert(!/\b(\d+\s?(users|people)|testimonial|badge|real-time|realtime|live data|evacuat)/.test(text), 'no invented statistics or operational claims');
  await context.close();
});

await browser.close();
console.log(`\n${results.length - failed} of ${results.length} checks passed${failed ? `, ${failed} FAILED` : ''}. Screenshots: ${path.relative(process.cwd(), SHOTS)}/`);
process.exit(failed ? 1 : 0);
