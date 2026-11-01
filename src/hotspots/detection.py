"""Pixel-size-aware MODIS detection probability, using VIIRS 375 m fires as reference.

Question: of the fires VIIRS sees, which does MODIS also detect, and how does that depend
on fire strength and MODIS pixel area? A fixed-temperature fire raises the pixel's
brightness roughly in proportion to FRP / pixel_area, so detection should depend on
FRP *and* pixel size (MODIS 1-10 km^2 vs VIIRS 0.14-0.8 km^2).

FIRMS lists detections only, not where MODIS looked. Proxy for "MODIS observed this
place": a MODIS detection within `near_km` and `max_dt_min` (same overpass, cloud-free
enough to detect something). The local MODIS pixel area is taken from that nearest MODIS
detection (pixel size varies smoothly with scan angle). Biases: this conditions on
nearby MODIS fire activity (inflates detection rates) and ignores clouds/partial swath.
FRP per VIIRS fire is the sum of same-satellite VIIRS FRP within half a MODIS pixel.
The sample is small (few near-simultaneous overpasses) and sensitive to `near_km`
(larger values admit VIIRS fires outside the narrower MODIS swath), so `frp_floor` --
the low-FRP tail of each sensor's own detections vs. pixel area -- is the more robust
evidence for the pixel-size effect.
"""
import numpy as np
import pandas as pd
from scipy import optimize
from scipy.spatial import cKDTree
from .footprint import EARTH_KM
from .match import _xyz, minutes

FRP_BINS = [0, 2, 5, 10, 20, 50, np.inf]
AREA_BINS = [0, 1.5, 3, np.inf]


def _chord(km):
    return 2 * np.sin(np.asarray(km) / (2 * EARTH_KM))


def observed_viirs(out: pd.DataFrame, modis: pd.DataFrame, max_dt_min=30, near_km=10) -> pd.DataFrame:
    """VIIRS rows of `harmonize(..., max_dt_min)` output inside a MODIS-observed area,
    with modis_area_km2, local_frp and detected (bool)."""
    v = out[out.sensor == "VIIRS"].reset_index(drop=True)
    k = min(32, len(modis))
    d, i = cKDTree(_xyz(modis.latitude, modis.longitude)).query(
        _xyz(v.latitude, v.longitude), k=k, distance_upper_bound=_chord(near_km))
    d, i = d.reshape(len(v), k), i.reshape(len(v), k)
    ok = i < len(modis)
    i0 = np.where(ok, i, 0)
    dt = np.abs(minutes(v.time)[:, None] - minutes(modis.time)[i0])
    ok &= dt <= max_dt_min
    j = np.where(ok, d, np.inf).argmin(axis=1)
    r = np.arange(len(v))
    keep = ok[r, j]
    area = (modis.scan_km.values * modis.track_km.values)[i0[r, j]]
    v = v.assign(modis_area_km2=area)[keep].reset_index(drop=True)
    v["local_frp"] = v.viirs_frp
    for _, g in v.groupby("satellite"):
        xyz = _xyz(g.latitude, g.longitude)
        nb = cKDTree(xyz).query_ball_point(xyz, _chord(0.5 * np.sqrt(g.modis_area_km2.values)))
        t, f = minutes(g.time), g.viirs_frp.fillna(0).values
        v.loc[g.index, "local_frp"] = [f[n][np.abs(t[n] - t[a]) <= 10].sum()
                                       for a, n in enumerate(nb)]
    v["detected"] = v.detected_by == "both"
    return v


def frp_floor(df: pd.DataFrame, bins, q: float = 0.05) -> pd.DataFrame:
    """q-quantile and median FRP of a sensor's detections by pixel-area bin and day/night.
    The low quantile approximates the smallest fire that sensor reliably detects."""
    area = pd.cut(df.scan_km * df.track_km, bins)
    g = df.groupby(["daynight", area], observed=True).frp
    return pd.DataFrame({"n": g.size(), f"frp_q{int(q * 100)}": g.quantile(q).round(1),
                         "frp_median": g.median().round(1)})


def detection_table(obs: pd.DataFrame) -> pd.DataFrame:
    """Detection fraction by local FRP bin (rows) and MODIS pixel area bin (columns)."""
    t = obs.assign(frp_bin=pd.cut(obs.local_frp, FRP_BINS, right=False),
                   area_bin=pd.cut(obs.modis_area_km2, AREA_BINS, right=False))
    p = t.pivot_table(index="frp_bin", columns="area_bin", values="detected", aggfunc="mean", observed=False)
    n = t.pivot_table(index="frp_bin", columns="area_bin", values="detected", aggfunc="size", observed=False)
    return p.round(2).astype(str) + " (n=" + n.fillna(0).astype(int).astype(str) + ")"


def fit_logistic(frp, area, detected) -> dict:
    """P(detect) = sigmoid(b0 + b1*log10(FRP) + b2*log10(area)). Physical expectation
    (detection ~ FRP/area) is b2 ~ -b1. Returns coefs and FRP at 50% for 1 and 4 km^2."""
    X = np.column_stack([np.ones(len(frp)), np.log10(np.clip(frp, 0.1, None)), np.log10(area)])
    yv = np.asarray(detected, float)

    def nll(b):
        z = X @ b
        return np.sum(np.logaddexp(0, z) - yv * z)

    b = optimize.minimize(nll, np.zeros(3), method="BFGS").x
    f50 = lambda a: float(10 ** (-(b[0] + b[2] * np.log10(a)) / b[1]))
    b0, b1, b2 = (round(float(c), 2) for c in b)
    return {"b0": b0, "b_log_frp": b1, "b_log_area": b2,
            "frp50_1km2": round(f50(1), 1), "frp50_4km2": round(f50(4), 1), "n": len(yv)}
