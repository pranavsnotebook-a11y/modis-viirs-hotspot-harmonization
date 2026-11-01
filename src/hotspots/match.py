"""Cross-sensor spatial/temporal matching of hot spots."""
import numpy as np
import pandas as pd
from scipy.spatial import cKDTree
from .footprint import EARTH_KM, enu_km, rects_overlap


def _xyz(lat, lon):
    la, lo = np.radians(lat), np.radians(lon)
    return np.column_stack([np.cos(la) * np.cos(lo), np.cos(la) * np.sin(lo), np.sin(la)])


def minutes(t: pd.Series) -> np.ndarray:
    """UTC timestamps -> float minutes since epoch."""
    ns = pd.to_datetime(t, utc=True).dt.tz_convert(None).to_numpy().astype("datetime64[ns]")
    return ns.astype(np.int64) / 6e10


def _col(df, name, default):
    return df[name].values if name in df else np.full(len(df), default)


def match(modis: pd.DataFrame, viirs: pd.DataFrame, max_dt_min: float = 180.0,
          extra_km: float = 0.0, k: int = 16) -> pd.DataFrame:
    """Match each VIIRS pixel to a MODIS pixel whose footprint overlaps it.

    Footprints are oriented rectangles (scan x track km, see `footprint`); `extra_km`
    pads the MODIS rectangle. Among overlapping candidates with |dt| <= max_dt_min the
    one closest in time wins, then the nearest centre. Returns viirs_idx, modis_idx
    (index labels), dist_km, dt_min. Each VIIRS pixel is assigned to at most one MODIS
    pixel even where MODIS pixels overlap each other.
    """
    cols = ["viirs_idx", "modis_idx", "dist_km", "dt_min"]
    if modis.empty or viirs.empty:
        return pd.DataFrame(columns=cols)
    k = min(k, len(modis))
    half_diag = lambda d: float(np.hypot(d.scan_km, d.track_km).max()) / 2
    max_r = half_diag(modis) + half_diag(viirs) + extra_km
    tree = cKDTree(_xyz(modis.latitude.values, modis.longitude.values))
    dist, ind = tree.query(_xyz(viirs.latitude.values, viirs.longitude.values), k=k,
                           distance_upper_bound=2 * np.sin(max_r / (2 * EARTH_KM)))
    ind, dist = ind.reshape(len(viirs), k), dist.reshape(len(viirs), k)
    valid = ind < len(modis)
    j_ = np.where(valid, ind, 0)
    km = 2 * EARTH_KM * np.arcsin(np.clip(dist / 2, 0, 1))
    de, dn = enu_km(modis.latitude.values[j_], modis.longitude.values[j_],
                    viirs.latitude.values[:, None], viirs.longitude.values[:, None])
    vcol = lambda c, d=np.nan: _col(viirs, c, d)[:, None]
    over = rects_overlap(de, dn, modis.scan_km.values[j_], modis.track_km.values[j_],
                         _col(modis, "heading_deg", np.nan)[j_],
                         vcol("scan_km"), vcol("track_km"), vcol("heading_deg"), pad_km=extra_km)
    dt = np.abs(minutes(viirs.time)[:, None] - minutes(modis.time)[j_])
    ok = valid & over & (dt <= max_dt_min)
    score = np.where(ok, dt * 1e3 + np.where(np.isfinite(km), km, 0), np.inf)
    j = score.argmin(axis=1)
    r = np.arange(len(viirs))
    sel = ok[r, j]
    return pd.DataFrame({
        "viirs_idx": viirs.index.values[sel],
        "modis_idx": modis.index.values[j_[r, j][sel]],
        "dist_km": km[r, j][sel], "dt_min": dt[r, j][sel]}, columns=cols)
