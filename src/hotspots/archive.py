"""Summarize FIRMS yearly country archives into monthly totals for the web app. Real data only.

Runs the same footprint and time matching as the recent bundle, one UTC day at a time, for MODIS against
S-NPP VIIRS (the one VIIRS satellite spanning 2012 onward), with a fixed window.
Output: web/app-data/history.json.gz (region x month) and web/app-data/cells/YYYY.json.gz (1 deg x country x month).
usage: python -m hotspots.archive data/archive [--years 2023 2024] [--no-match]"""
import argparse
import gzip
import io
import json
import zipfile
from pathlib import Path
import numpy as np
import pandas as pd
from .footprint import heading_deg
from .geo import Geo
from .match import match

WINDOW = 180
OUT = Path("web/app-data")
CONT = ["North America", "South America", "Europe", "Africa", "Asia", "Oceania"]


def complete(root):
    """Only zips the downloader finished: partial files are never read."""
    log = root / "fetch.log"
    return {l.split()[1] for l in log.read_text().splitlines() if l.startswith("ok ")} if log.exists() else set()


def read_zip(path) -> pd.DataFrame:
    """Concatenate the per-country CSVs in a yearly zip, keeping only what the summaries need."""
    use = ["latitude", "longitude", "scan", "track", "acq_date", "acq_time", "satellite", "daynight"]
    frames = []
    with zipfile.ZipFile(path) as z:
        for n in z.namelist():
            if n.endswith(".csv"):
                frames.append(pd.read_csv(io.BytesIO(z.read(n)), usecols=use, dtype={"satellite": str, "daynight": str}))
    d = pd.concat(frames, ignore_index=True)
    # FIRMS assigns a detection to one country file; drop exact repeats in case of shared borders.
    return d.drop_duplicates(["latitude", "longitude", "acq_date", "acq_time", "satellite"]).reset_index(drop=True)


def prepare(d: pd.DataFrame, sensor: str) -> pd.DataFrame:
    h = d.acq_time.astype(int)
    t = pd.to_datetime(d.acq_date) + pd.to_timedelta(h // 100, unit="h") + pd.to_timedelta(h % 100, unit="m")
    out = pd.DataFrame({"latitude": d.latitude.values, "longitude": d.longitude.values, "scan_km": d.scan.values,
                        "track_km": d.track.values, "time": pd.to_datetime(t.values, utc=True)})
    out["satellite"] = d.satellite.astype(str).values
    out["daynight"] = d.daynight.values
    if sensor == "MODIS":
        out["satellite"] = out.satellite.str[0].map({"T": "T", "A": "A"}).fillna("T")
    return out.sort_values("time").reset_index(drop=True)


def add_heading(df):
    df["heading_deg"] = heading_deg(df.latitude, df.satellite, df.daynight)
    return df


def match_year(m, v):
    """Returns boolean arrays: VIIRS pixel matched, MODIS pixel matched."""
    vm, mm = np.zeros(len(v), bool), np.zeros(len(m), bool)
    if m.empty or v.empty:
        return vm, mm
    pad = pd.Timedelta(minutes=WINDOW)
    day = v.time.dt.floor("D")
    for d, idx in v.groupby(day).groups.items():
        sub = m[(m.time >= d - pad) & (m.time < d + pd.Timedelta(days=1) + pad)]
        p = match(sub, v.loc[idx], max_dt_min=WINDOW, k=32)
        if len(p):
            vm[v.index.get_indexer(p.viirs_idx)] = True
            mm[m.index.get_indexer(p.modis_idx)] = True
    return vm, mm


def summarize_year(year, zroot, geo, do_match=True, cache=None):
    mz, vz = zroot / f"modis_{year}_all_countries.zip", zroot / f"viirs-snpp_{year}_all_countries.zip"
    done = complete(zroot)
    mz, vz = (mz if mz.name in done else Path("/nonexistent")), (vz if vz.name in done else Path("/nonexistent"))
    m = add_heading(prepare(read_zip(mz), "MODIS")) if mz.exists() else pd.DataFrame()
    v = add_heading(prepare(read_zip(vz), "VIIRS")) if vz.exists() else pd.DataFrame()
    vm, mm = match_year(m, v) if do_match else (np.zeros(len(v), bool), np.zeros(len(m), bool))
    frames = []
    for d, sensor, matched in ((m, "m", mm), (v, "v", vm)):
        if d.empty:
            continue
        frames.append(pd.DataFrame({
            "month": d.time.dt.month.values - 1, "la": np.floor(d.latitude.values).astype(np.int16),
            "lo": np.floor(d.longitude.values).astype(np.int16), "c": geo.country_idx(d.latitude.values, d.longitude.values),
            sensor: 1, f"x{sensor}": matched.astype(int)}))
    a = pd.concat(frames, ignore_index=True).fillna(0)
    for k in ("m", "v", "xm", "xv"):
        if k not in a:
            a[k] = 0
    g = a.groupby(["month", "la", "lo", "c"], as_index=False)[["m", "v", "xm", "xv"]].sum()
    g[["m", "v", "xm", "xv"]] = g[["m", "v", "xm", "xv"]].astype(int)
    g["h"] = g.m + g.v - g.xv
    return g, len(m), len(v), m.time.max() if len(m) else None, v.time.max() if len(v) else None, m.time.min() if len(m) else None, v.time.min() if len(v) else None


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("root"); ap.add_argument("--years", nargs="*", type=int); ap.add_argument("--no-match", action="store_true")
    a = ap.parse_args(argv)
    root = Path(a.root)
    geo = Geo()
    (OUT / "cells").mkdir(parents=True, exist_ok=True)
    work = root / "summaries"; work.mkdir(exist_ok=True)
    done = complete(root)
    years = a.years or sorted({int(n.split("_")[1]) for n in done})
    for y in years:
        cache = work / f"{y}.csv"
        want_v = f"viirs-snpp_{y}_all_countries.zip" in done
        if cache.exists() and (not want_v or json.load(open(work / f"{y}.json"))["nv"] > 0):
            continue
        g, nm, nv, mm_, vm_, m0, v0 = summarize_year(y, root, geo, not a.no_match)
        g.to_csv(cache, index=False)
        json.dump({"nm": nm, "nv": nv, "m_last": str(mm_), "v_last": str(vm_), "m_first": str(m0), "v_first": str(v0)}, open(work / f"{y}.json", "w"))
        print(y, f"modis {nm:,} viirs {nv:,} matched v {g.xv.sum():,} m {g.xm.sum():,}", flush=True)
    assemble(work, geo)


def assemble(work, geo):
    all_years = sorted(int(p.name.split(".")[0]) for p in work.glob("*.csv"))
    months = [f"{y}-{m:02d}" for y in range(all_years[0], all_years[-1] + 1) for m in range(1, 13)]
    idx = {p: i for i, p in enumerate(months)}
    names = {"Global": None}
    for c in CONT:
        names[c] = None
    for n in geo.names:
        names[n] = None
    reg = {k: {s: np.zeros(len(months), np.int64) for s in ("m", "v", "mm", "mv")} for k in names}
    for y in all_years:
        g = pd.read_csv(work / f"{y}.csv")
        rows = []
        for mo, la, lo, c, m, v, xm, xv, h in g[["month", "la", "lo", "c", "m", "v", "xm", "xv", "h"]].itertuples(index=False):
            i = idx[f"{y}-{mo + 1:02d}"]
            keys = ["Global"]
            if c >= 0:
                keys += [geo.names[c], geo.continents[c]]
            for k in keys:
                if k in reg:
                    r = reg[k]
                    r["m"][i] += m; r["v"][i] += v; r["mm"][i] += xm; r["mv"][i] += xv
            rows.append([int(mo), int(la), int(lo), int(c), int(m), int(v), int(h)])
        with gzip.open(OUT / "cells" / f"{y}.json.gz", "wt", compresslevel=9) as f:
            json.dump({"year": y, "rows": rows}, f, separators=(",", ":"))
    # A month is observed only if that sensor has detections somewhere on Earth that month. A year not downloaded
    # or an instrument outage therefore stays null ("no data") and can never read as a regional zero.
    obs = {"m": reg["Global"]["m"] > 0, "v": reg["Global"]["v"] > 0}
    months_observed = lambda s: [months[i] for i, ok in enumerate(obs[s]) if ok]
    cov = {"MODIS": [months_observed("m")[0], months_observed("m")[-1]] if obs["m"].any() else None,
           "VIIRS": [months_observed("v")[0], months_observed("v")[-1]] if obs["v"].any() else None}
    regions = {}
    for k, r in reg.items():
        regions[k] = {
            "m": [int(x) if obs["m"][i] else None for i, x in enumerate(r["m"])],
            "v": [int(x) if obs["v"][i] else None for i, x in enumerate(r["v"])],
            "mm": [int(x) if obs["m"][i] else None for i, x in enumerate(r["mm"])],
            "mv": [int(x) if obs["v"][i] else None for i, x in enumerate(r["mv"])],
        }
    meta = {"months": months, "coverage": cov, "window": WINDOW, "regions": regions,
            "source": "NASA FIRMS yearly country archives: MODIS C6.1, VIIRS S-NPP 375 m"}
    with gzip.open(OUT / "history.json.gz", "wt", compresslevel=9) as f:
        json.dump(meta, f, separators=(",", ":"))
    print("coverage", cov, "history MB", (OUT / "history.json.gz").stat().st_size / 1e6)


if __name__ == "__main__":
    main()
