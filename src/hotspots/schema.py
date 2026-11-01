"""Normalize MODIS and VIIRS FIRMS records to a common schema."""
import numpy as np
import pandas as pd

COMMON_COLS = ["sensor", "latitude", "longitude", "time", "frp", "conf_class",
               "scan_km", "track_km", "daynight"]

# VIIRS 375 m pixel is ~0.375 km at nadir; FIRMS scan/track are in degrees-of-pixel
# multiples (km-scale factors), so we convert directly: scan/track are already
# relative pixel-size factors in FIRMS, multiplied by nominal size.
NOMINAL_KM = {"MODIS": 1.0, "VIIRS": 0.375}


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
    if sensor not in NOMINAL_KM:
        raise ValueError(f"unknown sensor {sensor!r}")
    conf = (modis_conf_class if sensor == "MODIS" else viirs_conf_class)(df["confidence"])
    nom = NOMINAL_KM[sensor]
    out = pd.DataFrame({
        "sensor": sensor,
        "latitude": df["latitude"].astype(float),
        "longitude": df["longitude"].astype(float),
        "time": _to_time(df),
        "frp": pd.to_numeric(df["frp"], errors="coerce"),
        "conf_class": conf,
        "scan_km": df["scan"].astype(float) * nom,
        "track_km": df["track"].astype(float) * nom,
        "daynight": df["daynight"],
    })
    return out[COMMON_COLS].reset_index(drop=True)
