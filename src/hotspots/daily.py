"""Daily detection counts per country from the FIRMS yearly archives, for the Activity Calendar. Real data only.

Uses the same matching as hotspots.archive (MODIS against S-NPP VIIRS, footprint overlap, 180 min window), so a
day's Harmonized count is MODIS + S-NPP - matched S-NPP, exactly as in the monthly summary.
Output: web/app-data/daily/YYYY.json.gz with rows [day_of_year (0-based), country index (-1 offshore), modis, viirs,
matched_viirs] and the list of days each sensor was observed anywhere on Earth. A day a sensor has no detections
anywhere is an outage or a gap in the archive, so it is stored as "not observed" and never shown as zero.
usage: python -m hotspots.daily data/archive [--years 2024 2025] [--jobs 3]"""
import argparse
import gzip
import json
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path
import numpy as np
import pandas as pd
from .archive import add_heading, complete, match_year, prepare, read_zip
from .geo import Geo

OUT = Path("web/app-data/daily")


def year_rows(year, root):
    root = Path(root)
    done = complete(root)
    geo = Geo()
    mz, vz = root / f"modis_{year}_all_countries.zip", root / f"viirs-snpp_{year}_all_countries.zip"
    m = add_heading(prepare(read_zip(mz), "MODIS")) if mz.name in done else pd.DataFrame()
    v = add_heading(prepare(read_zip(vz), "VIIRS")) if vz.name in done else pd.DataFrame()
    vm, _ = match_year(m, v)
    frames = []
    for d, key, matched in ((m, "m", None), (v, "v", vm)):
        if d.empty:
            continue
        f = pd.DataFrame({"doy": d.time.dt.dayofyear.values - 1, "c": geo.country_idx(d.latitude.values, d.longitude.values), key: 1})
        if matched is not None:
            f["mv"] = matched.astype(int)
        frames.append(f)
    a = pd.concat(frames, ignore_index=True).fillna(0)
    for k in ("m", "v", "mv"):
        if k not in a:
            a[k] = 0
    g = a.groupby(["doy", "c"], as_index=False)[["m", "v", "mv"]].sum().astype(int)
    obs = {k: sorted(int(x) for x in g[g[k] > 0].doy.unique()) for k in ("m", "v")}
    out = {"year": year, "observed": obs, "rows": g[["doy", "c", "m", "v", "mv"]].values.tolist(),
           "window": 180, "source": "NASA FIRMS yearly country archives: MODIS C6.1, VIIRS S-NPP 375 m"}
    OUT.mkdir(parents=True, exist_ok=True)
    with gzip.open(OUT / f"{year}.json.gz", "wt", compresslevel=9) as fh:
        json.dump(out, fh, separators=(",", ":"))
    return year, len(m), len(v), int(vm.sum()) if len(vm) else 0


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("root"); ap.add_argument("--years", nargs="*", type=int); ap.add_argument("--jobs", type=int, default=3)
    a = ap.parse_args(argv)
    done = complete(Path(a.root))
    years = a.years or sorted({int(n.split("_")[1]) for n in done})
    years = [y for y in years if not (OUT / f"{y}.json.gz").exists()]
    with ProcessPoolExecutor(a.jobs) as ex:
        for y, nm, nv, mv in ex.map(year_rows, years, [a.root] * len(years)):
            print(y, f"modis {nm:,} viirs {nv:,} matched viirs {mv:,}", flush=True)
    idx = sorted(int(p.name[:4]) for p in OUT.glob("*.json.gz"))
    (OUT / "index.json").write_text(json.dumps({"years": idx}))
    print("daily years", idx[0], "to", idx[-1])


if __name__ == "__main__":
    main()
