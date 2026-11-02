"""Is the satellite-vs-satellite gap about overpass time? Discriminating test.

If overpass time drives the Aqua/Terra gap, the ratio should change with day/night, since the two
satellites' local times differ differently in each. A simply weaker Terra predicts a similar ratio
both ways. NOAA-20/NOAA-21 (same instrument, similar local time) is the negative control.
usage: python -m hotspots.overpass modis.csv n20.csv n21.csv --drop-after YYYY-MM-DD"""
import argparse
import numpy as np
import pandas as pd
from .floor import cell_frp, read


def local_solar_hour(df: pd.DataFrame) -> pd.Series:
    t = df.acq_time.astype(int)
    return ((t // 100 + (t % 100) / 60 + df.longitude / 15) % 24)


def summarize(sats: dict, res: float = 0.05, floor: float = 20.0) -> pd.DataFrame:
    rows = []
    for name, d in sats.items():
        for dn, g in d.groupby("daynight"):
            lst = local_solar_hour(g)
            # circular median-ish: rotate so the 0/24 wrap falls away from the overpass cluster
            ang = np.angle(np.exp(2j * np.pi * lst / 24).mean())
            shifted = ((lst - ang * 24 / (2 * np.pi) + 12) % 24)
            med = (shifted.median() + ang * 24 / (2 * np.pi) - 12) % 24
            c = cell_frp(g, res)
            rows.append((name, dn, round(med, 1), len(g), int((c >= floor).sum())))
    return pd.DataFrame(rows, columns=["satellite", "daynight", "median_local_hour", "pixels", f"cells_ge_{floor:g}MW"])


def main(argv=None):
    p = argparse.ArgumentParser()
    p.add_argument("modis"); p.add_argument("n20"); p.add_argument("n21")
    p.add_argument("--drop-after"); p.add_argument("--res", type=float, default=0.05)
    a = p.parse_args(argv)
    m = read(a.modis, a.drop_after)
    sat = m.satellite.astype(str).str[0]
    sats = {"Aqua": m[sat == "A"], "Terra": m[sat == "T"],
            "NOAA-20": read(a.n20, a.drop_after), "NOAA-21": read(a.n21, a.drop_after)}
    t = summarize(sats, a.res)
    print(t.to_string(index=False))
    col = t.columns[-1]
    v = t.set_index(["satellite", "daynight"])
    for label, x, y in (("Aqua/Terra", "Aqua", "Terra"), ("NOAA-20/NOAA-21 (control)", "NOAA-20", "NOAA-21"),
                        ("NOAA-20/Aqua", "NOAA-20", "Aqua"), ("NOAA-20/Terra", "NOAA-20", "Terra")):
        print(f"\n{label}")
        for dn in ("D", "N"):
            print(f"  {dn}: pixels {v.loc[(x, dn), 'pixels'] / v.loc[(y, dn), 'pixels']:.2f}  cells>=20MW {v.loc[(x, dn), col] / v.loc[(y, dn), col]:.2f}")
    # same contrast within continents: a global artefact should hold across regions
    from .regional import REGIONS
    print("\nAqua/Terra by region, cells>=20MW (D, N)")
    for r, (a0, a1, o0, o1) in REGIONS.items():
        f = lambda d: d[d.latitude.between(a0, a1) & d.longitude.between(o0, o1)]
        out = []
        for dn in ("D", "N"):
            A, T = f(sats["Aqua"][sats["Aqua"].daynight == dn]), f(sats["Terra"][sats["Terra"].daynight == dn])
            na, nt = (cell_frp(A, a.res) >= 20).sum(), (cell_frp(T, a.res) >= 20).sum()
            out.append(f"{dn} {na}/{nt}={na / nt:.2f}" if nt else f"{dn} {na}/0")
        print(f"  {r:14s} " + "  ".join(out))


if __name__ == "__main__":
    main()
