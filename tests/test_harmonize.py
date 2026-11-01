import pandas as pd
from hotspots.schema import normalize
from hotspots.merge import harmonize


def _modis():
    return pd.DataFrame({"latitude": [10.0, 20.0], "longitude": [30.0, 40.0],
        "acq_date": ["2024-08-01"] * 2, "acq_time": [1030, 1030], "frp": [20.0, 5.0],
        "confidence": [85, 20], "scan": [1.0, 1.0], "track": [1.0, 1.0], "daynight": ["D", "D"]})


def _viirs():
    return pd.DataFrame({"latitude": [10.001, 50.0], "longitude": [30.001, 60.0],
        "acq_date": ["2024-08-01"] * 2, "acq_time": [1045, 1045], "frp": [3.0, 1.0],
        "confidence": ["h", "n"], "scan": [1.0, 1.0], "track": [1.0, 1.0], "daynight": ["D", "D"]})


def test_confidence_mapping():
    m = normalize(_modis(), "MODIS")
    assert list(m.conf_class) == ["high", "low"]
    assert list(normalize(_viirs(), "VIIRS").conf_class) == ["high", "nominal"]


def test_harmonize_counts():
    out = harmonize(normalize(_modis(), "MODIS"), normalize(_viirs(), "VIIRS"))
    assert sorted(out.detected_by) == ["both", "modis", "viirs"]
