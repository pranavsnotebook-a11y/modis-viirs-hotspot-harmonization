"""Normalize MODIS and VIIRS FIRMS records to a common schema."""
import numpy as np
import pandas as pd
from .confidence import conf_score
from .footprint import heading_deg

COMMON_COLS = ["sensor", "satellite", "latitude", "longitude", "time", "frp", "conf_class",
               "conf_score", "scan_km", "track_km", "heading_deg", "daynight"]

# FIRMS `scan` and `track` are already pixel dimensions in km (they grow toward the
# swath edge), so they are used as-is.
SENSORS = ("MODIS", "VIIRS")


def _to_time(df: pd.DataFrame) -> pd.Series:
    hhmm = df["acq_time"].astype(int).astype(str).str.zfill(4)
    return pd.to_datetime(df["acq_date"].astype(str) + " " + hhmm,
                          format="%Y-%m-%d %H%M", utc=True)


def modis_conf_class(conf: pd.Series) -> pd.Series:
    """MODIS numeric confidence (0-100) -> low (<30) / nominal (30-79) / high (>=80)."""
    c = pd.to_numeric(conf)
    return pd.Series(np.select([c < 30, c < 80], ["low", "nominal"], "high"),
                     index=conf.index)


def viirs_conf_class(conf: pd.Series) -> pd.Series:
    """VIIRS confidence is l/n/h (may be spelled out)."""
    m = {"l": "low", "n": "nominal", "h": "high",
         "low": "low", "nominal": "nominal", "high": "high"}
    return conf.astype(str).str.lower().map(m)


def normalize(df: pd.DataFrame, sensor: str) -> pd.DataFrame:
    sensor = sensor.upper()
    if sensor not in SENSORS:
        raise ValueError(f"unknown sensor {sensor!r}")
    conf = (modis_conf_class if sensor == "MODIS" else viirs_conf_class)(df["confidence"])
    sat = df["satellite"].astype(str) if "satellite" in df else pd.Series(sensor, index=df.index)
    out = pd.DataFrame({
        "sensor": sensor,
        "satellite": sat,
        "latitude": df["latitude"].astype(float),
        "longitude": df["longitude"].astype(float),
        "time": _to_time(df),
        "frp": pd.to_numeric(df["frp"], errors="coerce"),
        "conf_class": conf,
        "conf_score": conf_score(df["confidence"], sensor),
        "scan_km": df["scan"].astype(float),
        "track_km": df["track"].astype(float),
        "heading_deg": heading_deg(df["latitude"].astype(float), sat, df["daynight"]),
        "daynight": df["daynight"],
    })
    return out[COMMON_COLS].reset_index(drop=True)
