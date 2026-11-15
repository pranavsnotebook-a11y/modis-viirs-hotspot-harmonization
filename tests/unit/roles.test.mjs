// node --test tests/unit   (roles.js is a plain browser script; it is loaded through vm exactly like the other cores)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const root = new URL('../../', import.meta.url);
const ctx = vm.createContext({});                       // a clean global, so roles.js really does attach itself
vm.runInContext(fs.readFileSync(new URL('web/js/roles.js', root), 'utf8'), ctx);
const R = ctx.ROLES;
const J = x => JSON.parse(JSON.stringify(x));   // arrays made inside the vm context have another realm's prototype; compare plain copies

const memory = () => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), _m: m }; };
const throwing = () => ({ getItem() { throw new Error('denied'); }, setItem() { throw new Error('quota'); }, removeItem() { throw new Error('denied'); } });

const ORDER = ['firefighter', 'grid', 'road', 'care', 'resident', 'analyst'];
const TITLES = ['Fire brigade', 'Grid operator', 'Road patrol', 'Clinic or school lead', 'Resident or farmer', 'Analyst'];
const THEME = ['cyan', 'purple', 'orange', 'red', 'green', 'yellow'];

test('six roles in the fixed order with the specified titles', () => {
  assert.deepEqual(J(R.list.map(r => r.id)), ORDER);
  assert.deepEqual(J(R.list.map(r => r.title)), TITLES);
});
test('ids are unique and get() finds each one', () => {
  assert.equal(new Set(R.list.map(r => r.id)).size, R.list.length);
  for (const r of R.list) assert.equal(R.get(r.id), r);
  assert.equal(R.get('nobody'), null);
});
test('every required field is present and non-empty', () => {
  for (const r of R.list) {
    for (const k of ['id', 'title', 'tagline', 'question', 'mode', 'icon', 'accent', 'href']) assert.ok(typeof r[k] === 'string' && r[k].trim(), `${r.id}.${k}`);
    assert.ok(r.modules.length >= 3 && r.modules.length <= 4, `${r.id} has three or four module chips`);
    for (const m of r.modules) assert.ok(typeof m === 'string' && m.trim());
    assert.ok(THEME.includes(r.accent), `${r.id} accent is a theme colour`);
    assert.match(r.icon, /^(<(path|circle|rect|line|polyline|ellipse)\b[^>]*\/>)+$/, `${r.id} icon is stroke-only svg markup`);
    assert.ok(!/fill=/.test(r.icon), `${r.id} icon sets no fill`);
  }
});
test('exactly one role is the full workspace; the rest are simplified', () => {
  assert.deepEqual(J(R.list.filter(r => r.mode === 'full').map(r => r.id)), ['analyst']);
  assert.equal(R.list.filter(r => r.mode === 'simplified').length, 5);
});
test('hrefs are as specified', () => {
  for (const id of ORDER.slice(0, 5)) assert.equal(R.get(id).href, `role.html?role=${id}`);
  assert.equal(R.get('analyst').href, 'index.html');
});
test('the list is frozen', () => {
  assert.throws(() => { 'use strict'; R.list.push({}); });
  assert.throws(() => { 'use strict'; R.list[0].title = 'x'; });
});
test('hrefFor appends the region with or without an existing query string', () => {
  assert.equal(R.hrefFor('firefighter'), 'role.html?role=firefighter');
  assert.equal(R.hrefFor('firefighter', {}), 'role.html?role=firefighter');
  assert.equal(R.hrefFor('firefighter', { region: 'PY' }), 'role.html?role=firefighter&r=PY');
  assert.equal(R.hrefFor('analyst', { region: 'BO' }), 'index.html?r=BO');
  assert.equal(R.hrefFor('nobody', { region: 'PY' }), null);
});
test('saved, save and clear with a working storage', () => {
  ctx.localStorage = memory();
  assert.equal(R.saved(), null);
  assert.equal(R.save('road'), true);
  assert.equal(ctx.localStorage.getItem('fv.role'), 'road');
  assert.equal(R.saved(), 'road');
  assert.equal(R.save('nobody'), false, 'unknown ids are not stored');
  assert.equal(R.saved(), 'road');
  ctx.localStorage.setItem('fv.role', 'stale-id');
  assert.equal(R.saved(), null, 'a stale id is ignored');
  assert.equal(R.clear(), true);
  assert.equal(R.saved(), null);
});
test('storage that throws, or is missing, never throws out', () => {
  ctx.localStorage = throwing();
  assert.equal(R.saved(), null);
  assert.equal(R.save('grid'), false);
  assert.equal(R.clear(), false);
  delete ctx.localStorage;
  assert.equal(R.saved(), null);
  assert.equal(R.save('grid'), false);
  assert.equal(R.clear(), false);
  Object.defineProperty(ctx, 'localStorage', { get() { throw new Error('SecurityError'); }, configurable: true });
  assert.equal(R.saved(), null);
  assert.equal(R.save('grid'), false);
});
test('the <noscript> list in start.html matches the data (titles, order, hrefs)', () => {
  const html = fs.readFileSync(new URL('web/start.html', root), 'utf8');
  const ns = /<noscript>([\s\S]*?)<\/noscript>/.exec(html);
  assert.ok(ns, 'start.html has a noscript block');
  const links = [...ns[1].matchAll(/<a\s+href="([^"]+)"\s*>([^<]+)<\/a>/g)].map(m => ({ href: m[1], title: m[2].trim() }));
  assert.deepEqual(links, J(R.list.map(r => ({ href: r.href, title: r.title }))));
});
test('start.js holds no role text', () => {
  const js = fs.readFileSync(new URL('web/js/start.js', root), 'utf8');
  for (const r of R.list) { assert.ok(!js.includes(r.title), r.title); assert.ok(!js.includes(r.question), r.id); }
});
