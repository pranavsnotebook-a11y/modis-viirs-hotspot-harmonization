# FIREVERSE: what is the smoke about to cross?

NASA Space Apps 2026 · **Team Terra flare**: Devika Sanil (Team Owner), Toufeeq SK, Pranav Krishna

**Walkthrough video (4.7 min):** [`docs/video/fireverse-roles-walkthrough.mp4`](docs/video/fireverse-roles-walkthrough.mp4)

FIREVERSE merges NASA FIRMS active-fire detections from MODIS and VIIRS into one harmonized record. It then runs a
smoke plume on modelled wind to show where each fire's smoke is heading, and what lies in its path: power lines,
main roads, clinics and schools. It covers Paraguay, Bolivia, Argentina and Brazil, in English, Spanish and Portuguese.
Every value is labelled OBSERVED (satellite fires), MAPPED (OpenStreetMap assets), MODELLED (wind) or SCENARIO
(smoke). Nothing is invented, and no detection does not mean no fire.

| Page | Who it is for | What it answers |
|---|---|---|
| `start.html` (front door) | everyone | Pick a role from a card deck |
| `role.html?role=firefighter` | fire brigade | Fires near base, where their smoke goes, what is in its path |
| `role.html?role=grid` | grid operator | Power lines with a fire upwind; 10-minute fast look; crew bulletin |
| `role.html?role=road` | road patrol | Road stretches in the smoke path; SMS-length bulletin |
| `role.html?role=care` | clinic or school lead | Is smoke heading for my site? |
| `role.html?role=resident` | resident or farmer | Is smoke heading for my place? |
| `downwind.html` | operations | The full watch list for every asset kind, plus the 8 January 2025 line-trip replay |
| `firelab.html` | anyone | The smoke plume itself, hour by hour |
| `index.html` | analyst | Explorer: map, globe, Harmonization Lab, calendar, history, data |
| `route.html?role=driver` | driver, road patrol | Will my drive go through smoke? Routes compared by modelled smoke, a detour search, turn-by-turn directions with smoke warnings, a drive mode with spoken alerts, the best time to leave; hand-off to Google Maps or GeoJSON |
| `place.html` | low-bandwidth phones | One place, one answer (about 130 kB) |

Each simplified role page has a three-step shift briefing (check the satellite clock, review the top items, send a
bulletin). Bulletins come in full and SMS form, and can be read aloud or shared by WhatsApp.

**Run it:** `python -m hotspots.server`, then open http://127.0.0.1:8000. Setup, the FIRMS key and Codespaces are
covered below.
**Tests:** `pytest -q` (Python) and `npm test` (front-end unit tests plus browser checks in Chrome).
**Smoke-aware navigation (built, `web/route.html`, the Driver role):** map apps show the air quality right now, but smoke
moves. This page compares driving routes by the modelled smoke on each at the time you would be there, searches for a
detour when every route meets smoke, gives turn-by-turn directions with smoke warnings, follows a drive with spoken
alerts, and says which departure time meets the least smoke. **Not built:** routing inside the road network that avoids
smoke by itself (the detour search tries up to six via-points beside the smoke, so it can miss a detour that exists), and
any live integration with a map company.

## Harmonization of MODIS and VIIRS hot spots

MODIS (1 km) and VIIRS (375 m) both report active fire detections, but with different resolutions, schemas,
confidence scales and overpass times. This project merges them into one consistent hot-spot product.

### Pipeline
1. **Load** FIRMS CSV downloads (MODIS C6.1, VIIRS S-NPP / NOAA-20 375 m) — `hotspots.io`
2. **Normalize** to a common schema: sensor, lat/lon, UTC time, FRP (MW), confidence class
   (low/nominal/high), footprint size from scan/track — `hotspots.schema`
3. **Match** detections across sensors by oriented-rectangle footprint overlap + time window —
   `hotspots.match`, `hotspots.footprint`
4. **Merge** matched groups into harmonized fire events (best location from VIIRS,
   combined FRP, agreement flag, unified confidence) — `hotspots.merge`, `hotspots.confidence`
5. **FRP harmonization** and **detection-probability** analysis — `hotspots.frp`, `hotspots.detection`,
   report via `python -m hotspots.report modis.csv viirs*.csv`

## FIREVERSE × FIRELAB: the Hot Spot Explorer (`web/index.html`)
Seven sections: Overview, Map Explorer (2D maps and 3D globe), Harmonization Lab, Activity Calendar, Historical Analysis,
Data Explorer and **FIRELAB**, a smoke and exposure simulator. Every fire shown is a real NASA FIRMS detection. Nothing is
randomly generated, and modelled or scenario values are labelled OBSERVED / MODELLED / SCENARIO on the page.

### See it in your browser, nothing to install (GitHub Codespaces)
On the repository page: **Code → Codespaces → Create codespace on main**. The first start takes a few minutes: it
installs the package and builds the population grid. Then the site opens in a new tab on port 8000 (if it does
not, open the **Ports** tab and click the globe next to 8000). The forwarded port is private to your GitHub
account. To use a FIRMS MAP_KEY there, add it as a Codespaces secret named `FIRMS_MAP_KEY` (Settings → Codespaces).

### Quick start

    python3 -m venv .venv && source .venv/bin/activate
    pip install -e '.[dev]'
    python -m hotspots.refresh            # download the latest 7 days from FIRMS and rebuild web/app-data
    python -m hotspots.server             # http://127.0.0.1:8000  (add --port / --host to change)

Without the server the site still runs from static files (`cd web && python3 -m http.server`), using the bundled
records. Live FIRMS queries and population exposure are then turned off, and FIRELAB weather is fetched directly
from the keyless Open-Meteo APIs.

### FIRMS API configuration (MAP_KEY)
The key stays on the server. It is never written to frontend code, logs, cache file names or API responses.

    cp .env.example .env                  # .env is git-ignored
    # edit .env:  FIRMS_MAP_KEY=your_key   (request one at https://firms.modaps.eosdis.nasa.gov/api/map_key/)
    # or:         export FIRMS_MAP_KEY=your_key

| | With a MAP_KEY | Without a key |
|---|---|---|
| Source | FIRMS area API (`/api/area/csv/...`) | public global NRT files (24 h / 48 h / 7 d) |
| Products | MODIS_NRT/SP, VIIRS_SNPP_NRT/SP, VIIRS_NOAA20_NRT/SP, VIIRS_NOAA21_NRT/SP | MODIS_NRT, VIIRS_SNPP_NRT, VIIRS_NOAA20_NRT, VIIRS_NOAA21_NRT |
| Period | any date FIRMS holds, split into 5-day requests | last 7 days |

`src/hotspots/firms.py` handles limits and errors. Each request covers 1–5 days, as the FIRMS API requires. A local counter
stays under the 5,000 transactions per 10 minutes FIRMS allows. Responses are cached on disk in `data/cache/firms` (30 min
for NRT; past standard-processing data is kept). Errors name the problem without the key. Examples:

    python -m hotspots.refresh                          # latest 7 days, NRT
    python -m hotspots.refresh --start 2026-08-01 --days 7          # a past week (key needed)
    python -m hotspots.refresh --start 2026-06-01 --days 7 --sp     # standard processing (key needed)

### Server API (`python -m hotspots.server`)
| Endpoint | Returns |
|---|---|
| `GET /api/status` | key configured (yes/no only), data mode, products, bundle dates, transaction use |
| `GET /api/firms?product=VIIRS_NOAA20_NRT&bbox=w,s,e,n&days=1..5[&date=YYYY-MM-DD]` | normalized records of one product |
| `GET /api/harmonize?bbox=w,s,e,n&days=1..7[&date=][&window=180][&processing=NRT\|SP]` | MODIS + all VIIRS for the box, matched, with every source record and its status |
| `GET /api/weather?lat=&lon=&time=ISO` | modelled hourly wind (10 m, 100 m), boundary layer, cloud; CAMS PM2.5 (Open-Meteo) |
| `GET /api/route?from=lat,lon&to=lat,lon` | up to 3 driving routes (OSRM demo server, OpenStreetMap data): geometry, distance m, duration s; cached |
| `GET /api/population?bbox=w,s,e,n` | GHS-POP 2025 population on a 0.025° grid (box ≤ 30 sq deg) |

### Harmonization (v2, `src/hotspots/harmonize.py`, mirrored in `web/js/app.js`)
1. **Space:** the pixel footprints overlap. FIRMS gives scan × track in km; rectangles are oriented along the orbit (`footprint.py`).
2. **Time:** acquisition times are within the window (default 180 min, 30–360 in the Lab).
3. **Selection:** among qualifying MODIS pixels, the one closest in time wins, then the nearest centre. Each VIIRS pixel joins at most one MODIS pixel.
4. **Counting:** a MODIS pixel and its VIIRS pixels form one group, counted once. Harmonized = MODIS + VIIRS − matched VIIRS. Every source record is kept, with its own values and its group link.
5. **Strength** (rule-based, not a probability):
   - *strong*: Δt ≤ 30 min, VIIRS centre in the core of the MODIS pixel, and no rival.
   - *moderate*: Δt ≤ 30 min otherwise, or Δt ≤ 120 min with a core hit and no rival.
   - *weak*: every other pair inside the window.
6. **Ambiguous:** a second MODIS pixel qualifies with Δt within 15 min of the chosen one, so the group assignment is a rule choice.
7. **Missing ≠ zero:** a satellite with no records anywhere on a day was not observing. Its counts are shown as "no data". In the 6–13 Nov 2026 bundle, S-NPP delivered no NRT records at all.

Finding from these rules: in November 2026 Aqua passes on average about 2 h after NOAA-20/21, because of its orbit drift
(see Orbit drift below). Only 16 of 85,119 matched VIIRS pixels (180 min window) are within 30 min, so nearly all
matches are *moderate* or *weak*. The Lab shows the time-gap distribution for each satellite pair, and a match
inspector draws every footprint to scale.

### FIRELAB simulation space (`web/firelab.html`, `web/js/sim.js`, model in `web/js/firelab-core.js`)
The FIRELAB tab opens a separate, full-screen simulation page. You can also reach it from any hotspot through *Open in FIRELAB*, which links to `firelab.html?fire=HS-…`. On that page you can:
- **choose a fire:** pick a region (or fly to a place) and click any real fire on the map, or choose one from the list;
- **adjust the scenario:** vegetation type, hours burning (with **▶ Play**, hour by hour), worst case, your own wind, and the emission-factor uncertainty range;
- **compare:** pin a run as **A** and compare it with the next;
- **watch the live results:** result cards, ground PM2.5 along the plume, people under each concentration band, a wind-speed sweep, and modelled wind with CAMS PM2.5.

How the model works:
- **Wind:** modelled, from Open-Meteo best-match models; ERA5 for older dates.
- **Smoke dispersion:** a steady-state Gaussian plume. Plume-top height from FRP follows Sofiev et al. 2012, with Pasquill–Turner stability, Briggs open-country σ and a mixing-height lid.
- **PM2.5 added:** FRP × 0.368 kg/MJ (Wooster et al. 2005) × the emission factor (Akagi et al. 2011, Table 1).
- **Population under each concentration band:** GHS-POP R2023A 2025.
- **Speed:** a 200 km square around the fire is loaded once, so every setting change recomputes instantly in the browser.

The plume is an unvalidated scenario from a single satellite snapshot. It is not a measurement or forecast, and the page says so.
Build the population grid once (about 484 MB download):

    pip install -e '.[pop]'
    curl -L -o data/pop/ghs.zip https://jeodpp.jrc.ec.europa.eu/ftp/jrc-opendata/GHSL/GHS_POP_GLOBE_R2023A/GHS_POP_E2025_GLOBE_R2023A_4326_30ss/V1-0/GHS_POP_E2025_GLOBE_R2023A_4326_30ss_V1_0.zip
    cd data/pop && unzip ghs.zip '*.tif' && cd ../..
    python -m hotspots.population build data/pop/GHS_POP_E2025_GLOBE_R2023A_4326_30ss_V1_0.tif

### Rebuilding the archive summaries

    # Natural Earth ne_50m_admin_0_countries.geojson -> data/geo/countries.geojson, ne_10m_populated_places_simple.geojson -> data/geo/places.geojson
    # Yearly archives from https://firms.modaps.eosdis.nasa.gov/data/country/zips/ into data/archive, listed as "ok <file>" in data/archive/fetch.log
    python -m hotspots.archive data/archive     # monthly region totals and 1° cells
    python -m hotspots.daily data/archive       # daily per-country counts for the Activity Calendar

**Definitions.** Raw detections are FIRMS pixels. A match is a candidate relationship, not proof of one physical fire. Records are pixels, not fires.

**Limits.** Record-level data covers only the bundled recent window (or a live query). Older periods use daily or monthly archive totals. The archive's VIIRS is S-NPP only (the one satellite spanning 2012 onward), while the NRT bundle uses NOAA-20/21, so the two are not comparable. FRP is not corrected between sensors. Regions come from a 0.1° raster of Natural Earth boundaries.

## DOWNWIND: what the smoke is about to cross (`web/downwind.html`)

Turns each fire record into a short bulletin for the people who own an asset, not for an analyst. For every fire it
runs the FIRELAB plume with the modelled wind and lists the mapped assets the smoke path reaches. Region selector in the
header (or `?r=BR`): Paraguay (PY), Bolivia (BO), Argentina (AR), Brazil (BR). The choice is remembered in the browser.

- Labels: fires are observed (FIRMS), assets are mapped (OpenStreetMap), wind is modelled (Open-Meteo), the smoke
  path is a scenario. The ranking number is not a measurement.
- Each row gives a bulletin in English, Spanish or Portuguese, full or short (at most 160 characters, GSM 7-bit safe),
  that can be copied, read aloud, or shared by WhatsApp. The Spanish and Portuguese texts are fixed templates not yet
  reviewed by a native speaker. Times use the region's time zone; Brazil has several and the bulletin uses Brasilia time.
- A clock shows the last satellite look and an estimate of the next one.
- "Within 5 km but not downwind" lists what a plain distance ring would also flag.
- Wind is requested for at most 240 grid cells (0.25 degree) per computation, strongest fires first. When fires are left
  out the page says how many, and none of their assets is called "not downwind". Fetched cells are cached in sessionStorage.
- A layer that was not built for a region is a disabled tab, not an empty list.
- Not a fault, visibility or health prediction, and not an operational alert service. Rules: the Method dialog.

**Regions and layers.** One source of truth, `web/app-data/regions.json` (country name as in `meta.json`, bulletin
language, IANA time zone, map box, asset build preset), read by `web/js/regions.js`, `hotspots.assets` and `hotspots.feed`.
To add a country: add one entry there, then run the two build commands below.

| Region | Power lines | Roads | Health | Schools | Named places |
|---|---|---|---|---|---|
| Paraguay (PY) | 220 kV and above | trunk, primary | hospitals, clinics | yes | city, town, village |
| Bolivia (BO) | 220 kV and above | trunk, primary | hospitals, clinics | yes | city, town, village |
| Argentina (AR) | 220 kV and above | motorway, trunk | hospitals | not loaded | city, town |
| Brazil (BR) | 220 kV and above | motorway, trunk | hospitals | not loaded | city, town |

Argentina and Brazil are large, so their presets leave out clinics and schools; the page shows those tabs as disabled
("not loaded for this region") rather than as an empty list.

```
python -m hotspots.assets BR     # OpenStreetMap via Overpass; uses the region's preset, flags override it, e.g.
python -m hotspots.assets BR --layers power,roads,health --roads motorway,trunk --tiles 3 --cache /tmp/ov
python -m hotspots.feed BR       # the small per-region feed for My place
```

The asset file records which layers were built, with what filter, and the simplification tolerance (it is raised until
the file is under about 1.5 MB gzipped). Overpass is slow and rate limited: the builder retries with backoff on two
endpoints and, if a whole-country query keeps failing, splits the country into boxes. A layer that cannot be fetched is
left out and recorded as not built; nothing is drawn by hand. The logic is `web/js/downwind-core.js`; check it with
`node tests/test_downwind_core.mjs` and `node tests/test_regions.mjs`.

**My place** (`web/place.html`, `?r=BR`): a light page for a phone that answers "is smoke heading for this place?" from
the small feed `web/app-data/feed/<ISO>.json`, in Spanish, Portuguese or English, with the same plume rule.
Feed window per region (`feed.fire_hours` in `regions.json`): the last 72 hours of fires for PY and AR, 48 hours for BO,
24 hours for BR, which keeps each feed under 300 kB; the page states what its feed covers. The page itself only uses the
last 24 hours of fires. A secondary block "Last 3 hours, fast satellite view" is fetched after the main answer and does not
change it. "My place" is also linked from DOWNWIND and from the Explorer navigation.

**Alert load.** The wind rule does not reduce the number of flagged days (257 against 244 for a 5 km ring on 500 kV
lines in Paraguay in 2025); it changes which fires are flagged (`docs/research/alert_load_2025.md`).

**Fast look.** A third DOWNWIND tab, and a small block on My place, use INPE's 10-minute GOES-19 detection files
(South America only, about 2 km pixels, no fire power, no confidence value, more false alarms than MODIS or VIIRS, not
validated against ground reports; detection time was a median of 20 minutes before the file time stamp in one
measurement). No plume is run: rows are assets downwind of a pixel by the modelled wind, ranked by number of scans.
Module `web/js/fast-core.js`, notes `docs/research/fast_detections.md`, check `node tests/test_fast_core.mjs`.

Replay of a real event (Paraguay only, from any region): `node scripts/replay_line_trip.mjs` reruns the 8 January 2025
trip of a 500 kV line that ANDE attributed to smoke. Result and limits: `docs/research/replay_2025-01-08.md`. On the
page: `downwind.html?replay`.

## Look and walkthrough video

The default look is the Paper theme (`web/css/play.css`): cream background, ink outlines, large headline numbers and solid data labels, so the data reads at a glance. The dark theme is one tap away and is remembered.

`docs/video/fireverse-roles-walkthrough.mp4` is a 4.7-minute walkthrough with six story characters, one per role, each with an avatar and their own neural voice: Ana (fire brigade), Diego (grid), Marco (road patrol, including the smoke-aware route planner), Lucía (clinic), Rosa (farmer) and Arjun (analyst: Explorer, Harmonization Lab, FIRELAB, DOWNWIND). Rebuild it with `node scripts/video/record.mjs` (Chrome, ffmpeg, `pip install edge-tts`, network for the voices, and the server on port 8000). Voiced lines are cached in `data/cache/voice/`. Every number on its tiles is read from the app while recording.

## Smoke-aware route planner (`web/route.html`)

Pick a start and an end (search the feed's named places, use your location when you press the button, or click the map), a departure (now, +1 h, +2 h, +3 h), and press Compare routes. Or press Try an example: it finds the main road with the strongest modelled smoke crossing in the current data and takes the named places near its two ends (at least 20 km apart); if nothing qualifies it says so.

| Step | Source | Label |
|---|---|---|
| Fires: last 24 h of the light feed, clustered at 1.5 km, 5 MW or more | NASA FIRMS | OBSERVED |
| Up to 3 driving routes | OSRM demo server, OpenStreetMap data, through `GET /api/route` (cached, 1 request a second) or directly on a static host | MAPPED |
| Wind for the travel hours | Open-Meteo, through the wind cache | MODELLED |
| Smoke at each km (every ~1 km, at the arrival time there), summed over the fires within 25 km of the route | the DOWNWIND/FIRELAB Gaussian plume, each fire held at its observed power for the whole trip | SCENARIO |

Per route: km in modelled smoke (1 µg/m³ or more), peak µg/m³, smoke-minutes, and where the smoke starts (km and clock time). Routes rank by least smoke-minutes, then least peak, then shortest time. A fire with no modelled wind is "not assessed", never "clear"; with no fire data at all every route is "not assessed". No detection does not mean no fire.

Beyond the comparison (all in `web/js/route-core.js`, pure and tested in Node):

- **Detour.** When the best route still meets modelled smoke, via-points are placed 8, 15 and 25 km to each side of the first smoke stretch, upwind side first, and routed through `GET /api/route` with `via=`. At most six are tried. A detour is kept only if it cuts smoke-minutes by half or more and adds no more than 45 minutes or 60% of the trip, whichever is less. It shows as "Route D (detour)"; if none qualifies the page says so.
- **Directions.** Turn-by-turn steps for the chosen route in English, Spanish and Portuguese, with the smoke warning on the step where smoke starts.
- **Drive.** Start drive follows the device's GPS along the route when location is granted and within 2 km of it, and re-assesses every 10 minutes. Simulate the drive moves a marker along the route and is labelled a simulation in the panel, on the map and in every spoken line. Alerts are spoken once each at 5 km and 1 km before a smoke stretch, on entering and on leaving it. It is not an emergency navigation system.
- **Best time to leave.** The same routes assessed for leaving now, +1 h, +2 h and +3 h, with the wind of each hour and no new routing requests.

Hand-off: a Google Maps directions link (origin, destination and up to 8 waypoints along the route; opens only when clicked; Google may adjust the path between points) and a GeoJSON download (one LineString per route with its numbers, plus the in-smoke stretches), which a map provider could ingest to show smoke ahead on a route. `GET /api/route?from=lat,lon&to=lat,lon` validates input, keeps answers in memory and under `data/cache/route/` (git-ignored) and calls the OSRM demo server at most once a second; the demo server is for light use. Tests: `tests/unit/route-core.test.mjs`, `tests/test_route_api.py`, `tests/e2e/route.spec.mjs`.

## Wind cache

With the Python server running, DOWNWIND and the role pages ask `api/wind` for modelled wind. The server fetches each quarter-degree cell from Open-Meteo once and keeps it in `data/cache/wind/` (git-ignored), so repeat visits do not spend the free service's quota. On a static host the pages ask Open-Meteo directly, as before.

## Roles: who the platform is for (`web/start.html`, `web/role.html`)

The front door (`/`) is a role picker: seven cards dealt from a deck (fire brigade, grid operator, road patrol, driver, clinic or school lead, resident or farmer, analyst). The analyst opens the full Hot Spot Explorer (`index.html`) and the driver opens the route planner (`route.html?role=driver`); the other five open `role.html?role=<id>&r=<ISO>`, one simplified page on a shared engine. The role is `?role=`, the region `?r=` (else the last region used, else PY); an unknown role goes back to `start.html`.

| role | what the page shows |
|---|---|
| `grid` | power lines with modelled smoke upwind (last 24 h of data, 5 MW and up), a bulletin for crews, and the 10-minute fast look as a secondary block |
| `road` | road stretches in the smoke path, the SMS-length bulletin first, read aloud |
| `firefighter` | pick a base by name or on request by device location, then the fires within 50 km ranked by power, each with wind, where the smoke heads and the mapped assets in its path |
| `care` | one clinic, school or town and one answer (the My place logic), share by WhatsApp |
| `resident` | the same single-place answer for a town or device location |

Items are cards that turn over to show their bulletin (full or 160-character SMS form, copy, read aloud, WhatsApp link) in English, Spanish and Portuguese (Spanish and Portuguese are fixed templates not reviewed by a native speaker). A **shift briefing** has three steps (check the satellite clock, review up to three top items, copy or send a bulletin); on a day with nothing in the path, reading the statement and copying the all-clear line replace steps 2 and 3. It is stored in `localStorage` per role and region, marks today on a 7-day strip, and records only what the person did: no points, levels, badges or scores. An all-clear is offered only when everything was assessed; if the wind or the data could not be loaded the page says so and offers a "not assessed" line instead.

Architecture (plain scripts that attach one global and also load in Node via `vm`; no build step):

- `js/roles.js` the seven roles as data; `js/role-config.js` what each role page shows and says (three languages);
- `js/watch-core.js` asset preparation, wind cache with an injectable fetch, the watch-list computation and the fast look, shared by DOWNWIND and the role pages;
- `js/bulletin-core.js` every bulletin text (full and short, EN/ES/PT), the region passed in;
- `js/role-core.js` the role pages' data logic; `js/briefing-core.js` the briefing rules; `js/place.js` (logic only on `role.html`) the single-place answer;
- `js/start.js`, `js/role.js` behaviour; `css/start.css`, `css/role.css` presentation.

Role pages read the light feed (`app-data/feed/<ISO>.json`) and the asset file (`app-data/assets/<ISO>.json.gz`), never the 10 MB record bundle.

Tests: `npm test` runs the unit tests (`node --test`, offline fixtures) and the end-to-end tests (`tests/e2e/start.spec.mjs`, `tests/e2e/role.spec.mjs`) in the Chrome installed on the machine (see `tests/e2e/README.md`). The wind and INPE services are stubbed in the role tests (`tests/e2e/stubs.mjs`).

## Data
NRT CSVs are at https://firms.modaps.eosdis.nasa.gov/active_fire/.

## Dev
    python3 -m venv .venv && source .venv/bin/activate
    pip install -e '.[dev]' && pytest

## Run on real data
    mkdir -p data && cd data
    B=https://firms.modaps.eosdis.nasa.gov/data/active_fire
    curl -O $B/modis-c6.1/csv/MODIS_C6_1_Global_24h.csv
    curl -O $B/suomi-npp-viirs-c2/csv/SUOMI_VIIRS_C2_Global_24h.csv
    cd .. && python -m hotspots.cli data/MODIS_C6_1_Global_24h.csv data/SUOMI_VIIRS_C2_Global_24h.csv data/harmonized.csv

NOAA-20/21 CSVs: `noaa-20-viirs-c2/csv/J1_VIIRS_C2_Global_24h.csv`, `noaa-21-viirs-c2/csv/J2_VIIRS_C2_Global_24h.csv`.
`python -m hotspots.map data/harmonized.csv data/map.html` writes an interactive map.
Note: FIRMS `scan`/`track` are already pixel sizes in km.

## Results (FIRMS global 24h, 2026-10-31/11-01; MODIS Aqua+Terra 13,846 px, VIIRS S-NPP+NOAA-20+NOAA-21 236,006 px)
All numbers below come from `python -m hotspots.cli|analyze|regional|report` (run inside `data/`).

**Footprint matching** (`hotspots.footprint`, `hotspots.match`): a VIIRS pixel matches a MODIS pixel when
their oriented rectangles (along-scan `scan` km x along-track `track` km) overlap; among overlapping candidates
the closest in time wins. FIRMS has no pixel orientation, so the along-track direction is approximated by the
ground-track heading of a 98.2 deg sun-synchronous orbit (orbit leg from satellite + day/night flag, Earth-rotation
corrected); unknown satellites fall back to axis-aligned rectangles in local ENU. Bow-tie overlap and the
triangular MODIS response are ignored, and the day/night flag can pick the wrong orbit leg near the poles.
Sanity check: at dt<=30 min the heading-oriented rectangles give 83 matches vs 81 axis-aligned, 77 rotated 45 deg
and 74 rotated 90 deg (small n, but the expected order).

**Time-window sensitivity** (S-NPP only, VIIRS rows matched / log10-FRP corr): 15 min -> 0, 30 -> 33 / 0.82,
60 -> 424 / 0.42, 120 -> 3,669 / 0.37, 180 -> 8,026 / 0.44. Near-simultaneous overpasses are rare, so most
"both" matches at >= 60 min are different overpasses of an evolving fire. At 180 min: 8,026 both / 68,323
VIIRS-only / 10,970 MODIS-only; median VIIRS-sum / MODIS FRP 1.50.

**Regional** (all 3 VIIRS, 60 min; log-FRP corr / median VIIRS-sum / MODIS, VIIRS rows matched): North America
0.89 / 1.39 (52), Oceania 0.62 / 1.33 (65), South America 0.49 / 1.11 (246), Asia 0.42 / 0.92 (223),
Africa 0.08 / 0.78 (206). Boxes are coarse; VIIRS FRP is now summed per (MODIS pixel, VIIRS satellite) so
different VIIRS satellites are never added together.

**FRP harmonization** (`hotspots.frp`): Theil-Sen fit of log10(VIIRS FRP summed over the MODIS footprint) on
log10(MODIS FRP), using only near-coincident pairs (dt <= 30 min): **n = 25** (MODIS pixel x VIIRS satellite, all Aqua).
Slope 1.28 (95% CI 0.85-1.64; Huber 1.29), intercept -0.36, robust scatter 0.37 dex (a factor of ~2.3),
Spearman 0.81, median ratio 0.91. Leave-one-out median |error|: free-slope 0.33 dex, constant-ratio 0.32 dex,
**no correction 0.28 dex** -- with this little data the fit does *not* beat using MODIS FRP as-is; the data are
consistent with a 1:1 relation within large scatter. `harmonized_frp(frp, sensor, model)` maps MODIS onto the
VIIRS-equivalent scale with a +/-1 sigma log-normal interval (e.g. 50 MW -> 66 MW, 28-154 MW); VIIRS passes through.
By group (n, slope, scatter): day 20 / 1.21 / 0.29 dex; night 5 / undetermined; Asia 17 / 1.34 / 0.50;
North America 5 / 1.20 / 0.09; Africa 3 (too few); MODIS nominal conf 22 / 1.27, high 3; S-NPP 8 / 1.30,
NOAA-20 12 / 1.41, NOAA-21 5 / 0.61 (CI unbounded). Groups with n <= 8 are not meaningful. Caveats: regression
dilution (MODIS FRP is noisy), fires still change within 30 min, VIIRS pixels in overlapping MODIS pixels count once.

**Confidence** (`hotspots.confidence`): unified 0-1 score = MODIS conf/100; VIIRS low/nominal/high -> 0.15/0.55/0.90
(midpoints of the MODIS class ranges); events seen by both combine as 1-(1-p_m)(1-p_v) (assumes independence --
optimistic). Empirical check on 83 coincident matches: median MODIS score is 0.57 for VIIRS nominal (n=69, matches
0.55) and 0.57 for VIIRS low (n=13; VIIRS "low" is mostly a sun-glint/weak-anomaly flag, not a weaker fire);
VIIRS high n=1. Mean unified score: both 0.79, MODIS-only 0.66, VIIRS-only 0.51.

**Why MODIS misses small fires** (`hotspots.detection`): each sensor's 5th-percentile FRP (a proxy for its
detection floor) grows with pixel area. MODIS day: 5.3 MW (<=1.5 km^2, n=6,518), 8.2 (1.5-3), 15.9 (3-6),
27.4 MW (>6 km^2); night similar (4.2 -> 28.3). VIIRS (0.14-0.62 km^2): 2.1-4.4 MW day, 0.5-1.1 MW night.
34% of daytime and 87% of night-time VIIRS pixels have FRP < 5 MW, i.e. below MODIS's best-case floor.
A direct detection-probability estimate (VIIRS fires within 10 km of a MODIS detection from the same overpass,
dt <= 30 min) has only n = 130 (64% detected by MODIS); a logistic fit P = f(log FRP, log area) gives coefficients
+1.95 (FRP) and -4.08 (area): 50% detection at ~1.6 MW for a 1 km^2 pixel vs ~29 MW for 4 km^2. These numbers
shift a lot with the neighbourhood radius (5 km: 20 MW; 50 km: 61 MW at 4 km^2, since VIIRS's wider swath leaks
in), so treat them as qualitative support for the pixel-size effect, not calibrated thresholds.

## Classic explorer (`web/explorer.html`)
Region (presets, lat/lon boxes, or "use map view") + date range; metric = harmonized events / MODIS / VIIRS.
Shows a map, an activity calendar (day grid now, month × year once ≥ 2 years are loaded), a daily
anomaly chart vs the median of the selected days, a sensor comparison, and CSV downloads (daily counts, 1° cells).
Build data: `python web/build_data.py web/data.json modis.csv viirs.csv [more viirs.csv]`, serve with
`cd web && python3 -m http.server`. Checked in a real browser (Playwright): renders, presets filter correctly.
Limits: current data is 8 days (FIRMS 7-day files), so the "historical median" is a median over those days, not
a multi-year climatology; the CSV downloads are per-cell counts, not individual hotspot rows. This is the older page; multi-year history is in `web/index.html`.

## Does an FRP floor close the count gap? (`python -m hotspots.floor modis.csv viirs.csv --drop-after DATE`)
FRP summed per 0.05 deg cell / satellite / day / day-night before flooring; 26 Oct-1 Nov 2026, global.
Floor (MW) 0 / 5 / 10 / 20 / 50 / 100: NOAA-20 / Aqua 5.45, 3.23, 2.60, 2.31, 2.11, 2.02; NOAA-20 / Terra 10.94, 6.71, 5.73, 5.15,
4.85, 4.41; Aqua / Terra 2.01, 2.08, 2.20, 2.23, 2.30, 2.18. The VIIRS ratio levels off instead of reaching 1, and two identical
MODIS instruments differ by about 2x. Cause not established; overpass time is untested. Similar at 0.1 and 0.25 deg grids.
A per-pixel floor (ratio 1.08 at 20 MW, reported in an earlier commit) is invalid because VIIRS splits one fire across pixels.
NOAA-20 pixels with no same-day MODIS overlap: 82% with no buffer, 73% with 1 km, 60% with 5 km; this is not the fire MODIS cannot see.
Explorer "combined detections" counts pixels, not fires, and is not deduplicated across VIIRS satellites.

## Overpass time (`python -m hotspots.overpass modis.csv n20.csv n21.csv --drop-after DATE`)
26 Oct-1 Nov 2026, global, cells with summed FRP >= 20 MW at 0.05 deg. Median local solar hour day / night: Aqua 15.7 / 3.8, Terra 8.7 / 20.6,
NOAA-20 13.5 / 1.5, NOAA-21 13.4 / 1.4. Ratios day / night: Aqua/Terra 4.89 / 0.23; NOAA-20/Aqua 2.27 / 2.84; NOAA-20/Terra 11.11 / 0.65;
control NOAA-20/NOAA-21 0.84 / 0.86 (raw pixels 1.00 / 1.06). Aqua/Terra flips in all six regions (day 2.18-8.06, night 0.13-0.80).
A simply weaker Terra cannot produce the flip. Not shown: separation of the fire diurnal cycle from other time-of-day effects, or any trend
artefact from orbit drift, which needs multi-year data.

## Leave-one-satellite-out test (`python -m hotspots.latent modis.csv n20.csv n21.csv --drop-after DATE`)
Criteria, result and limits: `docs/research/preregistration_loso.md`; full output: `docs/research/loso_results.txt`; design survey: `docs/research/novel_architectures.md`.
Trained without Terra, the model beats all baselines on Terra (deviance day 0.742 vs 1.063, night 0.902 vs 1.123). Reduced GLM, one week, not blind.

## Orbit drift (`python -m hotspots.drift data/archive docs/research/modis_drift.csv`)
Median local time of daytime detections, measured from the FIRMS MODIS archive: Aqua 13.5 h and Terra 10.6 h held steady from 2003 to about 2021, then moved to 14.7 h and 9.6 h by 2025.
Aqua/Terra pixels: day ratio 2.2-2.5 over 2003-2021, then 2.58, 2.75, 3.41, 3.89 for 2022-2025; night ratio 0.45-0.50, then down to 0.34. Both satellites have data every day of the years checked (2021, 2024, 2025).
Applying the daily cycle fitted earlier on one week of 2026 with Terra held out, with no refit, gives a change from the 2003-2020 mean to 2025 of x1.55 by day (observed x1.64) and x0.63 by night (observed x0.70).
Limits: the model's level is about 20% low by day; the fit used cells >= 20 MW while this table counts all pixels; agreement over time rests on the few years when orbits moved; the author saw this table before comparing. Terra's sensor ageing and changes in where fires burn are not ruled out, and this is not yet a corrected record.

## VIIRS control (`python -m hotspots.drift_control data/archive docs/research/viirs_control.csv`)
Rules were committed first (`docs/research/preregistration_viirs_control.md`); full results and limits are in `docs/research/viirs_control_results.md`.
2025 against 2013-2020, vegetation fires, same countries and months: Terra/S-NPP is x0.61 by day (model x0.69) and x1.33 at night (model x1.51), and S-NPP's local hour moved under 0.25 h. All five checks passed.
The MODIS data version changes in 2023 as the drift speeds up, so that year's step cannot be separated from it. Within the one version, 2023-2025, the day ratio still falls x0.73 (model x0.79).
Own method: MODIS pixels matched fell from 44.3% (2021) to 31.9% (2025), and Harmonized / S-NPP rose from 92.0% to 100.6%. A 300 minute window barely changes that rise (88.5% to 96.4%), and Aqua's matches fall too, cause not established. Harmonized counts after about 2021 are not comparable with earlier years.
