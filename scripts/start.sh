#!/usr/bin/env bash
# Start the Hot Spot Explorer (used by Codespaces; works anywhere). The site starts at once; the FIRELAB population
# grid builds in the background the first time and is picked up automatically when ready.
cd "$(dirname "$0")/.."
python -c "import hotspots.server" 2>/dev/null || pip install -q -e '.[dev,pop]'
if [ ! -f data/pop/ghs_pop_2025_0025deg.npy ]; then
  nohup bash scripts/setup_population.sh > /tmp/population.log 2>&1 &
  echo "Population grid is building in the background (log: /tmp/population.log)."
fi
exec python -m hotspots.server --host "${HOST:-0.0.0.0}" --port "${PORT:-8000}"
