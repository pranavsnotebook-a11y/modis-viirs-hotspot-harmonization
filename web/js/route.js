/* route.html: the smoke-aware route planner. Behaviour only. The logic is in route-core.js; the words are in route-core.js (ROUTE.UI) and role-config.js (shared frame text).
   Fires come from the light feed (never the 10 MB bundle), wind from our server's cache or Open-Meteo, routes from our server's cache or OSRM.
   Every number shown comes from the core. No key is used here. */
(function () {
'use strict';
const RT = window.ROUTE, RL = window.ROLES, C = window.ROLECFG, W = window.WATCH, RD = window.ROLEDATA, D = window.DOWNWIND, RG = window.REGIONS, PL = window.PLACE, F = window.FIRECORE;
const $ = id => document.getElementById(id);
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage blocked */ } },
};
const nav = (navigator.language || '').slice(0, 2).toLowerCase(), LANGS = ['en', 'es', 'pt'];
const S = { lang: LANGS.includes(store.get('fv.role.lang')) ? store.get('fv.role.lang') : LANGS.includes(nav) ? nav : 'en', region: 'PY', reg: null, feed: null, fires: [], end: 0, clusters: [], small: 0,
  errFeed: false, wind: null, from: null, to: null, depart: 0, res: null, msg: null, warn: null, warn2: null, assets: null, busy: false, gj: null, example: null, picks: 0,
  baseMs: 0, follow: true, fitted: null, chosen: null, leave: null, drive: null, muted: !!store.get('fv.route.mute'), simSpeed: RT.RULES.simSpeed, driveMsg: null };
// the role this page was opened for (?role=driver from the role picker): shown in the header, saved like the other role pages do
const role = RL ? RL.get(new URLSearchParams(location.search).get('role')) : null;
if (role) RL.save(role.id);
let runId = 0, map = null, layer = null, pins = null, carLayer = null;
const T = (k, ...a) => { const v = RT.UI[S.lang][k]; return typeof v === 'function' ? v(...a) : v; };
const SH = (k, ...a) => { const v = C.ui[S.lang][k]; return typeof v === 'function' ? v(...a) : v; }; // shared frame text of the role pages
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const nf = (x, dp) => RT.nf(x, S.lang, dp);
const toast = m => { const e = $('toast'); e.textContent = m; e.classList.add('show'); clearTimeout(toast._t); toast._t = setTimeout(() => e.classList.remove('show'), 3000); };
const fmtDur = s => { const m = Math.round(s / 60); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`; };
const hhmm = ms => PL.hhmm(ms);

/* ---------- messages (kept as a key so a language switch re-words them) ---------- */
function renderMsgs() {
  const st = $('rtStatus'); st.textContent = S.msg ? T(S.msg[0], ...S.msg.slice(1)) : '';
  for (const [id, k] of [['rtWarn', 'warn'], ['rtWarn2', 'warn2']]) { const w = $(id), v = S[k]; w.hidden = !v; w.textContent = v ? T(v[0], ...v.slice(1)) : ''; }
}
const say = (...m) => { S.msg = m.length && m[0] ? m : null; renderMsgs(); };
const warn = (k, ...a) => { S.warn = k ? [k, ...a] : null; renderMsgs(); };
const warn2 = (k, ...a) => { S.warn2 = k ? [k, ...a] : null; renderMsgs(); };

/* ---------- data ---------- */
async function gz(url) {
  const r = await fetch(url); if (!r.ok) throw new Error(url + ' HTTP ' + r.status);
  const b = new Uint8Array(await r.arrayBuffer());
  return b[0] === 0x1f && b[1] === 0x8b ? new Uint8Array(await new Response(new Blob([b]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()) : b;
}
async function loadFeed(iso) {
  try {
    const r = await fetch(`app-data/feed/${iso}.json`); if (!r.ok) throw new Error('feed HTTP ' + r.status);
    const f = await r.json(); return { feed: f, fires: PL.decodeFeed(f) };
  } catch (e) { return { feed: null, fires: [] }; }
}

/* ---------- frame ---------- */
function renderFrame() {
  document.documentElement.lang = S.lang;
  $('rtTitle').textContent = T('title'); $('rtQuestion').textContent = T('q'); document.title = `${T('title')} · FIREVERSE`;
  const roleName = role ? (role.id === 'driver' ? T('roleDriver') : role.title) : '';
  $('rtMode').textContent = (roleName ? roleName + ' · ' : '') + (S.reg ? S.reg.name[S.lang] : '');
  $('rtRole').hidden = !role; $('rtRoleTxt').textContent = roleName;
  $('switchRole').href = role ? 'start.html?r=' + S.region : 'start.html';
  $('leaveH').textContent = T('leaveH'); $('leaveNote').textContent = T('leaveNote'); $('stepsH').textContent = T('stepsH'); $('stepsNote').textContent = T('stepsNote');
  $('driveH').textContent = T('driveH'); $('driveTxt').textContent = T('driveStart'); $('simTxt').textContent = T('simulate'); $('stopTxt').textContent = T('driveStop'); $('driveSafety').textContent = T('driveSafety');
  renderMute(); renderRecenter(); renderSearchLine();
  $('rtSwap').title = T('swap'); $('rtSwap').setAttribute('aria-label', T('swap')); $('rtHandle').setAttribute('aria-label', T('handle'));
  $('lblEta').textContent = T('driveEta'); $('lblLeft').textContent = T('driveTimeLeft'); $('lblKm').textContent = T('driveKmLeft');
  { const b = $('rtPanelToggle'), open = MAIN().dataset.panel !== 'closed'; b.title = open ? T('panelHide') : T('panelShow'); b.setAttribute('aria-label', b.title); }
  $('switchTxt').textContent = SH('switchRole'); $('lblRegion').textContent = SH('region'); $('langBox').setAttribute('aria-label', SH('lang'));
  $('themeToggle').title = SH('theme'); $('themeToggle').setAttribute('aria-label', SH('theme'));
  $('planH').textContent = T('planH'); $('lblFrom').textContent = T('from'); $('lblTo').textContent = T('to'); $('lblDepart').textContent = T('depart');
  $('rtFrom').placeholder = T('search'); $('rtTo').placeholder = T('search'); $('locTxt').textContent = T('useLoc'); $('rtClick').textContent = T('clickMap');
  $('goTxt').textContent = T('go'); $('exTxt').textContent = T('example');
  const sel = $('rtDepart'), cur = String(S.depart); sel.replaceChildren();
  [0, 1, 2, 3].forEach(h => { const o = el('option', null, h ? T('inH', h) : T('now')); o.value = String(h); sel.append(o); }); sel.value = cur;
  $('mapH').textContent = T('mapH'); $('routesH').textContent = T('routesH'); $('handH').textContent = T('handH');
  $('rtMap').setAttribute('aria-label', T('mapLabel'));
  $('clockH').textContent = T('clockH'); $('lastL').textContent = SH('lastLook'); $('tagObs').textContent = SH('tagObs'); $('firesL').textContent = T('fireCount'); $('heldNote').textContent = T('held');
  $('rtSafety').textContent = T('safety');
  const cr = $('rtCredit'); cr.replaceChildren(el('span', null, T('credit') + '. '), el('span', 'rt-muted', T('creditNote')));
  $('esNote').textContent = S.lang === 'en' ? '' : SH('esNote'); $('esNote').hidden = S.lang === 'en';
  $('fullLink').textContent = SH('fullPage'); $('fullLink').href = 'downwind.html?r=' + S.region; $('placeLink').href = 'place.html';
  [...$('regionSel').options].forEach(o => { o.textContent = RG.name(o.value, S.lang); });
  $('langBox').querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.lang === S.lang)));
  $('gmapsNote').textContent = T('gmapsNote'); $('geoNote').textContent = T('geoNote');
  $('rtGmaps').querySelector('span').textContent = T('gmaps'); $('rtGeojson').querySelector('span').textContent = T('geojson');
  renderLegend();
}
function renderClock() {
  const f = S.feed, now = Date.now(), old = $('oldWarn');
  if (!f) { $('lastLook').textContent = SH('unknown'); $('fireCount').textContent = SH('unknown'); old.hidden = true; return; }
  const end = PL.dataEnd(f), h = (now - end) / 36e5, tz = PL.tzWord(S.lang);
  $('lastLook').textContent = `${PL.hhmm(end)} (${tz}), ${PL.dayOf(end, S.lang)} · ${PL.ago(end, now, S.lang)}`;
  old.hidden = !(h > RT.RULES.oldHours); old.textContent = SH('old', PL.ago(end, now, S.lang));
  setTimeout(relayout, 0);
  $('fireCount').textContent = `${T('fires', S.clusters.length, RT.RULES.minFrp, RT.RULES.hours)} · ${T('through', PL.hhmm(end) + ' ' + PL.dayOf(end, S.lang))}`;
}

/* ---------- layout: panel, sheet, map padding ---------- */
const MAIN = () => $('main');
const phoneMq = window.matchMedia ? matchMedia('(max-width: 759px)') : { matches: false };
const reduceMq = window.matchMedia ? matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
const isPhone = () => phoneMq.matches;
const PEEK = 190;   // px of the sheet that shows in its peek state (the css has the same number)
function stopPx() { const m = $('main').getBoundingClientRect(); return Math.round($('rtSearch').getBoundingClientRect().bottom - m.top + 8); }
function sheetVisible(state) { const h = $('main').getBoundingClientRect().height; return state === 'full' ? h - stopPx() : state === 'half' ? Math.min(h * .46, h - stopPx()) : PEEK; }
/* the map under the floating panel (desktop) or search card and sheet (phone) is padded away, so fitted routes are not hidden */
function fitPad() {
  const m = $('rtMap').getBoundingClientRect(), tl = [24, 24], br = [24, 24];
  if (isPhone()) {
    tl[1] = Math.max(24, $('rtSearch').getBoundingClientRect().bottom - m.top + 12);
    if (S.res && !S.drive) br[1] = Math.max(24, sheetVisible(MAIN().dataset.sheet) + 12);
  } else if (MAIN().dataset.panel === 'open' && !S.drive) tl[0] = Math.max(24, $('rtPanel').getBoundingClientRect().right - m.left + 16);
  return { paddingTopLeft: tl, paddingBottomRight: br };
}
function fitTo(bounds, o = {}) { if (map && bounds && (bounds.isValid ? bounds.isValid() : bounds.length)) map.fitBounds(bounds, { ...fitPad(), animate: false, ...o }); }
function relayout() { if (isPhone()) MAIN().style.setProperty('--stop', stopPx() + 'px'); if (map) setTimeout(() => map.invalidateSize(), 0); }
function setSheet(state) {
  const m = MAIN(); m.dataset.sheet = state; $('rtSheet').dataset.sheet = state; $('rtHandle').dataset.state = state;
  $('rtSheet').style.transform = ''; relayout();
  if (S.res && isPhone() && !S.drive && S.fitted) setTimeout(() => fitTo(S.fitted), 260);
}
const SHEETS = ['peek', 'half', 'full'];
const cycleSheet = () => setSheet(SHEETS[(SHEETS.indexOf(MAIN().dataset.sheet) + 1) % 3]);
function setPanel(open) {
  MAIN().dataset.panel = open ? 'open' : 'closed'; const b = $('rtPanelToggle'); b.setAttribute('aria-expanded', String(open)); b.title = b.ariaLabel = open ? T('panelHide') : T('panelShow');
  $('rtPanel').inert = !open; relayout();
}
function searchOpen(open) { MAIN().dataset.search = open ? 'open' : 'closed'; $('rtSearchLine').setAttribute('aria-expanded', String(open)); relayout(); if (open && isPhone()) setSheet('peek'); }
function initSheetDrag() {
  const h = $('rtHandle'), sh = $('rtSheet'); let y0 = 0, base = 0, moved = false, id = null, t0 = 0;
  const offsetOf = st => { const H = sh.getBoundingClientRect().height; return H - sheetVisible(st); };   // translateY of a state, px
  h.addEventListener('pointerdown', e => { if (!isPhone()) return; id = e.pointerId; y0 = e.clientY; t0 = e.timeStamp; moved = false; base = offsetOf(MAIN().dataset.sheet); h.setPointerCapture(id); });
  h.addEventListener('pointermove', e => {
    if (id !== e.pointerId) return; const dy = e.clientY - y0; if (Math.abs(dy) > 6) moved = true; if (!moved) return;
    sh.dataset.drag = ''; sh.style.transform = `translateY(${Math.max(0, Math.min(offsetOf('peek'), base + dy))}px)`;
  });
  const end = e => {
    if (id !== e.pointerId) return; id = null; delete sh.dataset.drag; if (!moved) return;   // a tap is a click: the button cycles
    const dy = e.clientY - y0, v = dy / Math.max(1, e.timeStamp - t0), at = Math.max(0, Math.min(offsetOf('peek'), base + dy + Math.max(-80, Math.min(80, v * 120))));   // a flick adds a little momentum, never a whole state
    let best = 'peek', bd = Infinity; for (const st of SHEETS) { const d = Math.abs(offsetOf(st) - at); if (d < bd) { bd = d; best = st; } }
    h.dataset.dragged = '1'; setTimeout(() => delete h.dataset.dragged, 50); setSheet(best);
  };
  h.addEventListener('pointerup', end); h.addEventListener('pointercancel', end);
  h.addEventListener('click', () => { if (h.dataset.dragged) return; cycleSheet(); });
}

/* ---------- maneuver pictograms (own stroke icons, 24x24) ---------- */
const MAN = {
  straight: '<path d="M12 20V5M7 10l5-5 5 5"/>', left: '<path d="M18 20v-7a3 3 0 0 0-3-3H6M10 6 6 10l4 4"/>', right: '<path d="M6 20v-7a3 3 0 0 1 3-3h9M14 6l4 4-4 4"/>',
  'slight-left': '<path d="M15 20v-8L8 5M8 11V5h6"/>', 'slight-right': '<path d="M9 20v-8l7-7M16 11V5h-6"/>', 'sharp-left': '<path d="M16 20v-6L6 6M6 12V6h6"/>', 'sharp-right': '<path d="M8 20v-6l10-8M18 12V6h-6"/>',
  uturn: '<path d="M8 20V9a4 4 0 0 1 8 0v4M12 10l4 4 4-4"/>', ramp: '<path d="M6 20c0-7 11-5 11-14M13 9l4-4 4 4"/>', merge: '<path d="M6 20c0-8 6-6 6-15M18 20c0-8-6-6-6-15M9 8l3-3 3 3"/>',
  fork: '<path d="M12 21v-7M12 14 6 7M12 14l6-7M6 12V7h5M18 12V7h-5"/>', roundabout: '<circle cx="12" cy="15" r="4"/><path d="M12 19v2M12 11V4M9 7l3-3 3 3"/>',
  arrive: '<path d="M7 21V4M7 5h10l-2 4 2 4H7"/>', depart: '<circle cx="12" cy="12" r="3.5"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/>',
};
function manIcon(key, cls = 'rt-mi') {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('class', cls); s.setAttribute('aria-hidden', 'true'); s.innerHTML = MAN[key] || MAN.straight; return s;
}

/* ---------- map ---------- */
function initMap() {
  const box = $('rtMap');
  if (!window.L) { box.textContent = T('noMapLib'); box.classList.add('rt-nomap'); return; }
  map = L.map(box, { zoomControl: false, attributionControl: true, worldCopyJump: false });
  L.control.zoom({ position: 'bottomright' }).addTo(map);
  const rc = L.control({ position: 'bottomright' });
  rc.onAdd = () => { const d = L.DomUtil.create('div', 'leaflet-bar rt-rc'), b = L.DomUtil.create('button', '', d); b.id = 'rtRecenter'; b.type = 'button'; b.innerHTML = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M12 3v4M12 17v4M3 12h4M17 12h4"/><circle cx="12" cy="12" r="8"/></svg>'; L.DomEvent.disableClickPropagation(d); b.addEventListener('click', recenter); return d; };
  rc.addTo(map);
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}', { maxZoom: 18, maxNativeZoom: 17, attribution: 'Tiles © Esri · Roads © OpenStreetMap contributors · Fires: NASA FIRMS' }).addTo(map);
  layer = L.layerGroup().addTo(map); pins = L.layerGroup().addTo(map); carLayer = L.layerGroup().addTo(map);
  map.on('click', e => { if (!S.drive) mapClick(e.latlng); });
  map.on('dragstart', () => { if (S.drive && S.follow) { S.follow = false; MAIN().dataset.follow = 'false'; renderRecenter(); } });
  renderRecenter();
}
function renderRecenter() { const b = $('rtRecenter'); if (!b) return; const lbl = T('recenter'); b.title = lbl; b.setAttribute('aria-label', lbl); b.dataset.paused = String(!!(S.drive && !S.follow)); }
/* the recenter button: while driving it resumes following the marker; otherwise it fits the routes (or the region) in view again */
function recenter() {
  if (S.drive) { S.follow = true; MAIN().dataset.follow = 'true'; renderRecenter(); if (S.drive.pos) followTo(S.drive.pos, true); return; }
  if (S.fitted) fitTo(S.fitted); else fitRegion();
}
const FOLLOW_ZOOM = 14;
function followTo(pos, first) {
  if (!map || !S.follow) return;
  const z = Math.max(map.getZoom(), 13), anim = !reduceMq.matches;
  if (first || map.getZoom() < 13) map.setView(pos, FOLLOW_ZOOM, { animate: anim, duration: .5 }); else map.panTo(pos, { animate: anim, duration: .3, easeLinearity: .5 });
  void z;
}
function fitRegion() { if (map && S.reg) map.fitBounds(S.reg.view, { ...fitPad(), animate: false }); }
function drawPins() {
  if (!map) return; pins.clearLayers();
  [['start', S.from], ['end', S.to]].forEach(([k, p]) => { if (p) L.marker([p.lat, p.lon], { icon: L.divIcon({ className: 'rt-pin ' + k, iconSize: [22, 22], iconAnchor: [11, 11], html: '<i></i>' }), keyboard: false, title: p.name }).addTo(pins); });
}
function drawFires(rel) {
  if (!map) return; layer.clearLayers();
  const near = new Set(rel || []);
  const list = S.clusters.slice().sort((a, b) => b.frp - a.frp).slice(0, 700);
  list.forEach(f => {
    const isNear = near.has(f);
    L.circleMarker([f.lat, f.lon], { radius: isNear ? 5 + Math.min(5, Math.sqrt(f.frp) / 3) : 3, color: '#151515', weight: isNear ? 1.5 : .5, fillColor: '#F54E00', fillOpacity: isNear ? .95 : .45, className: 'rt-fire' })
      .bindTooltip(`${SH('fire')} · ${nf(f.frp, 0)} MW · ${PL.hhmm(f.ms)} ${PL.dayOf(f.ms, S.lang)}`).addTo(layer);
  });
}
const shortDur = s => { const m = Math.round(s / 60); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`; };
function routeLabel(r) { const t = shortDur(r.route.duration); return r.status === 'notAssessed' ? T('lblNA', t) : r.kmInSmoke > 0 ? T('lblSmoke', t, nf(r.kmInSmoke, 1)) : T('lblClear', t); }
function drawRoutes(res) {
  drawFires(res.relFires);
  const bounds = [], mine = chosenRoute();
  const order = res.routes.slice().sort((a, b) => (a === mine ? 1 : 0) - (b === mine ? 1 : 0)); // the chosen one on top
  order.forEach(r => {
    const ll = r.route.coords.map(p => [p[1], p[0]]); ll.forEach(p => bounds.push(p));
    const on = r === mine, w = on ? 7 : 4, col = on ? '#1D3FD8' : r.detour ? '#7357D9' : '#6C7A99', name = r.detour ? T('routeD') : T('route', r.name), pick = () => chooseRoute(r.name);
    L.polyline(ll, { color: '#151515', weight: w + 3, opacity: on ? .9 : .35, interactive: false, className: 'rt-casing' }).addTo(layer);
    // a wider invisible line under the visible one makes the thin grey routes easy to hit
    L.polyline(ll, { color: '#000', weight: 18, opacity: 0, className: 'rt-hit' }).on('click', e => { L.DomEvent.stopPropagation(e); pick(); }).addTo(layer);
    L.polyline(ll, { color: col, weight: w, opacity: 1, dashArray: on ? null : '8 6', className: 'rt-line' + (on ? ' best' : '') + (r.detour ? ' detour' : ''), interactive: false }).addTo(layer);
    r.segments.forEach(g => {
      const sc = g.peak >= 15 ? '#E23A1F' : '#F5841F';
      L.polyline(g.pts, { color: '#151515', weight: w + 7, opacity: .5, interactive: false, lineCap: 'butt' }).addTo(layer);
      L.polyline(g.pts, { color: sc, weight: w + 4, opacity: .95, lineCap: 'butt', className: 'rt-smoke' })
        .bindTooltip(`${name} · ${nf(g.toKm - g.fromKm, 1)} km · ${T('peak')} ${nf(g.peak, 1)} µg/m³`, { sticky: true }).on('click', e => { L.DomEvent.stopPropagation(e); pick(); }).addTo(layer);
      L.polyline(g.pts, { color: col, weight: Math.max(2, w - 3), opacity: 1, interactive: false, dashArray: on ? null : '8 6' }).addTo(layer);
    });
    (r.detour && r.route.via || []).forEach(v => L.marker([v.lat, v.lon], { icon: L.divIcon({ className: 'rt-via', iconSize: [18, 18], iconAnchor: [9, 9], html: '<i></i>' }), keyboard: false, title: T('routeD') }).bindTooltip(T('routeD')).addTo(layer));
  });
  // a label bubble on each route: the chosen one in the middle and filled, the others spread along their length so they do not sit on top of each other
  const others = res.routes.filter(r => r !== mine), frac = new Map([[mine, .5]]); others.forEach((r, i) => frac.set(r, [.3, .7, .85][i % 3]));
  res.routes.forEach(r => {
    const p = RT.labelPoint(r, frac.get(r) ?? .5), on = r === mine, txt = routeLabel(r), sm = r.status !== 'notAssessed' && r.kmInSmoke > 0;
    const ic = L.divIcon({ className: 'rt-rl-wrap', iconSize: null, iconAnchor: [0, 0], html: `<span class="rt-rl${on ? ' on' : ''}${sm ? ' smoke' : ''}" data-route="${r.name}">${txt.replace(/</g, '&lt;')}</span>` });
    L.marker(p, { icon: ic, keyboard: false, interactive: true }).on('click', e => { L.DomEvent.stopPropagation(e); chooseRoute(r.name); }).addTo(layer);
  });
  drawPins();
  S.fitted = L.latLngBounds(bounds); fitTo(S.fitted);
}
function mapClick(ll) {
  const p = { name: `${T('mapPoint')} ${ll.lat.toFixed(3)}, ${ll.lng.toFixed(3)}`, lat: +ll.lat.toFixed(5), lon: +ll.lng.toFixed(5) };
  if (!S.from || (S.from && S.to)) { S.from = p; S.to = null; $('rtFrom').value = p.name; $('rtTo').value = ''; toast(T('setFrom')); }
  else { S.to = p; $('rtTo').value = p.name; toast(T('setTo')); }
  clearMatches(); drawPins();
}
function renderLegend() {
  const ul = $('rtLegend'); ul.replaceChildren();
  [['route', T('legendRoute')], ['smoke', T('legendSmoke')], ['fire', T('legendFire')]].forEach(([k, txt]) => { const li = el('li'); li.append(el('span', 'rt-sw ' + k), el('span', null, txt)); ul.append(li); });
}

/* ---------- from / to ---------- */
function renderSearchLine() {
  const b = $('rtSearchLine'); if (!b) return; const has = !!(S.res && S.from && S.to);
  b.hidden = !has; if (has) { $('rtSearchLineTxt').textContent = `${S.from.name} → ${S.to.name}`; b.title = T('searchEdit'); }
}
function swapPoints() {
  const a = S.from, b = S.to; S.from = b; S.to = a; const fi = $('rtFrom'), ti = $('rtTo'), t = fi.value; fi.value = ti.value; ti.value = t; clearMatches(); drawPins();
}
function clearMatches() { $('rtFromList').replaceChildren(); $('rtToList').replaceChildren(); }
function setPoint(which, p) {
  S[which] = p; $(which === 'from' ? 'rtFrom' : 'rtTo').value = p.name; $(which === 'from' ? 'rtFromList' : 'rtToList').replaceChildren(); drawPins();
  if (map && S.from && !S.res) fitTo(L.latLngBounds([S.from, S.to].filter(Boolean).map(q => [q.lat, q.lon])).pad(1.5), { maxZoom: 9 });
}
function search(which) {
  const inp = $(which === 'from' ? 'rtFrom' : 'rtTo'), ul = $(which === 'from' ? 'rtFromList' : 'rtToList'), q = inp.value;
  S[which] = null; drawPins(); ul.replaceChildren();
  const hits = RD.searchPlaces((S.feed && S.feed.places) || [], q, 6);
  if (q.trim().length >= 2 && !hits.length) { ul.append(Object.assign(el('li', 'rt-nomatch', S.feed ? T('noMatch') : T('noPlaces')))); return; }
  hits.forEach(h => { const li = el('li'), b = el('button', 'rt-match'); b.type = 'button'; b.dataset.lat = h.lat; b.dataset.lon = h.lon; b.textContent = h.name; b.addEventListener('click', () => setPoint(which, { name: h.name, lat: h.lat, lon: h.lon })); li.append(b); ul.append(li); });
}
function locate() {
  if (!navigator.geolocation) { toast(T('locFail')); return; }
  navigator.geolocation.getCurrentPosition(pos => setPoint('from', { name: T('myLoc'), lat: +pos.coords.latitude.toFixed(5), lon: +pos.coords.longitude.toFixed(5) }), err => toast(err && err.code === 1 ? T('locDenied') : T('locFail')), { enableHighAccuracy: false, timeout: 15000, maximumAge: 300000 });
}

/* ---------- results ---------- */
function tags() {
  const w = el('div', 'rt-tags');
  [['tagFires', 'obs', 'tagObs'], ['tagRoad', 'map', 'tagMap'], ['tagWind', 'mod', 'tagMod'], ['tagSmoke', 'scn', 'tagScn']].forEach(([lab, cls, key]) => { const s = el('span', 'rt-tg'); s.append(el('i', null, T(lab)), el('span', 'dtag ' + cls, T(key))); w.append(s); });
  return w;
}
const chosenRoute = () => (S.res && S.chosen && S.res.routes.find(r => r.name === S.chosen)) || null;
function card(r) {
  const na = r.status === 'notAssessed', a = el('article', 'rt-route'); a.dataset.route = r.name; a.dataset.best = String(!!r.best); a.dataset.status = r.status; a.dataset.detour = String(!!r.detour); a.dataset.chosen = String(r.name === S.chosen);
  const pick = el('button', 'rt-pick'); pick.type = 'button'; pick.dataset.pick = r.name; pick.setAttribute('aria-pressed', String(r.name === S.chosen)); pick.disabled = S.busy || !!S.drive;
  const top = el('span', 'rt-route-head'); top.append(el('span', 'rt-rname', r.detour ? T('routeD') : T('route', r.name)));
  if (r.best) top.append(el('span', 'rt-besttag', T('bestTag')));
  const nums = el('span', 'rt-nums'); const nv = (k, v) => { const d = el('span', 'rt-n'); d.append(el('i', null, k), el('b', null, v)); nums.append(d); };
  nv(T('time'), fmtDur(r.route.duration)); nv(T('dist'), `${nf(r.route.distance / 1000, 1)} ${T('kmShort')}`);
  const chip = el('span', 'rt-chip ' + (na ? 'na' : r.kmInSmoke > 0 ? 'smoke' : 'clear'), na ? T('chipNA') : r.kmInSmoke > 0 ? T('chipSmoke', nf(r.kmInSmoke, 1)) : T('chipClear'));
  chip.dataset.km = na ? '' : String(Math.round(r.kmInSmoke * 10) / 10);
  const line = el('span', 'rt-r-line'); line.append(nums, chip); pick.append(top, line); a.append(pick);
  if (na) a.append(el('p', 'rt-note warn', T('notAssessedR')));
  else if (r.status === 'partial') a.append(el('p', 'rt-note warn', T('partialR', r.unassessed)));
  // the chosen row opens: peak, smoke-minutes, where the smoke starts, the notes
  const more = el('div', 'rt-more'); more.hidden = r.name !== S.chosen;
  const dl = el('dl', 'rt-dl'), row = (k, v, cls) => { const d = el('div', cls); d.append(el('dt', null, k), el('dd', null, v)); dl.append(d); };
  row(T('inSmoke'), na ? '?' : `${nf(r.kmInSmoke, 1)} ${T('kmShort')}`, 'smoke'); row(T('peak'), na ? '?' : `${nf(r.peak, 1)} µg/m³`); row(T('smokeMin'), na ? '?' : nf(r.smokeMin, 0));
  more.append(dl);
  if (r.detour && r.route.via && S.res.detour) more.append(el('p', 'rt-note', T('detourVia', nf(S.res.detour.viaKm, 0), S.res.detour.side)));
  if (!na) {
    if (r.start) more.append(el('p', 'rt-note smoke', T('starts', nf(r.start.km, 1), hhmm(r.start.ms))));
    else more.append(el('p', 'rt-note', r.status === 'nofires' ? T('noFires') : T('noSmokeOn')));
    if (r.fires) more.append(el('p', 'rt-muted', T('obsFires', r.fires)));
  }
  a.append(more); a.append(tags());
  pick.addEventListener('click', () => chooseRoute(r.name));
  return a;
}
function chooseRoute(name) {
  if (!S.res || S.chosen === name || S.drive) return;
  S.chosen = name; stopDrive(true); renderResult(); if (map) drawRoutes(S.res);
}
function renderResult() {
  const res = S.res, box = $('rtRoutes'); box.replaceChildren();
  $('rtBestBox').hidden = !res; $('rtHand').hidden = !res; $('rtStepsBox').hidden = !res; $('rtDriveBox').hidden = !res; $('rtLeaveBox').hidden = !(res && S.leave); $('rtRoutes').hidden = !res; $('routesH').hidden = !res;
  MAIN().dataset.result = res ? 'yes' : 'no'; renderSearchLine();
  if (!res) { $('rtBest').textContent = ''; $('rtDetour').hidden = true; return; }
  $('rtBest').textContent = RT.summary(res, S.lang);
  const ds = res.detourSearch, dn = $('rtDetour'); dn.hidden = true;
  if (ds && ds.status === 'none') { dn.hidden = false; dn.textContent = T('detourNone', ds.limitMin, ds.tried.length); }
  else if (ds && ds.status === 'unavailable') { dn.hidden = false; dn.textContent = T('detourFail'); }
  res.routes.forEach(r => box.append(card(r)));
  const best = chosenRoute(), g = $('rtGmaps');
  g.hidden = !best; if (best) g.href = RT.gmapsUrl(best.route);
  if (S.gj) URL.revokeObjectURL(S.gj);
  S.gj = URL.createObjectURL(new Blob([JSON.stringify(RT.geojson(res, { dataEnd: S.end }), null, 1)], { type: 'application/geo+json' }));
  const d = $('rtGeojson'); d.href = S.gj; d.download = `fireverse-smoke-route-${new Date(res.depMs).toISOString().slice(0, 16).replace(/[:T]/g, '-')}.geojson`;
  const miss = res.fires.noWind + res.fires.capped;
  warn2(miss ? 'someNoWind' : null, miss);
  if (res.windFailed && !res.routes.some(r => r.status !== 'notAssessed')) warn('windFail');
  else if (res.noFireData) warn('feedFail');
  renderSteps(); renderLeave(); renderDrive(); relayout();
}

/* ---------- directions ---------- */
function renderSteps() {
  const r = chosenRoute(), list = $('rtStepList'); list.replaceChildren();
  $('rtStepsBox').hidden = !r;
  if (!r) return;
  const name = r.detour ? T('routeD') : T('route', r.name), dirs = RT.directions(r, S.lang, { hhmm });
  $('rtChosen').textContent = T('chosenNote', name);
  $('rtStepsSum').textContent = dirs.length ? `${T('stepsFor', name)} · ${T('stepsCount', dirs.length)}` : T('stepsFor', name);
  if (!dirs.length) { list.append(Object.assign(el('li', 'rt-nostep', T('stepsNone')))); return; }
  dirs.forEach(s => {
    const li = el('li', 'rt-step'); li.dataset.step = s.n; if (s.warns.length) li.dataset.smoke = '1';
    const ic = el('span', 'rt-step-i'); ic.append(manIcon(s.icon)); const main = el('span', 'rt-step-t', s.text); li.append(ic, main);
    if (!s.inText && s.distKm > 0) li.append(el('span', 'rt-step-d', s.distText));
    s.warns.forEach(w => { const p = el('p', 'rt-swarn', w.text); li.append(p); });
    list.append(li);
  });
}

/* ---------- best time to leave ---------- */
function renderLeave() {
  const box = $('rtLeaveBox'), lk = S.leave;
  box.hidden = !(S.res && lk); if (!lk) return;
  $('rtLeave').textContent = RT.leaveSummary(lk.rk, S.lang, hhmm);
  const ul = $('rtLeaveList'); ul.replaceChildren();
  lk.options.forEach(o => {
    const li = el('li'); li.dataset.h = o.h; if (lk.rk.best && lk.rk.best.h === o.h && lk.rk.kind !== 'same') li.dataset.best = '1';
    li.append(el('b', null, `${o.h ? T('inH', o.h) : T('now')} · ${hhmm(o.depMs)}`), el('span', null, o.best ? `${nf(o.best.kmInSmoke, 1)} ${T('kmShort')} · ${nf(o.best.smokeMin, 0)} ${T('minShort')}` : '?'));
    ul.append(li);
  });
}
async function computeLeave(my) {
  const res = S.res, names = res.routes.map(r => r.name), rts = res.routes.map(r => r.route), options = [];
  for (const h of RT.RULES.leaveHours) {
    const depMs = S.baseMs + h * 36e5; let a = null;
    if (depMs === res.depMs) a = res;
    else if (!S.errFeed) { try { a = await RT.assess({ routes: rts, names, depMs, clusters: S.clusters, wind: S.wind, noFireData: S.errFeed, rules: { maxRoutes: rts.length } }); } catch (e) { a = null; } }
    if (my !== runId) return null;
    const b = a && a.best && a.routes.find(r => r.name === a.best);
    options.push({ h, depMs, best: b ? { name: b.name, kmInSmoke: b.kmInSmoke, smokeMin: b.smokeMin, peak: b.peak, status: b.status } : null });
  }
  return { options, rk: RT.leaveRanking(options) };
}

/* ---------- drive ---------- */
const SPEECH_LANG = { en: 'en-US', es: 'es-ES', pt: 'pt-BR' };
function renderMute() { const b = $('rtMute'); b.setAttribute('aria-pressed', String(S.muted)); $('muteTxt').textContent = S.muted ? T('unmute') : T('mute'); }
function speak(text) {
  if (S.muted) return;
  const ss = window.speechSynthesis;
  if (!ss || typeof window.SpeechSynthesisUtterance !== 'function') { S.driveMsg = ['noSpeech']; renderDrive(); return; }
  try { ss.cancel(); const u = new SpeechSynthesisUtterance(text); u.lang = SPEECH_LANG[S.lang] || 'en-US'; ss.speak(u); } catch (e) { /* speech is a courtesy: the text is on screen */ }
}
function driveMsg(k, ...a) { S.driveMsg = k ? [k, ...a] : null; renderDrive(); }
function renderDrive() {
  const d = S.drive, r = chosenRoute(), m = MAIN(), panel = $('rtDrivePanel'), bar = $('rtDriveBar');
  $('rtDriveBox').hidden = !S.res || !r;
  $('rtDrive').disabled = !!d || S.busy; $('rtSimulate').disabled = !!(d && d.mode === 'sim');
  m.dataset.driving = String(!!d);
  // the message line lives under the buttons when planning and in the banner while driving
  const msgEl = $('rtDriveMsg'), home = d ? panel : $('rtDriveBox'), before = d ? $('driveSafety') : null;
  if (msgEl.parentNode !== home) home.insertBefore(msgEl, before);
  const mg = S.driveMsg; msgEl.textContent = mg ? T(mg[0], ...mg.slice(1)) : '';
  panel.hidden = !d; bar.hidden = !d; $('driveSafety').textContent = T('driveSafety');
  if (!d) { renderRecenter(); return; }
  const sim = d.mode === 'sim', mode = $('rtDriveMode'); mode.replaceChildren();
  if (sim) mode.append(el('span', 'dtag scn rt-simtag', T('driveSimTag')), el('span', null, ' ' + T('driveSimNote', RT.nf(S.simSpeed, S.lang, 0)))); else mode.append(el('span', null, T('driveGps')));
  panel.dataset.mode = d.mode; panel.dataset.on = String(d.on);
  const L_ = d.last;
  if (L_) {
    const ns = d.ns;
    $('rtDriveNext').textContent = ns ? ns.step.text : L_.next; $('rtDriveDist').textContent = ns ? RT.fmtDist(ns.inKm, S.lang) : '';
    const ic = $('rtDriveIcon'); ic.replaceChildren(manIcon(ns ? ns.step.icon : L_.arrived ? 'arrive' : 'straight', 'rt-mi big'));
    $('rtDriveSmoke').textContent = L_.smoke; $('rtDriveProg').textContent = (sim ? T('driveSimTag') + ': ' : '') + L_.progress;
    panel.dataset.smoke = d.near ? 'near' : 'clear';
    $('rtDriveEta').textContent = d.eta ? hhmm(d.eta) : ''; $('rtDriveLeft').textContent = d.leftMin != null ? fmtDur(d.leftMin * 60) : ''; $('rtDriveKm').textContent = d.leftKm != null ? `${nf(d.leftKm, 1)} ${T('kmShort')}` : '';
  }
  $('rtDriveAlert').textContent = d.ev ? RT.alertText(d.ev, S.lang, sim) : '';
  renderRecenter();
}
function stopDrive(silent) {
  const d = S.drive; if (!d) return;
  d.on = false; clearInterval(d.timer); clearInterval(d.reassess); if (d.watch != null && navigator.geolocation) navigator.geolocation.clearWatch(d.watch);
  try { window.speechSynthesis && window.speechSynthesis.cancel(); } catch (e) { /* none */ }
  if (carLayer) carLayer.clearLayers();
  S.drive = null; S.follow = true; delete document.body.dataset.drive; delete MAIN().dataset.follow; S.driveMsg = silent ? null : ['driveStopped']; $('rtSimulate').hidden = true; renderDrive();
  relayout(); if (S.fitted) setTimeout(() => fitTo(S.fitted), 60);
}
function driveTick(km, nowMs, pos) {
  const d = S.drive; if (!d || !d.on) return;
  const st = RT.driveState(d.r, km, nowMs), sim = d.mode === 'sim';
  d.km = km; d.nowMs = nowMs; d.last = RT.driveLines(d.r, st, d.dirs, S.lang, { hhmm }); d.last.arrived = st.done; d.ns = RT.nextStep(d.dirs, km); d.pos = pos || d.pos;
  d.near = !!(st.inSmoke || (st.next && st.next.distKm <= RT.RULES.driveAhead[0])); d.leftKm = st.remainingKm; d.leftMin = st.remainingKm / st.kmh * 60; d.eta = nowMs + d.leftMin * 6e4;
  const evs = RT.driveAlerts(d.r, km, d.fired, { first: d.first }); d.first = false;
  evs.forEach(ev => { d.ev = ev; speak(RT.alertText(ev, S.lang, sim)); });
  if (carLayer && pos) {
    followTo(pos, d.firstFollow !== false && !d.followed); d.followed = true;
    carLayer.clearLayers();
    L.circleMarker(pos, { radius: 9, color: '#151515', weight: 3, fillColor: sim ? '#F9BD2B' : '#1D3FD8', fillOpacity: 1, className: 'rt-car' + (sim ? ' sim' : '') }).bindTooltip(sim ? T('driveSimTag') : T('driveGps'), { permanent: sim, direction: 'top' }).addTo(carLayer);
  }
  if (st.done) { d.on = false; clearInterval(d.timer); clearInterval(d.reassess); if (d.watch != null) navigator.geolocation.clearWatch(d.watch); S.driveMsg = [sim ? 'driveDoneSim' : 'driveDone']; if (sim) speak(T('simSay') + ' ' + T('driveDoneSim')); else speak(T('driveDone')); $('rtSimulate').hidden = true; }
  document.body.dataset.drive = d.on ? d.mode : 'done';
  renderDrive();
}
function newDrive(mode) {
  const r = chosenRoute(); if (!r) return null;
  stopDrive(true);
  S.follow = true; MAIN().dataset.follow = 'true';
  const d = S.drive = { on: true, mode, r, dirs: RT.directions(r, S.lang, { hhmm }), fired: new Set(), first: true, km: 0, last: null, ev: null, timer: 0, reassess: 0, watch: null };
  S.driveMsg = null; document.body.dataset.drive = mode; return d;
}
function startSim() {
  const d = newDrive('sim'); if (!d) return;
  const r = d.r, t0 = r.samples[0].ms, begun = performance.now(); $('rtSimulate').hidden = false;
  const step = () => { const el_ = (performance.now() - begun) / 1000 * S.simSpeed, km = Math.min(r.km, r.km * el_ / Math.max(1, r.route.duration)), p = RT.pointAlong(r.route, km); driveTick(km, t0 + el_ * 1000, p); };
  renderDrive(); step(); if (d.on) d.timer = setInterval(step, 250);
}
async function reassessDrive() {
  const d = S.drive; if (!d || !d.on || d.mode !== 'gps') return;
  const now = Date.now(), dep = now - d.km / d.r.km * d.r.route.duration * 1000, my = d;
  try {
    const a = await RT.assess({ routes: [d.r.route], names: [d.r.name], depMs: dep, clusters: S.clusters, wind: S.wind, noFireData: S.errFeed });
    if (S.drive !== my) return;
    const nr = a.routes[0]; d.fired = RT.remapFired(d.r.segments || [], nr.segments || [], d.fired); d.r = nr; d.dirs = RT.directions(nr, S.lang, { hhmm }); driveMsg('driveReassessed', hhmm(now));
  } catch (e) { /* keep the last assessment */ }
}
function startGps(r, pos) {
  const d = newDrive('gps'); if (!d) return;
  const onPos = p => {
    const pr = RT.project(d.r.route, p.coords.latitude, p.coords.longitude);
    if (pr.off > RT.RULES.gpsMaxOffKm) { S.driveMsg = ['driveOff', nf(pr.off, 1)]; renderDrive(); return; }
    if (S.driveMsg && S.driveMsg[0] === 'driveOff') S.driveMsg = null;
    driveTick(pr.km, Date.now(), [p.coords.latitude, p.coords.longitude]);
  };
  onPos(pos); if (!d.on) return;
  d.watch = navigator.geolocation.watchPosition(onPos, () => { S.driveMsg = ['driveNoGps']; $('rtSimulate').hidden = false; renderDrive(); }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 });
  d.reassess = setInterval(reassessDrive, RT.RULES.reassessMin * 6e4);
}
function offerSim(...m) { stopDrive(true); S.driveMsg = m; $('rtSimulate').hidden = false; renderDrive(); $('rtSimulate').focus({ preventScroll: true }); }
function startDrive() {
  const r = chosenRoute(); if (!r) return;
  stopDrive(true); driveMsg('driveLooking'); $('rtDrive').disabled = true;
  if (!navigator.geolocation) { offerSim('driveNoGps'); return; }
  navigator.geolocation.getCurrentPosition(pos => {
    const pr = RT.project(r.route, pos.coords.latitude, pos.coords.longitude);
    if (pr.off > RT.RULES.gpsMaxOffKm) offerSim('driveOff', nf(pr.off, 1)); else startGps(r, pos);
  }, () => offerSim('driveNoGps'), { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 });
}

/* ---------- actions ---------- */
function busy(on) { S.busy = on; $('rtGo').disabled = on; $('rtExample').disabled = on; $('rtDrive').disabled = on || !!(S.drive && S.drive.on); $('rtSheetBody').setAttribute('aria-busy', String(on)); document.querySelectorAll('.rt-pick').forEach(b => { b.disabled = on || !!(S.drive && S.drive.on); }); }
async function go() {
  if (!S.from || !S.to) { say('need'); return; }
  const my = ++runId; stopDrive(true); searchOpen(true); setSheet('peek'); busy(true); say('working'); warn(null); warn2(null); S.res = null; S.leave = null; S.chosen = null; S.driveMsg = null; renderResult(); if (map) { drawFires(); drawPins(); }
  S.baseMs = Date.now(); const dep = S.baseMs + S.depart * 36e5;
  let fr;
  try { fr = await RT.fetchRoutes(S.from, S.to, F.getJSON); } catch (e) { if (my !== runId) return; busy(false); say(); warn('routingFail'); return; }
  if (my !== runId) return;
  if (!fr.routes.length) { busy(false); say(); warn('noRoute'); return; }
  let res;
  try { res = await RT.assess({ routes: fr.routes, depMs: dep, clusters: S.clusters, wind: S.wind, noFireData: S.errFeed }); } catch (e) { if (my !== runId) return; busy(false); say(); warn('windFail'); return; }
  if (my !== runId) return;
  S.res = res; S.chosen = res.best; renderResult(); searchOpen(false); if (map) drawRoutes(res);
  // the best route still meets modelled smoke: look for a way round it (at most 6 more routing requests, none if the best is clean)
  const best = res.routes.find(r => r.name === res.best);
  if (best && best.peak >= RT.RULES.minConc) {
    say('detourSearching');
    try {
      const out = await RT.searchDetour({ res, clusters: S.clusters, wind: S.wind, depMs: dep, noFireData: S.errFeed, fetchVia: via => RT.fetchRoutes(S.from, S.to, F.getJSON, { via }).then(x => x.routes) });
      if (my !== runId) return;
      S.res = out.res; S.chosen = out.res.best;
    } catch (e) { if (my !== runId) return; res.detourSearch = { status: 'unavailable', tried: [], limitMin: 0 }; }
    renderResult(); if (map) drawRoutes(S.res);
  }
  say('leaveWorking');
  try { const lk = await computeLeave(my); if (my !== runId) return; S.leave = lk; } catch (e) { if (my !== runId) return; S.leave = null; }
  S.busy = false; busy(false); say(); renderResult();
  document.body.dataset.result = String(++S.picks);
}
async function example() {
  if (S.errFeed) { warn('feedFail'); return; }
  const my = ++runId; busy(true); warn(null); warn2(null); say('exWorking');
  try {
    if (!S.assets) S.assets = W.prepAssets(JSON.parse(new TextDecoder().decode(await gz(`app-data/assets/${S.region}.json.gz`))));
  } catch (e) { S.assets = null; if (my === runId) { busy(false); say(); warn('exFailAssets'); } return; }
  let wl;
  try { wl = await RD.watchList({ cfg: { kind: 'roads', hours: RT.RULES.hours, minFrp: RT.RULES.minFrp }, fires: S.fires, end: S.end, assets: S.assets, wind: S.wind }); } catch (e) { wl = null; }
  if (my !== runId) return;
  const ex = wl && RT.pickExample({ rows: wl.res.rows, places: (S.feed && S.feed.places) || [] });
  if (!ex) { busy(false); say(); warn(wl && wl.res.wxErr && !wl.res.rows.length ? 'windFail' : 'exNone'); return; }
  S.depart = 0; $('rtDepart').value = '0'; S.example = ex; setPoint('from', ex.from); setPoint('to', ex.to); busy(false);
  await go();
  if (S.res) { S.msg = ['exFound', ex.from.name, ex.to.name, ex.row.road]; renderMsgs(); }
}

/* ---------- region and language ---------- */
async function loadRegion(iso) {
  delete document.body.dataset.ready; delete document.body.dataset.result;
  const my = ++runId; S.region = iso; S.reg = RG.get(iso); PL.setRegion(S.reg); RG.remember(iso);
  try { const u = new URL(location.href); u.searchParams.set('r', iso); history.replaceState(null, '', u); } catch (e) { /* sandboxed URL */ }
  $('regionSel').value = iso; stopDrive(true); S.fitted = null; S.chosen = S.leave = null; S.from = S.to = S.res = S.assets = S.example = null; $('rtFrom').value = ''; $('rtTo').value = ''; clearMatches(); say(); warn(null); warn2(null);
  renderFrame(); renderResult(); if (map) { layer.clearLayers(); drawPins(); fitRegion(); }
  const d = await loadFeed(iso); if (my !== runId) return;
  S.feed = d.feed; S.fires = d.fires; S.errFeed = !d.feed; S.end = d.feed ? PL.dataEnd(d.feed) : 0;
  const c = d.feed ? RT.fireClusters(d.fires, S.end) : { clusters: [], small: 0 }; S.clusters = c.clusters; S.small = c.small;
  S.wind = W.createWind({ getJSON: F.getJSON, server: 'api/wind', storage: (() => { try { return sessionStorage; } catch (e) { return null; } })() });
  if (S.errFeed) warn('feedFail');
  renderClock(); if (map) drawFires(); document.body.dataset.ready = '1';
}
function setLang(l) {
  S.lang = l; store.set('fv.role.lang', l); renderFrame(); renderClock(); renderMsgs();
  const d = S.drive; if (d) { d.dirs = RT.directions(d.r, l, { hhmm }); d.last = RT.driveLines(d.r, RT.driveState(d.r, d.km, d.nowMs), d.dirs, l, { hhmm }); }
  renderResult(); if (map && S.res) drawRoutes(S.res);
}
async function init() {
  await RG.ready;
  $('regionSel').innerHTML = RG.codes().map(c => `<option value="${c}">${RG.name(c, 'en')}</option>`).join('');
  $('langBox').innerHTML = LANGS.map(l => `<button type="button" data-lang="${l}" aria-pressed="${l === S.lang}">${RG.LANG_NAME[l]}</button>`).join('');
  $('langBox').addEventListener('click', e => { const b = e.target.closest('[data-lang]'); if (b) setLang(b.dataset.lang); });
  $('regionSel').addEventListener('change', e => loadRegion(e.target.value));
  const themeBtn = $('themeToggle');
  themeBtn.addEventListener('click', () => { const light = document.body.classList.toggle('light'); themeBtn.setAttribute('aria-pressed', String(light)); });
  for (const w of ['from', 'to']) {
    const inp = $(w === 'from' ? 'rtFrom' : 'rtTo');
    inp.addEventListener('input', () => search(w));
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); const b = $(w === 'from' ? 'rtFromList' : 'rtToList').querySelector('button.rt-match'); if (b) b.click(); else if (S.from && S.to) go(); } });
  }
  $('rtFromLoc').addEventListener('click', locate);
  $('rtSwap').addEventListener('click', swapPoints);
  $('rtPanelToggle').addEventListener('click', () => setPanel(MAIN().dataset.panel === 'closed'));
  $('rtSearchLine').addEventListener('click', () => searchOpen(MAIN().dataset.search !== 'open'));
  initSheetDrag();
  const relay = () => { relayout(); if (S.res && !S.drive) setTimeout(() => fitTo(S.fitted), 80); };
  if (phoneMq.addEventListener) phoneMq.addEventListener('change', relay); window.addEventListener('resize', () => relayout());
  $('rtDepart').addEventListener('change', e => { S.depart = +e.target.value; });
  $('rtGo').addEventListener('click', go); $('rtExample').addEventListener('click', example);
  $('rtDrive').addEventListener('click', startDrive); $('rtSimulate').addEventListener('click', startSim); $('rtStop').addEventListener('click', () => stopDrive());
  $('rtMute').addEventListener('click', () => { S.muted = !S.muted; store.set('fv.route.mute', S.muted); if (S.muted) { try { window.speechSynthesis && window.speechSynthesis.cancel(); } catch (e) { /* none */ } } renderMute(); });
  S.region = RG.initial(location.search);
  initMap(); renderLegend();
  setInterval(renderClock, 60000);
  await loadRegion(S.region);
  if (map) { fitRegion(); setTimeout(() => map.invalidateSize(), 0); }
}
init();
window.__ROUTE = { S, go, example, setLang, loadRegion, startSim, stopDrive, setSheet };
})();
