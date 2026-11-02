# Harmonization of MODIS and VIIRS Hot Spots

NASA Space Apps challenge project. MODIS (1 km) and VIIRS (375 m) both report active
fire detections, but with different resolutions, schemas, confidence scales and
overpass times. This project merges them into one consistent hot-spot product.

## Pipeline
1. **Load** FIRMS CSV downloads (MODIS C6.1, VIIRS S-NPP / NOAA-20 375 m) — `hotspots.io`
2. **Normalize** to a common schema: sensor, lat/lon, UTC time, FRP (MW), confidence class
   (low/nominal/high), footprint size from scan/track — `hotspots.schema`
3. **Match** detections across sensors by oriented-rectangle footprint overlap + time window —
   `hotspots.match`, `hotspots.footprint`
4. **Merge** matched groups into harmonized fire events (best location from VIIRS,
   combined FRP, agreement flag, unified confidence) — `hotspots.merge`, `hotspots.confidence`
5. **FRP harmonization** and **detection-probability** analysis — `hotspots.frp`, `hotspots.detection`,
   report via `python -m hotspots.report modis.csv viirs*.csv`

## Data
Get CSVs from https://firms.modaps.eosdis.nasa.gov/active_fire/ into `data/`.

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

## Hot Spot Explorer (`web/explorer.html`)
Region (presets, lat/lon boxes, or "use map view") + date range; metric = harmonized events / MODIS / VIIRS.
Shows a map, an activity calendar (day grid now, month × year once ≥ 2 years are loaded), a daily
anomaly chart vs the median of the selected days, a sensor comparison, and CSV downloads (daily counts, 1° cells).
Build data: `python web/build_data.py web/data.json modis.csv viirs.csv [more viirs.csv]`, serve with
`cd web && python3 -m http.server`. Checked in a real browser (Playwright): renders, presets filter correctly.
Limits: current data is 8 days (FIRMS 7-day files), so the "historical median" is a median over those days, not
a multi-year climatology; the CSV downloads are per-cell counts, not individual hotspot rows. A MAP_KEY-based
multi-year build would fill in the real calendar and anomalies with the same script.

## Does an FRP floor close the count gap? (`python -m hotspots.floor modis.csv viirs.csv --drop-after DATE`)
FRP summed per 0.05 deg cell / satellite / day / day-night before flooring; 26 Oct-1 Nov 2026, global.
Floor (MW) 0 / 5 / 10 / 20 / 50 / 100: NOAA-20 / Aqua 5.45, 3.23, 2.60, 2.31, 2.11, 2.02; NOAA-20 / Terra 10.94, 6.71, 5.73, 5.15,
4.85, 4.41; Aqua / Terra 2.01, 2.08, 2.20, 2.23, 2.30, 2.18. The VIIRS ratio levels off instead of reaching 1, and two identical
MODIS instruments differ by about 2x. Cause not established; overpass time is untested. Similar at 0.1 and 0.25 deg grids.
A per-pixel floor (ratio 1.08 at 20 MW, reported in an earlier commit) is invalid because VIIRS splits one fire across pixels.
NOAA-20 pixels with no same-day MODIS overlap: 82% with no buffer, 73% with 1 km, 60% with 5 km; this is not the fire MODIS cannot see.
Explorer "combined detections" counts pixels, not fires, and is not deduplicated across VIIRS satellites.
