"""MODIS-VIIRS harmonization rules, version 2. One place for the criteria; web/js/app.js mirrors them.

A VIIRS pixel is a candidate duplicate of a MODIS pixel when
  1. space: their pixel footprints overlap (FIRMS scan x track rectangles, oriented along the orbit), and
  2. time: their acquisition times differ by no more than the window (default 180 min).
Among MODIS pixels passing both, the one closest in time is chosen, then the nearest centre.
A MODIS pixel and the VIIRS pixels assigned to it form one group, counted once in Harmonized.
Nothing is merged or deleted: every source record is kept with its own values and its group link.

Each match also gets a rule-based strength. It is a label for how direct the evidence is, not a probability:
  strong    time gap <= 30 min (the same pass of the afternoon constellation: Aqua with S-NPP, NOAA-20, NOAA-21),
            the VIIRS centre lies in the core of the MODIS pixel, and no rival MODIS pixel is as close in time
  moderate  time gap <= 30 min otherwise, or time gap <= 120 min with a core hit and no rival
  weak      any other pair within the window: usually a different overpass, hours apart, of a fire that may
            have changed or spread, so it is the same place and probably the same event, not the same observation
Ambiguous: a second MODIS pixel also passes both tests with a time gap within 15 min of the chosen one, so the
group assignment is a rule choice. The VIIRS pixel is a duplicate either way; which MODIS pixel it belongs to is not
certain.
Core: centre distance <= half the shorter side of the MODIS pixel.
"""
import numpy as np
import pandas as pd
from .match import match

WINDOW = 180
MAX_WINDOW = 360
SAME_PASS_MIN = 30
NEAR_MIN = 120
AMBIG_MIN = 15
TIERS = ("strong", "moderate", "weak")
CRITERIA = {
    "spatial": "pixel footprints overlap (scan x track km, orbit-oriented rectangles)",
    "temporal_window_min": WINDOW,
    "selection": "closest acquisition time, then nearest centre; each VIIRS pixel joins at most one MODIS pixel",
    "strong": f"dt <= {SAME_PASS_MIN} min, centre in MODIS pixel core, no rival within {AMBIG_MIN} min",
    "moderate": f"dt <= {SAME_PASS_MIN} min otherwise, or dt <= {NEAR_MIN} min with core hit and no rival",
    "weak": "any other pair inside the window",
    "ambiguous": f"another MODIS pixel passes both tests with dt within {AMBIG_MIN} min of the chosen one",
    "core": "centre distance <= half the shorter side of the MODIS pixel",
    "counting": "Harmonized = MODIS + VIIRS - VIIRS pixels matched to MODIS; a group counts once",
}


def tier(dt, dist_km, m_scan, m_track, dt2, window=WINDOW):
    dt, dist_km, dt2 = np.asarray(dt, float), np.asarray(dist_km, float), np.asarray(dt2, float)
    core = dist_km <= 0.5 * np.minimum(m_scan, m_track)
    amb = np.isfinite(dt2) & (dt2 <= window) & (dt2 - dt <= AMBIG_MIN)
    strong = (dt <= SAME_PASS_MIN) & core & ~amb
    moderate = ~strong & ((dt <= SAME_PASS_MIN) | ((dt <= NEAR_MIN) & core & ~amb))
    return np.where(strong, "strong", np.where(moderate, "moderate", "weak")), amb, core


def match_days(m, v, window=MAX_WINDOW):
    """match() day by day so nearest-neighbour slots are not spent on other days. Positional indexes."""
    out = []
    if m.empty or v.empty:
        return pd.DataFrame(columns=["viirs_idx", "modis_idx", "dist_km", "dt_min", "n_cand", "dt2_min"])
    m, v = m.reset_index(drop=True), v.reset_index(drop=True)
    pad = pd.Timedelta(minutes=window)
    for d, idx in v.groupby(v.time.dt.floor("D")).groups.items():
        mm = m[(m.time >= d - pad) & (m.time < d + pd.Timedelta(days=1) + pad)]
        p = match(mm, v.loc[idx], max_dt_min=window, k=32)
        if len(p):
            out.append(p)
    return pd.concat(out, ignore_index=True) if out else pd.DataFrame(columns=["viirs_idx", "modis_idx", "dist_km", "dt_min", "n_cand", "dt2_min"])


def harmonize(m, v, window=WINDOW):
    """Normalized MODIS and VIIRS records -> one table of every source record with its match status.

    Columns added: record_id, status (Matched, MODIS Only, VIIRS Only), group_id (the MODIS record_id of the group),
    dt_min, dist_km, n_cand, dt2_min, strength, ambiguous. Returns (records, summary)."""
    m = m.reset_index(drop=True).copy()
    v = v.reset_index(drop=True).copy()
    m["record_id"] = [f"M{i:06d}" for i in range(len(m))]
    v["record_id"] = [f"V{i:07d}" for i in range(len(v))]
    p = match_days(m, v, window)
    for d in (m, v):
        for c, val in (("status", None), ("group_id", None), ("dt_min", np.nan), ("dist_km", np.nan), ("n_cand", 0), ("dt2_min", np.nan), ("strength", None), ("ambiguous", False)):
            d[c] = val
    m["status"], v["status"] = "MODIS Only", "VIIRS Only"
    if len(p):
        vi, mi = p.viirs_idx.astype(int).values, p.modis_idx.astype(int).values
        st, amb, _ = tier(p.dt_min, p.dist_km, m.scan_km.values[mi], m.track_km.values[mi], p.dt2_min, window)
        v.loc[vi, ["status", "group_id"]] = np.column_stack([np.full(len(vi), "Matched"), m.record_id.values[mi]])
        v.loc[vi, "dt_min"], v.loc[vi, "dist_km"] = p.dt_min.values, p.dist_km.values
        v.loc[vi, "n_cand"], v.loc[vi, "dt2_min"] = p.n_cand.values, p.dt2_min.values
        v.loc[vi, "strength"], v.loc[vi, "ambiguous"] = st, amb
        rank = {"strong": 0, "moderate": 1, "weak": 2}
        g = pd.DataFrame({"mi": mi, "dt": p.dt_min.values, "r": [rank[x] for x in st], "amb": amb})
        best = g.groupby("mi").agg(dt=("dt", "min"), r=("r", "min"), n=("dt", "size"), amb=("amb", "any"))
        ix = best.index.values
        m.loc[ix, "status"], m.loc[ix, "group_id"] = "Matched", m.record_id.values[ix]
        m.loc[ix, "dt_min"], m.loc[ix, "n_cand"] = best.dt.values, best.n.values  # for MODIS: VIIRS pixels in group
        m.loc[ix, "strength"] = [TIERS[r] for r in best.r.values]
        m.loc[ix, "ambiguous"] = best.amb.values
    vm = v.status == "Matched"
    summary = {
        "modis": len(m), "viirs": len(v), "matched_modis": int((m.status == "Matched").sum()), "matched_viirs": int(vm.sum()),
        "modis_only": int((m.status == "MODIS Only").sum()), "viirs_only": int((~vm).sum()),
        "harmonized": int(len(m) + len(v) - vm.sum()), "window_min": window,
        "strength_viirs": {t: int((v.strength == t).sum()) for t in TIERS}, "ambiguous_viirs": int(v.ambiguous.sum()),
        "criteria": CRITERIA,
    }
    return pd.concat([m, v], ignore_index=True), summary
