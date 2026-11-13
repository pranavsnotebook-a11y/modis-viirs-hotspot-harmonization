"""Build the record-level bundle for the web app from FIRMS 7-day files. Real data only.

Output (web/app-data): records.bin.gz (little-endian columns) and meta.json. Each VIIRS pixel stores
its best MODIS footprint-overlap candidate and time gap up to MAX_WINDOW, so the app can re-evaluate any
smaller window without new matching. IDs are assigned here because FIRMS records carry none.
usage: python -m hotspots.app_data data/recent/modis.csv data/recent/snpp.csv data/recent/n20.csv data/recent/n21.csv"""
import gzip
import json
import sys
from pathlib import Path
import numpy as np
import pandas as pd
from .geo import Geo
from .io import load_firms
from .harmonize import CRITERIA, match_days

MAX_WINDOW = 360
SAT = {"T": 0, "A": 1, "N": 2, "N20": 3, "1": 3, "J1": 3, "N21": 4, "2": 4, "J2": 4}
SAT_NAMES = ["Terra", "Aqua", "S-NPP", "NOAA-20", "NOAA-21"]
SENTINEL = 65535


def sat_code(series, default=None):
    if default is not None:
        return np.full(len(series), default, dtype=np.uint8)
    s = series.astype(str).str.strip().str[0].map({"T": 0, "A": 1})
    return s.astype(np.uint8).values


def load(modis_path, viirs_paths):
    m = load_firms(modis_path, "MODIS")
    m["sat"] = sat_code(m.satellite)
    m["raw_conf"] = pd.to_numeric(pd.read_csv(modis_path, usecols=["confidence"]).confidence).values
    frames = [m]
    for p, code in viirs_paths:
        v = load_firms(p, "VIIRS")
        v["sat"] = code
        v["raw_conf"] = v.conf_class.map({"low": 200, "nominal": 201, "high": 202}).values
        frames.append(v)
    return frames


def match_all(m, v, window=MAX_WINDOW):
    """Best MODIS candidate per VIIRS pixel, day by day (see hotspots.harmonize), plus what the browser needs to
    re-derive status and match strength for any window up to MAX_WINDOW: time gap, centre distance, number of
    MODIS candidates and the time gap of the best rival."""
    mi = np.full(len(v), -1, dtype=np.int32)
    dt = np.full(len(v), SENTINEL, dtype=np.uint16)
    dist = np.full(len(v), SENTINEL, dtype=np.uint16)
    dt2 = np.full(len(v), SENTINEL, dtype=np.uint16)
    nc = np.zeros(len(v), dtype=np.uint8)
    p = match_days(m, v, window)
    if len(p):
        vi, j = p.viirs_idx.astype(int).values, p.modis_idx.astype(int).values
        mi[vi] = j
        dt[vi] = np.round(p.dt_min.values.astype(float)).astype(np.uint16)
        dist[vi] = np.minimum(np.round(p.dist_km.values.astype(float) * 100), SENTINEL - 1).astype(np.uint16)
        d2 = p.dt2_min.values.astype(float)
        dt2[vi] = np.where(np.isfinite(d2), np.round(np.nan_to_num(d2)), SENTINEL).astype(np.uint16)
        nc[vi] = np.minimum(p.n_cand.values.astype(int), 255)
    return mi, dt, dist, dt2, nc


def main(argv=None, products=None):
    a = argv or sys.argv[1:]
    out = Path("web/app-data")
    out.mkdir(parents=True, exist_ok=True)
    geo = Geo()
    frames = load(a[0], [(a[1], 2), (a[2], 3), (a[3], 4)])
    m = frames[0].sort_values("time").reset_index(drop=True)
    v = pd.concat(frames[1:], ignore_index=True).sort_values("time").reset_index(drop=True)
    print(f"raw MODIS {len(m):,}  raw VIIRS {len(v):,}")
    mi, dt, dist, dt2, nc = match_all(m, v)
    print(f"VIIRS with a MODIS candidate within {MAX_WINDOW} min: {(mi >= 0).sum():,}")
    for w in (30, 60, 120, 180, 360):
        ok = dt <= w
        print(f"  window {w:>3}: VIIRS matched {ok.sum():>8,}  MODIS matched {len(np.unique(mi[ok])):>7,}")
    n_m = len(m)
    r = pd.concat([m, v], ignore_index=True)
    t0 = r.time.min().floor("D")
    tmin = ((r.time - t0).dt.total_seconds() / 60).round().astype(np.uint16).values
    cols = {
        "lat": np.round(r.latitude.values * 1e5).astype(np.int32),
        "lon": np.round(r.longitude.values * 1e5).astype(np.int32),
        "frp": np.round(np.nan_to_num(r.frp.values, nan=0) * 100).astype(np.uint32),
        "t": tmin,
        "scan": np.round(r.scan_km.values * 100).astype(np.uint16),
        "track": np.round(r.track_km.values * 100).astype(np.uint16),
        "place": geo.nearest_place(r.latitude.values, r.longitude.values).astype(np.uint16),
        "country": (geo.country_idx(r.latitude.values, r.longitude.values)).astype(np.int16),
        "mi": np.concatenate([np.full(n_m, -1, np.int32), mi]),
        "dt": np.concatenate([np.full(n_m, SENTINEL, np.uint16), dt]),
        "dist": np.concatenate([np.full(n_m, SENTINEL, np.uint16), dist]),
        "dt2": np.concatenate([np.full(n_m, SENTINEL, np.uint16), dt2]),
        "nc": np.concatenate([np.zeros(n_m, np.uint8), nc]),
        "sat": r.sat.values.astype(np.uint8),
        "conf": r.raw_conf.values.astype(np.uint8),
        "night": (r.daynight == "N").values.astype(np.uint8),
    }
    meta_cols, chunks, off = [], [], 0
    for k, c in cols.items():
        b = c.tobytes()
        meta_cols.append({"name": k, "type": c.dtype.name, "offset": off})
        pad = (-len(b)) % 8  # keep every column aligned for typed arrays
        chunks.append(b + b"\0" * pad)
        off += len(b) + pad
    with gzip.open(out / "records.bin.gz", "wb", compresslevel=9) as f:
        f.write(b"".join(chunks))
    last = r.time.max()
    days = pd.date_range(t0, last.floor("D"), freq="D")
    counts = r.groupby(r.time.dt.floor("D")).size().reindex(days, fill_value=0)
    partial = [str(d.date()) for d, c in counts.items() if c < 0.6 * counts.median()]
    # Days each satellite delivered any record anywhere on Earth. A satellite with no global records on a day was
    # not observing (outage or missing file), so its regional count that day is "no data", never zero.
    day_of = (r.time.dt.floor("D") - t0).dt.days.values
    sat_days = {SAT_NAMES[k]: sorted(int(x) for x in np.unique(day_of[r.sat.values == k])) for k in range(len(SAT_NAMES))}
    meta = {
        "n": len(r), "n_modis": n_m, "t0": t0.isoformat(), "columns": meta_cols, "max_window": MAX_WINDOW, "default_window": 180,
        "days": [str(d.date()) for d in days], "partial_days": partial, "generated_at": pd.Timestamp.utcnow().isoformat(),
        "sat_names": SAT_NAMES, "countries": geo.names, "continents": geo.continents,
        "places": {"name": geo.place_names, "country": geo.place_country,
                   "lat": np.round(geo.place_lat, 2).tolist(), "lon": np.round(geo.place_lon, 2).tolist()},
        "source": "NASA FIRMS near-real-time 7-day global files: MODIS C6.1 (Terra, Aqua), VIIRS C2 375 m (S-NPP, NOAA-20, NOAA-21)",
        "sat_days": sat_days, "products": products or {}, "harmonization": CRITERIA,
    }
    json.dump(meta, open(out / "meta.json", "w"), separators=(",", ":"))
    print((out / "records.bin.gz").stat().st_size / 1e6, "MB;", len(r), "records; days", meta["days"][0], meta["days"][-1], "partial", partial)


if __name__ == "__main__":
    main()
