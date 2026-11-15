// BRIEFING: steps, completion, 7-day strip, per-role/region keys, storage that is missing or throws. Pure functions.
import test from 'node:test';
import assert from 'node:assert/strict';
import { load, J } from './load.mjs';
load('briefing-core');
const B = globalThis.BRIEFING, DAY = '2026-11-15', IDS = ['a', 'b', 'c', 'd', 'e'];
const run = (acts, ids = IDS, day = DAY) => acts.reduce((s, a) => B.act(s, day, a), B.empty());

test('three steps in order, all open on a new day', () => {
  const st = B.steps(B.empty(), DAY, IDS);
  assert.deepEqual(J(st.map(s => s.id)), ['clock', 'review', 'send']); assert.ok(st.every(s => !s.done));
  assert.deepEqual(J(B.progress(st)), { done: 0, total: 3, complete: false });
});
test('review needs up to three distinct items, counted from the person\'s own flips', () => {
  let s = run([{ type: 'review', id: 'a' }, { type: 'review', id: 'a' }, { type: 'review', id: 'b' }]);
  let r = B.steps(s, DAY, IDS)[1]; assert.equal(r.done, false); assert.equal(r.count, 2); assert.equal(r.need, 3);
  s = B.act(s, DAY, { type: 'review', id: 'c' }); r = B.steps(s, DAY, IDS)[1]; assert.equal(r.done, true); assert.equal(r.count, 3);
  assert.equal(B.steps(run([{ type: 'review', id: 'a' }]), DAY, ['a']).at(1).done, true, 'one item: one flip is enough');
  assert.equal(B.steps(run([{ type: 'review', id: 'gone' }]), DAY, ['a', 'b']).at(1).count, 0, 'an item no longer listed does not count');
});
test('with no items the review step completes only on reading the statement', () => {
  assert.equal(B.steps(B.empty(), DAY, []).at(1).done, false); assert.equal(B.steps(B.empty(), DAY, [])[1].noItems, true);
  assert.equal(B.steps(run([{ type: 'read' }]), DAY, [])[1].done, true);
  assert.equal(B.steps(run([{ type: 'read' }]), DAY, ['a'])[1].done, false, 'reading the statement does not count when there are items');
});
test('completion: clock + review + send; settle marks the day and it stays marked when the list changes', () => {
  let s = run([{ type: 'clock' }, { type: 'review', id: 'a' }, { type: 'review', id: 'b' }, { type: 'review', id: 'c' }, { type: 'send' }]);
  assert.equal(B.progress(B.steps(s, DAY, IDS)).complete, true);
  s = B.settle(s, DAY, IDS); assert.equal(s.days[DAY].complete, true);
  s = B.settle(s, DAY, ['x', 'y']); assert.equal(s.days[DAY].complete, true, 'sticky');
  assert.equal(B.settle(run([{ type: 'clock' }]), DAY, IDS).days[DAY].complete, false);
});
test('act is pure and ignores unknown actions; old days are pruned to 30', () => {
  const s0 = B.empty(), s1 = B.act(s0, DAY, { type: 'clock' }); assert.deepEqual(J(s0), { v: 1, days: {} }); assert.equal(s1.days[DAY].clock, true);
  assert.deepEqual(J(B.act(s0, DAY, { type: 'nonsense' }).days[DAY]), { clock: false, reviewed: [], read: false, sent: false, complete: false });
  let s = B.empty(); for (let i = 0; i < 40; i++) s = B.act(s, B.addDays('2026-01-01', i), { type: 'clock' });
  assert.equal(Object.keys(s.days).length, 30); assert.ok(!s.days['2026-01-01'] && s.days['2026-02-09']);
});
test('7-day strip: seven days ending today, oldest first, marks only completed days', () => {
  let s = B.empty(); for (const d of ['2026-11-12', '2026-11-15']) s = { v: 1, days: { ...s.days, [d]: { clock: true, reviewed: [], read: true, sent: true, complete: true } } };
  const st = B.strip(s, DAY);
  assert.deepEqual(J(st.map(x => x.day)), ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15']);
  assert.deepEqual(J(st.map(x => x.complete)), [false, false, false, true, false, false, true]); assert.equal(st[6].today, true);
  assert.equal(B.addDays('2026-03-01', -1), '2026-02-28'); assert.equal(B.addDays('2024-03-01', -1), '2024-02-29');
});
test('day key follows the region time zone', () => {
  const ms = Date.parse('2026-11-15T02:30:00Z');
  assert.equal(B.dayKey(ms, 'America/Asuncion'), '2026-11-14'); assert.equal(B.dayKey(ms, 'America/Sao_Paulo'), '2026-11-14'); assert.equal(B.dayKey(ms, 'UTC'), '2026-11-15');
  assert.match(B.dayKey(ms, 'Not/AZone'), /^\d{4}-\d\d-\d\d$/, 'a bad zone falls back to UTC');
});
test('storage keys are per role and region; state is stored and loaded per key', () => {
  const m = new Map(), st = { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v) };
  assert.equal(B.storageKey('grid', 'PY'), 'fv.briefing.grid.PY'); assert.notEqual(B.storageKey('grid', 'PY'), B.storageKey('grid', 'BO')); assert.notEqual(B.storageKey('grid', 'PY'), B.storageKey('road', 'PY'));
  const s = B.act(B.empty(), DAY, { type: 'clock' });
  assert.equal(B.save(st, 'grid', 'PY', s), true);
  assert.equal(B.load(st, 'grid', 'PY').days[DAY].clock, true); assert.deepEqual(J(B.load(st, 'grid', 'BO')), { v: 1, days: {} }); assert.deepEqual(J(B.load(st, 'road', 'PY')), { v: 1, days: {} });
});
test('storage that is missing, throws, or holds junk never throws out and gives an empty state', () => {
  const thrower = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('quota'); } };
  for (const st of [null, undefined, thrower]) { assert.deepEqual(J(B.load(st, 'grid', 'PY')), { v: 1, days: {} }); assert.equal(B.save(st, 'grid', 'PY', B.empty()), false); }
  for (const junk of ['{', '[]', '{"v":2,"days":{}}', 'null', '{"v":1}']) assert.deepEqual(J(B.load({ getItem: () => junk }, 'grid', 'PY')), { v: 1, days: {} }, junk);
});
