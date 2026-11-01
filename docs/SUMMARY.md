# Project Summary: Harmonization of MODIS and VIIRS Hot Spots

**Challenge:** NASA Space Apps - merge MODIS (1 km) and VIIRS (375 m) active-fire detections into one consistent hot-spot product.

**What we built:** A Python package (`hotspots`) that loads FIRMS CSVs, normalizes them to a common schema (sensor, lat/lon, UTC time, FRP in MW, low/nominal/high confidence, footprint size in km), matches detections across sensors by footprint and time window, and merges them into events labelled `modis`, `viirs` or `both`. Extras: time-window and regional analyses, an interactive HTML map, and a static dashboard (`web/`) with source layers, per-sensor FRP histogram and counts.

**Results (global 24 h, 2026-10-31):** 5,917 events detected by both sensors, 70,432 VIIRS-only, 11,494 MODIS-only. Log10 FRP correlation 0.53 with a median VIIRS-sum/MODIS FRP ratio of 1.23 at a 180 min window. Tightening the window raises agreement but sharply cuts matches (30 min: 31 matches, r=0.75; 60 min: 369, r=0.41; 120 min: 2,737, r=0.44). Regional correlations range from 0.82 (North America, n=38) to -0.04 (Africa, n=200).

**Value:** A single, comparable view of fire activity with cross-sensor confirmation and VIIRS-grade location, helping responders and analysts avoid reconciling two feeds by hand.

**Caveats:** Few detections are truly simultaneous; most "both" matches are different overpasses of an evolving fire. Regional boxes are coarse and some samples are small. One day of data, no ground-truth validation.

**Next:** validate against fire perimeters, run multi-day, adaptive windows, FRP calibration, add geostationary data.

**Run:** see README (`python -m hotspots.cli ...`; `python3 web/build_sample.py && cd web && python3 -m http.server`).
