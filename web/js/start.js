/* FIREVERSE role selection: behaviour only. Role data comes from roles.js, every visible label from start.html
   (data-* attributes on #deck), every look from css/start.css. This file builds the deck, keeps one state on the
   container, measures where the cards belong, and navigates. */
(function () {
'use strict';
const R = window.ROLES;
const $ = id => document.getElementById(id);
const deck = $('deck'), slots = $('slots'), stage = $('stage'), live = $('live'), select = $('roleSelect');
const dealBtn = $('dealBtn'), gatherBtn = $('gatherBtn'), continueLink = $('continueLink'), form = $('altForm');
if (!R || !deck || !slots) return;   // the <noscript> list in the page remains the way in

const reduceMq = window.matchMedia ? matchMedia('(prefers-reduced-motion: reduce)') : { matches: false };
const label = k => deck.dataset['label' + k] || '';
const msg = k => deck.dataset['msg' + k] || '';
const regionMatch = /^[A-Za-z]{2,3}$/.exec(new URLSearchParams(location.search).get('r') || '');
const opts = regionMatch ? { region: regionMatch[0].toUpperCase() } : undefined;
const hrefOf = id => R.hrefFor(id, opts);

/* ---------- timings: the CSS owns them (custom properties on #deck), JS only waits for them ---------- */
function ms(name, fallback) {
  const v = parseFloat(getComputedStyle(deck).getPropertyValue(name));
  return isFinite(v) ? v : fallback;
}
const N = R.list.length;
const dealMs = () => reduceMq.matches ? ms('--fade', 200) + 40 : (N - 1) * ms('--stagger', 70) + ms('--flip-lag', 430) + ms('--flip', 500) + 40;
const collectMs = () => reduceMq.matches ? 0 : (N - 1) * ms('--stagger-back', 35) + ms('--collect', 520) + 40;
const leaveMs = () => reduceMq.matches ? 0 : ms('--leave', 420);

/* ---------- build the cards from the data ---------- */
const SVG_NS = 'http://www.w3.org/2000/svg';
function svgIcon(markup, cls) {
  const s = document.createElementNS(SVG_NS, 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('class', cls); s.setAttribute('aria-hidden', 'true');
  s.innerHTML = markup;   // markup comes from roles.js, which is our own file
  return s;
}
function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; }

const savedId = R.saved();
const cards = R.list.map((role, i) => {
  const li = el('li', 'slot'); li.dataset.role = role.id;
  li.style.setProperty('--i', i); li.style.setProperty('--rev', N - 1 - i);
  li.style.setProperty('--fr', (i % 2 ? 1 : -1) * (5 + (i % 3) * 2) + 'deg');   // fling rotation: alternates side
  const a = el('a', 'card'); a.href = hrefOf(role.id); a.dataset.accent = role.accent; a.dataset.role = role.id;
  a.setAttribute('aria-labelledby', 't-' + role.id); a.setAttribute('aria-describedby', 'q-' + role.id);
  const arc = el('span', 'arc'), lob = el('span', 'lob'), tilt = el('span', 'tilt'), flip = el('span', 'flip');
  const back = el('span', 'face face-back'); back.setAttribute('aria-hidden', 'true');
  const mark = el('span', 'brand-mark'); back.append(el('span', 'back-pattern'), mark);
  const front = el('span', 'face face-front');
  const top = el('span', 'f-top');
  const bubble = el('span', 'bubble'); bubble.append(svgIcon(role.icon, 'ico'));
  top.append(bubble);
  if (role.id === savedId) top.append(el('span', 'last', label('Last')));
  const title = el('span', 'title', role.title); title.id = 't-' + role.id;
  const q = el('span', 'q', role.question); q.id = 'q-' + role.id;
  const mods = el('span', 'mods');
  role.modules.forEach(m => mods.append(el('span', 'mod', m)));
  const foot = el('span', 'f-foot');
  foot.append(el('span', 'tag', role.mode === 'full' ? label('Full') : label('Simplified')), svgIcon('<path d="M5 12h14M13 6l6 6-6 6"/>', 'ico go'));
  front.append(top, title, q, mods, foot);
  flip.append(back, front); tilt.append(flip); lob.append(tilt); arc.append(lob); a.append(arc); li.append(a);
  if (role.id === savedId) li.dataset.last = '';
  slots.append(li);
  return { role, li, a };
});

// the list: same roles, same order, same hrefs
const ph = el('option', '', label('Pick')); ph.value = ''; select.append(ph);
R.list.forEach(r => { const o = el('option', '', r.title); o.value = r.id; select.append(o); });
select.value = savedId || '';
function markCurrent(id) { cards.forEach(c => { if (c.role.id === id) c.li.dataset.current = ''; else delete c.li.dataset.current; }); }
markCurrent(select.value);

if (savedId) {
  continueLink.hidden = false;
  continueLink.textContent = label('Continue').replace('{role}', R.get(savedId).title);
  continueLink.href = hrefOf(savedId);
  dealBtn.classList.replace('primary-btn', 'ghost-btn');
}

/* ---------- measuring: where does each card belong? ----------
   The grid slots (<li>) are real layout, so their rectangles are the truth for the dealt positions; the cards
   inside them are only transformed, which never changes a slot's rectangle. The deck sits at the horizontal middle
   of the slot grid, level with the first row, so on a phone (2 columns, 3 rows) it is at the top, not the middle of a
   tall grid. Each card gets the offset from its own slot to the deck as --dx/--dy (stacked pose); the dealt pose is
   simply "no offset". Nothing is hard-coded in pixels, and re-measuring only rewrites those variables, so a resize
   or rotation never replays the deal. */
function measure() {
  const lis = cards.map(c => c.li), rects = lis.map(li => li.getBoundingClientRect());
  const first = rects[0]; if (!first || !first.width) return;
  const left = Math.min(...rects.map(r => r.left)), right = Math.max(...rects.map(r => r.right));
  const ax = (left + right) / 2, ay = first.top + first.height / 2;
  lis.forEach((li, i) => {
    const r = rects[i];
    li.style.setProperty('--dx', (ax - (r.left + r.width / 2) + i * 1.5).toFixed(1) + 'px');
    li.style.setProperty('--dy', (ay - (r.top + r.height / 2) + i * 2.5).toFixed(1) + 'px');
    li.style.setProperty('--sr', ((i % 3) - 1) * 1.6 + 'deg');
  });
  const sr = stage.getBoundingClientRect(), bottom = Math.max(...rects.map(r => r.bottom));
  stage.style.setProperty('--card-w', first.width.toFixed(1) + 'px');
  stage.style.setProperty('--card-h', first.height.toFixed(1) + 'px');
  stage.style.setProperty('--ax', (ax - sr.left).toFixed(1) + 'px');
  stage.style.setProperty('--ay', (first.top - sr.top).toFixed(1) + 'px');
  // several rows: while the deck rests, the grid collapses to one card's height (see [data-compact] in the css)
  if (bottom - first.top > first.height + 2) stage.style.setProperty('--stack-h', (first.height + 28).toFixed(1) + 'px');
  else stage.style.removeProperty('--stack-h');
}
let raf = 0;
// While the deck rests, a resize must move the stack to its new place at once, not glide there: `data-measuring`
// switches the transitions off for the frame that picks up the new variables (css: [data-measuring]).
const remeasure = () => {
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(() => {
    deck.setAttribute('data-measuring', ''); measure(); void deck.offsetWidth;
    requestAnimationFrame(() => deck.removeAttribute('data-measuring'));
  });
};
if (window.ResizeObserver) new ResizeObserver(remeasure).observe(slots);
window.addEventListener('resize', remeasure);
window.addEventListener('orientationchange', remeasure);
if (document.fonts && document.fonts.ready) document.fonts.ready.then(remeasure);

/* ---------- the state machine ----------
   One attribute, data-state on #deck, is the only thing that moves the cards; the css maps each value to a pose
   and a set of transitions, so every state is stable on its own and any state can be left at any moment.
     stacked  face down in the deck (rest)         -> dealing
     dealing  thrown and flipping (timed)          -> shown | stacked
     shown    face up in the grid (rest)           -> stacked | leaving
     leaving  a role was chosen; others slide back -> shown (only if the browser comes back from history)
   Cards are focusable and exposed to assistive technology only in `shown`. */
const NEXT = { stacked: ['dealing'], dealing: ['shown', 'stacked'], shown: ['stacked', 'leaving'], leaving: ['shown'] };
let state = '', timer = 0, safety = 0, compactTimer = 0, byUser = false;
function setState(next) {
  if (state && NEXT[state].indexOf(next) < 0) return false;
  clearTimeout(timer); clearTimeout(compactTimer); clearTimeout(safety);
  state = next; deck.dataset.state = next;
  const live_ = next === 'shown';
  cards.forEach(c => { c.li.inert = !live_; c.li.setAttribute('aria-hidden', String(!live_)); c.a.tabIndex = live_ ? 0 : -1; });
  if (next !== 'stacked') delete deck.dataset.compact;
  if (next === 'dealing') timer = setTimeout(() => setState('shown'), dealMs());
  if (next === 'stacked') compactTimer = setTimeout(() => { deck.dataset.compact = ''; }, collectMs());
  if (next === 'shown') {
    cards.forEach(c => delete c.li.dataset.picked);
    announce(msg('Shown'));
    if (byUser) { cards[0].a.focus(); }
    byUser = false;
  }
  return true;
}
function announce(text) { live.textContent = ''; setTimeout(() => { live.textContent = text; }, 30); }

function deal(user) {
  if (state !== 'stacked') return;
  byUser = !!user;
  void deck.offsetWidth;            // commit the stacked pose so the deal has something to move from
  setState('dealing');
}
function gather() {
  if (state !== 'dealing' && state !== 'shown') return;
  const onCard = cards.some(c => c.a === document.activeElement);
  byUser = false;
  setState('stacked'); announce(msg('Gathered'));
  if (onCard) dealBtn.focus();   // the focused card has just become inert; hand focus to the control that deals again
}
function navigate(id) { location.assign(hrefOf(id)); }
function choose(id) {
  if (state === 'leaving') return;      // double activation: the first one wins
  R.save(id);
  if (state !== 'shown' || reduceMq.matches) { navigate(id); return; }
  const c = cards.find(x => x.role.id === id);
  c.li.dataset.picked = '';
  setState('leaving');
  timer = setTimeout(() => navigate(id), leaveMs());
  // if the navigation never happens (blocked, offline), do not leave the cards stranded
  safety = setTimeout(() => setState('shown'), leaveMs() + 4000);
}

/* ---------- events ---------- */
dealBtn.addEventListener('click', () => deal(true));
$('stackHit').addEventListener('click', () => deal(true));
gatherBtn.addEventListener('click', gather);
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && (state === 'shown' || state === 'dealing')) { e.preventDefault(); gather(); }
});
slots.addEventListener('click', e => {
  const a = e.target.closest('.card'); if (!a) return;
  const id = a.dataset.role;
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) { R.save(id); return; }   // let the browser open it elsewhere
  e.preventDefault(); choose(id);
});
slots.addEventListener('keydown', e => {   // links answer Enter natively; Space is added so the cards behave like buttons
  const a = e.target.closest('.card');
  if (a && e.key === ' ' && !e.repeat) { e.preventDefault(); a.click(); }
});
slots.addEventListener('focusin', e => {
  const a = e.target.closest('.card'); if (a && a.matches(':focus-visible')) { select.value = a.dataset.role; markCurrent(a.dataset.role); }
});
// tilt toward the pointer: only a pair of custom properties changes, the css does the transform
slots.addEventListener('pointermove', e => {
  const a = e.target.closest('.card');
  if (!a || state !== 'shown' || e.pointerType !== 'mouse') return;
  const r = a.getBoundingClientRect();
  a.style.setProperty('--ry', (((e.clientX - r.left) / r.width - .5) * 10).toFixed(2) + 'deg');
  a.style.setProperty('--rx', ((.5 - (e.clientY - r.top) / r.height) * 8).toFixed(2) + 'deg');
});
slots.addEventListener('pointerout', e => {
  const a = e.target.closest('.card'); if (a && !a.contains(e.relatedTarget)) { a.style.removeProperty('--rx'); a.style.removeProperty('--ry'); }
});
continueLink.addEventListener('click', e => {
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) { R.save(savedId); return; }
  e.preventDefault(); choose(savedId);
});
select.addEventListener('change', () => markCurrent(select.value));
form.addEventListener('submit', e => {
  e.preventDefault();
  if (!select.value) { select.focus(); return; }
  choose(select.value);
});
// coming back from history (bfcache) must not show cards stuck in the leaving pose
window.addEventListener('pageshow', e => { if (e.persisted && state === 'leaving') setState('shown'); });

/* theme: ui.js stores the choice; the pages own the class flip (as app.js and sim.js do) */
const themeBtn = $('themeToggle');
if (themeBtn) themeBtn.addEventListener('click', () => {
  const light = document.body.classList.toggle('light'); themeBtn.setAttribute('aria-pressed', String(light));
});

/* ---------- start ---------- */
setState('stacked');
deck.dataset.compact = '';
measure();
if (savedId) requestAnimationFrame(() => requestAnimationFrame(() => { measure(); deal(false); }));
})();
