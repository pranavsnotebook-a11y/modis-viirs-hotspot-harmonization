/* FIREVERSE roles: the single source of truth for who the platform is built for.
   A plain script (no build step). It attaches `ROLES` to the global object, so the browser, Node and the tests
   load the same file. Presentation lives in css/start.css, behaviour in js/start.js; no role text lives anywhere else
   except the <noscript> fallback in start.html, which a unit test keeps in step with this list.

   Icons are the inner markup of a 24x24 stroke-only SVG (the same style as the icons in downwind.html). */
(function (root) {
'use strict';

const KEY = 'fv.role';

const list = Object.freeze([
  {
    id: 'firefighter', title: 'Fire brigade',
    tagline: 'Where the fires are and where the smoke is going.',
    question: 'Where are the fires now, and which way is the wind pushing the smoke?',
    modules: ['Fires near base', 'Wind and smoke path', 'What is in the path'],
    mode: 'simplified', accent: 'orange', href: 'role.html?role=firefighter',
    // helmet: dome, brim, crest
    icon: '<path d="M5 15a7 7 0 0 1 14 0"/><path d="M3 15h18v3.5H3z"/><path d="M12 4.5V8M9.5 15v-3"/>'
  },
  {
    id: 'grid', title: 'Grid operator',
    tagline: 'Which power lines have a fire upwind.',
    question: 'Which power lines have a fire upwind today?',
    modules: ['Lines with smoke upwind', 'Fast 10-minute look', 'Bulletin for crews'],
    mode: 'simplified', accent: 'yellow', href: 'role.html?role=grid',
    // transmission tower with two cross-arms
    icon: '<path d="M12 2.5v3M9.5 5.5h5M12 5.5 7.5 21.5M12 5.5l4.5 16M9 12h6M7.8 17h8.4M3 9h18"/>'
  },
  {
    id: 'road', title: 'Road patrol',
    tagline: 'Which stretches of road smoke could cross.',
    question: 'Which stretches of road could smoke cross?',
    modules: ['Roads in the smoke path', 'SMS-length bulletin', 'Read aloud for radio'],
    mode: 'simplified', accent: 'purple', href: 'role.html?role=road',
    // road in perspective with a dashed centre line
    icon: '<path d="M9 3 5 21M15 3l4 18M12 4.5v2.5M12 11v2.5M12 17.5V20"/>'
  },
  {
    id: 'care', title: 'Clinic or school lead',
    tagline: 'Whether smoke is heading for your site.',
    question: 'Is smoke heading for my site?',
    modules: ['One site, one answer', 'Share by WhatsApp', 'Works on weak signal'],
    mode: 'simplified', accent: 'red', href: 'role.html?role=care',
    // building with a cross
    icon: '<path d="M3 11 12 4l9 7v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"/><path d="M12 12v5M9.5 14.5h5"/>'
  },
  {
    id: 'resident', title: 'Resident or farmer',
    tagline: 'Whether smoke is heading for your place.',
    question: 'Is smoke heading for my place?',
    modules: ['My place', 'Last satellite look', 'Spanish, Portuguese, English'],
    mode: 'simplified', accent: 'green', href: 'role.html?role=resident',
    // map pin
    icon: '<path d="M12 21.5s-6-5.6-6-11a6 6 0 0 1 12 0c0 5.4-6 11-6 11z"/><circle cx="12" cy="10.5" r="2.2"/>'
  },
  {
    id: 'analyst', title: 'Analyst',
    tagline: 'The full workspace: every record, every method.',
    question: 'The full workspace: every record, every method.',
    modules: ['Map and data explorer', 'Harmonization lab', 'FIRELAB scenarios'],
    mode: 'full', accent: 'cyan', href: 'index.html',
    // magnifier over bars
    icon: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m20 20-4.9-4.9M8 12.5v-3M10.5 12.5v-6M13 12.5v-4"/>'
  }
].map(r => Object.freeze(Object.assign({}, r, { modules: Object.freeze(r.modules.slice()) }))));

/* The spec lists Spanish, Portuguese and English as separate chips; the three-chip card groups them. */

function get(id) { return list.find(r => r.id === id) || null; }

// localStorage can be missing (privacy modes, sandboxed frames) or throw on access; every call is guarded.
function store() { try { return root.localStorage || null; } catch (e) { return null; } }
function saved() {
  try { const s = store(), id = s && s.getItem(KEY); return id && get(id) ? id : null; } catch (e) { return null; }
}
function save(id) {
  if (!get(id)) return false;
  try { const s = store(); if (!s) return false; s.setItem(KEY, id); return true; } catch (e) { return false; }
}
function clear() {
  try { const s = store(); if (!s) return false; s.removeItem(KEY); return true; } catch (e) { return false; }
}

// Adds r=<ISO> to the role's href, whether or not it already has a query string or a fragment.
function hrefFor(id, opts) {
  const role = get(id); if (!role) return null;
  const region = opts && opts.region;
  if (!region) return role.href;
  const hashAt = role.href.indexOf('#');
  const base = hashAt < 0 ? role.href : role.href.slice(0, hashAt), hash = hashAt < 0 ? '' : role.href.slice(hashAt);
  return base + (base.indexOf('?') < 0 ? '?' : '&') + 'r=' + encodeURIComponent(region) + hash;
}

root.ROLES = Object.freeze({ list, get, saved, save, clear, hrefFor, KEY });
})(typeof globalThis !== 'undefined' ? globalThis : window);
