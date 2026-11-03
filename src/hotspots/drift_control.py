"""VIIRS S-NPP as a control for the MODIS orbit drift result. Rules: docs/research/preregistration_viirs_control.md
usage: python -m hotspots.drift_control data/archive docs/research/viirs_control.csv"""
import io
import json
import sys
import zipfile
from pathlib import Path
import numpy as np
import pandas as pd
from .drift import circular_median, cycle, local_hour

USE = ["longitude", "acq_date", "acq_time", "satellite", "daynight", "version", "type"]
YEARS = range(2013, 2026)
BASE = (2013, 2020)
MIN_COUNT = 20
SAT = {"T": "Terra", "A": "Aqua", "N": "SNPP"}


def strata(path, year):
    """Counts per country, month, satellite and day/night, plus hours, versions and observed days."""
    counts, hours, versions, days = [], [], [], {}
    with zipfile.ZipFile(path) as z:
        for n in z.namelist():
            if not n.endswith(".csv"):
                continue
            d = pd.read_csv(io.BytesIO(z.read(n)), usecols=USE, dtype={"satellite": str, "daynight": str, "version": str})
            d = d[d.type == 0]
            if d.empty:
                continue
            d["sat"] = d.satellite.str[0].map(SAT)
            d["month"] = d.acq_date.str[5:7].astype(int)
            d["h"] = local_hour(d)
            c = d.groupby(["sat", "daynight", "month"]).size().rename("n").reset_index()
            c["country"], c["year"] = Path(n).stem.split("_", 2)[2], year
            counts.append(c)
            # Hours are pooled per sensor at the end, from a thinned sample to keep memory flat.
            hours.append(d[["sat", "daynight", "h"]].iloc[::10])
            versions.append(d.groupby(["sat", "version"]).size())
            for s, g in d.groupby("sat"):
                days.setdefault(s, set()).update(g.acq_date.unique())
    hr = pd.concat(hours).groupby(["sat", "daynight"]).h.apply(circular_median).rename("hour").reset_index()
    hr["year"] = year
    ver = pd.concat(versions).groupby(level=[0, 1]).sum().rename("n").reset_index()
    ver["year"] = year
    return pd.concat(counts), hr, ver, pd.DataFrame([(year, s, len(v)) for s, v in days.items()], columns=["year", "sat", "days"])


def fixed_geography(c, top, bottom, dn):
    """Year's ratio with country-month weights held at the baseline S-NPP count. Raw total ratio beside it."""
    c = c[c.daynight == dn]
    p = c.pivot_table(index=["country", "month", "year"], columns="sat", values="n", aggfunc="sum")
    w = c[(c.sat == "SNPP") & c.year.between(*BASE)].groupby(["country", "month"]).n.sum().rename("w")
    t = p[[top, bottom]].dropna().query(f"{top} >= {MIN_COUNT} and {bottom} >= {MIN_COUNT}").reset_index().merge(w.reset_index(), on=["country", "month"])
    t["r"] = t[top] / t[bottom]
    fixed = t.groupby("year").apply(lambda g: np.average(g.r, weights=g.w), include_groups=False)
    tot = c.pivot_table(index="year", columns="sat", values="n", aggfunc="sum")
    return fixed, tot[top] / tot[bottom]


def main(argv=None):
    a = argv or sys.argv[1:]
    root = Path(a[0])
    cache = root / "control_strata.pkl"  # the 13-year scan takes a while; this holds only aggregates
    if cache.exists():
        c, hr, ver, days = pd.read_pickle(cache)
    else:
        parts = [strata(root / f"{f}_{y}_all_countries.zip", y) for y in YEARS for f in ("modis", "viirs-snpp")]
        c, hr, ver, days = (pd.concat([p[i] for p in parts], ignore_index=True) for i in range(4))
        pd.to_pickle((c, hr, ver, days), cache)
    h = hr.pivot_table(index="year", columns=["sat", "daynight"], values="hour")
    h.columns = [f"{s}_{d}_h" for s, d in h.columns]
    out = h.round(2).copy()
    base = out.loc[BASE[0]:BASE[1]].mean()
    for top in ("Terra", "Aqua"):
        for dn in "DN":
            fixed, raw = fixed_geography(c, top, "SNPP", dn)
            b = fixed.loc[BASE[0]:BASE[1]].mean()
            name = f"{top}_SNPP_{dn}"
            out[name] = fixed.round(3)
            out[name + "_change"] = (fixed / b).round(3)
            out[name + "_raw"] = raw.round(3)
            model = pd.Series(cycle(h[f"{top}_{dn}_h"]) - cycle(h[f"SNPP_{dn}_h"]), index=h.index)
            out["pred_" + name + "_change"] = np.exp(model - model.loc[BASE[0]:BASE[1]].mean()).round(3)
    for s in ("Terra", "Aqua", "SNPP"):
        for dn in "DN":
            n = c[(c.sat == s) & (c.daynight == dn)].groupby("year").n.sum()
            out[f"{s}_{dn}_n"] = n
    d = days.pivot_table(index="year", columns="sat", values="days")
    d.columns = [f"{s}_days" for s in d.columns]
    out = out.join(d)
    if len(a) > 1:
        out.to_csv(a[1])
        modis = out.Terra_D_n + out.Terra_N_n + out.Aqua_D_n + out.Aqua_N_n
        snpp = out.SNPP_D_n + out.SNPP_N_n
        web = out.filter(regex="^(pred_)?Terra_SNPP_[DN]_change$").copy()
        web["modis_pct"] = (100 * (modis / modis.loc[BASE[0]:BASE[1]].mean() - 1)).round(1)
        web["snpp_pct"] = (100 * (snpp / snpp.loc[BASE[0]:BASE[1]].mean() - 1)).round(1)
        Path("web/app-data/control.json").write_text(json.dumps(web.reset_index().to_dict("list"), separators=(",", ":")))
    pd.set_option("display.width", 220, "display.max_columns", 80)
    print(ver.pivot_table(index="year", columns=["sat", "version"], values="n").fillna(0).astype(int).to_string())
    print(out.filter(regex="_h$|days").to_string())
    print(out.filter(regex="change").to_string())
    print(out.filter(regex="_n$").to_string())
    t = out.loc[2025]
    checks = {
        "terra day falls >=15%": t.Terra_SNPP_D_change <= .85,
        "terra night rises >=15%": t.Terra_SNPP_N_change >= 1.15,
        "day within 1.25x of model": 1 / 1.25 <= t.Terra_SNPP_D_change / t.pred_Terra_SNPP_D_change <= 1.25,
        "night within 1.25x of model": 1 / 1.25 <= t.Terra_SNPP_N_change / t.pred_Terra_SNPP_N_change <= 1.25,
        "snpp hour moved <0.25 h": max(np.ptp(out.SNPP_D_h), np.ptp(out.SNPP_N_h)) < .25,
    }
    for k, v in checks.items():
        print("PASS" if v else "FAIL", k)


if __name__ == "__main__":
    main()
