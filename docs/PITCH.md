# 5-Minute Pitch: Harmonization of MODIS and VIIRS Hot Spots

## 1. Problem (0:00-0:45)
- MODIS (1 km) and VIIRS (375 m) both report active fires, but with different resolutions, schemas, confidence scales and overpass times.
- Responders and researchers see two overlapping, inconsistent feeds. The same fire can appear as one MODIS pixel and many VIIRS pixels.

## 2. Approach (0:45-1:45)
Pipeline (package `hotspots`): **load** FIRMS CSVs -> **normalize** to one schema (sensor, lat/lon, UTC time, FRP in MW, confidence class low/nominal/high, footprint from scan/track in km) -> **match** across sensors within a spatial footprint plus a time window -> **merge** into harmonized events (best location from VIIRS, combined FRP, agreement flag, `detected_by` = modis / viirs / both).

## 3. Results (1:45-3:15) - global 24 h, 2026-10-31
- 5,917 events seen by both sensors, 70,432 VIIRS-only, 11,494 MODIS-only.
- Log10 FRP correlation 0.53; median (VIIRS-sum / MODIS) FRP ratio 1.23 (180 min window).
- Window sensitivity (matches / log10-FRP corr): 30 min 31 / 0.75; 60 min 369 / 0.41; 120 min 2,737 / 0.44; 180 min 5,917 / 0.53.
- Near-simultaneous matches by VIIRS satellite (30 min window): S-NPP 31 (0.75), NOAA-20 29 (0.74), NOAA-21 11 (0.83).
- Regional (60 min, all 3 VIIRS sats), corr / median ratio: North America 0.82 / 1.77 (n=38), Oceania 0.57 / 1.39, South America 0.46 / 0.98, Asia 0.42 / 0.97, Africa -0.04 / 0.90 (n=200).
- Demo: dashboard in `web/` (map layers by detection source, FRP histogram per sensor, counts) and `python -m hotspots.map`.

## 4. Impact for wildfire response (3:15-4:00)
- One consistent product instead of two feeds; VIIRS 375 m location with MODIS cross-check.
- "Both" flag gives a cross-sensor confirmation signal; single-sensor detections can be prioritized or triaged.
- Combined revisit: more looks per day at the same fire, useful for tracking evolution.

## 5. Limitations (4:00-4:40) - be upfront
- Only a few pairs are near-simultaneous (Aqua and S-NPP both cross ~13:30 local); most "both" matches at 180 min are different overpasses of an evolving fire, so FRP agreement is weak (corr 0.53).
- Regional boxes are coarse; several regions have small n (e.g. North America n=38) and Africa shows no correlation (-0.04).
- Single 24 h snapshot; no ground-truth validation (no perimeter or agency data); window choice is a trade-off between match count and FRP agreement.
- Not validated for false alarms (gas flares, volcanoes etc.).

## 6. Next steps (4:40-5:00)
Validate against reference fire perimeters; multi-day runs; adaptive time windows; cross-sensor FRP calibration; add GOES geostationary data for time continuity; live-updating dashboard.
