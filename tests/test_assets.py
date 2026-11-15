from hotspots.assets import kv, simplify


def test_kv_reads_highest_voltage():
    assert kv({"voltage": "500000"}) == 500
    assert kv({"voltage": "220000;66000"}) == 220
    assert kv({}) is None
    assert kv({"voltage": "high"}) is None


def test_simplify_keeps_ends_and_corners():
    straight = [(-25.0, -57.0 + i * 0.001) for i in range(50)]
    assert simplify(straight, 40) == [straight[0], straight[-1]]
    corner = [(-25.0, -57.0), (-25.0, -56.9), (-25.1, -56.9)]
    assert simplify(corner, 40) == corner


def test_selector_and_tiles():
    from hotspots.assets import selector, split, DEFAULT_PRESET
    p = {**DEFAULT_PRESET, "roads": ["motorway", "trunk"], "health": ["hospital"]}
    assert selector("roads", p) == 'way["highway"~"^(motorway|trunk)$"]'
    assert 'amenity"~"^(hospital)$' in selector("health", p)
    assert "voltage" in selector("power", p)
    parts = split((-10, -60, 0, -50))
    assert len(parts) == 4 and parts[0] == (-10, -60, -5, -55) and parts[3] == (-5, -55, 0, -50)


def test_build_records_layers_and_raises_tolerance(monkeypatch):
    from hotspots import assets
    line = {"type": "way", "id": 1, "tags": {"voltage": "500000"}, "geometry": [{"lat": -25.0 - i * 1e-4, "lon": -57.0 + (i % 7) * 3e-4} for i in range(200)]}
    school = {"type": "node", "id": 2, "lat": -25.1, "lon": -57.1, "tags": {"amenity": "school"}}

    def fake(iso, sel, geom, bbox, tiles, log, cache):
        return ([line] if "power" in sel else [school]), {"tiled": False, "queries": 1}
    monkeypatch.setattr(assets, "fetch_layer", fake)
    out, blob = assets.build("XX", {"layers": ["power", "schools"]}, log=lambda *_: None)
    assert out["layers"]["power"]["built"] and out["layers"]["schools"]["built"]
    assert out["layers"]["roads"] == {"built": False, "reason": "not built for this region"} and "roads" not in out
    assert len(out["power"]) == 1 and len(out["schools"]) == 1 and out["simplify_m"]["power"] >= 40
    small, _ = assets.build("XX", {"layers": ["power"]}, max_kb=0.3, log=lambda *_: None)
    assert small["simplify_m"]["power"] > 40  # a size limit forces a coarser line


def test_merge_ways_joins_same_ref_end_to_end():
    from hotspots.assets import merge_ways
    a = (1, "BR-1", [(0.0, 0.0), (0.0, 1.0)])
    b = (2, "BR-1", [(0.0, 2.0), (0.0, 1.0)])  # runs the other way: joined by reversing
    c = (3, "BR-1", [(5.0, 5.0), (5.0, 6.0)])  # same ref, not connected: stays apart
    d = (4, None, [(0.0, 2.0), (0.0, 3.0)])     # no ref or name: never joined
    out = {w[0]: w for w in merge_ways([a, b, c, d])}
    assert len(out) == 3 and out[1][1] == 2
    assert out[1][3] in ([(0.0, 0.0), (0.0, 1.0), (0.0, 2.0)], [(0.0, 2.0), (0.0, 1.0), (0.0, 0.0)])
    assert out[3][1] == 1 and out[4][1] == 1
