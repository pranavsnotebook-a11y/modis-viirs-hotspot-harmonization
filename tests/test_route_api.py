"""The route proxy: input checks, the answer's shape, memory and disk cache, the 1 request a second pace. The routing service is monkeypatched."""
import json
import pytest
from hotspots import firms, server


def q(**k):
    return {a: [b] for a, b in k.items()}


OK = {"code": "Ok", "routes": [
    {"geometry": {"type": "LineString", "coordinates": [[-57.6, -25.3], [-57.5, -25.2], [-57.4, -25.1]]}, "distance": 30000.4, "duration": 1500.2,
     "legs": [{"steps": [
         {"name": "Ruta 9", "ref": "PY09", "distance": 12000.04, "duration": 600, "maneuver": {"type": "depart", "location": [-57.6, -25.3]}},
         {"name": "", "ref": "PY03", "distance": 18000, "duration": 900, "maneuver": {"type": "turn", "modifier": "left", "location": [-57.5, -25.2]}},
         {"name": "", "distance": 0, "duration": 0, "maneuver": {"type": "arrive", "location": [-57.4, -25.1]}}]}]},
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
    assert r["coords"][0] == [-57.6, -25.3] and r["distance"] == 30000.4 and r["duration"] == 1500.2 and set(r) == {"coords", "distance", "duration", "steps"}
    assert len(calls) == 1 and "-57.6000,-25.3000;-57.4000,-25.1000" in calls[0] and "alternatives=3" in calls[0] and "overview=full" in calls[0] and "geometries=geojson" in calls[0] and "steps=true" in calls[0]


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


def test_steps_are_flattened_and_a_via_point_drops_its_arrive_and_depart():
    out = server._route_steps([
        {"steps": [{"name": "A", "distance": 100, "duration": 10, "maneuver": {"type": "depart", "location": [-57.6, -25.3]}},
                   {"name": "A", "distance": 0, "duration": 0, "maneuver": {"type": "arrive", "location": [-57.5, -25.2]}}]},
        {"steps": [{"name": "B", "distance": 0, "duration": 0, "maneuver": {"type": "depart", "location": [-57.5, -25.2]}},
                   {"name": "B", "distance": 200, "duration": 20, "maneuver": {"type": "turn", "modifier": "right", "location": [-57.5, -25.2]}},
                   {"name": "", "distance": 0, "duration": 0, "maneuver": {"type": "arrive", "location": [-57.4, -25.1]}}]}])
    assert [s["type"] for s in out] == ["depart", "turn", "arrive"] and out[1]["mod"] == "right" and out[1]["at"] == [-57.5, -25.2]
    assert server._route_steps(None) == [] and server._route_steps([{"steps": None}]) == []


def test_the_answer_has_steps_with_names_and_places(monkeypatch):
    monkeypatch.setattr(server, "_fetch_json", lambda url, timeout=40: OK)
    out = server.api_route(q(**{"from": "-25.3,-57.6", "to": "-25.1,-57.4"}))
    st = out["routes"][0]["steps"]
    assert [s["type"] for s in st] == ["depart", "turn", "arrive"] and st[0]["name"] == "Ruta 9" and st[1]["name"] == "PY03" and st[1]["mod"] == "left" and st[1]["at"] == [-57.5, -25.2]
    assert out["routes"][1]["steps"] == []


def qv(*vias, **k):
    d = q(**k)
    d["via"] = list(vias)
    return d


def test_via_points_are_validated_count_and_range():
    base = {"from": "-25.30,-57.60", "to": "-25.10,-57.40"}
    ok = ["-25.20,-57.50", "-25.25,-57.45", "-25.15,-57.42"]
    for bad in (qv(*ok, "-25.12,-57.41", **base),                      # four: one too many
                qv("x", **base), qv("-25.2;rm,-57.5", **base), qv("95.0,10.0", **base), qv("-25.2,200.0", **base), qv("-25.2", **base), qv("", **base)):
        with pytest.raises(server.BadRequest):
            server.api_route(bad)


def test_one_to_three_via_points_are_accepted_and_go_to_the_service_in_order_with_one_route(monkeypatch):
    calls = []
    monkeypatch.setattr(server, "_fetch_json", lambda url, timeout=40: (calls.append(url), OK)[1])
    server.api_route(qv("-25.20,-57.50", "-25.15,-57.45", "-25.12,-57.42", **{"from": "-25.3,-57.6", "to": "-25.1,-57.4"}))
    u = calls[0]
    assert "-57.6000,-25.3000;-57.5000,-25.2000;-57.4500,-25.1500;-57.4200,-25.1200;-57.4000,-25.1000" in u and "alternatives=false" in u and "steps=true" in u


def test_the_cache_key_includes_the_via_points(monkeypatch, tmp_path):
    calls = []
    monkeypatch.setattr(server, "_fetch_json", lambda url, timeout=40: (calls.append(url), OK)[1])
    base = {"from": "-25.3,-57.6", "to": "-25.1,-57.4"}
    server.api_route(q(**base))
    server.api_route(qv("-25.20,-57.50", **base))                 # same from and to, with a via: a different answer, so a new request
    assert len(calls) == 2
    again = server.api_route(qv("-25.200001,-57.500002", **base))  # same via at 4 decimals: served from the cache
    assert len(calls) == 2 and again["cached"] is True
    server.api_route(qv("-25.21,-57.50", **base))                 # another via: new request
    server.api_route(qv("-25.20,-57.50", "-25.15,-57.45", **base))  # two vias: new request
    assert len(calls) == 4
    assert len(list(tmp_path.glob("*.json"))) == 4
    server._route_mem.clear()
    assert server.api_route(qv("-25.20,-57.50", **base))["cached"] is True and len(calls) == 4   # and from disk
    assert len(server._route_mem) == 1


def test_via_requests_keep_the_one_a_second_pace(monkeypatch):
    clock, stamps = [1000.0], []
    monkeypatch.setattr(server.time, "time", lambda: clock[0])
    monkeypatch.setattr(server.time, "sleep", lambda s: clock.__setitem__(0, clock[0] + s))
    monkeypatch.setattr(server, "_fetch_json", lambda url, timeout=40: (stamps.append(clock[0]), OK)[1])
    for v in ("-25.20,-57.50", "-25.21,-57.50", "-25.22,-57.50"):
        server.api_route(qv(v, **{"from": "-25.3,-57.6", "to": "-25.1,-57.4"}))
    assert len(stamps) == 3 and all(b - a >= 1.0 - 1e-9 for a, b in zip(stamps, stamps[1:]))
