/* BULLETIN: every bulletin text of DOWNWIND and the role pages, full and short (SMS, radio), in English, Spanish and Portuguese.
   Plain script: attaches BULLETIN to window/globalThis, loads in Node via vm. Needs DOWNWIND (downwind-core.js) and WATCH (watch-core.js) first.
   Nothing here reads the page: the region (time zone and its words), the prepared assets (for the nearest named place) and the compass
   words arrive in a context object  c = { region, assets, compass }  (compass defaults to REGIONS.COMPASS).
   Spanish and Portuguese are fixed templates that no native speaker has reviewed yet. */
(function (root) {
'use strict';
const D = () => root.DOWNWIND, WATCH = root.WATCH;
const sigEN = (x, d = 2) => x == null || !isFinite(x) ? '—' : x >= 100 ? Math.round(x).toLocaleString('en-US') : String(+x.toPrecision(d));
const ctx = c => (c && c.compass ? c : { ...c, compass: root.REGIONS && root.REGIONS.COMPASS });
const LOCALE = { en: 'en-GB', es: 'es', pt: 'pt-BR' };
const timeLocal = (ms, region) => new Intl.DateTimeFormat('en-GB', { timeZone: region.tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(ms);
const dayLocal = (ms, lang, region) => new Intl.DateTimeFormat(LOCALE[lang], { timeZone: region.tz, day: 'numeric', month: 'long' }).format(ms);
const utc = ms => new Date(ms).toISOString().slice(11, 16);
const tzWord = (lang, region) => region.tzLabel[lang];
const cw = (dir, lang, c) => c.compass[lang][dir];
const ptAo = w => w === 'leste' || w === 'oeste' ? 'a ' + w : 'ao ' + w; // "a leste, ao norte"
const ptPara = w => w === 'leste' || w === 'oeste' ? 'para ' + w : 'para o ' + w;
const ptDo = w => w === 'leste' || w === 'oeste' ? 'de ' + w : 'do ' + w; // "vindo de leste, do norte"
const UNNAMED = { en: 'unnamed on the map', es: 'sin nombre en el mapa', pt: 'sem nome no mapa' };
function assetName(r, lang) {
  const a = r.asset, un = UNNAMED[lang], clinic = { en: 'Clinic', es: 'Clínica', pt: 'Clínica' }[lang];
  if (r.kind === 'power') return { en: `${a.kv} kV power line`, es: `Línea de ${a.kv} kV`, pt: `Linha de ${a.kv} kV` }[lang];
  if (r.kind === 'roads') return a.ref ? { en: 'Route ', es: 'Ruta ', pt: 'Rodovia ' }[lang] + a.ref : a.name || { en: 'Main road, unnamed on the map', es: 'Ruta principal sin nombre en el mapa', pt: 'Rodovia principal sem nome no mapa' }[lang];
  if (r.kind === 'health') return a.name || (a.kind === 'hospital' ? 'Hospital' : clinic) + (lang === 'en' ? ', ' : ' ') + un;
  return a.name || { en: 'School, unnamed on the map', es: 'Escuela sin nombre en el mapa', pt: 'Escola sem nome no mapa' }[lang];
}
const NIGHT_NOTE = { en: 'Night, stable air: the plume stays narrow and the model is least reliable.', es: 'Noche con aire estable: la columna de humo se mantiene estrecha y el modelo es menos confiable.', pt: 'Noite com ar estável: a pluma de fumaça fica estreita e o modelo é menos confiável.' };
const NIGHT_ROW = 'night, stable air: the plume stays narrow and the model is least reliable';
const stable = r => !!(r.s && r.s.r && (r.s.r.cls === 'E' || r.s.r.cls === 'F'));

/* ---- short format (SMS, radio text): at most 160 characters, no characters outside the GSM 7-bit default alphabet
   (and no extension-table characters such as ~ [ ] { } | ^ \ or the euro sign, which count double). ---- */
const SHORT_MAX = 160;
const GSM = new Set(('@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà').split(''));
const ABBR = { en: { north: 'N', 'north-east': 'NE', east: 'E', 'south-east': 'SE', south: 'S', 'south-west': 'SW', west: 'W', 'north-west': 'NW' },
  es: { north: 'N', 'north-east': 'NE', east: 'E', 'south-east': 'SE', south: 'S', 'south-west': 'SO', west: 'O', 'north-west': 'NO' },
  pt: { north: 'N', 'north-east': 'NE', east: 'L', 'south-east': 'SE', south: 'S', 'south-west': 'SO', west: 'O', 'north-west': 'NO' } };
function gsmClean(t, lang) { // names from the map: ASCII in English, GSM 7-bit default alphabet in Spanish and Portuguese; anything else becomes its base letter or is dropped
  const EXT = '~^\\[]{}|', ok = ch => lang !== 'en' ? GSM.has(ch) && ch !== '\n' && ch !== '\r' : ch >= ' ' && ch <= '~' && !EXT.includes(ch);
  let out = '';
  for (const ch of String(t ?? '').replace(/[‘’‛]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-')) {
    if (ok(ch)) out += ch;
    else { const b = ch.normalize('NFD')[0]; if (b && b !== ch && ok(b)) out += b; else if (/\s/.test(ch)) out += ' '; }
  }
  return out.replace(/\s+/g, ' ').trim();
}
const SHORT_GEN = { en: { power: 'Power line', roads: 'Road', hospital: 'Hospital', clinic: 'Clinic', schools: 'School' }, es: { power: 'Linea', roads: 'Ruta', hospital: 'Hospital', clinic: 'Clinica', schools: 'Escuela' }, pt: { power: 'Linha', roads: 'Rodovia', hospital: 'Hospital', clinic: 'Clinica', schools: 'Escola' } };
const SHORT_TO = { en: { power: 'to line', roads: 'to road', health: 'to site', schools: 'to site' }, es: { power: 'a la linea', roads: 'a la ruta', health: 'al lugar', schools: 'al lugar' }, pt: { power: 'até a linha', roads: 'até a rodovia', health: 'até o local', schools: 'até o local' } };
/* Pure: o = { kind, label, name, place, km, dir (compass word), mw, hhmm, eta (minutes or null) } -> text of at most 160 characters. */
function shortBulletin(o, lang) {
  const ab = ABBR[lang][o.dir] || '', cl = t => gsmClean(t, lang), num = x => lang === 'en' ? x : x.replace('.', ',');
  const GEN = { power: SHORT_GEN[lang].power, roads: SHORT_GEN[lang].roads, health: SHORT_GEN[lang][o.label === 'hospital' ? 'hospital' : 'clinic'], schools: SHORT_GEN[lang].schools };
  const to = SHORT_TO[lang][o.kind];
  const eta = o.eta == null ? '' : { en: ` in about ${o.eta}min`, es: ` en unos ${o.eta}min`, pt: ` em uns ${o.eta}min` }[lang];
  const build = (asset, place, noEta) => ({
    en: `SMOKE WATCH ${asset}${place ? ' nr ' + place : ''}: fire ${o.km}km ${ab}, ${o.mw}MW, seen ${o.hhmm}. Modelled wind takes smoke ${to}${noEta ? '' : eta}. Satellite model, not ground report.`,
    es: `VIGILANCIA DE HUMO ${asset}${place ? ' cerca de ' + place : ''}: fuego a ${num(o.km)}km ${ab}, ${num(o.mw)}MW, visto ${o.hhmm}. Viento modelado lleva humo ${to}${noEta ? '' : eta}. Modelo satelital, no reporte de campo.`,
    pt: `VIGILANCIA DE FUMACA ${asset}${place ? ' perto de ' + place : ''}: fogo a ${num(o.km)}km ${ab}, ${num(o.mw)}MW, visto ${o.hhmm}. Vento modelado leva fumaca ${to}${noEta ? '' : eta}. Modelo de satelite, nao relato de campo.`,
  }[lang]);
  const name = cl(o.name), place = cl(o.place), tries = [];
  if (name) { tries.push([name, place], [name, '']); for (const n of [28, 20, 14]) if (name.length > n) { const cut = name.slice(0, n + 1), sp = cut.lastIndexOf(' '), w = sp >= 6 ? cut.slice(0, sp) : name.slice(0, n); tries.push([w.trim(), '']); } }
  tries.push([GEN[o.kind], place], [GEN[o.kind], '']);
  for (const [a, p] of tries) { const t = build(a, p); if (t.length <= SHORT_MAX) return t; }
  for (const [a, p] of tries) { const t = build(a, p, true); if (t.length <= SHORT_MAX) return t; } // last resort: drop the travel time
  return build(GEN[o.kind], '', true).slice(0, SHORT_MAX); // cannot happen with real numbers; a hard stop so the limit always holds
}
function shortOf(r, lang, c) {
  c = ctx(c);
  const P = c.assets, pl = WATCH.nearPlace(P, r.at[0], r.at[1]), a = r.asset, eta = r.eta == null ? null : Math.max(5, Math.round(r.eta / 5) * 5);
  const o = { kind: r.kind, label: a.kind, place: pl ? pl.name : '', km: sigEN(r.nearestKm ?? r.km), dir: D().compass(r.bearing + 180), mw: sigEN(r.fire.frp), hhmm: timeLocal(r.fire.ms, c.region), eta, name: '' };
  let asset;
  if (r.kind === 'power') asset = { en: `${a.kv}kV line`, es: `Linea ${a.kv}kV`, pt: `Linha ${a.kv}kV` }[lang];
  else if (r.kind === 'roads') asset = a.ref ? { en: 'Route ', es: 'Ruta ', pt: 'Rodovia ' }[lang] + a.ref : a.name || '';
  else asset = a.name || '';
  o.name = asset; return shortBulletin(o, lang);
}
const bulletinText = (r, lang, fmt, c) => r.fast ? (fmt === 'short' ? shortFast(r, lang, c) : fastBulletin(r, lang, c)) : fmt === 'short' ? shortOf(r, lang, c) : bulletin(r, lang, c);
const FAST_NOTE = { en: 'This comes from a coarse 10-minute satellite view (GOES-19, pixels of about 2 km) with no fire size: it is not a measured plume and not a ground report.', es: 'Esto viene de una vista satelital gruesa de 10 minutos (GOES-19, píxeles de unos 2 km) sin tamaño del fuego: no es una columna de humo medida ni un reporte de campo.', pt: 'Isto vem de uma visão de satélite grosseira de 10 minutos (GOES-19, pixels de cerca de 2 km) sem o tamanho do fogo: não é uma pluma medida nem um relato de campo.' };
function fastBulletin(r, lang, c) {
  c = ctx(c);
  const P = c.assets, pl = WATCH.nearPlace(P, r.at[0], r.at[1]), sg = lang === 'en' ? sigEN : x => sigEN(x).replace('.', ',');
  const where = pl ? ({ en: `, near ${pl.name}`, es: `, cerca de ${pl.name}`, pt: `, perto de ${pl.name}` }[lang]) : '';
  const isLine = WATCH.KINDS[r.kind].line, dir = D().compass(r.bearing + 180), km = sg(r.km), wf = D().compass(r.wx.wd), n = r.scans;
  const eta = r.eta == null ? null : Math.max(5, Math.round(r.eta / 5) * 5), t1 = timeLocal(r.px.firstMs, c.region), t2 = timeLocal(r.px.lastMs, c.region), light = r.wx.ws < WATCH.RULES.lightWind;
  const cut = { en: 'The pixel is about 2 km wide, so the fire may be on either side of it.', es: 'El píxel mide unos 2 km de ancho, así que el fuego puede estar a cualquier lado.', pt: 'O pixel tem cerca de 2 km de largura, então o fogo pode estar de qualquer lado.' }[lang];
  const inpx = r.u.inPixel ? { en: 'The asset lies inside the pixel, so the wind test cannot be trusted here.', es: 'El lugar está dentro del píxel, así que la prueba del viento no es confiable aquí.', pt: 'O local está dentro do pixel, então o teste do vento não é confiável aqui.' }[lang] : '';
  const lightT = light ? { en: 'The wind is light, so its direction is unreliable.', es: 'Viento débil: la dirección es poco confiable.', pt: 'Vento fraco: a direção é pouco confiável.' }[lang] : '';
  if (lang === 'es') return [`VIGILANCIA DE HUMO, VISTA RÁPIDA. ${assetName(r, 'es')}${where}.`, FAST_NOTE.es,
    `Un píxel de fuego a ${km} km al ${cw(dir, 'es', c)} ${isLine ? 'de la línea' : 'de este lugar'}, visto en ${n} ${n === 1 ? 'lectura' : 'lecturas'} de 10 minutos entre las ${t1} y las ${t2} (${tzWord('es', c.region)}).`,
    `El viento modelado, del ${cw(wf, 'es', c)} a ${sg(r.wx.ws)} m/s, podría llevar humo hacia ${isLine ? 'la línea' : 'este lugar'}${eta ? `, en unos ${eta} minutos` : ''}.`, cut, inpx, lightT, 'Sin detección no significa sin fuego.'].filter(Boolean).join(' ');
  if (lang === 'pt') return [`VIGILÂNCIA DE FUMAÇA, VISÃO RÁPIDA. ${assetName(r, 'pt')}${where}.`, FAST_NOTE.pt,
    `Um pixel de fogo a ${km} km ${ptAo(cw(dir, 'pt', c))} ${isLine ? 'da linha' : 'deste local'}, visto em ${n} ${n === 1 ? 'leitura' : 'leituras'} de 10 minutos entre ${t1} e ${t2} (${tzWord('pt', c.region)}).`,
    `O vento modelado, vindo ${ptDo(cw(wf, 'pt', c))} a ${sg(r.wx.ws)} m/s, poderia levar fumaça até ${isLine ? 'a linha' : 'este local'}${eta ? `, em cerca de ${eta} minutos` : ''}.`, cut, inpx, lightT, 'Sem detecção não significa sem fogo.'].filter(Boolean).join(' ');
  return [`SMOKE WATCH, FAST VIEW. ${assetName(r, 'en')}${where}.`, FAST_NOTE.en,
    `A fire pixel ${km} km ${dir} of ${isLine ? 'the line' : 'this place'}, flagged on ${n} ten-minute scan${n === 1 ? '' : 's'} between ${t1} and ${t2} ${tzWord('en', c.region)}.`,
    `Modelled wind from the ${wf} at ${sg(r.wx.ws)} metres per second could carry smoke ${isLine ? 'to the line' : 'to this place'}${eta ? `, in about ${eta} minutes` : ''}.`, cut, inpx, lightT, 'No detection does not mean no fire.'].filter(Boolean).join(' ');
}
/* short form, same 160-character and GSM rules; the coarse, no-fire-size status is kept in every variant */
function shortFast(r, lang, c) {
  c = ctx(c);
  const P = c.assets, pl = WATCH.nearPlace(P, r.at[0], r.at[1]), a = r.asset, cl = t => gsmClean(t, lang), num = x => lang === 'en' ? x : x.replace('.', ',');
  const ab = ABBR[lang][D().compass(r.bearing + 180)] || '', km = num(sigEN(r.km)), n = r.scans, eta = r.eta == null ? null : Math.max(5, Math.round(r.eta / 5) * 5);
  const GEN = { power: SHORT_GEN[lang].power, roads: SHORT_GEN[lang].roads, health: SHORT_GEN[lang][a.kind === 'hospital' ? 'hospital' : 'clinic'], schools: SHORT_GEN[lang].schools };
  const to = SHORT_TO[lang][r.kind], inpx = r.u.inPixel;
  const e = eta == null ? '' : { en: ` in about ${eta}min`, es: ` en unos ${eta}min`, pt: ` em uns ${eta}min` }[lang];
  const build = (asset, place, noEta) => ({
    en: `FAST SMOKE WATCH ${asset}${place ? ' nr ' + place : ''}: coarse 10-min satellite pixel ${km}km ${ab}, ${n} scan${n === 1 ? '' : 's'}, no fire size${inpx ? ', in pixel' : ''}. Wind may take smoke ${to}${noEta ? '' : e}. Not ground report.`,
    es: `SATELITE RAPIDO ${asset}${place ? ' cerca de ' + place : ''}: pixel grueso a ${km}km ${ab}, ${n} lect., sin tamano de fuego${inpx ? ', en pixel' : ''}. Viento puede llevar humo ${to}${noEta ? '' : e}. No es reporte de campo.`,
    pt: `SATELITE RAPIDO ${asset}${place ? ' perto de ' + place : ''}: pixel grosso a ${km}km ${ab}, ${n} leit., sem tamanho do fogo${inpx ? ', no pixel' : ''}. Vento pode levar fumaca ${to}${noEta ? '' : e}. Nao e relato de campo.`,
  }[lang]);
  let asset;
  if (r.kind === 'power') asset = { en: `${a.kv}kV line`, es: `Linea ${a.kv}kV`, pt: `Linha ${a.kv}kV` }[lang];
  else if (r.kind === 'roads') asset = a.ref ? { en: 'Route ', es: 'Ruta ', pt: 'Rodovia ' }[lang] + a.ref : a.name || '';
  else asset = a.name || '';
  const name = cl(asset), place = cl(pl ? pl.name : ''), tries = [];
  if (name) { tries.push([name, place], [name, '']); for (const m of [28, 20, 14]) if (name.length > m) { const cut = name.slice(0, m + 1), sp = cut.lastIndexOf(' '), w = sp >= 6 ? cut.slice(0, sp) : name.slice(0, m); tries.push([w.trim(), '']); } }
  tries.push([GEN[r.kind], place], [GEN[r.kind], '']);
  for (const [x, y] of tries) { const t = build(x, y); if (t.length <= SHORT_MAX) return t; }
  for (const [x, y] of tries) { const t = build(x, y, true); if (t.length <= SHORT_MAX) return t; }
  return build(GEN[r.kind], '', true).slice(0, SHORT_MAX);
}
function bulletin(r, lang, c) {
  c = ctx(c);
  const f = r.fire, P = c.assets, pl = WATCH.nearPlace(P, r.at[0], r.at[1]), sig = lang === 'en' ? sigEN : x => sigEN(x).replace('.', ',');
  const where = pl ? ({ en: `, near ${pl.name}`, es: `, cerca de ${pl.name}`, pt: `, perto de ${pl.name}` }[lang]) : '';
  const fromAsset = D().compass(r.bearing + 180), km = sig(r.nearestKm ?? r.km), isLine = WATCH.KINDS[r.kind].line;
  const windFrom = D().compass(r.wx.wd), light = r.wx.ws < WATCH.RULES.lightWind;
  const eta = r.eta == null ? null : Math.max(5, Math.round(r.eta / 5) * 5);
  if (lang === 'es') {
    return [`VIGILANCIA DE HUMO. ${assetName(r, 'es')}${where}.`,
      `El satélite ${f.sat} detectó un fuego a las ${timeLocal(f.ms, c.region)} (${tzWord('es', c.region)}) del ${dayLocal(f.ms, 'es', c.region)}, a ${km} km al ${cw(fromAsset, 'es', c)}${isLine ? ' de la línea' : ''}, con ${sig(f.frp)} MW.`,
      `El viento modelado, del ${cw(windFrom, 'es', c)} a ${sig(r.wx.ws)} m/s, lleva el humo hacia ${isLine ? 'la línea' : 'este lugar'}${eta ? `; llegaría unos ${eta} minutos después de salir del fuego` : ''}.`,
      light ? 'Viento débil: la dirección es poco confiable.' : '',
      stable(r) ? NIGHT_NOTE.es : '',
      'Es un escenario modelado con datos satelitales, no un reporte de campo. Sin detección no significa sin fuego.'].filter(Boolean).join(' ');
  }
  if (lang === 'pt') {
    return [`VIGILÂNCIA DE FUMAÇA. ${assetName(r, 'pt')}${where}.`,
      `O satélite ${f.sat} detectou um fogo em ${dayLocal(f.ms, 'pt', c.region)}, ${timeLocal(f.ms, c.region)} (${tzWord('pt', c.region)}), a ${km} km ${ptAo(cw(fromAsset, 'pt', c))}${isLine ? ' da linha' : ' deste local'}, com ${sig(f.frp)} MW.`,
      `O vento modelado, vindo ${ptDo(cw(windFrom, 'pt', c))} a ${sig(r.wx.ws)} m/s, leva a fumaça ${isLine ? 'até a linha' : 'até este local'}${eta ? `; chegaria cerca de ${eta} minutos depois de sair do fogo` : ''}.`,
      light ? 'Vento fraco: a direção é pouco confiável.' : '',
      stable(r) ? NIGHT_NOTE.pt : '',
      'É um cenário modelado com dados de satélite, não um relato de campo. Sem detecção não significa sem fogo.'].filter(Boolean).join(' ');
  }
  return [`SMOKE WATCH. ${assetName(r, 'en')}${where}.`,
    `${f.sat} saw a fire at ${timeLocal(f.ms, c.region)} ${tzWord('en', c.region)} on ${dayLocal(f.ms, 'en', c.region)}, ${km} km ${fromAsset} of ${isLine ? 'the line' : 'this place'}, ${sig(f.frp)} megawatts.`,
    `Modelled wind from the ${windFrom} at ${sig(r.wx.ws)} metres per second carries the smoke ${isLine ? 'across the line' : 'to this place'}${eta ? `, about ${eta} minutes after it leaves the fire` : ''}.`,
    light ? 'The wind is light, so its direction is unreliable.' : '',
    stable(r) ? NIGHT_NOTE.en : '',
    'This is a modelled scenario from satellite data, not a ground report. No detection does not mean no fire.'].filter(Boolean).join(' ');
}


/* ---------- bulletins that the role pages add ---------- */
const AC = {
  en: (s, when, tz) => `ALL CLEAR, SATELLITE DATA. No fire detected by satellite ${s.en} in the data up to ${when}${tz}. Satellite data arrives up to three hours after a pass and the smoke path is a modelled scenario. No detection does not mean no fire.`,
  es: (s, when, tz) => `SIN NOVEDAD, DATOS SATELITALES. Ningún fuego detectado por satélite ${s.es} en los datos hasta ${when}${tz}. Los datos satelitales llegan hasta tres horas después de una pasada y la trayectoria del humo es un escenario modelado. Sin detección no significa sin fuego.`,
  pt: (s, when, tz) => `SEM NOVIDADE, DADOS DE SATÉLITE. Nenhum fogo detectado por satélite ${s.pt} nos dados até ${when}${tz}. Os dados de satélite chegam até três horas depois de uma passagem e a trajetória da fumaça é um cenário modelado. Sem detecção não significa sem fogo.`,
};
/* the line to copy on a day when nothing is in the path. subject: { en, es, pt }; c.endMs: end of the data (ms) */
function allClear(subject, lang, c) {
  const when = timeLocal(c.endMs, c.region) + ', ' + dayLocal(c.endMs, lang, c.region);
  return AC[lang](subject, when, ' (' + tzWord(lang, c.region) + ')');
}
const SHORT_AC = {
  en: s => `ALL CLEAR (satellite data): no fire seen upwind of ${s}. Data lags up to 3h. No detection is not no fire.`,
  es: s => `SIN NOVEDAD (datos satelite): sin fuego visto viento arriba de ${s}. Datos con hasta 3h de retraso. Sin deteccion no es sin fuego.`,
  pt: s => `SEM NOVIDADE (dados satelite): sem fogo visto a barlavento de ${s}. Dados com ate 3h de atraso. Sem deteccao nao e sem fogo.`,
};
const SHORT_SUBJ = { en: { power: 'power lines', roads: 'roads', site: 'site' }, es: { power: 'lineas', roads: 'rutas', site: 'lugar' }, pt: { power: 'linhas', roads: 'rodovias', site: 'local' } };
const shortAllClear = (kind, lang) => SHORT_AC[lang](SHORT_SUBJ[lang][kind] || SHORT_SUBJ[lang].site);


const NA = {
  en: s => `NOT ASSESSED. Smoke paths to ${s.en} could not be fully assessed: some data or the modelled wind could not be loaded. This is not an all-clear. Satellite data, modelled scenario, not a ground report.`,
  es: s => `NO EVALUADO. No se pudieron evaluar por completo las trayectorias de humo hacia ${s.es}: faltaron datos o el viento modelado. Esto no es una señal de que todo esté bien. Datos satelitales, escenario modelado, no un reporte de campo.`,
  pt: s => `NÃO AVALIADO. Não foi possível avaliar por completo as trajetórias de fumaça para ${s.pt}: faltaram dados ou o vento modelado. Isto não é um sinal de que está tudo bem. Dados de satélite, cenário modelado, não um relato de campo.`,
};
const notAssessed = (subject, lang) => NA[lang](subject);
const SHORT_NA = { en: 'NOT ASSESSED: data or modelled wind missing. This is NOT an all-clear. Satellite model, not ground report.', es: 'NO EVALUADO: faltan datos o viento modelado. NO es una senal de que todo este bien. Modelo satelital, no reporte de campo.', pt: 'NAO AVALIADO: faltam dados ou vento modelado. NAO e um sinal de que esta tudo bem. Modelo de satelite, nao relato de campo.' };

/* The fire-brigade bulletin. it = { fire: { sat, ms, frp }, km (from base), brg (bearing from base to the fire), wx: { ws, wd } | null, heading (compass word the smoke goes toward, or null),
   assets: [{ kind, name }] (mapped assets in the modelled path) }, c.baseName: the base, c.baseKinds for nothing else. */
const FIRE_KIND = { en: { power: 'power line', roads: 'road', health: 'clinic or hospital', schools: 'school' }, es: { power: 'línea eléctrica', roads: 'ruta', health: 'clínica u hospital', schools: 'escuela' }, pt: { power: 'linha de energia', roads: 'rodovia', health: 'clínica ou hospital', schools: 'escola' } };
function fireBulletin(it, lang, c) {
  c = ctx(c);
  const sg = lang === 'en' ? sigEN : x => sigEN(x).replace('.', ','), f = it.fire, dir = D().compass(it.brg), wf = it.wx ? D().compass(it.wx.wd) : null, hd = it.heading;
  const base = c.baseName || { en: 'base', es: 'la base', pt: 'a base' }[lang];
  const list = it.assets.slice(0, 4).map(a => (a.name ? a.name + ' (' + FIRE_KIND[lang][a.kind] + ')' : FIRE_KIND[lang][a.kind])).join(', ') + (it.assets.length > 4 ? ' +' + (it.assets.length - 4) : '');
  const light = it.wx && it.wx.ws < WATCH.RULES.lightWind;
  if (lang === 'es') return [`VIGILANCIA DE FUEGO. ${base}.`, `El satélite ${f.sat} detectó un fuego a las ${timeLocal(f.ms, c.region)} (${tzWord('es', c.region)}) del ${dayLocal(f.ms, 'es', c.region)}, a ${sg(it.km)} km al ${cw(dir, 'es', c)} de la base, con ${sg(f.frp)} MW.`,
    it.wx ? `El viento modelado, del ${cw(wf, 'es', c)} a ${sg(it.wx.ws)} m/s, lleva el humo hacia el ${cw(hd, 'es', c)}.` : 'No se pudo cargar el viento modelado: no se sabe hacia dónde va el humo.',
    it.wx ? (it.assets.length ? `En su trayectoria modelada: ${list}.` : 'Ninguna línea, ruta, clínica ni escuela mapeada está en la trayectoria modelada.') : '', light ? 'Viento débil: la dirección es poco confiable.' : '',
    'Es un escenario modelado con datos satelitales, no un reporte de campo. Sin detección no significa sin fuego.'].filter(Boolean).join(' ');
  if (lang === 'pt') return [`VIGILÂNCIA DE FOGO. ${base}.`, `O satélite ${f.sat} detectou um fogo em ${dayLocal(f.ms, 'pt', c.region)}, ${timeLocal(f.ms, c.region)} (${tzWord('pt', c.region)}), a ${sg(it.km)} km ${ptAo(cw(dir, 'pt', c))} da base, com ${sg(f.frp)} MW.`,
    it.wx ? `O vento modelado, vindo ${ptDo(cw(wf, 'pt', c))} a ${sg(it.wx.ws)} m/s, leva a fumaça ${ptPara(cw(hd, 'pt', c))}.` : 'Não foi possível carregar o vento modelado: não se sabe para onde vai a fumaça.',
    it.wx ? (it.assets.length ? `Na trajetória modelada: ${list}.` : 'Nenhuma linha, rodovia, clínica ou escola mapeada está na trajetória modelada.') : '', light ? 'Vento fraco: a direção é pouco confiável.' : '',
    'É um cenário modelado com dados de satélite, não um relato de campo. Sem detecção não significa sem fogo.'].filter(Boolean).join(' ');
  return [`FIRE WATCH. ${base}.`, `${f.sat} saw a fire at ${timeLocal(f.ms, c.region)} ${tzWord('en', c.region)} on ${dayLocal(f.ms, 'en', c.region)}, ${sg(it.km)} km ${dir} of base, ${sg(f.frp)} megawatts.`,
    it.wx ? `Modelled wind from the ${wf} at ${sg(it.wx.ws)} metres per second carries the smoke toward the ${hd}.` : 'The modelled wind could not be loaded, so it is not known where the smoke is heading.',
    it.wx ? (it.assets.length ? `In its modelled path: ${list}.` : 'No mapped power line, road, clinic or school is in the modelled path.') : '', light ? 'The wind is light, so its direction is unreliable.' : '',
    'This is a modelled scenario from satellite data, not a ground report. No detection does not mean no fire.'].filter(Boolean).join(' ');
}
function shortFire(it, lang, c) {
  c = ctx(c);
  const cl = t => gsmClean(t, lang), num = x => lang === 'en' ? x : x.replace('.', ','), f = it.fire, ab = ABBR[lang][D().compass(it.brg)] || '', hd = it.heading ? ABBR[lang][it.heading] : '';
  const n = it.assets.length, ws = it.wx ? num(sigEN(it.wx.ws)) : null;
  const build = base => ({
    en: `FIRE WATCH${base ? ' ' + base : ''}: ${num(sigEN(f.frp))}MW, ${num(sigEN(it.km))}km ${ab} of base, seen ${timeLocal(f.ms, c.region)}. ${ws ? `Modelled wind takes smoke ${hd}, ${ws}m/s. ${n} mapped asset${n === 1 ? '' : 's'} in path.` : 'No modelled wind.'} Satellite model, not ground report.`,
    es: `VIGILANCIA DE FUEGO${base ? ' ' + base : ''}: ${num(sigEN(f.frp))}MW, ${num(sigEN(it.km))}km ${ab} de la base, visto ${timeLocal(f.ms, c.region)}. ${ws ? `Viento modelado lleva humo al ${hd}, ${ws}m/s. ${n} lugar(es) mapeado(s) en la trayectoria.` : 'Sin viento modelado.'} Modelo satelital, no reporte de campo.`,
    pt: `VIGILANCIA DE FOGO${base ? ' ' + base : ''}: ${num(sigEN(f.frp))}MW, ${num(sigEN(it.km))}km ${ab} da base, visto ${timeLocal(f.ms, c.region)}. ${ws ? `Vento modelado leva fumaca a ${hd}, ${ws}m/s. ${n} local(is) mapeado(s) na trajetoria.` : 'Sem vento modelado.'} Modelo de satelite, nao relato de campo.`,
  }[lang]);
  const name = cl(c.baseName || '');
  for (const b of [name, name.slice(0, 20).trim(), '']) { const t = build(b); if (t.length <= SHORT_MAX) return t; }
  return build('').slice(0, SHORT_MAX);
}

root.BULLETIN = { sig: sigEN, timeLocal, dayLocal, utc, tzWord, assetName, gsmClean, shortBulletin, shortOf, bulletin, fastBulletin, shortFast, bulletinText, stable, NIGHT_ROW, SHORT_MAX, allClear, shortAllClear, notAssessed, shortNotAssessed: lang => SHORT_NA[lang], fireBulletin, shortFire, LANGS: ['en', 'es', 'pt'] };
})(typeof globalThis !== 'undefined' ? globalThis : window);
