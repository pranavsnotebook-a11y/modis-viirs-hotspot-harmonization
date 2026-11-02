# One Fire Record — project summary

**Problem.** MODIS (1 km, 2000+) and VIIRS (375 m, 2012+) report fires differently. Raw counts jump when VIIRS
arrives, so "fires doubled" can be a sensor artefact. People who rely on the record (health officers, responders,
journalists) cannot tell real change from sensor change.

**Key result (measured, FIRMS global, 26 Oct–1 Nov 2026, NOAA-20 vs Terra+Aqua).** NOAA-20 VIIRS reports **5.6x** as
many detections as MODIS. Counting only detections above a common FRP floor shrinks the ratio: 2.9x at 5 MW, 1.7x at
10 MW, **1.08x at 20 MW**. So most of the raw gap is a detection-sensitivity effect, not extra fire. Above 50 MW the
ratio is 0.70; we have not explained that (possible causes: large fires split across several VIIRS pixels, saturation).
Caveat: one week of data, FRP is not identically defined on both sensors, MODIS is two satellites vs one VIIRS.

**Supporting analysis.** Footprint-overlap matching of MODIS and VIIRS pixels (8,026 matched / 68,323 VIIRS-only /
10,970 MODIS-only at a 180 min window; most matches are different overpasses). The smallest daytime fire MODIS reports
grows with pixel size (5.3 MW for pixels <=1.5 km2 to 27.4 MW for >6 km2). A robust FRP fit on only 25 near-coincident
pairs does not beat leaving MODIS FRP unchanged, so we do not claim a validated FRP correction.

**One engine, three uses** (proposals in `docs/ideas/`):
1. **Fire Claim Checker** — tests a trend claim against sensor artefacts (verdict + uncertainty).
2. **Invisible Burn Ledger** — share of a district's burning that a MODIS-only record never saw.
3. **Satellite Look Ledger** — when a blank map means "unknown", not "clear".

**Built.** Pipeline (`src/hotspots`), Explorer web app with region/date selection, calendar, anomaly view and CSV
download (`web/explorer.html`, 8 days of data), 10 tests.

**Not yet.** Multi-year history (needs FIRMS MAP_KEY or archive downloads), external validation against fire
perimeters/burned area, validated FRP harmonization.
