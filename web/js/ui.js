/* FIREVERSE shell: presentation behaviour shared by the pages. Drawers and dialogs (focus, Escape, scroll lock),
   tabs with arrow keys, the collapsible rail, mobile navigation, remembered disclosures and theme, and quick
   tooltips for calendar cells. No data logic lives here; app.js and sim.js own every number. */
(function () {
'use strict';
const $ = id => document.getElementById(id);
const store = { get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* storage off */ } } };
const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea,[tabindex]:not([tabindex="-1"]),summary';
const mq = q => window.matchMedia && matchMedia(q).matches;

function resizeIn(el) {
  if (!window.Chart) return;
  requestAnimationFrame(() => el.querySelectorAll('canvas').forEach(c => { const ch = Chart.getChart(c); if (ch) ch.resize(); }));
}

/* ---------- theme (applied before the first paint of the charts) ---------- */
const themeBtn = $('themeToggle');
if (store.get('theme') !== 'dark') document.body.classList.add('light'); // the Paper theme is the default; dark is the stored choice
if (themeBtn) {
  themeBtn.setAttribute('aria-pressed', document.body.classList.contains('light'));
  themeBtn.addEventListener('click', () => setTimeout(() => { const l = document.body.classList.contains('light'); store.set('theme', l ? 'light' : 'dark'); themeBtn.setAttribute('aria-pressed', l); }, 0));
}

/* ---------- dialogs and drawers ---------- */
const openStack = [];
function open(id, opener) {
  const el = $(id); if (!el || !el.hidden) return;
  el.hidden = false; el._opener = opener || document.activeElement;
  openStack.push(el);
  if (el.getAttribute('aria-modal') === 'true') document.documentElement.classList.add('locked');
  requestAnimationFrame(() => { el.classList.add('in'); const f = el.querySelector('[autofocus]') || el.querySelector(FOCUSABLE); if (f) f.focus({ preventScroll: true }); });
  document.querySelectorAll(`[aria-controls="${id}"]`).forEach(b => b.setAttribute('aria-expanded', 'true'));
  el.dispatchEvent(new CustomEvent('fv:open'));
}
function close(id) {
  const el = typeof id === 'string' ? $(id) : id; if (!el || el.hidden) return;
  el.classList.remove('in'); el.hidden = true;
  const k = openStack.indexOf(el); if (k >= 0) openStack.splice(k, 1);
  if (!openStack.some(x => x.getAttribute('aria-modal') === 'true')) document.documentElement.classList.remove('locked');
  document.querySelectorAll(`[aria-controls="${el.id}"]`).forEach(b => b.setAttribute('aria-expanded', 'false'));
  const o = el._opener; if (o && document.contains(o) && o.offsetParent !== null) o.focus({ preventScroll: true });
  el.dispatchEvent(new CustomEvent('fv:close'));
}
document.addEventListener('click', e => {
  const c = e.target.closest('[data-close]'); if (c) { close(c.dataset.close); return; }
  const o = e.target.closest('[data-open]'); if (o) { open(o.dataset.open, o); return; }
  const w = e.target.closest('.drawer-wrap,.sheet-wrap,.modal-wrap'); if (w && e.target === w) close(w);  // backdrop
});
document.addEventListener('keydown', e => {
  const top = openStack[openStack.length - 1];
  if (e.key === 'Escape' && top) { e.preventDefault(); close(top); return; }
  if (e.key === 'Tab' && top && top.getAttribute('aria-modal') === 'true') { // keep focus inside a modal
    const f = [...top.querySelectorAll(FOCUSABLE)].filter(x => x.offsetParent !== null); if (!f.length) return;
    if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f.at(-1).focus(); }
    else if (!e.shiftKey && document.activeElement === f.at(-1)) { e.preventDefault(); f[0].focus(); }
  }
});

/* ---------- tabs: click and arrow keys; panes are found by the tablist's own handler ---------- */
document.addEventListener('keydown', e => {
  const t = e.target.closest('[role=tab]'); if (!t || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
  const tabs = [...t.parentElement.querySelectorAll('[role=tab]')], k = tabs.indexOf(t);
  const n = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : (k + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
  e.preventDefault(); tabs[n].focus(); tabs[n].click();
});
function tabs(list, attr, paneSel, onShow) {
  if (!list) return;
  const show = name => {
    list.querySelectorAll('[role=tab]').forEach(b => { const on = b.dataset[attr] === name; b.setAttribute('aria-selected', on); b.tabIndex = on ? 0 : -1; });
    document.querySelectorAll(paneSel).forEach(p => { p.hidden = p.dataset[attr + 'pane'] !== name; if (!p.hidden) resizeIn(p); });
    if (onShow) onShow(name);
  };
  list.querySelectorAll('[role=tab]').forEach(b => b.addEventListener('click', () => show(b.dataset[attr])));
  return show;
}

/* ---------- remembered disclosures ---------- */
document.querySelectorAll('details.disclose[id]').forEach(d => {
  const key = 'open:' + d.id;
  if (store.get(key) === '1') d.open = true;
  d.addEventListener('toggle', () => { store.set(key, d.open ? '1' : '0'); if (d.open) resizeIn(d); });
});

/* ---------- Explorer shell ---------- */
const side = $('sidebar');
if (side) {
  const app = $('app'), btn = $('sideCollapse');
  const setRail = on => {
    const t = on ? 'Expand navigation' : 'Collapse navigation';
    app.classList.toggle('rail', on); btn.setAttribute('aria-expanded', !on); btn.setAttribute('aria-label', t); btn.title = t;
    setTimeout(() => window.dispatchEvent(new Event('resize')), 220); // maps and charts re-measure
  };
  setRail(store.get('rail') === '1');
  btn.addEventListener('click', () => { const on = !app.classList.contains('rail'); setRail(on); store.set('rail', on ? '1' : '0'); });

  const NAMES = { overview: 'Overview', map: 'Map Explorer', harmonization: 'Harmonization Lab', calendar: 'Activity Calendar', history: 'Historical Analysis', data: 'Data Explorer' };
  document.addEventListener('fv:page', e => {
    $('crumbPage').textContent = NAMES[e.detail] || '';
    document.title = `${NAMES[e.detail]} · FIREVERSE Hot Spot Explorer`;
    const more = ['calendar', 'history'].includes(e.detail); $('moreBtn').classList.toggle('active', more);
    close('moreSheet');
    if (e.detail !== 'map') close('mapDrawer');
  });
  $('moreBtn').addEventListener('click', e => open('moreSheet', e.currentTarget));
  // the status pill is hidden on phones; mirror it in the More sheet
  const mirror = () => { $('sheetMeta').textContent = [$('dataPill').textContent, $('serverState').textContent].filter(Boolean).join(' · '); };
  new MutationObserver(mirror).observe($('dataPill'), { childList: true, characterData: true, subtree: true }); mirror();

  // map side panel: Layers, Details, Latest. Non-modal, so the map stays usable beside it.
  const drawer = $('mapDrawer'), lb = $('mapLayersBtn');
  const showM = tabs(drawer.querySelector('[role=tablist]'), 'mtab', '#mapDrawer [data-mpane]', () => {});
  document.querySelectorAll('#mapDrawer [data-mpane]').forEach(p => { p.dataset.mtabpane = p.dataset.mpane; });
  let cur = 'layers';
  const mapPanel = (tab, force) => {
    if (!drawer.hidden && tab === cur && !force) { close(drawer); return; }
    cur = tab; showM(tab);
    if (drawer.hidden) open('mapDrawer', lb);
  };
  drawer.addEventListener('fv:open', () => { lb.setAttribute('aria-expanded', 'true'); $('mapStage').classList.add('drawer-open'); });
  drawer.addEventListener('fv:close', () => { lb.setAttribute('aria-expanded', 'false'); $('mapStage').classList.remove('drawer-open'); });
  window.UI_mapPanel = mapPanel;

  // calendar views
  tabs($('calTabs'), 'cal', '[data-calpane]');

  // export menu: close after a choice or a click elsewhere
  const menu = $('exportMenu');
  menu.addEventListener('click', e => { if (e.target.closest('[role=menuitem]')) menu.open = false; });
  document.addEventListener('click', e => { if (menu.open && !menu.contains(e.target)) menu.open = false; });
  menu.addEventListener('keydown', e => { if (e.key === 'Escape' && menu.open) { menu.open = false; menu.querySelector('summary').focus(); e.stopPropagation(); } });

  // filters collapse on phones
  if (mq('(max-width: 767px)')) { $('dataFilters').open = false; document.querySelector('.legend-box').open = false; }
}

/* ---------- quick tooltips for heatmap cells (the native title waits about a second) ---------- */
const tip = document.createElement('div'); tip.className = 'qtip'; tip.setAttribute('role', 'tooltip'); tip.hidden = true; document.body.appendChild(tip);
const TIP_SEL = '.heat-cell,.dcell';
function showTip(el) {
  if (el.title) { el.dataset.tip = el.title; el.removeAttribute('title'); }
  if (!el.dataset.tip) return;
  tip.textContent = el.dataset.tip; tip.hidden = false;
  const r = el.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight;
  tip.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.left + r.width / 2 - w / 2)) + 'px';
  tip.style.top = (r.top - h - 8 < 8 ? r.bottom + 8 : r.top - h - 8) + 'px';
}
document.addEventListener('mouseover', e => { const c = e.target.closest(TIP_SEL); if (c) showTip(c); else tip.hidden = true; });
document.addEventListener('focusin', e => { const c = e.target.closest(TIP_SEL); if (c) showTip(c); else tip.hidden = true; });
document.addEventListener('scroll', () => { tip.hidden = true; }, true);

window.UI = { resizeIn, open, close, tabs, store, mapPanel: (t, f) => window.UI_mapPanel && window.UI_mapPanel(t, f) };
})();

/* Chart.js defaults shared by every chart */
if (window.Chart) {
  const f = getComputedStyle(document.body).fontFamily;
  Chart.defaults.font.family = f; Chart.defaults.font.size = 11;
  Object.assign(Chart.defaults.plugins.tooltip, { padding: 10, cornerRadius: 8, backgroundColor: '#0B1D27f2', borderColor: '#36D5E844', borderWidth: 1, titleColor: '#EAF3F5', bodyColor: '#C9D9DE', footerColor: '#9AB0B8', boxPadding: 4, usePointStyle: true });
  Chart.defaults.plugins.legend.labels.usePointStyle = true; Chart.defaults.plugins.legend.labels.pointStyleWidth = 8;
  Chart.defaults.elements.bar.borderRadius = 4; Chart.defaults.elements.line.borderJoinStyle = 'round';
}
