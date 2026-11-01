import numpy as np
import pandas as pd
import pytest
from hotspots.confidence import calibrate_viirs_map, combine, conf_score
from hotspots.detection import fit_logistic, frp_floor
from hotspots.footprint import heading_deg, rects_overlap
from hotspots.frp import fit_frp_model, fit_quality, harmonized_frp
from hotspots.merge import harmonize
from hotspots.schema import normalize

KM_DEG = 1 / 111.195  # degrees latitude per km


def _raw(lat, lon, scan, track, sat, frp=10.0, conf="n", t=1030):
    n = len(lat)
    return pd.DataFrame({"latitude": lat, "longitude": lon, "acq_date": ["2024-08-01"] * n,
                         "acq_time": [t] * n, "frp": [frp] * n if np.isscalar(frp) else frp,
                         "confidence": [conf] * n, "scan": [scan] * n, "track": [track] * n,
                         "satellite": [sat] * n, "daynight": ["D"] * n})


def test_heading_sun_synchronous():
    h = heading_deg([0, 0, 0], ["A", "T", "X"], ["D", "D", "D"])
    assert 340 < h[0] < 350          # Aqua day: ascending, slightly west of north
    assert 190 < h[1] < 200          # Terra day: descending, slightly west of south
    assert np.isnan(h[2])            # unknown satellite -> axis-aligned fallback
    assert heading_deg([0], ["A"], ["N"])[0] == pytest.approx(h[1])  # Aqua night = descending


def test_rectangle_overlap_vs_circle():
    # 4 km (scan, east-west) x 1 km (track, north-south) pixel, axis-aligned.
    ov = lambda de, dn, az=np.nan: bool(rects_overlap(de, dn, 4, 1, az, 0.375, 0.375, az))
    assert ov(1.9, 0)          # inside along scan
    assert not ov(0, 1.5)      # a 2 km-radius circle would have matched this
    assert ov(2.1, 0.6)        # near the corner, outside a 0.5 km circle along track
    assert ov(0, 1.5, 90)      # rotated 90 deg: track now east-west, scan north-south
    assert not ov(1.9, 0, 90)


def test_match_uses_rectangle():
    m = normalize(_raw([0.0], [0.0], 4.0, 1.0, "X", conf=80), "MODIS")
    v = normalize(_raw([1.5 * KM_DEG, 0.0], [0.0, 1.9 * KM_DEG], 0.375, 0.375, "Y"), "VIIRS")
    out = harmonize(m, v, max_dt_min=30)
    assert list(out.detected_by[:2]) == ["viirs", "both"]


def test_frp_sum_is_per_viirs_satellite():
    m = normalize(_raw([0.0], [0.0], 1.0, 1.0, "A", frp=20.0, conf=80), "MODIS")
    v = pd.concat([_raw([0.0, 0.001], [0.0, 0.0], 0.375, 0.375, "N", frp=5.0),
                   _raw([0.0], [0.001], 0.375, 0.375, "N20", frp=7.0)], ignore_index=True)
    out = harmonize(m, normalize(v, "VIIRS"), max_dt_min=30)
    b = out[out.detected_by == "both"]
    assert sorted(b.viirs_frp_in_modis_pixel) == [7.0, 10.0, 10.0]


def test_frp_model_recovers_slope_and_resists_outliers():
    rng = np.random.default_rng(0)
    x = rng.uniform(0.5, 2.5, 200)
    y = 0.1 + 1.2 * x + rng.normal(0, 0.1, 200)
    y[:20] += 1.5  # 10% gross outliers
    m = fit_frp_model(10 ** x, 10 ** y)
    assert m.slope == pytest.approx(1.2, abs=0.08)
    assert m.sigma_dex < 0.2
    h = harmonized_frp([10.0, 10.0], ["MODIS", "VIIRS"], m)
    assert h.frp_lo[0] < h.frp_h[0] < h.frp_hi[0]
    assert h.frp_h[1] == h.frp_lo[1] == h.frp_hi[1] == 10.0
    q = fit_quality(10 ** x[20:60], 10 ** y[20:60])
    assert q["n"] == 40 and q["spearman"] > 0.8
    assert fit_quality([1, 2], [1, 2]) == {"n": 2}
    r = fit_frp_model([10, 20, 40], [20, 40, 80], fixed_slope=1.0)
    assert r.intercept == pytest.approx(np.log10(2)) and r.slope == 1.0


def test_confidence_scores():
    assert list(conf_score(pd.Series([0, 55, 100]), "MODIS")) == [0, 0.55, 1]
    assert list(conf_score(pd.Series(["l", "nominal", "h"]), "VIIRS")) == [0.15, 0.55, 0.9]
    assert combine([0.5, np.nan], [0.5, 0.3]).tolist() == pytest.approx([0.75, 0.3])
    cal = calibrate_viirs_map(pd.Series(["high"] * 6 + ["low"]), pd.Series([0.8] * 6 + [0.1]))
    assert cal == {"low": 0.15, "nominal": 0.55, "high": 0.8}  # low has n<5 -> default


def test_detection_logistic_recovers_pixel_size_effect():
    rng = np.random.default_rng(1)
    frp, area = 10 ** rng.uniform(0, 2.5, 4000), rng.uniform(1, 9, 4000)
    z = -1 + 3 * np.log10(frp) - 3 * np.log10(area)  # detection ~ FRP / area
    det = rng.random(4000) < 1 / (1 + np.exp(-z))
    f = fit_logistic(frp, area, det)
    assert f["b_log_frp"] == pytest.approx(3, abs=0.4)
    assert f["b_log_area"] == pytest.approx(-3, abs=0.5)
    assert f["frp50_4km2"] > f["frp50_1km2"]


def test_frp_floor_by_area():
    df = pd.DataFrame({"frp": [1, 2, 3, 10, 20, 30.0], "scan_km": [1, 1, 1, 3, 3, 3.0],
                       "track_km": [1.0] * 6, "daynight": ["D"] * 6})
    t = frp_floor(df, [0, 2, 9], q=0.5)
    assert list(t.frp_q50) == [2.0, 20.0]
