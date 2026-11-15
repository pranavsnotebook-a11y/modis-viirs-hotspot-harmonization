// Things that must stay true of the role pages' files: no keys in front-end code, no inline handlers, no gamification vocabulary,
// every script a page loads exists, role text is not scattered.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './load.mjs';
const rd = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const FILES = ['web/role.html', 'web/css/role.css', 'web/js/role.js', 'web/js/role-config.js', 'web/js/role-core.js', 'web/js/watch-core.js', 'web/js/bulletin-core.js', 'web/js/briefing-core.js', 'web/start.html', 'web/js/start.js', 'web/js/roles.js'];

test('no API key or secret appears in front-end code', () => {
  for (const f of FILES) { const t = rd(f); assert.ok(!/(api[_-]?key|map[_-]?key|secret|token)\s*[:=]\s*['"][A-Za-z0-9]{8,}/i.test(t), f); assert.ok(!/[?&](key|apikey|api_key|map_key)=/i.test(t), f); }
});
test('no inline event handlers in the pages', () => { for (const f of ['web/role.html', 'web/start.html']) assert.ok(!/\son[a-z]+\s*=\s*["']/i.test(rd(f)), f); });
test('every script and stylesheet role.html loads exists', () => {
  const html = rd('web/role.html');
  for (const m of html.matchAll(/(?:src|href)="((?:js|css)\/[^"?]+)/g)) assert.ok(fs.existsSync(path.join(ROOT, 'web', m[1])), m[1]);
  const order = [...html.matchAll(/src="js\/([^".?]+)/g)].map(m => m[1]);
  for (const [a, b] of [['firelab-core', 'downwind-core'], ['downwind-core', 'watch-core'], ['watch-core', 'bulletin-core'], ['bulletin-core', 'place'], ['regions', 'role'], ['role-config', 'role'], ['briefing-core', 'role'], ['role-core', 'role']]) assert.ok(order.indexOf(a) >= 0 && order.indexOf(a) < order.indexOf(b), `${a} before ${b}`);
  assert.ok(!/records\.bin|meta\.json/.test(html + rd('web/js/role.js') + rd('web/js/role-core.js')), 'role pages never read the record bundle');
});
test('downwind.html loads the shared cores before downwind.js, and downwind.js no longer holds the logic it moved out', () => {
  const html = rd('web/downwind.html'), js = rd('web/js/downwind.js');
  assert.ok(html.indexOf('watch-core.js') > 0 && html.indexOf('watch-core.js') < html.indexOf('js/downwind.js') && html.indexOf('bulletin-core.js') < html.indexOf('js/downwind.js'));
  for (const gone of ['function prepAssets', 'function nearAssets', 'async function fetchWeather', 'function shortBulletin', 'function gsmClean', 'function fastBulletin', 'const SHORT_GEN', 'const GSM = new Set']) assert.ok(!js.includes(gone), gone);
});
test('the briefing never uses points, levels, badges, leaderboards, confetti or a score', () => {
  for (const f of ['web/js/briefing-core.js', 'web/js/role.js', 'web/js/role-config.js', 'web/role.html', 'web/css/role.css']) assert.ok(!/\b(leaderboard|confetti|badge|xp|score|streak)\b/i.test(rd(f).replace(/the person's own|not a score|no points, levels, badges, leaderboards, confetti/gi, '')), f);
});
test('role.js carries no role titles or questions (they live in roles.js and role-config.js)', () => {
  const js = rd('web/js/role.js'); for (const t of ['Fire brigade', 'Grid operator', 'Road patrol', 'Clinic or school lead', 'Resident or farmer']) assert.ok(!js.includes(t), t);
});
test('the front door: server maps / to start.html and keeps start.html and role.html out of the cache', () => {
  const py = rd('src/hotspots/server.py'); assert.match(py, /u\.path == "\/":\s*\n\s*self\.path = "\/start\.html"/); assert.ok(py.includes('"/start.html"') && py.includes('"/role.html"'));
});
test('Switch role links exist on role, DOWNWIND, My place and the explorer', () => { for (const f of ['web/role.html', 'web/downwind.html', 'web/place.html', 'web/index.html']) assert.match(rd(f), /href="start\.html"[^>]*>(?:<[^>]+>)*[^<]*Switch role|Switch role<\/a>/, f); });
