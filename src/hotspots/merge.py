"""Merge matched MODIS/VIIRS detections into harmonized fire events."""
import pandas as pd
from .match import match


def harmonize(modis: pd.DataFrame, viirs: pd.DataFrame, **kw) -> pd.DataFrame:
    """Return one row per fire event. VIIRS location preferred (finer resolution);
    FRP of a MODIS pixel is summed over the VIIRS pixels it contains for comparability.
    `detected_by` is 'both', 'viirs' or 'modis'."""
    pairs = match(modis, viirs, **kw)
    mi_used = set(pairs.modis_idx)
    vi_used = set(pairs.viirs_idx)
    v_frp_by_m = viirs.frp.groupby(pairs.set_index("viirs_idx").modis_idx).sum() \
        if len(pairs) else pd.Series(dtype=float)

    v = viirs.copy()
    v["detected_by"] = ["both" if i in vi_used else "viirs" for i in v.index]
    v["modis_idx"] = pairs.set_index("viirs_idx").modis_idx.reindex(v.index)
    v["modis_frp"] = v.modis_idx.map(modis.frp)

    m_only = modis[~modis.index.isin(mi_used)].copy()
    m_only["detected_by"] = "modis"
    m_only["modis_frp"] = m_only.frp
    out = pd.concat([v.rename(columns={"frp": "viirs_frp"}),
                     m_only.rename(columns={"frp": "viirs_frp"}).assign(viirs_frp=float("nan"))],
                    ignore_index=True)
    return out.drop(columns=["modis_idx"])
