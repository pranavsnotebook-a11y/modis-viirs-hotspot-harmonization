import numpy as np

from hotspots.feed import build_feed

DAY = 1440


def _bundle():
    # index 0,1 MODIS (n_modis=2); then VIIRS. country 0 = Paraguay, 1 = elsewhere
    rows = [  # lat, lon, frp(0.01MW), t, country, dt, sat
        (-2500000, -5700000, 1000, 0, 0, 0, 0),                     # 0 MODIS, old (outside 72 h)
        (-2500000, -5700000, 2000, 6 * DAY, 0, 0, 1),               # 1 MODIS, latest day
        (-2510000, -5710000, 300, 6 * DAY + 5, 0, 500, 2),          # 2 VIIRS unique (dt > 180): kept
        (-2510000, -5710000, 400, 6 * DAY + 6, 0, 10, 2),           # 3 VIIRS with MODIS partner: dropped
        (-2520000, -5720000, 500, 6 * DAY + 60, 0, 999, 3),         # 4 VIIRS, new pass of NOAA-20 (gap 54 > 30)
        (-2520000, -5720000, 500, 6 * DAY + 70, 1, 999, 3),         # 5 other country
        (-2530000, -5730000, 700, 3 * DAY - 10, 0, 300, 2),         # 6 VIIRS, outside 72 h of the end, inside 4 days
    ]
    a = np.array(rows, dtype=np.int64)
    cols = {"lat": a[:, 0], "lon": a[:, 1], "frp": a[:, 2], "t": a[:, 3], "country": a[:, 4], "dt": a[:, 5], "sat": a[:, 6]}
    meta = {"t0": "2026-11-06T00:00:00+00:00", "n_modis": 2, "default_window": 180, "source": "SRC",
            "countries": ["Paraguay", "Elsewhere"], "sat_names": ["Terra", "Aqua", "S-NPP", "NOAA-20"]}
    return meta, cols


def test_feed_filters_window_and_ids():
    meta, cols = _bundle()
    f = build_feed(meta, cols, "PY", "Paraguay", [{"name": "A", "lat": -25.0, "lon": -57.0}, {"lat": 1, "lon": 1}])
    fr = f["fires"]
    ids = list(np.cumsum(fr["idx"]))
    assert ids == [1, 2, 4]  # record indexes: MODIS 1 (HS-M000001), VIIRS 2 (HS-V0000000), VIIRS 4 (HS-V0000002); no old, no partnered, no foreign
    assert fr["n_modis"] == 2  # MODIS 1, VIIRS index 2-2, VIIRS index 4-2; no old, no partnered, no foreign
    assert (fr["lat"][0], fr["lon"][0], fr["t"][0], f["sats"][fr["sat"][0]], fr["frp"][0]) == (-250000, -570000, 6 * DAY, "Aqua", 20.0)
    assert list(np.cumsum(fr["t"])) == [6 * DAY, 6 * DAY + 5, 6 * DAY + 60]
    assert f["data_through_utc"] == "2026-11-12T01:00Z"
    assert f["source"] == "SRC" and f["places"] == [["A", -25.0, -57.0]]


def test_pass_grouping_uses_all_records_of_region():
    meta, cols = _bundle()
    f = build_feed(meta, cols, "PY", "Paraguay", [])
    assert f["passes"]["Aqua"] == [6 * DAY]
    assert f["passes"]["S-NPP"] == [3 * DAY - 10, 6 * DAY + 5]  # includes the partnered VIIRS record (same pass) and an older pass
    assert f["passes"]["NOAA-20"] == [6 * DAY + 60]
    assert "Terra" not in f["passes"]  # its only record is older than 4 days


def test_fire_window_is_a_parameter_and_regions_file_is_read():
    from hotspots.feed import load_regions
    meta, cols = _bundle()
    f = build_feed(meta, cols, "PY", "Paraguay", [], fire_hours=24)
    assert f["fire_hours"] == 24 and f["country"] == "Paraguay"
    assert list(np.cumsum(f["fires"]["idx"])) == [1, 2, 4]  # all three are inside the last 24 h of this bundle
    f30 = build_feed(meta, cols, "PY", "Paraguay", [], fire_hours=0.5)
    assert list(np.cumsum(f30["fires"]["idx"])) == [4]  # only the newest fire is inside the last half hour
    r = load_regions()
    assert set(r) >= {"PY", "BO", "AR", "BR"} and r["BR"]["country"] == "Brazil"
