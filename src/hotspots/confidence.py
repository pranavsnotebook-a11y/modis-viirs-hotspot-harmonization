"""Unified 0-1 detection-confidence score for MODIS and VIIRS.

MODIS C6.1 gives a numeric 0-100 confidence; VIIRS 375 m gives only a class
(low = e.g. sun-glint / weak anomaly, nominal = ordinary detection, high = saturated).
The two are *not* calibrated probabilities, so the unified score is a convention:

* MODIS: confidence / 100.
* VIIRS: each class maps to the midpoint of the matching MODIS class range
  (low <30 -> 0.15, nominal 30-79 -> 0.55, high >=80 -> 0.90), so that equal unified
  scores mean the same *class* on both sensors. `calibrate_viirs_map` offers an
  empirical alternative (median MODIS confidence of coincident matches per VIIRS class).
* An event seen by both sensors combines scores as 1 - (1-p_m)(1-p_v), which assumes
  independent errors -- optimistic, since both sensors share the same fire and scene.
"""
import numpy as np
import pandas as pd

VIIRS_CLASS_SCORE = {"low": 0.15, "nominal": 0.55, "high": 0.90}


def conf_score(conf: pd.Series, sensor: str, viirs_map=None) -> pd.Series:
    if sensor.upper() == "MODIS":
        return (pd.to_numeric(conf, errors="coerce") / 100).clip(0, 1)
    m = {"l": "low", "n": "nominal", "h": "high"}
    cls = conf.astype(str).str.lower().map(lambda s: m.get(s, s))
    return cls.map(viirs_map or VIIRS_CLASS_SCORE).astype(float)


def combine(p_modis, p_viirs):
    """Score for an event; missing sensor contributes nothing (NaN -> 0)."""
    pm, pv = np.nan_to_num(np.asarray(p_modis, float)), np.nan_to_num(np.asarray(p_viirs, float))
    return 1 - (1 - pm) * (1 - pv)


def calibrate_viirs_map(viirs_class: pd.Series, modis_score: pd.Series, min_n: int = 5) -> dict:
    """Median MODIS score of coincident matches per VIIRS class (falls back to default)."""
    g = pd.DataFrame({"c": viirs_class.values, "s": modis_score.values}).dropna().groupby("c").s
    med, n = g.median(), g.size()
    return {k: float(med[k]) if n.get(k, 0) >= min_n else v for k, v in VIIRS_CLASS_SCORE.items()}
