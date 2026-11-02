"""Build web/data.json: per-day, per-1deg-cell counts for MODIS, VIIRS and harmonized events.
usage: python web/build_data.py OUT.json MODIS.csv VIIRS.csv [VIIRS.csv ...]
Data-agnostic: any number of days; a longer FIRMS history gives the multi-year calendar."""
import json, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
import numpy as np, pandas as pd
from hotspots.io import load_firms
from hotspots.merge import harmonize


def cell(df):
    return np.floor(df.latitude).astype(int), np.floor(df.longitude).astype(int)


def main(out, modis_path, *viirs_paths):
    m = load_firms(modis_path, "MODIS")
    v = pd.concat([load_firms(p, "VIIRS") for p in viirs_paths], ignore_index=True)
    v = v.drop_duplicates(["latitude", "longitude", "time"]).reset_index(drop=True)
    m["day"], v["day"] = m.time.dt.strftime("%Y-%m-%d"), v.time.dt.strftime("%Y-%m-%d")
    days = sorted(set(m.day) | set(v.day))
    rows = {}
    def add(df, key):
        la, lo = cell(df)
        for d, a, b in zip(df.day, la, lo):
            rows.setdefault((d, a, b), [0, 0, 0])[key] += 1
    add(m, 0); add(v, 1)
    for d in days:  # per-day matching keeps the k-nearest search from mixing days
        out_d = harmonize(m[m.day == d], v[v.day == d], max_dt_min=60)
        out_d["day"] = d
        add(out_d, 2)
    cells = [[days.index(d), a, b, *c] for (d, a, b), c in sorted(rows.items())]
    json.dump({"days": days, "cols": ["day", "lat", "lon", "modis", "viirs", "events"],
               "cells": cells, "window_min": 60,
               "note": "events = deduplicated MODIS+VIIRS detections (matched pairs counted once)"},
              open(out, "w"), separators=(",", ":"))
    print(len(days), "days,", len(cells), "cells ->", out)


if __name__ == "__main__":
    main(*sys.argv[1:])
