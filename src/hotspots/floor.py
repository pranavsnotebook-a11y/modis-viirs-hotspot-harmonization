"""Does an FRP floor close the MODIS-vs-VIIRS count gap? A fair test.

A floor on per-pixel FRP is NOT comparable across sensors: one fire's power is split over
several 375 m VIIRS pixels but lands in one 1 km MODIS pixel, so per-pixel flooring removes VIIRS
detections purely through splitting. Here FRP is summed per grid cell, per satellite, per day and
day/night BEFORE flooring, and satellites are compared one against one.
usage: python -m hotspots.floor modis.csv viirs.csv [--res 0.05] [--drop-after YYYY-MM-DD]"""
import argparse
import numpy as np
import pandas as pd

FLOORS = (0, 5, 10, 20, 50, 100)


def cell_frp(df: pd.DataFrame, res: float = 0.05) -> pd.Series:
    """Summed FRP per (date, day/night, grid cell) for ONE satellite."""
    return df.assign(la=np.floor(df.latitude / res), lo=np.floor(df.longitude / res)) \
        .groupby(["acq_date", "daynight", "la", "lo"]).frp.sum()


def ratio_table(num: pd.DataFrame, den: pd.DataFrame, res: float = 0.05, floors=FLOORS) -> pd.DataFrame:
    a, b = cell_frp(num, res), cell_frp(den, res)
    rows = [(f, int((a >= f).sum()), int((b >= f).sum())) for f in floors]
    t = pd.DataFrame(rows, columns=["cell_frp_floor_mw", "num_cells", "den_cells"])
    t["ratio"] = (t.num_cells / t.den_cells.replace(0, np.nan)).round(2)
    return t


def read(path, drop_after=None):
    d = pd.read_csv(path)
    d["frp"] = pd.to_numeric(d.frp, errors="coerce")
    return d[d.acq_date <= drop_after] if drop_after else d


def main(argv=None):
    p = argparse.ArgumentParser()
    p.add_argument("modis"); p.add_argument("viirs")
    p.add_argument("--res", type=float, default=0.05)
    p.add_argument("--drop-after", help="last complete date; the newest FIRMS day is usually partial")
    a = p.parse_args(argv)
    m, v = read(a.modis, a.drop_after), read(a.viirs, a.drop_after)
    sat = m.satellite.astype(str).str[0]
    aqua, terra = m[sat == "A"], m[sat == "T"]
    for name, n, d in (("VIIRS / Aqua", v, aqua), ("VIIRS / Terra", v, terra), ("Aqua / Terra", aqua, terra)):
        print(f"\n{name} (grid {a.res} deg)\n" + ratio_table(n, d, a.res).to_string(index=False))


if __name__ == "__main__":
    main()
