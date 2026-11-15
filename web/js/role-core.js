/* ROLEDATA: the data logic of the role pages, without the DOM. Plain script; needs DOWNWIND, WATCH, BULLETIN, PLACE and REGIONS.
   Reads the light feed (PLACE.decodeFeed) and the prepared asset file, never the 10 MB bundle. Wind is requested through an
   injected getJSON, so Node tests run offline. Nothing here invents a fire, a measurement or a confidence value. */
(function (root) {
'use strict';
const D = () => root.DOWNWIND, W = () => root.WATCH, P_ = () => root.PLACE;
const norm = s => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/* decoded fires of the feed inside the last `hours` of data */
function recentFires(fires, end, hours) { return fires.filter(d => d.ms > end - hours * 36e5 && d.ms <= end); }

/* places: [[name, lat, lon], ...] (the feed) or [{name, lat, lon}] (the asset file). Starts-with matches first. */
function searchPlaces(list, q, limit) {
  const n = norm(q).trim(); if (n.length < 2) return [];
  const out = [];
  for (const p of list || []) {
    const name = Array.isArray(p) ? p[0] : p.name; if (!name) continue;
    const k = norm(name).indexOf(n); if (k < 0) continue;
    out.push({ name, lat: Array.isArray(p) ? p[1] : p.lat, lon: Array.isArray(p) ? p[2] : p.lon, kind: Array.isArray(p) ? 'place' : (p.kind || 'place'), at: k });
  }
  out.sort((a, b) => (a.at === 0 ? 0 : 1) - (b.at === 0 ? 0 : 1) || a.name.length - b.name.length);
  return out.slice(0, limit || 8);
}
/* care: named clinics, hospitals and schools from the asset file, then towns from the feed */
function searchSites(P, feed, q, limit) {
  const lim = limit || 8, out = [];
  const add = (kind, list) => searchPlaces(list.map(p => ({ name: p.name, lat: p.lat, lon: p.lon, kind })), q, lim).forEach(h => out.push(h));
  if (P && W().kindBuilt(P, 'health')) add('health', P.points.health.filter(p => p.name));
  if (P && W().kindBuilt(P, 'schools')) add('schools', P.points.schools.filter(p => p.name));
  searchPlaces((feed && feed.places) || [], q, lim).forEach(h => out.push(h));
  return out.sort((a, b) => (a.at === 0 ? 0 : 1) - (b.at === 0 ? 0 : 1)).slice(0, lim);
}

/* grid and road: the watch list for one kind from the last `hours` of the feed's data */
async function watchList(o) {
  const cfg = o.cfg, R = { ...W().rules(), minFrp: cfg.minFrp }, dets = recentFires(o.fires, o.end, cfg.hours);
  const range = W().liveRange(o.end, cfg.hours, R);
  const res = await W().computeLive({ kind: cfg.kind, dets, assets: o.assets, rules: R, wind: o.wind, range, live: true });
  return { res, dets, range, rules: R };
}
/* the line a person can copy on a day with nothing to list: an all-clear only when everything was assessed, otherwise an honest "not assessed" */
function statusKind(res, loadFailed) { return loadFailed || res.noAssets || res.wxErr || res.noWind || res.skipped ? 'notAssessed' : 'clear'; }

/* firefighter: fires within radius of the base, strongest first, each with the wind at its pass and the mapped assets in its modelled path */
async function fireItems(o) {
  const cfg = o.cfg, d = D(), w = W(), R = { ...w.rules(), minFrp: 0 };
  const dets = recentFires(o.fires, o.end, cfg.hours).filter(f => d.dist(o.base.lat, o.base.lon, f.lat, f.lon) <= cfg.radiusKm);
  const clusters = d.cluster(dets, R.clusterKm).map(f => ({ ...f, ms: Date.parse(f.time) })).sort((a, b) => b.frp - a.frp || b.ms - a.ms);
  const shown = clusters.slice(0, cfg.max), range = w.liveRange(o.end, cfg.hours, R);
  const cells = new Set(shown.map(f => w.cellKey(f.lat, f.lon)));
  const failed = shown.length ? await o.wind.fetch(cells, range) : 0;
  const spot = f => Math.round(f.lat * 50) + ',' + Math.round(f.lon * 50) + '|' + f.sat;
  const items = shown.map(f => {
    const wx = o.wind.has(f.lat, f.lon, range) ? o.wind.at(f.lat, f.lon, f.ms, range) : null;
    return { fire: f, km: d.dist(o.base.lat, o.base.lon, f.lat, f.lon), brg: d.bearing(o.base.lat, o.base.lon, f.lat, f.lon), wx, heading: wx ? d.compass(wx.wd + 180) : null, rows: [], assessed: !!wx, key: spot(f) };
  });
  const byKey = new Map(items.map(i => [i.key, i])), notBuilt = [];
  for (const kind of w.KIND_LIST) {
    if (!o.assets || !w.kindBuilt(o.assets, kind)) { notBuilt.push(kind); continue; }
    const res = await w.computeLive({ kind, dets: shown.length ? dets : [], assets: o.assets, rules: R, wind: o.wind, range, live: true });
    for (const r of res.rows) { const it = byKey.get(spot(r.fire)); if (it) it.rows.push(r); }
  }
  items.forEach(i => i.rows.sort((a, b) => (b.peak || 0) - (a.peak || 0)));
  return { items, total: clusters.length, hidden: Math.max(0, clusters.length - shown.length), failed, notBuilt, range, anyUnassessed: items.some(i => !i.assessed) };
}

/* care and resident: the one answer for one place, by the same functions My place uses */
async function siteAnswer(place, fires, end, getJSON) {
  const PL = P_(), cl = PL.candidates(place, fires, end);
  let H = null;
  if (PL.insideBox(place)) {
    try {
      const w = PL.windWindow(cl);
      if (!w) H = { time: [], wind_speed_100m: [], wind_direction_100m: [] };
      else { const j = await getJSON(PL.windURL(place, w), 20000); if (!j || !j.hourly || !j.hourly.time) throw new Error('no wind'); H = j.hourly; }
    } catch (e) { H = null; }
  }
  return PL.analyse(place, fires, end, H);
}
root.ROLEDATA = Object.freeze({ norm, recentFires, searchPlaces, searchSites, watchList, statusKind, fireItems, siteAnswer });
})(typeof globalThis !== 'undefined' ? globalThis : window);
