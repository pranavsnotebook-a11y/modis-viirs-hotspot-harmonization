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
    """For each VIIRS pixel find the MODIS pixel (if any) whose footprint contains it.

    A pair matches when great-circle distance <= half the MODIS pixel diagonal-ish
    extent (max(scan, track)/2 + extra_km) and |dt| <= max_dt_min.
    Returns columns viirs_idx, modis_idx, dist_km, dt_min (nearest MODIS per VIIRS).
    """
    if modis.empty or viirs.empty:
        return pd.DataFrame(columns=["viirs_idx", "modis_idx", "dist_km", "dt_min"])
    tree = cKDTree(_xyz(modis.latitude.values, modis.longitude.values))
    # chord length for generous radius, refine afterwards
    r_km = float(modis[["scan_km", "track_km"]].max().max()) / 2 + extra_km
    chord = 2 * np.sin(r_km / (2 * EARTH_KM))
    rows = []
    for vi, nbrs in enumerate(tree.query_ball_point(
            _xyz(viirs.latitude.values, viirs.longitude.values), chord)):
        best = None
        for mi in nbrs:
            m = modis.iloc[mi]
            dt = abs((viirs.time.iloc[vi] - m.time).total_seconds()) / 60
            if dt > max_dt_min:
                continue
            d = 2 * EARTH_KM * np.arcsin(np.linalg.norm(
                _xyz(viirs.latitude.values[vi:vi+1], viirs.longitude.values[vi:vi+1])[0]
                - _xyz(np.array([m.latitude]), np.array([m.longitude]))[0]) / 2)
            if d > max(m.scan_km, m.track_km) / 2 + extra_km:
                continue
            if best is None or d < best[2]:
                best = (vi, mi, d, dt)
        if best:
            rows.append(best)
    return pd.DataFrame(rows, columns=["viirs_idx", "modis_idx", "dist_km", "dt_min"])
