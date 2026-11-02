"""Common detection floor: how much of the MODIS-vs-VIIRS count gap is just sensitivity?

Counts MODIS vs VIIRS detections per region at increasing FRP floors. If the gap is mostly a
detection-limit effect, the VIIRS/MODIS count ratio should fall toward 1 as the floor rises
above what both sensors reliably see. Uses same-days, one VIIRS satellite at a time.
usage: python -m hotspots.floor modis.csv viirs.csv [out.csv]"""
import sys
import numpy as np
import pandas as pd
from .io import load_firms
from .regional import region_of

FLOORS = [0, 3, 5, 10, 20, 50]


def table(m: pd.DataFrame, v: pd.DataFrame) -> pd.DataFrame:
    days = sorted(set(m.time.dt.date) & set(v.time.dt.date))[:-1]  # drop possibly-partial last day
    m, v = m[m.time.dt.date.isin(days)].copy(), v[v.time.dt.date.isin(days)].copy()
    for d in (m, v):
        d["region"] = [region_of(a, b) for a, b in zip(d.latitude, d.longitude)]
    rows = []
    for r in ["ALL"] + sorted(set(m.region) | set(v.region)):
        mm = m if r == "ALL" else m[m.region == r]
        vv = v if r == "ALL" else v[v.region == r]
        for f in FLOORS:
            nm, nv = int((mm.frp >= f).sum()), int((vv.frp >= f).sum())
            rows.append((r, f, nm, nv, round(nv / nm, 2) if nm else np.nan))
    return pd.DataFrame(rows, columns=["region", "frp_floor_mw", "modis", "viirs", "viirs_over_modis"])


def main(argv=None):
    a = argv or sys.argv[1:]
    t = table(load_firms(a[0], "MODIS"), load_firms(a[1], "VIIRS"))
    print(t[t.region.isin(["ALL", "Africa", "Asia", "South America", "North America"])].to_string(index=False))
    if len(a) > 2:
        t.to_csv(a[2], index=False)


if __name__ == "__main__":
    main()
