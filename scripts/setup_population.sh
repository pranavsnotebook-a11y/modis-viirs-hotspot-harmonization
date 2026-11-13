#!/usr/bin/env bash
# One-time download (about 484 MB) and build of the GHS-POP 2025 grid used by FIRELAB. Safe to re-run.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p data/pop
[ -f data/pop/ghs_pop_2025_0025deg.npy ] && { echo "population grid already built"; exit 0; }
URL=https://jeodpp.jrc.ec.europa.eu/ftp/jrc-opendata/GHSL/GHS_POP_GLOBE_R2023A/GHS_POP_E2025_GLOBE_R2023A_4326_30ss/V1-0/GHS_POP_E2025_GLOBE_R2023A_4326_30ss_V1_0.zip
curl -sSL -o data/pop/ghs.zip "$URL"
(cd data/pop && unzip -o -q ghs.zip 'GHS_POP_E2025_GLOBE_R2023A_4326_30ss_V1_0.tif')
python -m hotspots.population build data/pop/GHS_POP_E2025_GLOBE_R2023A_4326_30ss_V1_0.tif
rm -f data/pop/ghs.zip data/pop/GHS_POP_E2025_GLOBE_R2023A_4326_30ss_V1_0.tif
echo "population grid ready"
