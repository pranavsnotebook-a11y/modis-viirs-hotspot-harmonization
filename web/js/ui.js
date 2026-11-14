/* Small presentation helpers shared by the pages: charts inside collapsed sections are resized when they open,
   and the open/closed state of each section is remembered. No data logic lives here. */
(function () {
'use strict';
const store = { get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* no storage */ } } };
function resizeIn(el) {
  if (!window.Chart) return;
  requestAnimationFrame(() => el.querySelectorAll('canvas').forEach(c => { const ch = Chart.getChart(c); if (ch) ch.resize(); }));
}
document.querySelectorAll('details.disclose[id], details.live-box[id]').forEach(d => {
  const key = 'open:' + d.id;
  if (store.get(key) === '1') d.open = true;
  d.addEventListener('toggle', () => { store.set(key, d.open ? '1' : '0'); if (d.open) resizeIn(d); });
});
window.UI = { resizeIn };
})();
if (window.Chart) {
  Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
  Chart.defaults.plugins.tooltip.padding = 10; Chart.defaults.plugins.tooltip.cornerRadius = 10;
  Chart.defaults.plugins.tooltip.backgroundColor = '#0b1a26f2'; Chart.defaults.plugins.tooltip.borderColor = '#22d3ee44'; Chart.defaults.plugins.tooltip.borderWidth = 1;
  Chart.defaults.plugins.legend.labels.usePointStyle = true; Chart.defaults.elements.bar.borderRadius = 4;
}
(function () { // remember the theme between pages and visits
  const b = document.getElementById('themeToggle');
  let t = null; try { t = localStorage.getItem('theme'); } catch (e) { /* no storage */ }
  if (t === 'light' && !document.body.classList.contains('light')) { document.body.classList.add('light'); if (b) b.textContent = '☾'; }
  if (b) b.addEventListener('click', () => setTimeout(() => { try { localStorage.setItem('theme', document.body.classList.contains('light') ? 'light' : 'dark'); } catch (e) { /* no storage */ } }, 0));
})();
