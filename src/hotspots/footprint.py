"""Oriented-rectangle pixel footprints and overlap tests.

FIRMS gives the pixel size (`scan` = along-scan km, `track` = along-track km) but no
pixel orientation. We approximate the along-track direction with the ground-track
heading of a sun-synchronous orbit (inclination ~98.2 deg), corrected for Earth rotation:

    sin(az_inertial) = cos(i) / cos(lat)          (clipped beyond |lat| ~ 81.8 deg)

The orbit direction comes from the satellite + day/night flag: Aqua, S-NPP, NOAA-20/21
cross the equator ascending in daytime (~13:30 LT) and descending at night; Terra is the
opposite (~10:30 LT descending). Caveats: the `daynight` flag is per-pixel solar zenith,
so near the poles (polar day/night) it can give the wrong orbit leg; Earth-rotation
correction uses a fixed 6.7 km/s ground speed; MODIS/VIIRS bow-tie and the triangular
along-scan response are ignored. Unknown satellites fall back to an axis-aligned
rectangle in local ENU (track = north-south, scan = east-west), which is within ~10 deg
of the true orientation outside the polar regions.
"""
import numpy as np

EARTH_KM = 6371.0088
INCLINATION_DEG = 98.2
GROUND_SPEED_KMS = 6.7
EARTH_ROT_KMS = 0.4651  # equatorial surface speed
DAY_ASCENDING = {"A", "N", "N20", "N21", "1", "2", "J1", "J2"}
DAY_DESCENDING = {"T"}


def heading_deg(lat, satellite, daynight):
    """Approximate ground-track azimuth (deg clockwise from north); NaN if unknown."""
    lat = np.asarray(lat, float)
    sat = np.asarray(satellite, dtype=object).astype(str)
    day = np.asarray(daynight, dtype=object).astype(str) == "D"
    asc_day, desc_day = np.isin(sat, list(DAY_ASCENDING)), np.isin(sat, list(DAY_DESCENDING))
    ascending = np.where(asc_day, day, ~day)
    coslat = np.cos(np.radians(lat))
    az = np.arcsin(np.clip(np.cos(np.radians(INCLINATION_DEG)) / np.maximum(coslat, 1e-6), -1, 1))
    az = np.where(ascending, az, np.pi - az)
    ve = GROUND_SPEED_KMS * np.sin(az) - EARTH_ROT_KMS * coslat
    vn = GROUND_SPEED_KMS * np.cos(az)
    out = np.degrees(np.arctan2(ve, vn)) % 360
    return np.where(asc_day | desc_day, out, np.nan)


def enu_km(lat0, lon0, lat, lon):
    """Local east/north offsets (km) of (lat, lon) from (lat0, lon0); fine for < ~50 km."""
    dlon = (np.asarray(lon) - lon0 + 180) % 360 - 180
    e = EARTH_KM * np.radians(dlon) * np.cos(np.radians(lat0))
    n = EARTH_KM * np.radians(np.asarray(lat) - lat0)
    return e, n


def _axes(az_deg):
    """Unit vectors (east, north) for along-track t and along-scan s; NaN -> axis-aligned."""
    a = np.radians(np.nan_to_num(az_deg, nan=0.0))
    return (np.sin(a), np.cos(a)), (np.cos(a), -np.sin(a))


def rects_overlap(de, dn, scan_a, track_a, az_a, scan_b, track_b, az_b, pad_km=0.0):
    """Separating-axis test for two oriented rectangles (vectorized).

    Rectangle A is centred at the origin, B at (de, dn) km east/north of A. `pad_km` grows
    A's half-sizes (e.g. geolocation uncertainty). Touching edges count as overlap.
    """
    (tae, tan_), (sae, san) = _axes(az_a)
    (tbe, tbn), (sbe, sbn) = _axes(az_b)
    ha_t, ha_s = np.asarray(track_a) / 2 + pad_km, np.asarray(scan_a) / 2 + pad_km
    hb_t, hb_s = np.asarray(track_b) / 2, np.asarray(scan_b) / 2
    ok = True
    for le, ln in ((tae, tan_), (sae, san), (tbe, tbn), (sbe, sbn)):
        proj = (ha_t * np.abs(tae * le + tan_ * ln) + ha_s * np.abs(sae * le + san * ln)
                + hb_t * np.abs(tbe * le + tbn * ln) + hb_s * np.abs(sbe * le + sbn * ln))
        ok = ok & (np.abs(de * le + dn * ln) <= proj + 1e-9)
    return ok
