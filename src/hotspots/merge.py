"""Merge matched MODIS/VIIRS detections into harmonized fire events."""
import pandas as pd
from .confidence import combine
from .match import match


def harmonize(modis: pd.DataFrame, viirs: pd.DataFrame, **kw) -> pd.DataFrame:
    """One row per fire event. VIIRS location is preferred (finer resolution).

    `detected_by` is 'both', 'viirs' or 'modis'. `viirs_frp` is the FRP of the VIIRS
    pixel; `modis_frp` is the matched MODIS pixel's FRP (pixel-level, not summed).
    `viirs_frp_in_modis_pixel` sums VIIRS FRP per (MODIS pixel, VIIRS satellite) so that
    several VIIRS satellites are never added together. `event_conf` is the unified 0-1
    confidence (see `confidence.combine`). `modis_idx`/`dt_min` refer to the match.
    """
    pairs = match(modis, viirs, **kw).set_index("viirs_idx")
    v = viirs.rename(columns={"frp": "viirs_frp"}).copy()
    v["modis_idx"] = pairs.modis_idx.reindex(v.index)
    v["dt_min"] = pairs.dt_min.reindex(v.index)
    v["detected_by"] = v.modis_idx.notna().map({True: "both", False: "viirs"})
    v["modis_frp"] = v.modis_idx.map(modis.frp)
    v["viirs_frp_in_modis_pixel"] = v.groupby(["modis_idx", "satellite"]).viirs_frp.transform("sum")
    v["event_conf"] = combine(v.modis_idx.map(modis.conf_score), v.conf_score)
    m_only = modis[~modis.index.isin(pairs.modis_idx)].rename(columns={"frp": "modis_frp"})
    m_only = m_only.assign(detected_by="modis", event_conf=m_only.conf_score)
    return pd.concat([v, m_only], ignore_index=True)
