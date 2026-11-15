/* role.html: one page, five simplified roles. Behaviour only. Who the roles are: roles.js. What each shows and says: role-config.js.
   Data logic: role-core.js, watch-core.js, bulletin-core.js, place.js (logic only). The shift briefing's rules: briefing-core.js.
   This file reads the light feed and the asset file (never the 10 MB record bundle), builds the cards and keeps the page state. */
(function () {
'use strict';
const R = window.ROLES, C = window.ROLECFG, W = window.WATCH, B = window.BULLETIN, RD = window.ROLEDATA, BR = window.BRIEFING, D = window.DOWNWIND, RG = window.REGIONS, PL = window.PLACE, F = window.FIRECORE, FAST = window.FAST;
const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search), roleId = params.get('role');
const role = R.get(roleId), cfg = C.get(roleId);
if (!role || !cfg) { // unknown or missing role: the picker; the analyst has the full workspace
  const u = roleId === 'analyst' ? 'index.html' : 'start.html', r = params.get('r');
  location.replace(r && /^[A-Za-z]{2,3}$/.test(r) ? u + '?r=' + r.toUpperCase() : u);
  return;
}
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
  raw: () => { try { return localStorage; } catch (e) { return null; } },
};
const nav = (navigator.language || '').slice(0, 2).toLowerCase();
const S = { role: roleId, lang: C.LANGS.includes(store.get('fv.role.lang')) ? store.get('fv.role.lang') : C.LANGS.includes(nav) ? nav : 'en', region: 'PY', reg: null,
  feed: null, fires: [], end: 0, P: null, wind: null, errFeed: false, errAssets: false, loading: true, list: null, fi: null, R: null, pick: null, brief: BR.empty(), day: '', cards: new Map(), fast: null, ids: [] };
let runId = 0, speaking = null;
const t = (k, ...a) => { const v = C.ui[S.lang][k]; return typeof v === 'function' ? v(...a) : v; };
const tx = o => o[S.lang] || o.en;
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const cw = d => RG.COMPASS[S.lang][d];
const nfmt = x => S.lang === 'en' ? B.sig(x) : B.sig(x).replace('.', ',');
const bctx = extra => ({ region: S.reg, assets: S.P, compass: RG.COMPASS, endMs: S.end, ...extra });
const toast = m => { const e = $('toast'); e.textContent = m; e.classList.add('show'); clearTimeout(toast._t); toast._t = setTimeout(() => e.classList.remove('show'), 3000); };

/* ---------- loading ---------- */
async function gz(url) {
  const r = await fetch(url); if (!r.ok) throw new Error(url + ' HTTP ' + r.status);
  const b = new Uint8Array(await r.arrayBuffer());
  return b[0] === 0x1f && b[1] === 0x8b ? new Uint8Array(await new Response(new Blob([b]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()) : b;
}
const needsAssets = cfg.engine !== 'place';
async function loadData(iso) {
  const [f, a] = await Promise.all([
    fetch(`app-data/feed/${iso}.json`).then(r => { if (!r.ok) throw new Error('feed HTTP ' + r.status); return r.json(); }).catch(() => null),
    needsAssets ? gz(`app-data/assets/${iso}.json.gz`).then(b => JSON.parse(new TextDecoder().decode(b))).then(W.prepAssets).catch(() => null) : Promise.resolve(null),
  ]);
  let fires = [];
  try { if (f) fires = PL.decodeFeed(f); } catch (e) { /* a broken feed is treated as no feed */ return { feed: null, P: a, fires: [] }; }
  return { feed: f, P: a, fires };
}

/* ---------- compute ---------- */
const pickKey = () => `fv.role.pick.${S.role}.${S.region}`;
async function compute(my) {
  S.list = S.fi = S.R = null;
  if (S.errFeed || (needsAssets && S.errAssets && cfg.engine === 'watch')) return;
  if (cfg.engine === 'watch') {
    const r = await RD.watchList({ cfg, fires: S.fires, end: S.end, assets: S.P, wind: S.wind });
    if (my === runId) S.list = r;
  } else if (cfg.engine === 'fires' && S.pick) {
    const r = await RD.fireItems({ cfg, base: S.pick, fires: S.fires, end: S.end, assets: S.P, wind: S.wind });
    if (my === runId) S.fi = r;
  } else if (S.pick) {
    const r = await RD.siteAnswer(S.pick, S.fires, S.end, F.getJSON);
    if (my === runId) S.R = r;
  }
}
function itemIds() {
  if (cfg.engine === 'watch') return S.list ? S.list.res.rows.map(r => r.key) : [];
  if (cfg.engine === 'fires') return S.fi ? S.fi.items.map(i => i.key) : [];
  return ['answer']; // one answer card; it cannot be reviewed until a place is chosen
}

/* ---------- briefing ---------- */
const locked = () => (cfg.engine === 'site' || cfg.engine === 'place') && !S.pick;
function act(a) {
  S.brief = BR.settle(BR.act(S.brief, S.day, a), S.day, S.ids);
  BR.save(store.raw(), S.role, S.region, S.brief);
  renderBrief();
}
function renderBrief() {
  S.ids = itemIds();
  S.brief = BR.settle(S.brief, S.day, S.ids);
  const st = BR.steps(S.brief, S.day, S.ids), pr = BR.progress(st);
  $('briefH').textContent = t('briefH'); $('briefSub').textContent = t('briefSub');
  $('ringFg').setAttribute('stroke-dashoffset', String(100 - Math.round(100 * pr.done / pr.total)));
  $('ringTxt').textContent = `${pr.done}/${pr.total}`;
  $('ring').setAttribute('aria-label', t('of', pr.done, pr.total));
  const ol = $('steps'); ol.replaceChildren();
  st.forEach((s, i) => {
    const li = el('li', 'rl-step'); li.dataset.done = String(s.done); li.dataset.step = s.id;
    const mark = el('span', 'rl-mark'); mark.setAttribute('aria-hidden', 'true');
    if (s.done) { const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('class', 'ico'); svg.innerHTML = '<use href="#i-check"/>'; mark.append(svg); } else mark.textContent = String(i + 1);
    const body = el('span', 'rl-step-body'); body.append(el('b', null, t('steps')[i]));
    let sub = s.done ? t('done') : t('todo');
    if (s.id === 'review' && !s.noItems) sub = t('reviewCount', s.count, s.need) + (s.done ? ' · ' + t('done') : '');
    body.append(el('small', null, sub)); li.append(mark, body); ol.append(li);
  });
  $('doneBox').hidden = !pr.complete; $('doneH').textContent = t('complete'); $('doneP').textContent = t('completeBody');
  $('briefCard').dataset.complete = String(pr.complete);
  $('weekL').textContent = t('week');
  const wk = $('week'); wk.replaceChildren();
  const wdf = new Intl.DateTimeFormat(S.lang === 'en' ? 'en-GB' : S.lang, { weekday: 'narrow', timeZone: 'UTC' });
  BR.strip(S.brief, S.day).forEach(d => {
    const li = el('li', 'rl-day'); li.dataset.complete = String(d.complete); if (d.today) li.dataset.today = '';
    li.setAttribute('aria-label', `${d.day}: ${d.complete ? t('weekDone') : t('weekNot')}`);
    li.append(el('span', 'rl-dow', wdf.format(Date.parse(d.day + 'T12:00:00Z'))), el('span', 'rl-dot'));
    wk.append(li);
  });
  const cb = $('clockBtn'), on = st[0].done;
  cb.disabled = on; cb.textContent = on ? t('clockChecked') : t('checkClock'); cb.dataset.done = String(on);
  document.querySelectorAll('[data-readnone]').forEach(b => { const d = st[1].done; b.disabled = d; b.textContent = d ? t('readDone') : t('readNone'); });
}

/* ---------- clock ---------- */
function renderClock() {
  const f = S.feed, now = Date.now(), old = $('oldWarn');
  $('clockH').textContent = t('clockH'); $('lastL').textContent = t('lastLook'); $('nextL').textContent = t('nextLook');
  $('tagObs').textContent = t('tagObs'); $('tagEst').textContent = t('tagEst'); $('delayNote').textContent = t('delay') + ' ' + t('nextNote');
  if (!f) { $('lastLook').textContent = t('unknown'); $('nextLook').textContent = t('unknown'); old.hidden = true; return; }
  const end = PL.dataEnd(f), h = (now - end) / 36e5, tz = PL.tzWord(S.lang);
  $('lastLook').textContent = `${PL.hhmm(end)} (${tz}), ${PL.dayOf(end, S.lang)} · ${PL.ago(end, now, S.lang)}`;
  old.hidden = !(h > PL.RULES.oldHours); old.textContent = t('old', PL.ago(end, now, S.lang));
  const nx = PL.nextLook(f, now);
  $('nextLook').textContent = nx ? `${PL.hhmm(nx.t)} (${tz}), ${PL.dayOf(nx.t, S.lang)} · ${nx.sat}` : t('unknown');
}

/* ---------- cards ---------- */
const TAGS = { obs: ['obs', 'tagObs'], map: ['map', 'tagMap'], mod: ['mod', 'tagMod'], scn: ['scn', 'tagScn'], fast: ['fast', 'tagFast'] };
const tag = k => { const s = el('span', 'dtag ' + TAGS[k][0], t(TAGS[k][1])); return s; };
const utc = ms => new Date(ms).toISOString().slice(11, 16);
/* spec: { id, title(lang), lines(lang)->[string], tags:[..], text(lang, fmt)->string, facts(lang)->[[label, value, tag]], hasShort, fmt, plain, count (record a review when flipped) } */
function cardState(id, spec) { let s = S.cards.get(id); if (!s) S.cards.set(id, s = { face: spec.plain ? 'back' : 'front', fmt: spec.fmt || 'full' }); return s; }
function buildCard(spec) {
  const st = cardState(spec.id, spec), li = el('li', 'rcard'); li.dataset.id = spec.id; li.dataset.face = st.face;
  if (spec.plain) li.dataset.plain = '';
  if (spec.tone) li.dataset.tone = spec.tone;
  const inner = el('div', 'rc-inner'), front = el('div', 'rc-face rc-front'), back = el('div', 'rc-face rc-back');
  if (!spec.plain) {
    const flip = el('button', 'rc-flip'); flip.type = 'button'; flip.dataset.flip = spec.id;
    const hd = el('span', 'rc-title', spec.title(S.lang)); hd.dataset.k = 'title';
    flip.append(hd);
    const lines = el('span', 'rc-lines'); lines.dataset.k = 'lines'; spec.lines(S.lang).forEach(l => lines.append(el('span', 'rc-line', l))); flip.append(lines);
    const tg = el('span', 'rc-tags'); spec.tags.forEach(k => tg.append(tag(k))); flip.append(tg);
    flip.append(el('span', 'rc-hint', spec.hint ? spec.hint(S.lang) : t('tap')));
    front.append(flip);
  }
  const top = el('div', 'rc-back-top');
  const bt = el('b', 'rc-title', spec.title(S.lang)); bt.dataset.k = 'btitle'; top.append(bt);
  if (!spec.plain) { const bb = el('button', 'ghost-btn rc-backbtn', t('back')); bb.type = 'button'; bb.dataset.back = spec.id; top.append(bb); }
  back.append(top);
  if (spec.hasShort) {
    const seg = el('div', 'rc-seg'); seg.setAttribute('role', 'group');
    for (const f of ['full', 'short']) { const b = el('button', 'rc-segbtn', t(f)); b.type = 'button'; b.dataset.fmt = f; b.setAttribute('aria-pressed', String(st.fmt === f)); seg.append(b); }
    back.append(seg);
  }
  const txt = el('p', 'rc-text'); txt.dataset.k = 'text'; txt.lang = S.lang; back.append(txt);
  const cnt = el('p', 'rc-count rl-muted'); cnt.dataset.k = 'count'; back.append(cnt);
  const acts = el('div', 'rc-acts');
  const cp = el('button', 'primary-btn', t('copy')); cp.type = 'button'; cp.dataset.act = 'copy';
  const sp = el('button', 'ghost-btn', t('speak')); sp.type = 'button'; sp.dataset.act = 'speak'; sp.setAttribute('aria-pressed', 'false');
  const wa = el('a', 'ghost-btn', t('wa')); wa.dataset.act = 'wa'; wa.target = '_blank'; wa.rel = 'noopener';
  acts.append(cp, sp, wa); back.append(acts);
  if (spec.facts) { const dl = el('dl', 'rc-facts'); dl.dataset.k = 'facts'; back.append(dl); }
  inner.append(front, back); li.append(inner);
  li._spec = spec; paintCard(li);
  return li;
}
/* fill the language- and format-dependent parts of a card */
function paintCard(li) {
  const spec = li._spec, st = cardState(spec.id, spec), q = k => li.querySelector(`[data-k="${k}"]`);
  const txt = spec.text(S.lang, st.fmt);
  q('text').textContent = txt; q('text').lang = S.lang;
  const cnt = q('count'); cnt.hidden = !(spec.hasShort && st.fmt === 'short'); cnt.textContent = t('chars', txt.length, B.SHORT_MAX);
  li.querySelectorAll('[data-fmt]').forEach(b => { b.setAttribute('aria-pressed', String(b.dataset.fmt === st.fmt)); b.textContent = t(b.dataset.fmt); });
  const wa = li.querySelector('[data-act=wa]'); wa.href = 'https://wa.me/?text=' + encodeURIComponent(txt + (spec.waLink ? ' ' + spec.waLink() : ''));
  const fa = q('facts'); if (fa) { fa.replaceChildren(); spec.facts(S.lang).forEach(([k, v, g]) => { const d = el('div'), dt = el('dt', null, k + ' '), dd = el('dd', null, v); dt.append(tag(g)); d.append(dt, dd); fa.append(d); }); }
  const front = li.querySelector('.rc-front'), back = li.querySelector('.rc-back'), face = li.dataset.face;
  front.inert = face === 'back' && !li.hasAttribute('data-plain'); back.inert = face === 'front';
  front.setAttribute('aria-hidden', String(front.inert)); back.setAttribute('aria-hidden', String(back.inert));
}
function flip(li, to) {
  const spec = li._spec, st = cardState(spec.id, spec); if (st.face === to) return;
  st.face = to; li.dataset.face = to; li.classList.add('flipping'); clearTimeout(li._t); li._t = setTimeout(() => li.classList.remove('flipping'), 800);
  paintCard(li);
  if (to === 'back') { if (spec.count) act({ type: 'review', id: spec.id }); const b = li.querySelector('[data-back]'); if (b) b.focus({ preventScroll: true }); }
  else { stopSpeak(); const f = li.querySelector('.rc-flip'); if (f) f.focus({ preventScroll: true }); }
}
function stopSpeak() { if ('speechSynthesis' in window) speechSynthesis.cancel(); document.querySelectorAll('[data-act=speak]').forEach(b => { b.setAttribute('aria-pressed', 'false'); b.textContent = t('speak'); }); speaking = null; }
document.addEventListener('click', async e => {
  const li = e.target.closest('.rcard'); if (!li) return;
  const spec = li._spec, st = cardState(spec.id, spec);
  if (e.target.closest('[data-flip]')) return flip(li, 'back');
  if (e.target.closest('[data-back]')) return flip(li, 'front');
  const f = e.target.closest('[data-fmt]'); if (f) { st.fmt = f.dataset.fmt; return paintCard(li); }
  const a = e.target.closest('[data-act]'); if (!a) return;
  const txt = spec.text(S.lang, st.fmt);
  if (a.dataset.act === 'copy') { try { await navigator.clipboard.writeText(txt); toast(t('copied')); if (spec.send !== false) act({ type: 'send' }); } catch (err) { toast(t('copyFail')); } }
  else if (a.dataset.act === 'wa') { if (spec.send !== false) act({ type: 'send' }); }
  else if (a.dataset.act === 'speak') {
    if (speaking === spec.id) return stopSpeak();
    if (!('speechSynthesis' in window)) return toast(t('copyFail'));
    stopSpeak(); const u = new SpeechSynthesisUtterance(txt); u.lang = { es: 'es-ES', pt: 'pt-BR', en: 'en-GB' }[S.lang]; u.rate = .95; u.onend = stopSpeak;
    speaking = spec.id; a.setAttribute('aria-pressed', 'true'); a.textContent = t('stop'); speechSynthesis.speak(u);
  }
});
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return; const li = e.target.closest && e.target.closest('.rcard[data-face=back]:not([data-plain])'); if (li) { e.preventDefault(); flip(li, 'front'); }
});

/* ---------- card specs per engine ---------- */
const spotName = r => r.kind === 'power' ? '' : r.kind === 'roads' ? (r.asset.ref ? (S.lang === 'es' ? 'Ruta ' : S.lang === 'pt' ? 'Rodovia ' : 'Route ') + r.asset.ref : r.asset.name || '') : r.asset.name || '';
function watchSpec(r, i, fast) {
  const id = (fast ? 'f:' : '') + r.key;
    return { id, count: !fast, send: true, hasShort: true, fmt: cfg.fmt, tags: fast ? ['fast', 'map', 'mod'] : ['obs', 'map', 'mod', 'scn'],
    title: l => B.assetName(r, l),
    lines: l => {
      const eta = r.eta == null ? null : Math.max(5, Math.round(r.eta / 5) * 5), out = [];
      out.push(fast ? `${r.scans === 1 ? '' : ''}${C.ui[l].fastScans(r.scans)} · ${nfmt(r.km)} km ${RG.COMPASS[l][D.compass(r.bearing + 180)]}` : `${C.ui[l].fire} · ${nfmt(r.nearestKm ?? r.km)} km ${RG.COMPASS[l][D.compass(r.bearing + 180)]}${r.fire.frp != null ? ' · ' + nfmt(r.fire.frp) + ' MW' : ''}`);
      if (eta) out.push(C.ui[l].eta(eta));
      if (r.wx && r.wx.ws < W.RULES.lightWind) out.push(C.ui[l].light);
      return out;
    },
    text: (l, fmt) => B.bulletinText(r, l, fmt, bctx()),
    facts: l => {
      const u = C.ui[l], f = [];
      if (fast) f.push([u.fire, `GOES-19 · ${u.fastScans(r.scans)} · ${utc(r.px.firstMs)}–${utc(r.px.lastMs)} UTC`, 'fast']);
      else f.push([u.fire, `${r.fire.sat} · ${utc(r.fire.ms)} UTC · ${nfmt(r.fire.frp)} MW${r.passes && r.passes.size > 1 ? ' · ' + u.passes(r.passes.size) : ''}${r.others ? ' · ' + u.others(r.others) : ''}`, 'obs']);
      f.push([u.asset, 'OpenStreetMap ' + (r.kind === 'power' || r.kind === 'roads' ? 'way ' + r.asset.id : r.asset.id), 'map']);
      if (r.wx) f.push([u.wind, `${u.fromTo(RG.COMPASS[l][D.compass(r.wx.wd)], nfmt(r.wx.ws))} · ${r.wx.hour.slice(11, 16)} UTC`, 'mod']);
      if (!fast && r.peak != null) f.push([u.smoke, `${nfmt(r.peak)} µg/m³ PM2.5 (${l === 'en' ? 'scenario, not a measurement' : l === 'es' ? 'escenario, no una medición' : 'cenário, não uma medição'})`, 'scn']);
      return f;
    }};
}
function fireSpec(it) {
  const mk = lang => ({ fire: it.fire, km: it.km, brg: it.brg, wx: it.wx, heading: it.heading, assets: it.rows.map(r => ({ kind: r.kind, name: spotName(r) })) });
  const c = () => bctx({ baseName: S.pick.name });
  return { id: it.key, count: true, send: true, hasShort: true, fmt: 'full', tags: ['obs', 'mod', 'map'],
    title: l => C.ui[l].ofBase(nfmt(it.km), RG.COMPASS[l][D.compass(it.brg)]),
    lines: l => {
      const u = C.ui[l], out = [`${u.fire} · ${nfmt(it.fire.frp)} MW · ${it.fire.sat} ${utc(it.fire.ms)} UTC`];
      out.push(it.wx ? C.roles.firefighter.text.heading(RG.COMPASS[l][it.heading], RG.COMPASS[l][D.compass(it.wx.wd)], nfmt(it.wx.ws))[l] : C.roles.firefighter.text.noWind[l]);
      out.push(it.assessed ? (it.rows.length ? C.roles.firefighter.text.inPath(it.rows.length)[l] : C.roles.firefighter.text.nothingInPath[l]) : '');
      return out.filter(Boolean);
    },
    text: (l, fmt) => fmt === 'short' ? B.shortFire(mk(l), l, c()) : B.fireBulletin(mk(l), l, c()),
    facts: l => {
      const u = C.ui[l], f = [[u.fire, `${it.fire.sat} · ${utc(it.fire.ms)} UTC · ${nfmt(it.fire.frp)} MW`, 'obs']];
      if (it.wx) f.push([u.wind, `${u.fromTo(RG.COMPASS[l][D.compass(it.wx.wd)], nfmt(it.wx.ws))} · ${it.wx.hour.slice(11, 16)} UTC`, 'mod']);
      it.rows.slice(0, 6).forEach(r => f.push([u.asset, B.assetName(r, l), 'map']));
      return f;
    } };
}
function answerSpec() {
  const R_ = S.R, p = R_.place, link = () => { const u = new URL('place.html', location.href); u.search = ''; return u.href + `?r=${S.region}&lat=${p.lat.toFixed(2)}&lon=${p.lon.toFixed(2)}` + (p.name ? '&name=' + encodeURIComponent(p.name) : ''); };
  return { id: 'answer', count: true, send: true, hasShort: false, fmt: 'full', tags: R_.items.length ? ['obs', 'mod', 'scn'] : ['obs'], tone: R_.status,
    title: l => { const s = PL.sentence(R_, l); return s.head; },
    lines: l => { const s = PL.sentence(R_, l); return [s.body]; },
    hint: () => t('answerHint'),
    text: l => PL.sentence(R_, l).full, waLink: link,
    facts: l => {
      const u = C.ui[l], it = R_.items.find(i => i.id === R_.focus), f = [];
      if (it) { f.push([u.fire, `${it.sat} · ${PL.hhmm(it.ms)} · ${PL.num(it.km, l)} km ${PL.dirOf(it.brg, l)} · ${PL.num(it.frp, l)} MW`, 'obs']); if (it.ws != null) f.push([u.wind, `${u.fromTo(PL.dirOf(it.wd, l), PL.num(it.ws, l))} · ${it.hour.slice(11, 16)} UTC`, 'mod']); if (it.conc != null) f.push([u.smoke, `${PL.num(it.conc, l)} µg/m³ PM2.5`, 'scn']); }
      return f;
    } };
}
function statusSpec(kind) { // the copyable line on a day with nothing to list (or nothing assessed)
  const sub = cfg.subject, c = () => bctx();
  return { id: 'status:' + kind, plain: true, send: true, hasShort: true, fmt: cfg.fmt === 'short' ? 'short' : 'full', tags: [], title: () => t('statusH'),
    lines: () => [], text: (l, fmt) => kind === 'clear' ? (fmt === 'short' ? B.shortAllClear(cfg.shortKind, l) : B.allClear(sub, l, c())) : (fmt === 'short' ? B.shortNotAssessed(l) : B.notAssessed(cfg.target, l)) };
}

/* ---------- the work panel ---------- */
/* the headline numbers, large: each is a count from the data on this page, with its data label */
function stats(list) { const d = el('div', 'rl-stats'); for (const [n, label, k] of list) { const c = el('div', 'rl-stat'); c.append(el('b', null, Number(n).toLocaleString(S.lang === 'en' ? 'en-US' : S.lang === 'pt' ? 'pt-BR' : 'es')), el('span', null, label), tag(k)); d.append(c); } return d; }
function msg(cls, text) { const p = el('p', 'rl-note ' + cls, text); return p; }
function readBtn() { const b = el('button', 'ghost-btn', t('readNone')); b.type = 'button'; b.dataset.readnone = ''; b.addEventListener('click', () => act({ type: 'read' })); return b; }
function cardList(specs) { const ul = el('ul', 'rl-cards'); specs.forEach(s => ul.append(buildCard(s))); return ul; }
const kindName = k => tx(cfg.kindWord || { en: '', es: '', pt: '' });
function picker(box) {
  const wrap = el('div', 'rl-pick'), tt = cfg.text;
  const cur = S.pick;
  const labelKey = cfg.engine === 'fires' ? 'baseSet' : cfg.engine === 'site' ? 'siteSet' : 'placeSet';
  if (cur) {
    const row = el('div', 'rl-picked');
    row.append(el('span', 'rl-picked-k', t(labelKey)), el('b', null, (cur.name || '') + (cur.name ? ' · ' : '') + cur.lat.toFixed(2) + ', ' + cur.lon.toFixed(2)));
    const ch = el('button', 'ghost-btn', t('change')); ch.type = 'button'; ch.dataset.change = ''; ch.addEventListener('click', () => { S.pick = null; store.set(pickKey(), null); S.fi = S.R = null; renderWork(); renderBrief(); const i = $('pickQ'); if (i) i.focus(); });
    row.append(ch); wrap.append(row); box.append(wrap); return;
  }
  const p = el('p', 'rl-muted', tx(cfg.engine === 'fires' ? tt.basePick : tt.pick)); wrap.append(p);
  const form = el('div', 'rl-search'), lab = el('label', 'vh', t('search')); lab.htmlFor = 'pickQ';
  const inp = el('input'); inp.id = 'pickQ'; inp.type = 'search'; inp.autocomplete = 'off'; inp.placeholder = t('search'); inp.setAttribute('aria-controls', 'pickList');
  form.append(lab, inp);
  if (cfg.geo !== false && (cfg.engine === 'fires' || cfg.geo)) { const g = el('button', 'ghost-btn', t('useLoc')); g.type = 'button'; g.dataset.geo = ''; g.prepend(svgUse('i-pin')); form.append(g);
    g.addEventListener('click', () => {
      const m = $('pickMsg'); if (!navigator.geolocation) { m.textContent = t('locFail'); return; }
      m.textContent = t('locating');
      navigator.geolocation.getCurrentPosition(pos => choose({ name: '', lat: pos.coords.latitude, lon: pos.coords.longitude }), err => { m.textContent = err.code === 1 ? t('locDenied') : t('locFail'); }, { timeout: 15000, maximumAge: 600000 });
    }); }
  const ul = el('ul', 'rl-matches'); ul.id = 'pickList'; ul.setAttribute('aria-label', t('search'));
  const msgp = el('p', 'rl-muted'); msgp.id = 'pickMsg'; msgp.setAttribute('role', 'status');
  inp.addEventListener('input', () => {
    ul.replaceChildren(); msgp.textContent = '';
    const hits = cfg.engine === 'site' ? RD.searchSites(S.P, S.feed, inp.value) : RD.searchPlaces((S.feed && S.feed.places) || [], inp.value);
    if (!hits.length && RD.norm(inp.value).trim().length >= 2) { msgp.textContent = t('noMatch'); return; }
    hits.forEach(h => { const li = el('li'), b = el('button', 'rl-match', h.name); b.type = 'button'; if (h.kind !== 'place') b.append(el('small', null, ' · ' + (h.kind === 'health' ? 'clinic/hospital' : 'school'))); b.addEventListener('click', () => choose(h)); li.append(b); ul.append(li); });
  });
  wrap.append(form, ul, msgp); box.append(wrap);
}
function svgUse(id) { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('class', 'ico'); s.innerHTML = `<use href="#${id}"/>`; return s; }
async function choose(h) {
  S.pick = { name: String(h.name || '').replace(/[\u0000-\u001f<>]/g, '').slice(0, 60), lat: Math.round(+h.lat * 100) / 100, lon: Math.round(+h.lon * 100) / 100 };
  store.set(pickKey(), S.pick);
  const my = ++runId; S.cards.clear(); renderWork(true); renderBrief();
  await compute(my); if (my !== runId) return;
  renderWork(); renderBrief(); const f = document.querySelector('#work .rc-flip'); if (f) f.focus({ preventScroll: true });
}
function renderWork(busy) {
  const box = $('work'), tt = cfg.text; box.replaceChildren();
  $('workH').textContent = tx(tt.listH); document.querySelector('.rl-work').setAttribute('aria-busy', String(!!(busy || S.loading)));
  if (S.loading || busy) { box.append(msg('rl-loading', t('loading'))); if (cfg.engine !== 'watch' && !S.loading) picker(box); return; }
  if (cfg.engine === 'fires' || cfg.engine === 'site' || cfg.engine === 'place') { if (S.errFeed) { /* feed missing: pickers have no places */ } picker(box); }
  if (S.errFeed) { box.append(msg('rl-warn', t('loadFeed'))); box.append(statusSpecBlock('notAssessed')); return; }
  if (cfg.engine === 'watch') return renderWatch(box);
  if (cfg.engine === 'fires') return renderFires(box);
  if (S.R) { box.append(cardList([answerSpec()])); }
  else box.append(msg('rl-muted', tx(tt.none)));
}
function statusSpecBlock(kind) {
  const wrap = el('div', 'rl-status'); wrap.append(readBtn(), cardList([statusSpec(kind)])); return wrap;
}
function renderWatch(box) {
  const kw = kindName(); 
  if (S.errAssets) { box.append(msg('rl-warn', t('loadAssets', kw)), statusSpecBlock('notAssessed')); return; }
  if (!W.kindBuilt(S.P, cfg.kind)) { box.append(msg('rl-warn', t('notBuilt', kw)), statusSpecBlock('notAssessed')); return; }
  const L = S.list; if (!L) return;
  const res = L.res;
  if (res.noAssets) { box.append(msg('rl-warn', t('notBuilt', kw)), statusSpecBlock('notAssessed')); return; }
  box.append(stats([[res.rows.length, t('statHit', kw), 'scn'], [res.fires, t('statFires', L.rules.minFrp, cfg.hours), 'obs']]));
  box.append(msg('rl-scope', t('scope', res.rows.length, kw, res.fires, L.rules.minFrp, cfg.hours)));
  if (res.wxErr || res.noWind) box.append(msg('rl-warn', t('windOff')));
  if (res.skipped) box.append(msg('rl-warn', t('capped', res.skipped)));
  if (res.rows.length) { box.append(el('p', 'rl-muted', t('flipHint'))); box.append(cardList(res.rows.map((r, i) => watchSpec(r, i, false)))); }
  else {
    box.append(msg('rl-statement', tx(cfg.text.none)));
    box.append(statusSpecBlock(RD.statusKind(res, false)));
  }
  if (res.near.length) box.append(msg('rl-muted', t('nearNote', res.near.length)));
}
function renderFires(box) {
  const tt = cfg.text;
  if (!S.pick) return;
  if (S.errAssets) box.append(msg('rl-warn', t('loadAssets', 'power lines, roads, clinics, schools')));
  const FI = S.fi; if (!FI) return;
  box.append(stats([[FI.total, t('statNear', cfg.radiusKm, cfg.hours), 'obs']]));
  box.append(msg('rl-scope', t('fireScope', FI.total, cfg.radiusKm, cfg.hours)));
  if (FI.anyUnassessed || FI.failed) box.append(msg('rl-warn', t('windOff')));
  FI.notBuilt.forEach(k => { if (!S.errAssets) box.append(msg('rl-warn', t('notBuilt', k === 'power' ? 'power lines' : k === 'roads' ? 'main roads' : k === 'health' ? 'clinics and hospitals' : 'schools'))); });
  if (FI.items.length) { box.append(el('p', 'rl-muted', t('flipHint'))); box.append(cardList(FI.items.map(fireSpec))); if (FI.hidden) box.append(msg('rl-muted', tx(tt.more(FI.hidden)))); }
  else { box.append(msg('rl-statement', tx(tt.none))); box.append(statusSpecBlock(RD.statusKind({ noAssets: false, wxErr: FI.failed ? 1 : 0 }, false))); }
}

/* ---------- fast look (grid) ---------- */
async function loadFast() {
  const body = $('fastBody'); if (S.fast && S.fast.region === S.region) return;
  body.replaceChildren(msg('rl-muted', t('loading'))); const my = runId;
  const v = S.reg.view, now = Date.now();
  let r = null;
  try { r = await FAST.load({ bbox: [v[0][1], v[0][0], v[1][1], v[1][0]], hours: W.FAST_HOURS, now }); } catch (e) { r = null; }
  if (my !== runId) return;
  const fd = { ...(r || {}), pixels: r ? FAST.pixels(r.detections) : [], unreachable: !r || (r.files.loaded === 0 && r.files.failed > 0) };
  const res = await W.computeFast({ kind: cfg.kind, assets: S.P, rules: W.rules(), wind: S.wind, now, fd });
  if (my !== runId) return;
  S.fast = { region: S.region, res }; renderFast();
}
function renderFast() {
  const body = $('fastBody'); body.replaceChildren(); if (!S.fast) return;
  const res = S.fast.res; body.append(msg('rl-muted', t('fastSub')));
  if (res.fastErr) { body.append(msg('rl-warn', t('fastErr'))); return; }
  if (res.noAssets) { body.append(msg('rl-warn', t('notBuilt', kindName()))); return; }
  if (res.wxErr || res.noWind) body.append(msg('rl-warn', t('windOff')));
  if (!res.rows.length) { body.append(msg('rl-statement', t('fastNone'))); return; }
  body.append(cardList(res.rows.slice(0, 12).map((r, i) => watchSpec(r, i, true))));
}

/* ---------- page frame ---------- */
function renderFrame() {
  document.documentElement.lang = S.lang;
  const name = cfg.title[S.lang];
  $('rTitle').textContent = name; $('rQuestion').textContent = cfg.q[S.lang];
  $('rMode').textContent = `${S.reg ? S.reg.name[S.lang] : ''} · ${role.mode === 'full' ? '' : { en: 'Simplified view', es: 'Vista simplificada', pt: 'Visão simplificada' }[S.lang]}`;
  document.title = `${name} · FIREVERSE`;
  $('switchTxt').textContent = t('switchRole'); $('lblRegion').textContent = t('region'); $('langBox').setAttribute('aria-label', t('lang'));
  $('themeToggle').title = t('theme'); $('themeToggle').setAttribute('aria-label', t('theme'));
  $('limits').textContent = t('limits'); $('esNote').textContent = S.lang === 'en' ? '' : t('esNote'); $('esNote').hidden = S.lang === 'en';
  const fl = $('fullLink'); fl.textContent = t('fullPage'); fl.href = 'downwind.html?r=' + S.region;
  $('switchRole').href = 'start.html';
  [...$('regionSel').options].forEach(o => { o.textContent = RG.name(o.value, S.lang); });
  $('langBox').querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.lang === S.lang)));
  const fb = $('fastBox'); fb.hidden = !cfg.fast; $('fastSum').textContent = t('fastH');
}
async function loadRegion(iso) {
  delete document.body.dataset.ready;
  const my = ++runId; S.region = iso; S.reg = RG.get(iso); PL.setRegion(S.reg); RG.remember(iso);
  try { const u = new URL(location.href); u.searchParams.set('r', iso); u.searchParams.set('role', S.role); history.replaceState(null, '', u); } catch (e) { /* sandboxed URL */ }
  $('regionSel').value = iso;
  S.loading = true; S.cards.clear(); S.fast = null; S.list = S.fi = S.R = null; stopSpeak();
  if ($('fastBox')) { $('fastBox').open = false; $('fastBody').replaceChildren(); }
  S.pick = store.get(pickKey()); if (S.pick && !RG.inside(iso, S.pick.lat, S.pick.lon)) S.pick = null;
  S.day = BR.dayKey(Date.now(), S.reg.tz); S.brief = BR.load(store.raw(), S.role, iso);
  renderFrame(); renderClock(); renderBrief(); renderWork();
  const d = await loadData(iso); if (my !== runId) return;
  S.feed = d.feed; S.fires = d.fires; S.P = d.P; S.errFeed = !d.feed; S.errAssets = needsAssets && !d.P; S.end = d.feed ? PL.dataEnd(d.feed) : 0;
  S.wind = W.createWind({ getJSON: F.getJSON, server: 'api/wind', storage: (() => { try { return sessionStorage; } catch (e) { return null; } })() });
  renderClock();
  await compute(my); if (my !== runId) return;
  S.loading = false; renderWork(); renderBrief(); document.body.dataset.ready = '1';
  document.dispatchEvent(new CustomEvent('role:ready'));
}
function setLang(l) { S.lang = l; store.set('fv.role.lang', l); stopSpeak(); renderFrame(); renderClock(); renderBrief(); renderWork(); if (S.fast) renderFast(); }
async function init() {
  R.save(S.role);
  await RG.ready;
  $('regionSel').innerHTML = RG.codes().map(c => `<option value="${c}">${RG.name(c, 'en')}</option>`).join('');
  $('langBox').innerHTML = C.LANGS.map(l => `<button type="button" data-lang="${l}" aria-pressed="${l === S.lang}">${RG.LANG_NAME[l]}</button>`).join('');
  $('langBox').addEventListener('click', e => { const b = e.target.closest('[data-lang]'); if (b) setLang(b.dataset.lang); });
  $('regionSel').addEventListener('change', e => loadRegion(e.target.value));
  $('clockBtn').addEventListener('click', () => act({ type: 'clock' }));
  $('fastBox').addEventListener('toggle', () => { if ($('fastBox').open) loadFast(); });
  const themeBtn = $('themeToggle');
  themeBtn.addEventListener('click', () => { const light = document.body.classList.toggle('light'); themeBtn.setAttribute('aria-pressed', String(light)); });
  S.region = RG.initial(location.search);
  setInterval(renderClock, 60000);
  await loadRegion(S.region);
}
init();
window.__ROLE = { S, setLang, loadRegion, act };
})();
