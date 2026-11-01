"""Combine S-NPP/NOAA-20/NOAA-21 into one VIIRS layer and compare FRP with MODIS by region.
python -m hotspots.regional modis.csv viirs1.csv [viirs2.csv ...]"""
import sys
import numpy as np
import pandas as pd
from .io import load_firms
from .merge import harmonize

REGIONS = {  # name: (lat_min, lat_max, lon_min, lon_max)
    "North America": (15, 72, -170, -50), "South America": (-56, 15, -92, -34),
    "Europe": (35, 72, -12, 40), "Africa": (-35, 37, -18, 52),
    "Asia": (-10, 75, 40, 150), "Oceania": (-50, -10, 110, 180),
}


def combine_viirs(paths):
    v = pd.concat([load_firms(p, "VIIRS") for p in paths], ignore_index=True)
    return v.drop_duplicates(["latitude", "longitude", "time"]).reset_index(drop=True)


def region_of(lat, lon):
    for n, (a, b, c, d) in REGIONS.items():
        if a <= lat <= b and c <= lon <= d:
            return n
    return "Other"


def main(argv=None):
    a = argv or sys.argv[1:]
    m, v = load_firms(a[0], "MODIS"), combine_viirs(a[1:])
    out = harmonize(m, v, max_dt_min=60)
    out["region"] = [region_of(la, lo) for la, lo in zip(out.latitude, out.longitude)]
    rows = []
    for r, g in out.groupby("region"):
        b = g[g.detected_by == "both"].dropna(subset=["modis_frp", "viirs_frp_in_modis_pixel"])
        c = np.corrcoef(np.log10(b.modis_frp.clip(lower=.1)), np.log10(b.viirs_frp_in_modis_pixel.clip(lower=.1)))[0, 1] if len(b) > 2 else np.nan
        rows.append((r, len(g), (g.detected_by == "both").sum(), (g.detected_by == "modis").sum(),
                     round(c, 3), round((b.viirs_frp_in_modis_pixel / b.modis_frp.clip(lower=.1)).median(), 2) if len(b) else np.nan))
    print(pd.DataFrame(rows, columns=["region", "events", "both", "modis_only", "log_frp_corr", "median_viirs/modis_frp"]).to_string(index=False))
    print(f"\nVIIRS pixels combined: {len(v)}")


if __name__ == "__main__":
    main()
