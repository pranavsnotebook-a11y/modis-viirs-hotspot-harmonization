"""Download the latest FIRMS detections for all five satellites and rebuild the web app's record bundle.

With FIRMS_MAP_KEY set (environment or .env) the area API is used for the whole world, which also allows a past
period (--start). Without a key the public global 7-day NRT files are used. Standard-processing products are
used only when asked (--sp) and need a key; they lag NRT by weeks to months.
usage: python -m hotspots.refresh [--days 7] [--start YYYY-MM-DD] [--sp]"""
import argparse
import json
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from . import app_data, firms

OUT = Path("data/recent")
FILES = {"MODIS": "modis.csv", "VIIRS_SNPP": "snpp.csv", "VIIRS_NOAA20": "n20.csv", "VIIRS_NOAA21": "n21.csv"}


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=7)
    ap.add_argument("--start")
    ap.add_argument("--sp", action="store_true", help="standard processing instead of NRT (needs a key)")
    a = ap.parse_args(argv)
    OUT.mkdir(parents=True, exist_ok=True)
    key = firms.map_key()
    kind = "SP" if a.sp else "NRT"
    if (a.sp or a.start) and not key:
        raise SystemExit("A past period or standard processing needs FIRMS_MAP_KEY. Without a key, run with no options.")
    products = {}
    for base, fname in FILES.items():
        src = f"{base}_{kind}"
        try:
            if key:
                start = date.fromisoformat(a.start) if a.start else datetime.now(timezone.utc).date() - timedelta(days=a.days - 1)
                raw, info = firms.fetch_range(src, (-180, -90, 180, 90), start, start + timedelta(days=a.days - 1))
            else:
                raw, info = firms.public(src, "7d")
        except firms.FirmsError as e:
            print(f"{src}: FAILED ({e}); keeping no records for it, shown as no data")
            raw, info = None, {"via": "failed", "error": str(e)}
        cols = "latitude,longitude,bright,scan,track,acq_date,acq_time,satellite,confidence,version,bright2,frp,daynight"
        p = OUT / fname
        if raw is None or raw.empty:
            hdr = cols.replace("bright2", "bright_t31" if base == "MODIS" else "bright_ti5").replace("bright,", "brightness," if base == "MODIS" else "bright_ti4,")
            p.write_text(hdr + "\n")
            n = 0
        else:
            raw.to_csv(p, index=False)
            n = len(raw)
        products[src] = {**info, "records": n, "label": firms.PRODUCTS[src]["label"], "retrieved_utc": datetime.now(timezone.utc).isoformat(timespec="seconds")}
        print(f"{src}: {n:,} records via {info.get('via')}")
    Path("data/recent/products.json").write_text(json.dumps(products, indent=1))
    app_data.main([str(OUT / f) for f in FILES.values()], products=products)


if __name__ == "__main__":
    main()
