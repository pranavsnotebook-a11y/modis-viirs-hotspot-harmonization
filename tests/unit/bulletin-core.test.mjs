// BULLETIN: full and short texts in three languages, region passed in, GSM-safe short form, all-clear and not-assessed lines.
import test from 'node:test';
import assert from 'node:assert/strict';
import { load, regions, J, constantWind } from './load.mjs';
load('regions', 'firelab-core', 'downwind-core', 'fast-core', 'watch-core', 'bulletin-core');
const W = globalThis.WATCH, B = globalThis.BULLETIN, RG = globalThis.REGIONS; RG.load(regions());
const T = '2025-01-08T17:00Z', END = Date.parse(T);
const fire = { id: 'HS-V0000001', lat: -25, lon: -57, frp: 20, time: T, ms: END, sat: 'S-NPP' };
const A = { layers: { power: { built: true }, roads: { built: true }, health: { built: true }, schools: { built: true } },
  power: [{ id: 1, kv: 500, pts: [[-24.955, -57.2], [-24.955, -56.8]] }], roads: [{ id: 3, ref: '9', name: 'Ruta 9', pts: [[-24.955, -57.2], [-24.955, -56.8]] }],
  health: [{ id: 'n1', name: 'Clínica Ñandú 🙂 del Norte con un nombre larguísimo para probar el recorte', kind: 'clinic', lat: -24.96, lon: -57 }], schools: [{ id: 's1', name: '', lat: -24.96, lon: -57.01 }], places: [{ name: 'Pueblo', lat: -24.97, lon: -57.01 }] };
const P = W.prepAssets(A), R = { ...W.rules(), minFrp: 5 };
const rows = {};
for (const kind of W.KIND_LIST) rows[kind] = (await W.computeLive({ kind, dets: [fire], assets: P, rules: R, wind: W.createWind({ getJSON: constantWind().getJSON }), range: W.liveRange(END, 24, R), live: true })).rows[0];
const ctx = iso => ({ region: RG.get(iso), assets: P });   // compass defaults to REGIONS.COMPASS
const GSM_OK = /^[\x20-\x7e¡£¤¥§¿ÄÅÆÇÉÑÖØÜßàäåæèéìñòöøùü\n]*$/, EXT = /[~^\\[\]{}|€]/;

test('every kind produced a row to test with', () => { for (const k of W.KIND_LIST) assert.ok(rows[k], k); });
test('full bulletin: English text is exactly the DOWNWIND text for the fixture (golden), with the region time zone', () => {
  assert.equal(B.bulletin(rows.power, 'en', ctx('PY')),
    'SMOKE WATCH. 500 kV power line, near Pueblo. S-NPP saw a fire at 14:00 Paraguay time on 8 January, 5 km south of the line, 20 megawatts. Modelled wind from the south at 3 metres per second carries the smoke across the line, about 30 minutes after it leaves the fire. This is a modelled scenario from satellite data, not a ground report. No detection does not mean no fire.');
});
test('the region is an argument: the same fire reads in another time zone and zone name', () => {
  assert.match(B.bulletin(rows.power, 'en', ctx('PY')), /14:00 Paraguay time/);
  assert.match(B.bulletin(rows.power, 'en', ctx('BO')), /13:00 Bolivia time/);
  assert.match(B.bulletin(rows.power, 'es', ctx('BR')), /\(hora de Brasilia\)/);
});
test('all three languages, both forms, every kind: limits are always stated', () => {
  for (const kind of W.KIND_LIST) for (const lang of B.LANGS) {
    const full = B.bulletinText(rows[kind], lang, 'full', ctx('PY'));
    assert.match(full, lang === 'en' ? /No detection does not mean no fire/ : lang === 'es' ? /Sin detección no significa sin fuego/ : /Sem detecção não significa sem fogo/, `${kind} ${lang}`);
    assert.match(full, lang === 'en' ? /not a ground report/ : lang === 'es' ? /no un reporte de campo/ : /não um relato de campo/);
  }
});
test('short form: at most 160 characters, GSM 7-bit only, no extension characters, for every kind, language and region', () => {
  for (const iso of ['PY', 'BO', 'AR', 'BR']) for (const kind of W.KIND_LIST) for (const lang of B.LANGS) {
    const t = B.bulletinText(rows[kind], lang, 'short', ctx(iso));
    assert.ok(t.length <= B.SHORT_MAX && t.length > 40, `${iso} ${kind} ${lang} ${t.length}: ${t}`);
    assert.match(t, GSM_OK, t); assert.ok(!EXT.test(t), t);
  }
});
test('short form keeps a long name by cutting it, and drops emoji and accents the SMS alphabet cannot carry in English', () => {
  const t = B.bulletinText(rows.health, 'en', 'short', ctx('PY')); assert.ok(t.length <= 160); assert.ok(!/[^\x20-\x7e]/.test(t), t);
  assert.equal(B.gsmClean('Clínica Ñandú 🙂 [x]', 'es'), 'Clinica Ñandu x'); assert.equal(B.gsmClean('Clínica Ñandú', 'en'), 'Clinica Nandu');
});
test('shortBulletin is pure and never exceeds 160 characters even for absurd names', () => {
  const o = { kind: 'roads', label: '', name: 'X'.repeat(300), place: 'Y'.repeat(300), km: '12', dir: 'north-east', mw: '1234', hhmm: '14:00', eta: 125 };
  for (const lang of B.LANGS) assert.ok(B.shortBulletin(o, lang).length <= 160);
});
test('night, light wind and unnamed assets are said in words', () => {
  const night = { ...rows.power, s: { r: { cls: 'F' } } }; assert.match(B.bulletin(night, 'en', ctx('PY')), /Night, stable air/);
  const light = { ...rows.power, wx: { ...rows.power.wx, ws: 1.5 } }; assert.match(B.bulletin(light, 'pt', ctx('PY')), /Vento fraco/);
  assert.match(B.assetName(rows.schools, 'en'), /School, unnamed on the map/);
});
test('all-clear line: says it is satellite data, that data lags, and that no detection is not no fire (3 languages, full and short)', () => {
  const c = { region: RG.get('PY'), endMs: END };
  for (const lang of B.LANGS) {
    const t = B.allClear({ en: 'upwind of power lines', es: 'viento arriba de las líneas', pt: 'a barlavento das linhas' }, lang, c);
    assert.match(t, lang === 'en' ? /SATELLITE DATA/ : lang === 'es' ? /DATOS SATELITALES/ : /DADOS DE SATÉLITE/);
    assert.match(t, lang === 'en' ? /three hours/ : /tres horas|três horas/); assert.match(t, lang === 'en' ? /does not mean no fire/ : lang === 'es' ? /no significa sin fuego/ : /não significa sem fogo/);
    const s = B.shortAllClear('power', lang); assert.ok(s.length <= 160); assert.match(s, GSM_OK); assert.match(s, /3h/);
  }
});
test('not-assessed line never reads as an all-clear', () => {
  for (const lang of B.LANGS) { const t = B.notAssessed({ en: 'power lines', es: 'las líneas', pt: 'as linhas' }, lang); assert.ok(!/ALL CLEAR|SIN NOVEDAD|SEM NOVIDADE/.test(t)); assert.match(t, /NOT ASSESSED|NO EVALUADO|NÃO AVALIADO/); assert.ok(B.shortNotAssessed(lang).length <= 160); }
});
test('fire-brigade bulletin: wind, heading, assets in the path; honest when wind is missing; short form within 160 characters', () => {
  const it = { fire, km: 12.3, brg: 45, wx: { ws: 4.2, wd: 270 }, heading: 'east', assets: [{ kind: 'power', name: '' }, { kind: 'health', name: 'Clinic North' }] };
  const c = { ...ctx('PY'), baseName: 'Asunción' };
  assert.match(B.fireBulletin(it, 'en', c), /FIRE WATCH\. Asunción\..*12 km north-east of base.*wind from the west at 4\.2.*toward the east\. In its modelled path: power line, Clinic North \(clinic or hospital\)/);
  assert.match(B.fireBulletin({ ...it, assets: [] }, 'en', c), /No mapped power line, road, clinic or school is in the modelled path/);
  const nw = B.fireBulletin({ ...it, wx: null, heading: null, assets: [] }, 'en', c); assert.match(nw, /could not be loaded, so it is not known/); assert.ok(!/No mapped power line/.test(nw), 'no claim about assets without wind');
  assert.match(B.fireBulletin(it, 'pt', c), /leva a fumaça para leste/); assert.match(B.fireBulletin(it, 'es', c), /lleva el humo hacia el este/);
  for (const lang of B.LANGS) { const s = B.shortFire(it, lang, { ...c, baseName: 'N'.repeat(200) }); assert.ok(s.length <= 160, s); assert.match(s, GSM_OK); }
});
