# Harmonization of MODIS and VIIRS Hot Spots

NASA Space Apps challenge project. MODIS (1 km) and VIIRS (375 m) both report active
fire detections, but with different resolutions, schemas, confidence scales and
overpass times. This project merges them into one consistent hot-spot product.

## Pipeline
1. **Load** FIRMS CSV downloads (MODIS C6.1, VIIRS S-NPP / NOAA-20 375 m) — `hotspots.io`
2. **Normalize** to a common schema: sensor, lat/lon, UTC time, FRP (MW), confidence class
   (low/nominal/high), footprint size from scan/track — `hotspots.schema`
3. **Match** detections across sensors within a spatial footprint + time window — `hotspots.match`
4. **Merge** matched groups into harmonized fire events (best location from VIIRS,
   combined FRP, agreement flag) — `hotspots.merge`

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

First result (global 24h, 2026-10-31): 5,917 events seen by both sensors, 70,432 VIIRS-only,
11,494 MODIS-only; log10 FRP correlation 0.53, median VIIRS-sum/MODIS FRP ratio 1.23.
Note: FIRMS `scan`/`track` are already in km.

## Time-window sensitivity (`python -m hotspots.analyze modis.csv viirs.csv`)
Matches / log10-FRP correlation: 30 min → 31 / 0.75, 60 → 369 / 0.41, 120 → 2,737 / 0.44,
180 → 5,917 / 0.53. Only a few pairs are near-simultaneous (Aqua and S-NPP both cross ~13:30
local), so most "both" matches are different overpasses of the same fire (fire evolves).
