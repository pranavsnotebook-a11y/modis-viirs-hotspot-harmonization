// ROLECFG against roles.js: every simplified role has a config, every href resolves to a file that exists, all text exists in three languages.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { load, ROOT, J } from './load.mjs';
load('roles', 'role-config');
const R = globalThis.ROLES, C = globalThis.ROLECFG, LANGS = ['en', 'es', 'pt'];

test('every simplified role in roles.js resolves to a config; the analyst has none (it is index.html)', () => {
  for (const r of R.list) assert.equal(!!C.get(r.id), r.mode === 'simplified', r.id);
  assert.deepEqual(J(Object.keys(C.roles).sort()), J(R.list.filter(r => r.mode === 'simplified').map(r => r.id).sort()));
});
test('every role href points at a file that exists in web/ (role.html is no longer allowed to be missing)', () => {
  for (const r of R.list) { const f = path.join(ROOT, 'web', r.href.split('?')[0].split('#')[0]); assert.ok(fs.existsSync(f), `${r.id}: ${r.href} -> ${f}`); }
  assert.ok(fs.existsSync(path.join(ROOT, 'web/role.html')));
});
test('role.html href carries role=<id> that its own config knows', () => {
  for (const r of R.list.filter(x => x.mode === 'simplified')) assert.equal(new URL(r.href, 'http://x/').searchParams.get('role'), r.id);
});
test('title and question match roles.js in English and exist in Spanish and Portuguese', () => {
  for (const r of R.list.filter(x => x.mode === 'simplified')) {
    const c = C.get(r.id); assert.equal(c.title.en, r.title); assert.equal(c.q.en, r.question);
    for (const l of LANGS) { assert.ok(c.title[l] && c.q[l]); }
  }
});
test('engine, kind and text are well formed for every role', () => {
  for (const [id, c] of Object.entries(C.roles)) {
    assert.ok(['watch', 'fires', 'site', 'place'].includes(c.engine), id);
    for (const k of ['subject', 'target']) for (const l of LANGS) assert.ok(c[k] && c[k][l], `${id}.${k}.${l}`);
    if (c.engine === 'watch') { assert.ok(['power', 'roads'].includes(c.kind)); assert.equal(c.hours, 24); assert.equal(c.minFrp, 5); assert.ok(['full', 'short'].includes(c.fmt)); for (const l of LANGS) assert.ok(c.kindWord[l] && c.text.none[l] && c.text.listH[l]); }
    if (c.engine === 'fires') { assert.equal(c.radiusKm, 50); for (const l of LANGS) assert.ok(c.text.none[l] && c.text.basePick[l] && c.text.heading('north', 'south', '3')[l]); }
  }
  assert.equal(C.get('grid').kind, 'power'); assert.equal(C.get('grid').fast, true); assert.equal(C.get('road').kind, 'roads'); assert.equal(C.get('road').fmt, 'short');
  assert.equal(C.get('care').engine, 'site'); assert.equal(C.get('resident').engine, 'place'); assert.equal(C.get('firefighter').engine, 'fires');
});
test('the frame text has the same keys in English, Spanish and Portuguese, and functions return text', () => {
  const k = l => Object.keys(C.ui[l]).sort(); assert.deepEqual(k('es'), k('en')); assert.deepEqual(k('pt'), k('en'));
  for (const l of LANGS) for (const [key, v] of Object.entries(C.ui[l])) {
    if (typeof v === 'function') { const out = v(3, 'north', '4', 5, 24); assert.ok(typeof out === 'string' && out.length > 2 && !/undefined|NaN/.test(out), `${l}.${key}`); }
    else if (Array.isArray(v)) assert.equal(v.length, 3, key); else assert.ok(typeof v === 'string' && v.length > 0, `${l}.${key}`);
  }
});
test('limits are stated in every language and no text claims scores, levels or badges', () => {
  for (const l of LANGS) { assert.match(C.ui[l].limits, /3|tres|três|three/i); assert.match(JSON.stringify(C.ui[l]), /./); }
  const all = JSON.stringify([C.ui, C.roles]).toLowerCase();
  for (const bad of ['points', 'puntos', 'pontos', 'level', 'nivel', 'badge', 'insignia', 'leaderboard', 'confetti', 'streak', 'racha', 'sequência']) assert.ok(!all.includes('"' + bad) && !all.includes(' ' + bad + ' '), bad);
});
test('Spanish and Portuguese note about unreviewed templates is present', () => {
  assert.match(C.ui.es.esNote, /no los ha revisado un hablante nativo/); assert.match(C.ui.pt.esNote, /não foram revisados por um falante nativo/);
});
