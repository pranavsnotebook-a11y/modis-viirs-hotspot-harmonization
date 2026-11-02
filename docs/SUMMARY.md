# One Fire Record — project summary

**Problem.** MODIS (1 km, 2000+) and VIIRS (375 m, 2012+) report fires differently. Raw counts jump when VIIRS
arrives, so "fires doubled" can be a sensor artefact. People who rely on the record (health officers, responders,
journalists) cannot tell real change from sensor change.

**Key result (measured, FIRMS global, 26 Oct-1 Nov 2026, one satellite vs one satellite).** Summing FRP per 0.05 deg cell
before applying a floor (so one fire split across many VIIRS pixels is not penalized), NOAA-20 / Aqua falls from 5.45x with
no floor to 2.31x at 20 MW and 2.02x at 100 MW. It levels off near 2x and does not reach 1. So a detection floor explains
a large part of the gap but not all of it. Two identical MODIS instruments also disagree: Aqua / Terra is 2.0-2.3x at every
floor, which instrument resolution cannot explain.

**Overpass time is a large effect (`python -m hotspots.overpass`).** Median local solar time measured from the data: Aqua 15.7 h day /
3.8 h night, Terra 8.7 h / 20.6 h, NOAA-20 and NOAA-21 13.5 h / 1.5 h. Cells with at least 20 MW: Aqua / Terra is 4.89 by day and 0.23
at night, flipping in all six regions, which a simply weaker Terra cannot produce. At night, 1 km Terra at 20.6 h finds more such cells than
375 m NOAA-20 at 01:30 (NOAA-20 / Terra 0.65). Control: NOAA-20 / NOAA-21 is 0.84-0.86 at this floor (1.00-1.06 in raw pixels), so about
15% is this method's own noise. One week only; the fire diurnal cycle is the likely cause, but this does not separate it from other
time-of-day effects, and it does not yet show a trend artefact from orbit drift.
A per-pixel FRP floor is not a valid test (an earlier version of this project reported 1.08x at 20 MW that way; withdrawn).

**Supporting analysis.** Footprint-overlap matching of MODIS and VIIRS pixels (8,026 matched / 68,323 VIIRS-only /
10,970 MODIS-only at a 180 min window; most matches are different overpasses). The smallest daytime fire MODIS reports
grows with pixel size (5.3 MW for pixels <=1.5 km2 to 27.4 MW for >6 km2). A robust FRP fit on only 25 near-coincident
pairs does not beat leaving MODIS FRP unchanged, so we do not claim a validated FRP correction.

**One engine, three uses** (proposals in `docs/ideas/`):
1. **Fire Claim Checker** — tests a trend claim against sensor artefacts (verdict + uncertainty).
2. **Invisible Burn Ledger** — share of a district's burning a MODIS-only record misses. Not yet measurable as stated: 60-82% of NOAA-20 pixels have no same-day MODIS overlap, depending on matching distance, and that also reflects overpass timing and cloud.
3. **Satellite Look Ledger** — when a blank map means "unknown", not "clear".

**Built.** Pipeline (`src/hotspots`), Explorer web app with region/date selection, calendar, anomaly view and CSV
download (`web/explorer.html`, 8 days of data), 10 tests.

**Not yet.** Multi-year history (needs FIRMS MAP_KEY or archive downloads), external validation against fire
perimeters/burned area, validated FRP harmonization.
