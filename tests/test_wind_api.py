"""The wind cache endpoint: input checks, and that a cell on disk is served without asking the wind service."""
import json
import pytest
from hotspots import server


def q(**k):
    return {a: [b] for a, b in k.items()}


def test_rejects_bad_input():
    for bad in (q(cells="x", d0="2025-01-08", d1="2025-01-09"), q(cells="-25.25,-57.00", d0="2025-01-08", d1="2025-03-09"),
                q(cells="-25.25,-57.00", d0="8 Jan", d1="2025-01-09"), q(cells=";".join(["-25.25,-57.00"] * 61), d0="2025-01-08", d1="2025-01-09")):
        with pytest.raises(server.BadRequest):
            server.api_wind(bad)


def test_serves_cached_cell_and_reports_missing(tmp_path, monkeypatch):
    monkeypatch.setattr(server, "WIND_DIR", tmp_path)
    calls = []

    def fake(url, timeout=40):
        calls.append(url)
        raise OSError("offline")

    monkeypatch.setattr(server, "_fetch_json", fake)
    d = tmp_path / "2025-01-08_2025-01-09_era5"
    d.mkdir()
    h = {"time": ["2025-01-08T00:00"], "wind_speed_100m": [3.0]}
    (d / "-25.25_-57.00.json").write_text(json.dumps(h))
    out = server.api_wind(q(cells="-25.25,-57.00", d0="2025-01-08", d1="2025-01-09", old="1"))
    assert out["cells"]["-25.25,-57.00"] == h and calls == []
    out = server.api_wind(q(cells="-25.25,-57.00;-25.50,-57.00", d0="2025-01-08", d1="2025-01-09", old="1"))
    assert out["cells"]["-25.50,-57.00"] is None and len(calls) == 1 and "-25.50" in calls[0] and "-25.25" not in calls[0]


def test_stores_what_the_service_returns(tmp_path, monkeypatch):
    monkeypatch.setattr(server, "WIND_DIR", tmp_path)
    h = {"time": ["2025-01-08T00:00"], "wind_speed_100m": [4.0]}
    monkeypatch.setattr(server, "_fetch_json", lambda url, timeout=40: {"hourly": h})
    out = server.api_wind(q(cells="-25.25,-57.00", d0="2025-01-08", d1="2025-01-09", old="1"))
    assert out["cells"]["-25.25,-57.00"] == h
    assert json.loads((tmp_path / "2025-01-08_2025-01-09_era5" / "-25.25_-57.00.json").read_text()) == h
