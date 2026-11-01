"""Merge matched MODIS/VIIRS detections into harmonized fire events."""
import pandas as pd
from .match import match


def harmonize(modis: pd.DataFrame, viirs: pd.DataFrame, **kw) -> pd.DataFrame:
    """One row per fire event. VIIRS location is preferred (finer resolution).
    `detected_by` is 'both', 'viirs' or 'modis'. `viirs_frp` is the FRP of the VIIRS
    pixel; `modis_frp` is the matched MODIS pixel's FRP (pixel-level, not summed)."""
    pairs = match(modis, viirs, **kw).set_index("viirs_idx")
    v = viirs.rename(columns={"frp": "viirs_frp"}).copy()
    v["modis_idx"] = pairs.modis_idx.reindex(v.index)
    v["detected_by"] = v.modis_idx.notna().map({True: "both", False: "viirs"})
    v["modis_frp"] = v.modis_idx.map(modis.frp)
    # MODIS pixel with several VIIRS pixels: aggregate VIIRS FRP for fair comparison
    v["viirs_frp_in_modis_pixel"] = v.groupby("modis_idx").viirs_frp.transform("sum")
    m_only = modis[~modis.index.isin(pairs.modis_idx)].rename(columns={"frp": "modis_frp"})
    m_only = m_only.assign(detected_by="modis")
    return pd.concat([v.drop(columns="modis_idx"), m_only], ignore_index=True)
