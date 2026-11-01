"""Cross-sensor spatial/temporal matching of hot spots."""
import numpy as np
import pandas as pd
from scipy.spatial import cKDTree

EARTH_KM = 6371.0088


def _xyz(lat, lon):
    la, lo = np.radians(lat), np.radians(lon)
    return np.column_stack([np.cos(la) * np.cos(lo), np.cos(la) * np.sin(lo), np.sin(la)])


def match(modis: pd.DataFrame, viirs: pd.DataFrame, max_dt_min: float = 180.0,
          extra_km: float = 0.0) -> pd.DataFrame:
    """Match each VIIRS pixel to the nearest MODIS pixel whose footprint contains it.

    Match when great-circle distance <= max(scan, track)/2 + extra_km of the MODIS
    pixel and |dt| <= max_dt_min. Returns viirs_idx, modis_idx (index labels),
    dist_km, dt_min. Vectorized: k nearest MODIS candidates per VIIRS pixel.
    """
    cols = ["viirs_idx", "modis_idx", "dist_km", "dt_min"]
    if modis.empty or viirs.empty:
        return pd.DataFrame(columns=cols)
    k = min(8, len(modis))
    tree = cKDTree(_xyz(modis.latitude.values, modis.longitude.values))
    max_r = float((modis[["scan_km", "track_km"]].max(axis=1)).max()) / 2 + extra_km
    dist, ind = tree.query(_xyz(viirs.latitude.values, viirs.longitude.values), k=k,
                           distance_upper_bound=2 * np.sin(max_r / (2 * EARTH_KM)))
    ind = np.atleast_2d(ind.T).T if k == 1 else ind
    dist = dist.reshape(ind.shape)
    valid = ind < len(modis)
    ind_c = np.where(valid, ind, 0)
    km = 2 * EARTH_KM * np.arcsin(np.clip(dist / 2, 0, 1))
    radius = modis[["scan_km", "track_km"]].max(axis=1).values[ind_c] / 2 + extra_km
    mt = modis.time.values[ind_c]
    dt = np.abs((viirs.time.values[:, None] - mt) / np.timedelta64(1, "m"))
    ok = valid & (km <= radius) & (dt <= max_dt_min)
    km = np.where(ok, km, np.inf)
    j = km.argmin(axis=1)
    r = np.arange(len(viirs))
    sel = ok[r, j]
    return pd.DataFrame({
        "viirs_idx": viirs.index.values[sel],
        "modis_idx": modis.index.values[ind_c[r, j][sel]],
        "dist_km": km[r, j][sel], "dt_min": dt[r, j][sel]}, columns=cols)
