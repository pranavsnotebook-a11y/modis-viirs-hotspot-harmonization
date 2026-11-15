"""Small per-region JSON feed for the "My place" page (web/place.html).

usage: python -m hotspots.feed PY      (PY, BO, AR or BR: the regions of web/app-data/regions.json)

Reads web/app-data/regions.json (country name, hours of fires kept), meta.json and records.bin.gz (the bundle read by
web/js/downwind.js) and writes web/app-data/feed/<ISO>.json: the harmonized fires of the last N hours of data (72 unless
the region says otherwise), the satellite pass start times of the last 4 days, and the named places. Nothing here is invented: every row is a FIRMS record.
"""
from __future__ import annotations

import argparse
import gzip
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np

WEB = Path(__file__).resolve().parents[2] / "web"
REGIONS_FILE = WEB / "app-data" / "regions.json"
TYPES = {"int32": np.int32, "uint32": np.uint32, "int16": np.int16, "uint16": np.uint16, "uint8": np.uint8}
PASS_WINDOW_MIN = 4 * 24 * 60
PASS_GAP_MIN = 30


def read_columns(meta: dict, raw: bytes) -> dict:
    n = meta["n"]
    return {c["name"]: np.frombuffer(raw, dtype=TYPES[c["type"]], count=n, offset=c["offset"]) for c in meta["columns"]}


def _delta(v):
    return [v[0]] + [b - a for a, b in zip(v, v[1:])] if v else []


def _fires(rows, cols, nm=0) -> dict:
    """Parallel arrays, in record-index order. id, lat, lon and t are delta-coded (first value absolute) to keep the file small."""
    ids = [i for i, _ in rows]
    lat = [int(round(int(cols["lat"][i]) / 10)) for i in ids]
    lon = [int(round(int(cols["lon"][i]) / 10)) for i in ids]
    return {"n_modis": nm, "idx": _delta(ids), "lat": _delta(lat), "lon": _delta(lon), "t": _delta([tm for _, tm in rows]),
            "sat": [int(cols["sat"][i]) for i in ids], "frp": [round(int(cols["frp"][i]) / 100, 2) for i in ids]}


def load_regions(path: Path = REGIONS_FILE) -> dict:
    """The one list of regions (country name as in meta.json, feed window); shared with web/js/regions.js and hotspots.assets."""
    return json.loads(Path(path).read_text(encoding="utf-8"))["regions"]


def build_feed(meta: dict, cols: dict, region: str, country: str, places: list, generated: datetime | None = None, fire_hours: float = 72, place_kinds: list | None = None) -> dict:
    t0 = datetime.fromisoformat(meta["t0"])
    nm, window = int(meta["n_modis"]), int(meta.get("default_window", 180))
    k = meta["countries"].index(country)
    idx = np.flatnonzero(cols["country"] == k)
    out = {"region": region, "country": country, "fire_hours": fire_hours, "place_kinds": place_kinds, "generated_utc": (generated or datetime.now(timezone.utc)).strftime("%Y-%m-%dT%H:%M:%SZ"),
           "source": meta["source"], "t0": meta["t0"], "units": "fires: parallel arrays in record order; idx (global record index, HS-M + 6 digits if < n_modis else HS-V + 7 digits of idx - n_modis), "
                    "lat and lon in 1e-4 degrees, t in minutes after t0; idx, lat, lon and t are delta-coded (running sum); sat indexes sats, frp in MW. passes: minutes after t0. places: [name, lat, lon] in degrees",
           "places": [[p["name"], round(p["lat"], 3), round(p["lon"], 3)] for p in places if p.get("name")]}
    if not len(idx):
        return {**out, "data_through_utc": None, "sats": [], "fires": _fires([], []), "passes": {}}
    t = cols["t"][idx].astype(np.int64)
    end = int(t.max())
    out["data_through_utc"] = (t0 + timedelta(minutes=end)).strftime("%Y-%m-%dT%H:%MZ")
    # harmonized layer: every MODIS record, and VIIRS records with no MODIS partner (dt > default window)
    harm = (idx < nm) | (cols["dt"][idx] > window)
    keep = harm & (t >= end - fire_hours * 60)
    rows = [(int(i), int(tm)) for i, tm in zip(idx[keep], t[keep])]  # idx is ascending
    out["sats"] = list(meta["sat_names"])
    out["fires"] = _fires(rows, cols, nm)
    # passes: ALL records of the region, a new pass starts after a gap of more than 30 minutes
    passes = {}
    sats = cols["sat"][idx]
    for s in np.unique(sats):
        ts = np.sort(t[sats == s])
        starts = ts[np.concatenate(([True], np.diff(ts) > PASS_GAP_MIN))]
        starts = [int(x) for x in starts if x >= end - PASS_WINDOW_MIN]
        if starts:
            passes[meta["sat_names"][int(s)]] = starts
    out["passes"] = passes
    return out


def main(argv=None) -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("iso", help="region code, e.g. PY")
    ap.add_argument("--web", type=Path, default=WEB)
    a = ap.parse_args(argv)
    iso = a.iso.upper()
    regions = load_regions(a.web / "app-data" / "regions.json")
    if iso not in regions:
        raise SystemExit(f"unknown region {iso}; known: {', '.join(regions)}")
    reg = regions[iso]
    d = a.web / "app-data"
    meta = json.loads((d / "meta.json").read_text())
    with gzip.open(d / "records.bin.gz", "rb") as f:
        cols = read_columns(meta, f.read())
    if reg["country"] not in meta["countries"]:
        raise SystemExit(f'"{reg["country"]}" is not in meta.json countries')
    try:
        with gzip.open(d / "assets" / f"{iso}.json.gz", "rt", encoding="utf-8") as f:
            assets = json.load(f)
        places = assets.get("places", [])
        kinds = (assets.get("layers", {}).get("places") or {}).get("place")
    except FileNotFoundError:
        raise SystemExit(f"build the asset file first: python -m hotspots.assets {iso} (the feed lists its named places)")
    feed = build_feed(meta, cols, iso, reg["country"], places, fire_hours=float(reg.get("feed", {}).get("fire_hours", 72)), place_kinds=kinds)
    (d / "feed").mkdir(exist_ok=True)
    p = d / "feed" / f"{iso}.json"
    p.write_text(json.dumps(feed, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"{p}: {p.stat().st_size / 1000:.1f} kB, {len(feed['fires']['idx'])} fires, {len(feed['places'])} places, through {feed['data_through_utc']}")


if __name__ == "__main__":
    main()
