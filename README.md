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
