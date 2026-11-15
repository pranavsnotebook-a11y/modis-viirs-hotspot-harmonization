// node tests/test_downwind_core.mjs  (the browser core, run headless)
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
globalThis.window = globalThis;
for (const f of ['web/js/firelab-core.js', 'web/js/downwind-core.js']) vm.runInThisContext(fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8'));
const D = globalThis.DOWNWIND;

// one fire, wind from the south: a line 5 km north is crossed, a line 5 km south is not
const fire = { lat: -25, lon: -57, frp: 20, time: '2025-01-08T17:00Z', sat: 'X' };
const s = D.scenario(fire, { ws: 3, wd: 180, u10: 2, blh: 1500, cloud: 0 });
const north = D.crossLine(s, [[-24.955, -57.2], [-24.955, -56.8]]), south = D.crossLine(s, [[-25.045, -57.2], [-25.045, -56.8]]);
assert.ok(north.crosses && Math.abs(north.crossKm - 5) < .1 && north.peak > 0, 'line downwind is crossed');
assert.ok(!south.crosses && south.peak === 0, 'line upwind is not crossed');
assert.ok(Math.abs(north.nearestKm - south.nearestKm) < .05, 'both lines are equally near: distance alone cannot tell them apart');
assert.ok(Math.abs(north.etaMin - 5000 / 3 / 60) < 1);
assert.equal(D.compass(north.bearing), 'north');

// a point downwind gets smoke, the mirror point upwind gets none
assert.ok(D.atPoint(s, -24.96, -57).conc > 0 && D.atPoint(s, -25.04, -57).conc === 0);

// clustering: same pass and within 1.5 km merge with FRP summed; another satellite or a later pass does not
const c = D.cluster([
  { lat: -25, lon: -57, frp: 5, time: '2025-01-08T17:05Z', sat: 'A' }, { lat: -25.005, lon: -57, frp: 7, time: '2025-01-08T17:05Z', sat: 'A' },
  { lat: -25, lon: -57, frp: 9, time: '2025-01-08T17:28Z', sat: 'B' }, { lat: -25, lon: -57, frp: 3, time: '2025-01-09T05:00Z', sat: 'A' },
  { lat: -25.2, lon: -57, frp: 1, time: '2025-01-08T17:05Z', sat: 'A' }]);
assert.equal(c.length, 4);
assert.equal(c.find(x => x.n === 2).frp, 12);
console.log('downwind-core: all checks pass');
