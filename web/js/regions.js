/* Regions of DOWNWIND and My place. The single source of truth is web/app-data/regions.json (also read by src/hotspots/feed.py and
   src/hotspots/assets.py). In a browser this file fetches it: await REGIONS.ready before using get() or codes().
   In Node, call REGIONS.load(JSON.parse(fs.readFileSync('web/app-data/regions.json'))). */
(function (root) {
'use strict';
const KEY = 'fv.region';
const COMPASS = { // the eight words of D.compass(), per language
  en: { north: 'north', 'north-east': 'north-east', east: 'east', 'south-east': 'south-east', south: 'south', 'south-west': 'south-west', west: 'west', 'north-west': 'north-west' },
  es: { north: 'norte', 'north-east': 'noreste', east: 'este', 'south-east': 'sureste', south: 'sur', 'south-west': 'suroeste', west: 'oeste', 'north-west': 'noroeste' },
  pt: { north: 'norte', 'north-east': 'nordeste', east: 'leste', 'south-east': 'sudeste', south: 'sul', 'south-west': 'sudoeste', west: 'oeste', 'north-west': 'noroeste' },
};
const R = { data: {}, KEY, COMPASS, LANGS: ['en', 'es', 'pt'], LANG_NAME: { en: 'English', es: 'Español', pt: 'Português' },
  load(json) { R.data = (json && json.regions) || {}; for (const [k, r] of Object.entries(R.data)) r.iso = k; return R; },
  codes() { return Object.keys(R.data); },
  get(iso) { return R.data[String(iso || '').toUpperCase()] || null; },
  name(iso, lang) { const r = R.get(iso); return r ? r.name[lang] || r.name.en : ''; },
  /* is the point inside the region's box? A box, not the border: part of a neighbouring country can be inside it. */
  inside(iso, lat, lon) { const r = R.get(iso); if (!r) return false; const v = r.view; return lat >= v[0][0] && lat <= v[1][0] && lon >= v[0][1] && lon <= v[1][1]; },
  /* order of the three bulletin languages: English, then the region's own, then the other */
  langOrder(iso) { const r = R.get(iso), own = r ? r.lang : 'es'; return ['en', own, ...R.LANGS.filter(l => l !== 'en' && l !== own)]; },
  /* region to start with: ?r=XX in the URL, else the last one used in this browser, else PY */
  initial(search, fallback) {
    let q = null; try { q = new URLSearchParams(search || '').get('r'); } catch (e) { /* no URL */ }
    let s = null; try { s = root.localStorage && root.localStorage.getItem(KEY); } catch (e) { /* storage blocked */ }
    for (const c of [q, s, fallback || 'PY']) if (c && R.get(c)) return String(c).toUpperCase();
    return R.codes()[0] || 'PY';
  },
  remember(iso) { try { root.localStorage.setItem(KEY, iso); } catch (e) { /* storage full or blocked */ } },
};
R.ready = typeof root.fetch === 'function' && typeof root.document !== 'undefined'
  ? root.fetch('app-data/regions.json').then(r => { if (!r.ok) throw new Error('regions.json HTTP ' + r.status); return r.json(); }).then(j => R.load(j))
  : Promise.resolve(R);
root.REGIONS = R;
if (typeof module !== 'undefined' && module.exports) module.exports = R;
})(typeof window !== 'undefined' ? window : globalThis);
