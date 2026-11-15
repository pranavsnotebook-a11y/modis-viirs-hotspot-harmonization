/* BRIEFING: the "shift briefing" of the role pages as pure functions over a plain state object. Plain script: attaches BRIEFING.
   Three steps per day: (1) check the satellite clock, (2) review the top items (up to three), (3) copy or send a bulletin.
   The state records only what the person did, per role and region, on this device. There are no points, levels or scores:
   the only numbers are counts of the person's own actions. Storage is optional and may throw; every call is guarded. */
(function (root) {
'use strict';
const STEPS = ['clock', 'review', 'send'], KEEP_DAYS = 30, MAX_REVIEW = 3;
const empty = () => ({ v: 1, days: {} });
const storageKey = (role, region) => 'fv.briefing.' + role + '.' + region;
/* the calendar day in the region's time zone, as YYYY-MM-DD (the 'en-CA' locale formats it that way) */
function dayKey(ms, tz) {
  try { return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(ms); }
  catch (e) { return new Date(ms).toISOString().slice(0, 10); }
}
const addDays = (day, n) => new Date(Date.parse(day + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const rec = (state, day) => (state.days && state.days[day]) || { clock: false, reviewed: [], read: false, sent: false, complete: false };

/* action: { type: 'clock' } | { type: 'review', id } | { type: 'read' } | { type: 'send' }. Returns a new state; the input is not changed. */
function act(state, day, action) {
  const cur = rec(state || empty(), day), d = { ...cur, reviewed: cur.reviewed.slice() };
  if (action.type === 'clock') d.clock = true;
  else if (action.type === 'review' && action.id != null && !d.reviewed.includes(String(action.id))) d.reviewed.push(String(action.id));
  else if (action.type === 'read') d.read = true;
  else if (action.type === 'send') d.sent = true;
  const days = { ...(state && state.days) }; days[day] = d;
  const keys = Object.keys(days).sort(); while (keys.length > KEEP_DAYS) delete days[keys.shift()];
  return { v: 1, days };
}
/* ids: the ids of the items on the page now (an item reviewed earlier that is no longer listed does not count).
   With no items, the review step is done once the person has read the statement that nothing is in the path. */
function steps(state, day, ids) {
  const d = rec(state || empty(), day), list = (ids || []).map(String), need = Math.min(MAX_REVIEW, list.length), got = d.reviewed.filter(x => list.includes(x)).length;
  return [
    { id: 'clock', done: !!d.clock },
    { id: 'review', done: need === 0 ? !!d.read : got >= need, need, count: Math.min(got, need), noItems: need === 0 },
    { id: 'send', done: !!d.sent },
  ];
}
const progress = st => { const done = st.filter(s => s.done).length; return { done, total: st.length, complete: done === st.length }; };
/* a day that was completed stays completed, even if the list on the page changes later */
function settle(state, day, ids) {
  const st = state || empty();
  if (!progress(steps(st, day, ids)).complete || rec(st, day).complete) return st;
  const days = { ...st.days }; days[day] = { ...rec(st, day), reviewed: rec(st, day).reviewed.slice(), complete: true };
  return { v: 1, days };
}
/* seven days ending today, oldest first */
function strip(state, today) {
  const out = [];
  for (let i = 6; i >= 0; i--) { const day = addDays(today, -i); out.push({ day, complete: !!rec(state || empty(), day).complete, today: i === 0 }); }
  return out;
}
function load(storage, role, region) {
  try {
    const raw = storage && storage.getItem(storageKey(role, region)); if (!raw) return empty();
    const j = JSON.parse(raw); return j && j.v === 1 && j.days && typeof j.days === 'object' ? j : empty();
  } catch (e) { return empty(); }
}
function save(storage, role, region, state) {
  try { if (!storage) return false; storage.setItem(storageKey(role, region), JSON.stringify(state)); return true; } catch (e) { return false; }
}
root.BRIEFING = Object.freeze({ STEPS, MAX_REVIEW, empty, storageKey, dayKey, addDays, act, steps, progress, settle, strip, load, save });
})(typeof globalThis !== 'undefined' ? globalThis : window);
