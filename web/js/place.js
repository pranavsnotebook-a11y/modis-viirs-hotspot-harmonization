/* My place: is smoke from a satellite-detected fire heading for this place?
   OBSERVED: fires (NASA FIRMS, from app-data/feed/PY.json). MODELLED: wind (Open-Meteo). SCENARIO: the smoke path (FIRELAB plume).
   The pure logic (analyse, sentence, nextLook, decodeFeed) has no DOM, so Node can run exactly the code the page runs. */
(function (root) {
'use strict';
const D = root.DOWNWIND, RG = root.REGIONS;
let REG = { iso: 'PY', ptIn: 'no Paraguai', ptOf: 'do Paraguai', tz: 'America/Asuncion', view: [[-27.7, -62.7], [-19.2, -54.2]], lang: 'es', name: { en: 'Paraguay', es: 'Paraguay', pt: 'Paraguai' }, tzLabel: { en: 'Paraguay time', es: 'hora de Paraguay', pt: 'horário do Paraguai' } }; // replaced by setRegion() from regions.json
const RULES = { reachKm: 25, nearKm: 10, hoursOfData: 24, hoursAfterPass: 3, scenarioHours: 3, minConc: 1, lightWind: 3, clusterKm: 1.5, oldHours: 12 };
function setRegion(r) { REG = r; }
const r2 = x => Math.round(x * 100) / 100;

/* ---------- pure logic ---------- */
function decodeFeed(feed) {
  const F = feed && feed.fires; if (!F || !Array.isArray(F.idx) || !Array.isArray(feed.sats)) throw new Error('bad feed');
  const t0 = Date.parse(feed.t0), out = [];
  let i = 0, la = 0, lo = 0, t = 0;
  for (let k = 0; k < F.idx.length; k++) {
    i += F.idx[k]; la += F.lat[k]; lo += F.lon[k]; t += F.t[k];
    const ms = t0 + t * 60000;
    out.push({ id: i < F.n_modis ? 'HS-M' + String(i).padStart(6, '0') : 'HS-V' + String(i - F.n_modis).padStart(7, '0'), lat: la / 1e4, lon: lo / 1e4, ms,
      time: new Date(ms).toISOString().slice(0, 16) + 'Z', sat: feed.sats[F.sat[k]], frp: F.frp[k] });
  }
  return out;
}
const dataEnd = feed => Date.parse(feed.data_through_utc);

/* wx: Open-Meteo hourly object (time, wind_speed_100m, ...) or null. Same field mapping as DOWNWIND. */
function wxAt(H, ms) {
  if (!H) return null;
  const k = H.time.indexOf(new Date(Math.floor(ms / 36e5) * 36e5).toISOString().slice(0, 13) + ':00');
  if (k < 0 || H.wind_speed_100m[k] == null || H.wind_direction_100m[k] == null) return null;
  return { hour: H.time[k], ws: H.wind_speed_100m[k], wd: H.wind_direction_100m[k], u10: H.wind_speed_10m[k], blh: H.boundary_layer_height ? H.boundary_layer_height[k] : null, cloud: H.cloud_cover ? H.cloud_cover[k] : 50 };
}
/* the fires that count for a place: last 24 h of data, within 25 km, grouped per pass (cluster 1.5 km) */
function candidates(place, fires, end) {
  const dets = fires.filter(d => d.ms > end - RULES.hoursOfData * 36e5 && d.ms <= end && D.dist(place.lat, place.lon, d.lat, d.lon) <= RULES.reachKm);
  return D.cluster(dets, RULES.clusterKm).map(f => ({ ...f, ms: Date.parse(f.time) }));
}
function windWindow(cl) {
  if (!cl.length) return null;
  const t0 = Math.min(...cl.map(f => f.ms)), t1 = Math.max(...cl.map(f => f.ms)) + RULES.hoursAfterPass * 36e5;
  return { d0: new Date(t0).toISOString().slice(0, 10), d1: new Date(t1).toISOString().slice(0, 10), old: (Date.now() - t0) / 864e5 > 80 };
}
function windURL(place, w) {
  const base = w.old ? 'https://archive-api.open-meteo.com/v1/archive' : 'https://api.open-meteo.com/v1/forecast';
  return `${base}?latitude=${place.lat.toFixed(2)}&longitude=${place.lon.toFixed(2)}&hourly=wind_speed_10m,wind_speed_100m,wind_direction_100m,boundary_layer_height,cloud_cover&start_date=${w.d0}&end_date=${w.d1}&wind_speed_unit=ms&timezone=GMT`;
}
/* The DOWNWIND point rule: the hour of the pass and the two after it; downwind when the scenario adds >= 1 ug/m3 here. */
function analyse(place, fires, end, H, computedAt) {
  const R = { v: 1, place, computedAt: computedAt || Date.now(), dataEnd: end, items: [], status: 'none', windFailed: !H };
  R.region = REG.iso;
  const v = REG.view; // a box, not the border: part of a neighbouring country can lie inside it, and its fires are not in the feed
  if (place.lat < v[0][0] || place.lat > v[1][0] || place.lon < v[0][1] || place.lon > v[1][1]) { R.status = 'outside'; return R; }
  const groups = new Map();
  for (const f of candidates(place, fires, end)) {
    let down = null, best = null, first = null;
    for (let h = 0; h < RULES.hoursAfterPass; h++) {
      const t = f.ms + h * 36e5, wx = wxAt(H, t); if (!wx) continue;
      const c = D.atPoint(D.scenario(f, wx, { time: new Date(t), hours: RULES.scenarioHours }), place.lat, place.lon);
      if (!first) first = { wx, c };
      if (c.conc >= RULES.minConc && (!best || c.conc > best.c.conc)) best = { wx, c };
    }
    if (first) down = !!best;
    const use = best || first;
    const it = { id: f.id, lat: f.lat, lon: f.lon, km: D.dist(place.lat, place.lon, f.lat, f.lon), brg: D.bearing(place.lat, place.lon, f.lat, f.lon), ms: f.ms, sat: f.sat, frp: f.frp, down,
      conc: best ? best.c.conc : null, ws: use ? use.wx.ws : null, wd: use ? use.wx.wd : null, hour: use ? use.wx.hour : null, passes: 1, _p: new Set([f.sat + f.time]) };
    const key = Math.round(f.lat * 50) + ',' + Math.round(f.lon * 50); // about 2 km: the same fire on another pass
    const o = groups.get(key);
    if (!o) groups.set(key, it);
    else { it._p = new Set([...o._p, ...it._p]); if (it.ms > o.ms || (it.ms === o.ms && (it.conc || 0) > (o.conc || 0))) groups.set(key, it); else o._p = it._p; }
  }
  R.items = [...groups.values()].map(o => { o.passes = o._p.size; delete o._p; return o; })
    .sort((a, b) => (b.down === true) - (a.down === true) || (b.conc || 0) - (a.conc || 0) || a.km - b.km);
  const hit = R.items.filter(i => i.down === true), nearest = R.items.slice().sort((a, b) => a.km - b.km);
  if (hit.length) { R.status = 'smoke'; R.focus = hit[0].id; }
  else if (R.items.some(i => i.down === null)) { R.status = 'nowind'; R.focus = nearest[0].id; }
  else if (nearest.length && nearest[0].km <= RULES.nearKm) { R.status = 'near'; R.focus = nearest[0].id; }
  else if (nearest.length) { R.status = 'far'; R.focus = nearest[0].id; }
  return R;
}

/* ---------- words ---------- */
const sig = (x, d = 2) => x == null || !isFinite(x) ? '?' : x >= 100 ? String(Math.round(x)) : String(+x.toPrecision(d));
const num = (x, lang) => lang === 'en' ? sig(x) : sig(x).replace('.', ','); // decimal comma in Spanish and Portuguese
const COMPASS = { en: { north: 'north', 'north-east': 'north-east', east: 'east', 'south-east': 'south-east', south: 'south', 'south-west': 'south-west', west: 'west', 'north-west': 'north-west' },
  es: { north: 'norte', 'north-east': 'noreste', east: 'este', 'south-east': 'sureste', south: 'sur', 'south-west': 'suroeste', west: 'oeste', 'north-west': 'noroeste' },
  pt: { north: 'norte', 'north-east': 'nordeste', east: 'leste', 'south-east': 'sudeste', south: 'sul', 'south-west': 'sudoeste', west: 'oeste', 'north-west': 'noroeste' } };
const dirOf = (deg, lang) => COMPASS[lang][D.compass(deg)];
const ptAo = w => w === 'leste' || w === 'oeste' ? 'a ' + w : 'ao ' + w;
const ptDo = w => w === 'leste' || w === 'oeste' ? 'de ' + w : 'do ' + w;
const LOCALE = { en: 'en-GB', es: 'es', pt: 'pt-BR' };
const tzWord = lang => REG.tzLabel[lang];
const hhmm = ms => new Intl.DateTimeFormat('en-GB', { timeZone: REG.tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(ms);
const dayOf = (ms, lang) => new Intl.DateTimeFormat(LOCALE[lang], { timeZone: REG.tz, day: 'numeric', month: 'long' }).format(ms);
function ago(ms, now, lang) {
  const h = (now - ms) / 36e5, es = lang === 'es', pt = lang === 'pt';
  if (h < 0) return es ? 'en el futuro (reloj del teléfono incorrecto?)' : pt ? 'no futuro (relógio do telefone errado?)' : 'in the future (phone clock wrong?)';
  if (h < 1) { const m = Math.max(1, Math.round(h * 60)); return es ? `hace ${m} min` : pt ? `há ${m} min` : `${m} min ago`; }
  if (h < 48) return es ? `hace ${num(h, lang)} h` : pt ? `há ${num(h, lang)} h` : `${num(h, lang)} h ago`;
  const d = Math.round(h / 24); return es ? `hace ${d} días` : pt ? `há ${d} dias` : `${d} days ago`;
}
const HEAD = {
  en: { smoke: 'SMOKE PATH REACHES THIS PLACE', near: 'FIRE NEARBY, SMOKE HEADING ELSEWHERE', far: 'FIRES WITHIN 25 KM, SMOKE NOT HEADING HERE', none: 'NO SATELLITE-DETECTED FIRE WITHIN 25 KM', nowind: 'WIND UNKNOWN: IT IS NOT KNOWN WHETHER SMOKE IS HEADING HERE', outside: n => `OUTSIDE ${n.toUpperCase()}: THIS PAGE'S AREA IS THE SELECTED REGION ONLY` },
  es: { smoke: 'LA TRAYECTORIA DEL HUMO LLEGA A ESTE LUGAR', near: 'FUEGO CERCA, EL HUMO VA HACIA OTRO LADO', far: 'FUEGOS A MENOS DE 25 KM, EL HUMO NO VA HACIA AQUÍ', none: 'NINGÚN FUEGO DETECTADO POR SATÉLITE A MENOS DE 25 KM', nowind: 'VIENTO DESCONOCIDO: NO SE SABE SI EL HUMO VA HACIA AQUÍ', outside: n => `FUERA DE ${n.toUpperCase()}: ESTA PÁGINA CUBRE SOLO LA REGIÓN ELEGIDA` },
  pt: { smoke: 'A TRAJETÓRIA DA FUMAÇA CHEGA A ESTE LOCAL', near: 'FOGO PERTO, A FUMAÇA VAI PARA OUTRO LADO', far: 'FOGOS A MENOS DE 25 KM, A FUMAÇA NÃO VAI PARA CÁ', none: 'NENHUM FOGO DETECTADO POR SATÉLITE A MENOS DE 25 KM', nowind: 'VENTO DESCONHECIDO: NÃO SE SABE SE A FUMAÇA VAI PARA CÁ', outside: () => `FORA ${REG.ptOf.toUpperCase()}: ESTA PÁGINA COBRE SÓ A REGIÃO ESCOLHIDA` },
};
const headOf = (status, lang) => { const h = HEAD[lang][status]; return typeof h === 'function' ? h(REG.name[lang]) : h; };
const FOOT = { en: 'Fires are observed by satellite; the smoke path is a modelled scenario, not a measurement. No detection does not mean no fire.', es: 'Los fuegos son observados por satélite; la trayectoria del humo es un escenario modelado, no una medición. Sin detección no significa sin fuego.', pt: 'Os fogos são observados por satélite; a trajetória da fumaça é um cenário modelado, não uma medição. Sem detecção não significa sem fogo.' };
function sentence(R, lang) {
  const es = lang === 'es', pt = lang === 'pt', it = R.items.find(i => i.id === R.focus), n = x => num(x, lang);
  const seen = it && it.passes > 1 ? (es ? `, visto en ${it.passes} pasadas` : pt ? `, visto em ${it.passes} passagens` : `, seen on ${it.passes} passes`) : '';
  const fire = it && (es ? `El satélite ${it.sat} detectó un fuego a las ${hhmm(it.ms)} (${tzWord('es')}) del ${dayOf(it.ms, 'es')}, a ${n(it.km)} km al ${dirOf(it.brg, 'es')} de este lugar, con ${n(it.frp)} MW${seen}.`
    : pt ? `O satélite ${it.sat} detectou um fogo em ${dayOf(it.ms, 'pt')}, ${hhmm(it.ms)} (${tzWord('pt')}), a ${n(it.km)} km ${ptAo(dirOf(it.brg, 'pt'))} deste local, com ${n(it.frp)} MW${seen}.`
    : `${it.sat} saw a fire at ${hhmm(it.ms)} ${tzWord('en')} on ${dayOf(it.ms, 'en')}, ${n(it.km)} km ${dirOf(it.brg, 'en')} of this place, ${n(it.frp)} megawatts${seen}.`);
  const wind = it && it.ws != null ? (es ? `El viento modelado, del ${dirOf(it.wd, 'es')} a ${n(it.ws)} m/s,` : pt ? `O vento modelado, vindo ${ptDo(dirOf(it.wd, 'pt'))} a ${n(it.ws)} m/s,` : `Modelled wind from the ${dirOf(it.wd, 'en')} at ${n(it.ws)} metres per second`) : '';
  const light = it && it.ws != null && it.ws < RULES.lightWind ? (es ? ' Viento débil: la dirección es poco confiable.' : pt ? ' Vento fraco: a direção é pouco confiável.' : ' The wind is light, so its direction is unreliable.') : '';
  const nm = REG.name[lang];
  let body = '';
  if (R.status === 'smoke') body = fire + ' ' + (es ? `${wind} lleva su humo hacia este lugar.` : pt ? `${wind} leva a fumaça até este local.` : `${wind} carries its smoke here.`) + light;
  else if (R.status === 'near') body = fire + ' ' + (es ? `${wind} lleva su humo lejos de este lugar.` : pt ? `${wind} leva a fumaça para longe deste local.` : `${wind} carries its smoke away from this place.`) + light;
  else if (R.status === 'far') body = es ? `Hay ${R.items.length} fuego(s) a menos de 25 km; el más cercano está a ${n(it.km)} km al ${dirOf(it.brg, 'es')}. El viento modelado lleva su humo lejos de este lugar.`
    : pt ? `Há ${R.items.length} fogo(s) a menos de 25 km; o mais próximo está a ${n(it.km)} km ${ptAo(dirOf(it.brg, 'pt'))}. O vento modelado leva a fumaça deles para longe deste local.`
    : `${R.items.length} fire(s) within 25 km; the nearest is ${n(it.km)} km ${dirOf(it.brg, 'en')}. Modelled wind carries their smoke away from this place.`;
  else if (R.status === 'none') body = es ? `Los satélites no registraron ningún fuego a menos de 25 km de este lugar en las 24 horas hasta las ${hhmm(R.dataEnd)} del ${dayOf(R.dataEnd, 'es')} (los últimos datos).`
    : pt ? `Os satélites não registraram nenhum fogo a menos de 25 km deste local nas 24 horas até ${hhmm(R.dataEnd)} de ${dayOf(R.dataEnd, 'pt')} (os dados mais recentes).`
    : `The satellites recorded no fire within 25 km of this place in the 24 hours up to ${hhmm(R.dataEnd)} on ${dayOf(R.dataEnd, 'en')} (the latest data).`;
  else if (R.status === 'nowind') body = es ? `Hay ${R.items.length} fuego(s) a menos de 25 km; el más cercano está a ${n(it.km)} km al ${dirOf(it.brg, 'es')} (${it.sat}, ${hhmm(it.ms)}). No se pudo cargar el viento modelado de este lugar, así que no se sabe si el humo va hacia aquí.`
    : pt ? `Há ${R.items.length} fogo(s) a menos de 25 km; o mais próximo está a ${n(it.km)} km ${ptAo(dirOf(it.brg, 'pt'))} (${it.sat}, ${hhmm(it.ms)}). Não foi possível carregar o vento modelado deste local, então não se sabe se a fumaça vai para cá.`
    : `${R.items.length} fire(s) within 25 km; the nearest is ${n(it.km)} km ${dirOf(it.brg, 'en')} (${it.sat}, ${hhmm(it.ms)}). The modelled wind could not be loaded for this place, so it is not known whether smoke is heading here.`;
  else body = es ? `Esta página solo tiene fuegos registrados en ${nm}, así que no puede decir nada de este lugar.` : pt ? `Esta página só tem fogos registrados ${REG.ptIn}, então não pode dizer nada sobre este local.` : `This page only holds fires recorded in ${nm}, so it cannot say anything about this place.`;
  const name = R.place.name ? R.place.name + ': ' : '', head = headOf(R.status, lang);
  return { head, body, foot: FOOT[lang], full: `${name}${head}. ${body} ${FOOT[lang]}` };
}
/* per satellite: pass starts (ms). Next look = earliest start + whole days that is after now. An estimate, not an orbit prediction. */
function nextLook(feed, now) {
  const t0 = Date.parse(feed.t0); let next = null;
  for (const [sat, p] of Object.entries(feed.passes || {})) for (const m of p) {
    let t = t0 + m * 60000; if (t <= now) t += Math.ceil((now - t) / 864e5 + 1e-9) * 864e5; if (t <= now) t += 864e5;
    if (!next || t < next.t) next = { t, sat };
  }
  return next;
}
const insideBox = p => { const v = REG.view; return !(p.lat < v[0][0] || p.lat > v[1][0] || p.lon < v[0][1] || p.lon > v[1][1]); };
root.PLACE = { insideBox, setRegion, headOf, tzWord, ptAo, ptDo, RULES, decodeFeed, dataEnd, wxAt, candidates, windWindow, windURL, analyse, sentence, nextLook, hhmm, dayOf, ago, num, dirOf, r2 };

/* ---------- page ---------- */
if (typeof document === 'undefined' || document.documentElement.hasAttribute('data-place-logic-only')) return; // role.html loads only the logic above
const $ = id => document.getElementById(id);
const UI = {
  en: { title: 'My place', sub: 'Is smoke from a satellite-detected fire heading for this place?', regionL: 'Region', clockH: 'When the satellites look', lastLook: 'Last look', nextLook: 'Next look', tagObs: 'OBSERVED', tagEst: 'ESTIMATE', delay: 'Data arrives up to three hours after a pass.',
    pickH: 'Choose the place', searchLabel: 'Search a town', searchPh: 'Search a town', geo: 'Use my location', statH: 'Result', choose: 'Choose a place to see the answer.', speak: 'Read aloud', stop: 'Stop', wa: 'Share by WhatsApp', copy: 'Copy', copied: 'Copied', copyFail: 'Copy failed: select the text and copy it by hand',
    listH: 'Fires considered', cacheH: 'Saved result (old)', whatH: 'What this is', esNote: 'Spanish and Portuguese texts are fixed templates, not live translations, and have not been reviewed by a native speaker. Check them before sharing.' },
  es: { title: 'Mi lugar', sub: '¿Va hacia este lugar el humo de un fuego detectado por satélite?', regionL: 'Región', clockH: 'Cuándo miran los satélites', lastLook: 'Última mirada', nextLook: 'Próxima mirada', tagObs: 'OBSERVADO', tagEst: 'ESTIMACIÓN', delay: 'Los datos llegan hasta tres horas después de una pasada.',
    pickH: 'Elija el lugar', searchLabel: 'Buscar una localidad', searchPh: 'Buscar una localidad', geo: 'Usar mi ubicación', statH: 'Resultado', choose: 'Elija un lugar para ver la respuesta.', speak: 'Leer en voz alta', stop: 'Detener', wa: 'Compartir por WhatsApp', copy: 'Copiar', copied: 'Copiado', copyFail: 'No se pudo copiar: seleccione el texto y cópielo a mano',
    listH: 'Fuegos considerados', cacheH: 'Resultado guardado (viejo)', whatH: 'Qué es esto', esNote: 'Los textos en español y portugués son plantillas fijas, no traducciones en vivo, y no los ha revisado un hablante nativo. Revíselos antes de compartir.' },
  pt: { title: 'Meu local', sub: 'A fumaça de um fogo detectado por satélite está indo para este local?', regionL: 'Região', clockH: 'Quando os satélites olham', lastLook: 'Última passagem', nextLook: 'Próxima passagem', tagObs: 'OBSERVADO', tagEst: 'ESTIMATIVA', delay: 'Os dados chegam até três horas depois de uma passagem.',
    pickH: 'Escolha o local', searchLabel: 'Buscar uma cidade', searchPh: 'Buscar uma cidade', geo: 'Usar minha localização', statH: 'Resultado', choose: 'Escolha um local para ver a resposta.', speak: 'Ler em voz alta', stop: 'Parar', wa: 'Compartilhar por WhatsApp', copy: 'Copiar', copied: 'Copiado', copyFail: 'Não foi possível copiar: selecione o texto e copie à mão',
    listH: 'Fogos considerados', cacheH: 'Resultado salvo (antigo)', whatH: 'O que é isto', esNote: 'Os textos em espanhol e português são modelos fixos, não traduções ao vivo, e não foram revisados por um falante nativo. Revise antes de compartilhar.' },
};
const LANGS = ['en', 'es', 'pt'], LNAME = { en: 'English', es: 'Español', pt: 'Português' };
const nav = (navigator.language || '').slice(0, 2).toLowerCase();
const S = { lang: LANGS.includes(nav) ? nav : 'en', region: 'PY', place: null, feed: null, fires: null, R: null, stale: false };
const store = { get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage full or blocked: carry on */ } } };
const T = k => UI[S.lang][k];
const norm = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const cleanName = s => String(s || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 60);
const L3 = (en, es, pt) => ({ en, es, pt })[S.lang];
let runId = 0, speaking = false;

function applyLang() {
  document.documentElement.lang = S.lang;
  document.querySelectorAll('[data-i]').forEach(e => { const k = e.dataset.i; if (k === 'speak') return; e.textContent = T(k); });
  document.querySelectorAll('[data-ph]').forEach(e => { e.placeholder = T(e.dataset.ph); });
  document.querySelectorAll('.lang button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.lang === S.lang)));
  document.querySelectorAll('[data-rn]').forEach(e => { e.textContent = REG.name[S.lang]; });
  const sel = $('region'); if (sel) { sel.setAttribute('aria-label', T('regionL')); [...sel.options].forEach(o => { o.textContent = RG.name(o.value, S.lang); }); }
  $('speak').textContent = speaking ? T('stop') : T('speak');
  document.title = T('title') + ' · FIREVERSE';
  if ($('fastCard')) { $('fastH').textContent = L3('Last 3 hours, fast satellite view', 'Últimas 3 horas, vista satelital rápida', 'Últimas 3 horas, visão rápida de satélite'); }
  renderFeedNote();
}
function renderFeedNote() {
  const f = S.feed, el = $('feedNote'); if (!el) return;
  if (!f) { el.textContent = ''; return; }
  const kinds = f.place_kinds ? f.place_kinds.join(', ') : '', nPl = f.places.length.toLocaleString(S.lang === 'en' ? 'en-US' : S.lang === 'es' ? 'es' : 'pt-BR');
  const kindWord = { city: L3('cities', 'ciudades', 'cidades'), town: L3('towns', 'localidades', 'cidades pequenas'), village: L3('villages', 'pueblos', 'vilarejos') };
  const kw = f.place_kinds ? f.place_kinds.map(k => kindWord[k] || k).join(', ') : '';
  el.textContent = L3(`This region's feed covers the fires of the last ${f.fire_hours} hours of data in ${REG.name.en}, and ${nPl} named places${kw ? ' (' + kw + ' only)' : ''}.`,
    `La fuente de esta región cubre los fuegos de las últimas ${f.fire_hours} horas de datos en ${REG.name.es}, y ${nPl} lugares con nombre${kw ? ' (solo ' + kw + ')' : ''}.`,
    `O arquivo desta região cobre os fogos das últimas ${f.fire_hours} horas de dados ${REG.ptIn}, e ${nPl} locais com nome${kw ? ' (somente ' + kw + ')' : ''}.`) + (kinds ? '' : '');
}
function renderClock() {
  const f = S.feed, now = Date.now(), warn = $('oldWarn'), tz = PLACE.tzWord(S.lang);
  if (!f) { $('lastLook').textContent = L3('unknown (the data could not be loaded)', 'desconocida (no se pudieron cargar los datos)', 'desconhecida (não foi possível carregar os dados)'); $('nextLook').textContent = L3('unknown', 'desconocida', 'desconhecida'); $('nextNote').textContent = ''; return; }
  const end = PLACE.dataEnd(f), h = (now - end) / 36e5;
  $('lastLook').textContent = `${PLACE.hhmm(end)} (${tz}), ${PLACE.dayOf(end, S.lang)} · ${PLACE.ago(end, now, S.lang)}`;
  warn.hidden = !(h > PLACE.RULES.oldHours);
  warn.textContent = L3(`THIS DATA IS OLD: the last look was ${PLACE.ago(end, now, 'en')}. What is shown is not the current situation.`, `ESTOS DATOS SON VIEJOS: la última mirada fue ${PLACE.ago(end, now, 'es')}. Lo que se muestra no es la situación actual.`, `ESTES DADOS SÃO ANTIGOS: a última passagem foi ${PLACE.ago(end, now, 'pt')}. O que aparece não é a situação atual.`);
  const nx = PLACE.nextLook(f, now);
  $('nextLook').textContent = nx ? `${L3('about', 'alrededor de las', 'por volta das')} ${PLACE.hhmm(nx.t)} (${tz}), ${PLACE.dayOf(nx.t, S.lang)} · ${nx.sat}` : L3('unknown (no recent pass times)', 'desconocida (sin horas de pasadas recientes)', 'desconhecida (sem horários de passagens recentes)');
  $('nextNote').textContent = L3('Estimated from recent pass times, not an orbit prediction.', 'Estimada con horas de pasadas recientes, no es una predicción de órbita.', 'Estimada com horários de passagens recentes, não é uma previsão de órbita.');
}
function row(label, tagKey, text) {
  const d = document.createElement('div'), dt = document.createElement('dt'), dd = document.createElement('dd'), tg = document.createElement('span');
  tg.className = 'tag ' + { obs: 'obs', mod: 'mod', scn: 'scn' }[tagKey]; tg.textContent = { obs: L3('OBSERVED', 'OBSERVADO', 'OBSERVADO'), mod: L3('MODELLED', 'MODELADO', 'MODELADO'), scn: L3('SCENARIO', 'ESCENARIO', 'CENÁRIO') }[tagKey];
  dt.append(label + ' ', tg); dd.textContent = text; d.append(dt, dd); return d;
}
function pageLink(p) {
  const u = new URL(location.href); u.search = ''; u.hash = '';
  return u.href + '?r=' + S.region + '&lat=' + p.lat.toFixed(2) + '&lon=' + p.lon.toFixed(2) + (p.name ? '&name=' + encodeURIComponent(p.name) : '');
}
function renderResult() {
  const R = S.R;
  const has = !!R;
  $('actions').hidden = !has; $('facts').hidden = !has; $('listCard').hidden = !has || !R.items.length;
  $('stale').hidden = !S.stale;
  if (!has) { $('stateHead').textContent = T('choose'); $('stateBody').textContent = ''; $('stateFoot').textContent = ''; $('status').className = 'status'; $('placeLine').textContent = ''; return; }
  const s = PLACE.sentence(R, S.lang), p = R.place;
  $('status').className = 'status ' + R.status;
  $('placeLine').textContent = (p.name ? p.name + ' · ' : L3('Your location · ', 'Su ubicación · ', 'Sua localização · ')) + p.lat.toFixed(2) + ', ' + p.lon.toFixed(2);
  $('stateHead').textContent = s.head; $('stateBody').textContent = s.body; $('stateFoot').textContent = s.foot;
  if (S.stale) $('stale').textContent = L3(`SAVED RESULT, OLD: computed ${PLACE.ago(R.computedAt, Date.now(), 'en')}. New data could not be loaded.`, `RESULTADO GUARDADO, VIEJO: calculado ${PLACE.ago(R.computedAt, Date.now(), 'es')}. No se pudieron cargar datos nuevos.`, `RESULTADO SALVO, ANTIGO: calculado ${PLACE.ago(R.computedAt, Date.now(), 'pt')}. Não foi possível carregar dados novos.`);
  const f = $('facts'); f.replaceChildren();
  const it = R.items.find(i => i.id === R.focus), n = x => PLACE.num(x, S.lang);
  if (it) {
    f.append(row(L3('Fire', 'Fuego', 'Fogo'), 'obs', `${it.sat} · ${PLACE.hhmm(it.ms)} ${PLACE.tzWord(S.lang)} · ${n(it.km)} km ${PLACE.dirOf(it.brg, S.lang)} · ${n(it.frp)} MW`));
    if (it.ws != null) f.append(row(L3('Wind at 100 m', 'Viento a 100 m', 'Vento a 100 m'), 'mod', L3(`from the ${PLACE.dirOf(it.wd, 'en')} at ${n(it.ws)} m/s · hour ${it.hour.slice(11, 16)} UTC`, `del ${PLACE.dirOf(it.wd, 'es')} a ${n(it.ws)} m/s · hora ${it.hour.slice(11, 16)} UTC`, `vindo ${PLACE.ptDo(PLACE.dirOf(it.wd, 'pt'))} a ${n(it.ws)} m/s · hora ${it.hour.slice(11, 16)} UTC`)));
    if (it.conc != null) f.append(row(L3('Smoke at this place', 'Humo en este lugar', 'Fumaça neste local'), 'scn', L3(`the scenario adds ${n(it.conc)} µg/m³ of fine particles (not a measurement)`, `el escenario agrega ${n(it.conc)} µg/m³ de partículas finas (no es una medición)`, `o cenário acrescenta ${n(it.conc)} µg/m³ de partículas finas (não é uma medição)`)));
  }
  const ul = $('list'); ul.replaceChildren();
  $('listNote').textContent = L3('Observed fires in the last 24 hours of data within 25 km. Each fire is shown once, with its latest pass.', 'Fuegos observados en las últimas 24 horas de datos, a menos de 25 km. Cada fuego aparece una vez, con su última pasada.', 'Fogos observados nas últimas 24 horas de dados, a menos de 25 km. Cada fogo aparece uma vez, com a passagem mais recente.');
  for (const i of R.items) {
    const li = document.createElement('li'), a = document.createElement('a'), b = document.createElement('b'), st = document.createElement('span');
    a.href = 'firelab.html?fire=' + encodeURIComponent(i.id);
    b.textContent = `${n(i.km)} km ${PLACE.dirOf(i.brg, S.lang)}`;
    st.className = i.down ? 'dw' : '';
    st.textContent = i.down === true ? L3('downwind', 'viento abajo', 'a favor do vento') : i.down === false ? L3('not downwind', 'no viento abajo', 'fora da direção do vento') : L3('wind unknown', 'viento desconocido', 'vento desconhecido');
    a.append(b, ` · ${PLACE.hhmm(i.ms)} · ${i.sat} · ${n(i.frp)} MW · `, st, i.passes > 1 ? L3(` · seen on ${i.passes} passes`, ` · visto en ${i.passes} pasadas`, ` · visto em ${i.passes} passagens`) : '');
    li.append(a); ul.append(li);
  }
  $('wa').href = 'https://wa.me/?text=' + encodeURIComponent(s.full + ' ' + pageLink(p));
}
function renderCache(R) {
  S.cache = R || null; const c = $('cacheCard'); if (!R || !S.R || S.R === R) { c.hidden = true; return; }
  const s = PLACE.sentence(R, S.lang);
  c.hidden = false; $('cacheText').textContent = L3(`Computed ${PLACE.ago(R.computedAt, Date.now(), 'en')} (old). `, `Calculado ${PLACE.ago(R.computedAt, Date.now(), 'es')} (viejo). `, `Calculado ${PLACE.ago(R.computedAt, Date.now(), 'pt')} (antigo). `) + s.full;
}
async function fetchWind(place, cl) {
  const w = PLACE.windWindow(cl); if (!w) return { H: null, skipped: true };
  const j = await FIRECORE.getJSON(PLACE.windURL(place, w), 20000);
  if (!j || !j.hourly || !j.hourly.time) throw new Error('no wind');
  return { H: j.hourly };
}
const resKey = () => 'fv.place.result.' + S.region;
async function run() {
  const my = ++runId, p = S.place; S.stale = false;
  if (!p) { S.R = null; renderResult(); return; }
  $('stateHead').textContent = L3('Working it out…', 'Calculando…', 'Calculando…'); $('stateBody').textContent = '';
  const last = store.get(resKey()), cached = last && last.place && last.place.lat === p.lat && last.place.lon === p.lon ? last : null;
  if (!S.fires) { // no feed: show the saved result, marked old
    S.R = cached || null; S.stale = !!cached; renderResult(); renderCache(null);
    if (!cached) { $('stateHead').textContent = L3('THE DATA COULD NOT BE LOADED AND THERE IS NO SAVED RESULT', 'NO SE PUDIERON CARGAR LOS DATOS Y NO HAY RESULTADO GUARDADO', 'NÃO FOI POSSÍVEL CARREGAR OS DADOS E NÃO HÁ RESULTADO SALVO'); $('stateBody').textContent = L3('It is not known whether smoke is heading here.', 'No se sabe si el humo va hacia este lugar.', 'Não se sabe se a fumaça vai para este local.'); }
    return;
  }
  const end = PLACE.dataEnd(S.feed), cl = PLACE.candidates(p, S.fires, end);
  let H = null;
  if (PLACE.insideBox(p)) { try { const w = await fetchWind(p, cl); H = w.H; if (w.skipped) H = { time: [], wind_speed_100m: [], wind_direction_100m: [] }; } catch (e) { H = null; } }
  if (my !== runId) return;
  const R = PLACE.analyse(p, S.fires, end, H);
  S.R = R; renderResult();
  if (R.status !== 'nowind') { store.set(resKey(), R); renderCache(null); }
  else renderCache(cached);
}
async function setPlace(p) {
  S.place = { lat: r2(+p.lat), lon: r2(+p.lon), name: cleanName(p.name) };
  store.set('fv.place', S.place);
  $('matches').replaceChildren(); $('geoMsg').textContent = '';
  stopSpeak(); await run(); fastLook(); // the fast view is fetched only after the main status is shown
}
function search(q) {
  const ul = $('matches'); ul.replaceChildren(); const n = norm(q).trim(); if (n.length < 2 || !S.feed) return;
  const hit = S.feed.places.filter(p => norm(p[0]).includes(n)).sort((a, b) => norm(a[0]).startsWith(n) === norm(b[0]).startsWith(n) ? 0 : norm(a[0]).startsWith(n) ? -1 : 1).slice(0, 8);
  if (!hit.length) { const li = document.createElement('li'); li.className = 'muted'; li.textContent = L3('No match. Try fewer letters or use your location.', 'Sin coincidencias. Pruebe sin tildes o use su ubicación.', 'Sem resultados. Tente sem acentos ou use sua localização.'); ul.append(li); return; }
  for (const p of hit) { const li = document.createElement('li'), b = document.createElement('button'); b.type = 'button'; b.textContent = p[0]; b.addEventListener('click', () => { $('q').value = p[0]; setPlace({ lat: p[1], lon: p[2], name: p[0] }); }); li.append(b); ul.append(li); }
}
function locate() {
  const m = $('geoMsg');
  if (!navigator.geolocation) { m.textContent = L3('This browser cannot give your location. Search for a town instead.', 'Este navegador no puede dar su ubicación. Busque una localidad.', 'Este navegador não consegue dar sua localização. Busque uma cidade.'); return; }
  m.textContent = L3('Finding your location…', 'Buscando su ubicación…', 'Procurando sua localização…');
  navigator.geolocation.getCurrentPosition(pos => setPlace({ lat: pos.coords.latitude, lon: pos.coords.longitude, name: '' }),
    err => { m.textContent = err.code === 1 ? L3('Location was not allowed. That is fine: search for a town instead.', 'No se permitió la ubicación. No pasa nada: busque una localidad.', 'A localização não foi permitida. Sem problema: busque uma cidade.') : L3('Your location could not be found. Search for a town instead.', 'No se pudo obtener la ubicación. Busque una localidad.', 'Não foi possível obter sua localização. Busque uma cidade.'); },
    { timeout: 15000, maximumAge: 600000 });
}
function stopSpeak() { if ('speechSynthesis' in window) speechSynthesis.cancel(); speaking = false; $('speak').setAttribute('aria-pressed', 'false'); $('speak').textContent = T('speak'); }
function say(msg) { $('toast').textContent = msg; }
/* ---------- fast look: INPE 10-minute GOES-19 pixels, secondary and never part of the main status ---------- */
const FASTR = 10; // km
const FS = { token: 0, res: null };
function fastAgo(ms) { const m = Math.max(0, Math.round((Date.now() - ms) / 6e4)); return m < 120 ? L3(`${m} min ago`, `hace ${m} min`, `há ${m} min`) : PLACE.ago(ms, Date.now(), S.lang); }
async function fastLook() {
  const my = ++FS.token, p = S.place; FS.res = null;
  if (!p || !PLACE.insideBox(p) || !window.FAST) { renderFast(); return; }
  renderFast('wait');
  let L = null;
  try { const d = 0.12 / Math.max(.3, Math.cos(p.lat * Math.PI / 180)); L = await FAST.load({ bbox: [p.lon - d, p.lat - 0.12, p.lon + d, p.lat + 0.12], hours: 3 }); } catch (e) { L = null; }
  if (my !== FS.token) return;
  if (!L || (L.files.loaded === 0 && L.files.failed > 0)) { FS.res = { err: true }; renderFast(); return; }
  const near = FAST.pixels(L.detections).map(px => ({ px, km: D.dist(p.lat, p.lon, px.lat, px.lon) })).filter(o => o.km <= FASTR);
  const res = { near, newestFileMs: L.newestFileMs, newestDetectionMs: L.newestDetectionMs, files: L.files, hits: [], windFailed: false };
  if (near.length) {
    try {
      const w = { d0: new Date(Date.now() - 4 * 36e5).toISOString().slice(0, 10), d1: new Date().toISOString().slice(0, 10), old: false };
      const j = await FIRECORE.getJSON(PLACE.windURL(p, w), 20000);
      if (!j || !j.hourly || !j.hourly.time) throw new Error('no wind');
      for (const o of near) {
        const wx = PLACE.wxAt(j.hourly, o.px.lastMs); if (!wx) { res.windFailed = true; continue; }
        const u = FAST.upwindOfPoint(o.px, wx, p.lat, p.lon, { reachKm: FASTR });
        if (u.downwind || u.inPixel) res.hits.push({ ...o, u, wx });
      }
    } catch (e) { res.windFailed = true; }
    res.hits.sort((a, b) => b.px.scans - a.px.scans || a.km - b.km);
  }
  if (my !== FS.token) return;
  FS.res = res; renderFast();
}
function renderFast(wait) {
  const card = $('fastCard'), R = FS.res; card.hidden = !S.place || !PLACE.insideBox(S.place);
  if (card.hidden) return;
  $('fastCav').textContent = L3('Coarse view: pixels of about 2 km, no fire size, more false alarms than MODIS or VIIRS, not validated. It does not change the answer above.', 'Vista gruesa: píxeles de unos 2 km, sin tamaño del fuego, más falsas alarmas que MODIS o VIIRS, no validada. No cambia la respuesta de arriba.', 'Visão grosseira: pixels de cerca de 2 km, sem tamanho do fogo, mais alarmes falsos que MODIS ou VIIRS, não validada. Não altera a resposta acima.');
  const el = $('fastText'), n = x => PLACE.num(x, S.lang);
  if (wait || !R) { el.textContent = L3('Loading the fast view…', 'Cargando la vista rápida…', 'Carregando a visão rápida…'); return; }
  if (R.err) { el.textContent = L3('The fast satellite view (INPE) could not be reached. The answer above is not affected.', 'No se pudo conectar con la vista satelital rápida (INPE). La respuesta de arriba no cambia.', 'Não foi possível acessar a visão rápida de satélite (INPE). A resposta acima não muda.'); return; }
  const fileAge = R.newestFileMs ? L3(` Newest file: ${fastAgo(R.newestFileMs)}.`, ` Archivo más nuevo: ${fastAgo(R.newestFileMs)}.`, ` Arquivo mais novo: ${fastAgo(R.newestFileMs)}.`) : '';
  if (!R.near.length) { el.textContent = L3('None flagged within 10 km in the last 3 hours.', 'Ninguno marcado a menos de 10 km en las últimas 3 horas.', 'Nenhum marcado a menos de 10 km nas últimas 3 horas.') + fileAge; return; }
  if (!R.hits.length) {
    el.textContent = (R.windFailed ? L3(`${R.near.length} pixel(s) within 10 km; the modelled wind could not be loaded, so it is not known whether any is upwind.`, `${R.near.length} píxel(es) a menos de 10 km; no se pudo cargar el viento modelado, así que no se sabe si alguno está viento arriba.`, `${R.near.length} pixel(s) a menos de 10 km; não foi possível carregar o vento modelado, então não se sabe se algum está a barlavento.`)
      : L3(`${R.near.length} pixel(s) within 10 km, none upwind of this place by the modelled wind.`, `${R.near.length} píxel(es) a menos de 10 km, ninguno viento arriba de este lugar según el viento modelado.`, `${R.near.length} pixel(s) a menos de 10 km, nenhum a barlavento deste local segundo o vento modelado.`)) + fileAge; return;
  }
  const h = R.hits[0], dir = PLACE.dirOf(h.u.bearing, S.lang), mins = h.u.travelMin == null ? null : Math.max(5, Math.round(h.u.travelMin / 5) * 5), sc = h.px.scans;
  el.textContent = L3(`A fire pixel ${n(h.km)} km ${dir} of this place is upwind: flagged on ${sc} ten-minute scan${sc === 1 ? '' : 's'}, newest ${fastAgo(h.px.lastMs)}${mins ? `; smoke could take about ${mins} min` : ''}${h.u.inPixel ? '. The place is inside the pixel: the fire may be on either side' : ''}.`,
    `Un píxel de fuego a ${n(h.km)} km al ${dir} de este lugar está viento arriba: marcado en ${sc} ${sc === 1 ? 'lectura' : 'lecturas'} de 10 minutos, la más nueva ${fastAgo(h.px.lastMs)}${mins ? `; el humo podría tardar unos ${mins} min` : ''}${h.u.inPixel ? '. El lugar está dentro del píxel: el fuego puede estar a cualquier lado' : ''}.`,
    `Um pixel de fogo a ${n(h.km)} km ${PLACE.ptAo(dir)} deste local está a barlavento: marcado em ${sc} ${sc === 1 ? 'leitura' : 'leituras'} de 10 minutos, a mais nova ${fastAgo(h.px.lastMs)}${mins ? `; a fumaça poderia levar cerca de ${mins} min` : ''}${h.u.inPixel ? '. O local está dentro do pixel: o fogo pode estar de qualquer lado' : ''}.`) + fileAge;
}
async function loadRegion(iso) {
  S.region = iso; REG = RG.get(iso); PLACE.setRegion(REG); RG.remember(iso);
  $('region').value = iso;
  try { const u = new URL(location.href); u.searchParams.set('r', iso); history.replaceState(null, '', u); } catch (e) { /* sandboxed URL */ }
  S.feed = null; S.fires = null; S.R = null; $('matches').replaceChildren(); $('q').value = '';
  const saved = store.get('fv.place');
  if (!S.place && saved && isFinite(saved.lat) && isFinite(saved.lon)) S.place = saved;
  if (S.place && !S.fromUrl && !RG.inside(iso, S.place.lat, S.place.lon)) S.place = null; // a place saved in another region is not carried over; one given in the link is kept, so the page can say it is outside this region
  try {
    const r = await fetch(`app-data/feed/${iso}.json`); if (!r.ok) throw new Error('HTTP ' + r.status);
    S.feed = await r.json(); S.fires = PLACE.decodeFeed(S.feed);
  } catch (e) { S.feed = null; S.fires = null; }
  applyLang(); renderClock(); await run(); fastLook();
}
async function init() {
  await RG.ready;
  const sel = $('region'); sel.innerHTML = RG.codes().map(c => `<option value="${c}">${RG.name(c, 'en')}</option>`).join('');
  $('langBox').innerHTML = LANGS.map(l => `<button type="button" data-lang="${l}" aria-pressed="${l === S.lang}">${LNAME[l]}</button>`).join('');
  const q = new URLSearchParams(location.search), lat = parseFloat(q.get('lat')), lon = parseFloat(q.get('lon'));
  if (isFinite(lat) && isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) { S.place = { lat: r2(lat), lon: r2(lon), name: cleanName(q.get('name')) }; S.fromUrl = true; }
  const iso = RG.initial(location.search); REG = RG.get(iso); PLACE.setRegion(REG); applyLang(); renderResult();
  document.querySelector('.lang').addEventListener('click', e => { const b = e.target.closest('[data-lang]'); if (!b) return; stopSpeak(); S.lang = b.dataset.lang; applyLang(); renderClock(); renderResult(); renderCache(S.cache); search($('q').value); renderFast(); });
  sel.addEventListener('change', e => { S.fromUrl = false; loadRegion(e.target.value); });
  $('q').addEventListener('input', e => search(e.target.value));
  $('geo').addEventListener('click', locate);
  $('copy').addEventListener('click', async () => { if (!S.R) return; try { await navigator.clipboard.writeText(PLACE.sentence(S.R, S.lang).full + ' ' + pageLink(S.R.place)); say(T('copied')); } catch (e) { say(T('copyFail')); } });
  $('speak').addEventListener('click', () => {
    if (!S.R || !('speechSynthesis' in window)) return say(L3('This browser cannot read aloud.', 'Este navegador no puede leer en voz alta.', 'Este navegador não consegue ler em voz alta.'));
    if (speaking) return stopSpeak();
    const u = new SpeechSynthesisUtterance(PLACE.sentence(S.R, S.lang).full); u.lang = { es: 'es-ES', pt: 'pt-BR', en: 'en-GB' }[S.lang]; u.onend = stopSpeak;
    speaking = true; $('speak').setAttribute('aria-pressed', 'true'); $('speak').textContent = T('stop'); speechSynthesis.speak(u);
  });
  await loadRegion(iso);
  setInterval(renderClock, 60000);
  window.__PL = { S, setPlace, loadRegion };
}
init();
})(typeof window !== 'undefined' ? window : globalThis);
