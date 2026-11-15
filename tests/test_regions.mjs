// node tests/test_regions.mjs : regions.json is the single source of truth; its country names must be real strings of meta.json
import fs from 'node:fs';
import assert from 'node:assert/strict';
import vm from 'node:vm';
globalThis.window = globalThis; // the same plain script the pages load; the repo root package.json makes .js files ES modules, so no require()
vm.runInThisContext(fs.readFileSync(new URL('../web/js/regions.js', import.meta.url), 'utf8'));
const R = globalThis.REGIONS;
const read = f => JSON.parse(fs.readFileSync(new URL('../web/app-data/' + f, import.meta.url), 'utf8'));
R.load(read('regions.json'));
const meta = read('meta.json');
assert.deepEqual(R.codes(), ['PY', 'BO', 'AR', 'BR']);
for (const c of R.codes()) {
  const r = R.get(c);
  assert.ok(meta.countries.includes(r.country), `${c}: "${r.country}" is not in meta.json countries`);
  assert.ok(r.ptIn && r.ptOf);
  assert.ok(['es', 'pt'].includes(r.lang) && r.tz && r.tzLabel.en && r.tzLabel.es && r.tzLabel.pt && r.name.en);
  assert.doesNotThrow(() => new Intl.DateTimeFormat('en', { timeZone: r.tz }));
  const [[s, w], [n, e]] = r.view; assert.ok(s < n && w < e);
  assert.ok(R.inside(c, (s + n) / 2, (w + e) / 2) && !R.inside(c, n + 1, w));
}
assert.equal(R.get('BR').lang, 'pt'); assert.equal(R.get('BR').tz, 'America/Sao_Paulo'); assert.equal(R.get('BR').tzLabel.en, 'Brasília time');
assert.deepEqual(R.langOrder('BR'), ['en', 'pt', 'es']); assert.deepEqual(R.langOrder('PY'), ['en', 'es', 'pt']);
assert.equal(R.initial('?r=br'), 'BR'); assert.equal(R.initial('?r=XX'), 'PY');
assert.deepEqual(Object.values(R.COMPASS.pt), ['norte', 'nordeste', 'leste', 'sudeste', 'sul', 'sudoeste', 'oeste', 'noroeste']);
console.log('regions: all checks pass');
