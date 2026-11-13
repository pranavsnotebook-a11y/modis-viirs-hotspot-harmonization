"""Harmonization v2 rules, the FIRMS client's key handling and normalization, and the API input checks."""
import numpy as np
import pandas as pd
import pytest
from hotspots import firms, harmonize as hz
from hotspots.schema import normalize


def _frame(lat, lon, times, sensor, sat, scan=1.0, track=1.0):
    d = pd.DataFrame({"latitude": lat, "longitude": lon, "acq_date": ["2026-11-10"] * len(lat), "acq_time": times,
                      "frp": [10.0] * len(lat), "confidence": ([80] if sensor == "MODIS" else ["n"]) * len(lat),
                      "scan": [scan] * len(lat), "track": [track] * len(lat), "daynight": ["D"] * len(lat), "satellite": [sat] * len(lat)})
    return normalize(d, sensor)


def test_tier_rules():
    st, amb, core = hz.tier([10, 10, 10, 90, 90, 200], [0.1, 0.9, 0.1, 0.1, 0.1, 0.1], [1.0] * 6, [1.0] * 6,
                            [np.nan, np.nan, 12, np.nan, 95, np.nan])
    assert list(st) == ["strong", "moderate", "moderate", "moderate", "weak", "weak"]
    assert list(amb) == [False, False, True, False, True, False]
    assert list(core) == [True, False, True, True, True, True]


def test_rival_outside_window_is_not_ambiguous():
    _, amb, _ = hz.tier([170], [0.1], [1.0], [1.0], [182], window=180)
    assert not amb[0]


def test_every_source_record_is_kept_and_counted_once():
    m = _frame([10.0, 10.0085], [30.0, 30.0], [1330, 1330], "MODIS", "A")       # two MODIS pixels ~0.95 km apart
    v = _frame([10.0042, 40.0], [30.0, 40.0], [1340, 1340], "VIIRS", "N20", 0.4, 0.4)  # one between them, one far away
    m["sat"], v["sat"] = 1, 3
    recs, s = hz.harmonize(m, v, 180)
    assert len(recs) == 4 and s["modis"] == 2 and s["viirs"] == 2
    assert s["matched_viirs"] == 1 and s["viirs_only"] == 1
    assert s["harmonized"] == 3  # 2 MODIS + 2 VIIRS - 1 matched VIIRS
    hit = recs[recs.record_id == "V0000000"].iloc[0]
    assert hit.status == "Matched" and hit.n_cand == 2 and bool(hit.ambiguous)  # both MODIS pixels overlap it, same time
    assert recs[recs.record_id == "V0000001"].iloc[0].status == "VIIRS Only"


def test_time_window_is_respected():
    m = _frame([10.0], [30.0], [1000], "MODIS", "T")
    v = _frame([10.0], [30.0], [1400], "VIIRS", "N20", 0.4, 0.4)
    _, s = hz.harmonize(m, v, 180)
    assert s["matched_viirs"] == 0
    _, s = hz.harmonize(m, v, 360)
    assert s["matched_viirs"] == 1 and s["strength_viirs"]["weak"] == 1


def test_map_key_never_in_errors(monkeypatch):
    monkeypatch.setenv("FIRMS_MAP_KEY", "abcdef0123456789abcdef0123456789")
    assert firms.map_key() == "abcdef0123456789abcdef0123456789"
    assert "<MAP_KEY>" in firms._redact("https://x/api/area/csv/abcdef0123456789abcdef0123456789/MODIS_NRT", firms.map_key())
    monkeypatch.setenv("FIRMS_MAP_KEY", "bad key; rm -rf")
    monkeypatch.setattr(firms, "_load_dotenv", lambda: {})
    assert firms.map_key() is None


def test_no_key_paths_fail_clearly(monkeypatch):
    monkeypatch.delenv("FIRMS_MAP_KEY", raising=False)
    monkeypatch.setattr(firms, "_load_dotenv", lambda: {})
    with pytest.raises(firms.FirmsError, match="FIRMS_MAP_KEY"):
        firms.area("MODIS_NRT")
    with pytest.raises(firms.FirmsError, match="no public"):
        firms.public("MODIS_SP")
    with pytest.raises(firms.FirmsError):
        firms.bbox_text((10, 0, 5, 1))


def test_normalize_keeps_product_and_satellite():
    raw = pd.DataFrame({"latitude": [1.0], "longitude": [2.0], "bright_ti4": [330.0], "scan": [0.4], "track": [0.4],
                        "acq_date": ["2026-11-10"], "acq_time": ["0512"], "satellite": ["N21"], "confidence": ["h"],
                        "version": ["2.0NRT"], "bright_ti5": [290.0], "frp": [3.5], "daynight": ["N"]})
    n = firms.normalize(raw, "VIIRS_NOAA21_NRT")
    assert n.sat.iloc[0] == 4 and n["product"].iloc[0] == "VIIRS_NOAA21_NRT" and n.processing.iloc[0] == "NRT"
    assert str(n.time.iloc[0]) == "2026-11-10 05:12:00+00:00" and n.conf_class.iloc[0] == "high"
    assert firms.normalize(pd.DataFrame(), "MODIS_NRT").empty


def test_server_rejects_bad_boxes():
    from hotspots.server import BadRequest, bbox_arg
    assert bbox_arg({"bbox": ["-10,-5,10,5"]}) == (-10, -5, 10, 5)
    for b in ("1,2,3", "a,b,c,d", "10,0,5,1"):
        with pytest.raises(BadRequest):
            bbox_arg({"bbox": [b]})
    with pytest.raises(BadRequest):
        bbox_arg({"bbox": ["-180,-90,180,90"]}, max_deg=2500)
