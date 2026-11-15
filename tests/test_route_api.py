"""The route proxy: input checks, the answer's shape, memory and disk cache, the 1 request a second pace. The routing service is monkeypatched."""
import json
import pytest
from hotspots import firms, server


def q(**k):
    return {a: [b] for a, b in k.items()}


OK = {"code": "Ok", "routes": [
    {"geometry": {"type": "LineString", "coordinates": [[-57.6, -25.3], [-57.5, -25.2], [-57.4, -25.1]]}, "distance": 30000.4, "duration": 1500.2, "legs": [{"steps": []}]},
    {"geometry": {"coordinates": [[-57.6, -25.3], [-57.45, -25.25], [-57.4, -25.1]]}, "distance": 33000, "duration": 1700},
]}


@pytest.fixture(autouse=True)
def fresh(tmp_path, monkeypatch):
    monkeypatch.setattr(server, "ROUTE_DIR", tmp_path)
    server._route_mem.clear()
    monkeypatch.setattr(server, "_route_last", [0.0])


def test_rejects_bad_input():
    good = "-25.30,-57.60"
    for bad in (q(to=good), q(**{"from": good}), q(**{"from": "x", "to": good}), q(**{"from": good, "to": "1,2,3"}),
                q(**{"from": "95.0,10.0", "to": good}), q(**{"from": good, "to": "10.0,200.0"}), q(**{"from": good, "to": good}),
                q(**{"from": good, "to": "40.0,-57.6"}), q(**{"from": "-25.3;rm,-57.6", "to": good})):
        with pytest.raises(server.BadRequest):
            server.api_route(bad)


def test_returns_routes_and_calls_the_service_once(monkeypatch):
    calls = []
    monkeypatch.setattr(server, "_fetch_json", lambda url, timeout=40: (calls.append(url), OK)[1])
    out = server.api_route(q(**{"from": "-25.3,-57.6", "to": "-25.1,-57.4"}))
    assert len(out["routes"]) == 2 and out["code"] == "Ok"
    r = out["routes"][0]
    assert r["coords"][0] == [-57.6, -25.3] and r["distance"] == 30000.4 and r["duration"] == 1500.2 and set(r) == {"coords", "distance", "duration"}
    assert len(calls) == 1 and "-57.6000,-25.3000;-57.4000,-25.1000" in calls[0] and "alternatives=3" in calls[0] and "overview=full" in calls[0] and "geometries=geojson" in calls[0]


def test_second_identical_request_is_served_from_memory_then_from_disk(monkeypatch, tmp_path):
    calls = []
    monkeypatch.setattr(server, "_fetch_json", lambda url, timeout=40: (calls.append(url), OK)[1])
    a = server.api_route(q(**{"from": "-25.3,-57.6", "to": "-25.1,-57.4"}))
    b = server.api_route(q(**{"from": "-25.30001,-57.60002", "to": "-25.1,-57.4"}))  # same 4-decimal key
    assert len(calls) == 1 and b["cached"] is True and b["routes"] == a["routes"]
    assert list(tmp_path.glob("*.json"))
    server._route_mem.clear()
    c = server.api_route(q(**{"from": "-25.3,-57.6", "to": "-25.1,-57.4"}))
    assert len(calls) == 1 and c["cached"] is True and c["routes"] == a["routes"]


def test_upstream_failure_is_an_error_and_is_not_cached(monkeypatch):
    def boom(url, timeout=40):
        raise OSError("offline")
    monkeypatch.setattr(server, "_fetch_json", boom)
    with pytest.raises(firms.FirmsError):
        server.api_route(q(**{"from": "-25.3,-57.6", "to": "-25.1,-57.4"}))
    assert not server._route_mem


def test_no_route_is_an_answer_with_no_routes(monkeypatch, tmp_path):
    monkeypatch.setattr(server, "_fetch_json", lambda url, timeout=40: {"code": "NoRoute", "routes": []})
    out = server.api_route(q(**{"from": "-25.3,-57.6", "to": "-25.1,-57.4"}))
    assert out["routes"] == [] and out["code"] == "NoRoute" and not list(tmp_path.glob("*.json"))


def test_requests_to_the_service_are_at_least_one_second_apart(monkeypatch):
    stamps, naps = [], []
    clock = [1000.0]
    monkeypatch.setattr(server.time, "time", lambda: clock[0])
    monkeypatch.setattr(server.time, "sleep", lambda s: (naps.append(s), clock.__setitem__(0, clock[0] + s)))
    monkeypatch.setattr(server, "_fetch_json", lambda url, timeout=40: (stamps.append(clock[0]), OK)[1])
    server.api_route(q(**{"from": "-25.3,-57.6", "to": "-25.1,-57.4"}))
    clock[0] += .3
    server.api_route(q(**{"from": "-25.3,-57.6", "to": "-25.2,-57.4"}))
    assert len(stamps) == 2 and stamps[1] - stamps[0] >= 1.0 - 1e-9 and naps
