"""Mapped assets for the DOWNWIND page: what a smoke plume can cross. Source: OpenStreetMap (ODbL), via Overpass.

Assets are MAPPED, not surveyed: OpenStreetMap is volunteer data, can be incomplete or mislabelled, and is not the
operator's own record. Nothing is invented here: a feature with no name stays unnamed.

Layers: power (high-voltage lines), roads, health (hospitals, clinics), schools, places (named towns).
What is built for a region comes from its entry in web/app-data/regions.json ("assets"); flags override it.

usage:
  python -m hotspots.assets PY
  python -m hotspots.assets BR --layers power,roads,health,places --roads motorway,trunk --health hospital
Options: --power-min-kv 220  --places city,town  --tol-power 40 --tol-roads 120 (metres)  --max-kb 1500
         --tiles N (start with an N x N grid of boxes instead of one query)  --cache DIR (keep raw Overpass answers, so a rerun resumes)
Writes web/app-data/assets/<ISO>.json.gz and records in it which layers were built, with what filter, and the
simplification tolerance used. A layer that cannot be fetched is left out and recorded as not built, never guessed."""
import argparse
import gzip
import hashlib
import json
import math
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

WEB = Path(__file__).resolve().parents[2] / "web"
OUT = WEB / "app-data" / "assets"
REGIONS_FILE = WEB / "app-data" / "regions.json"
ENDPOINTS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter", "https://overpass.private.coffee/api/interpreter"]
ALL_LAYERS = ("power", "roads", "health", "schools", "places")
DEFAULT_PRESET = {"layers": list(ALL_LAYERS), "roads": ["trunk", "primary"], "health": ["hospital", "clinic"], "places": ["city", "town", "village"], "power_min_kv": 220}
ROAD_TOL_LADDER = [120, 200, 350, 600, 1000, 1600]
POWER_TOL_LADDER = [40, 80, 150, 300, 600]


def load_regions(path=REGIONS_FILE):
    return json.loads(Path(path).read_text(encoding="utf-8"))["regions"]


def selector(layer, preset):
    """Overpass selector for one layer, without the area filter."""
    if layer == "power":
        # server-side pre-filter: some part of the voltage tag has 6 digits starting 2-9, or 7+ digits (>= 200 kV); kv() then applies the exact minimum
        pre = '["voltage"~"(^|;)([2-9][0-9]{5}|[0-9]{7,})"]' if preset.get("power_min_kv", 220) >= 200 else ""
        return 'way["power"="line"]' + pre
    if layer == "roads":
        return 'way["highway"~"^(' + "|".join(preset["roads"]) + ')$"]'
    if layer == "health":
        return 'nwr["amenity"~"^(' + "|".join(preset["health"]) + ')$"]'
    if layer == "schools":
        return 'nwr["amenity"="school"]'
    if layer == "places":
        return 'node["place"~"^(' + "|".join(preset["places"]) + ')$"]["name"]'
    raise ValueError(layer)


def _post(query, tries, log):
    data = urllib.parse.urlencode({"data": query}).encode()
    err = None
    for attempt in range(tries):
        url = ENDPOINTS[attempt % len(ENDPOINTS)]
        try:
            req = urllib.request.Request(url, data=data, headers={"User-Agent": "FIREVERSE-HotSpotExplorer/1.0", "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=900) as r:
                j = json.loads(r.read())
            rem = str(j.get("remark", ""))
            if "runtime error" in rem or "timed out" in rem or "out of memory" in rem:  # Overpass answers 200 with a partial result and a remark
                raise RuntimeError("Overpass remark: " + rem[:120])
            return j["elements"]
        except Exception as e:  # busy public servers: wait, then try the other one
            err = e
            wait = min(150, 15 * (attempt + 1)) * (3 if isinstance(e, urllib.error.HTTPError) and e.code == 429 else 1)
            log(f"    attempt {attempt + 1}/{tries} on {url.split('/')[2]} failed: {str(e)[:100]}; waiting {wait}s")
            if attempt + 1 < tries:
                time.sleep(wait)
    raise RuntimeError(f"Overpass failed: {err}")


def overpass(iso, sel, geom, bbox=None, tries=4, log=print, cache=None):
    """One query for the country, or only the part inside bbox = (south, west, north, east). Cached raw when cache is a directory."""
    bb = "" if bbox is None else "(" + ",".join(f"{v:.4f}" for v in bbox) + ")"
    q = f'[out:json][timeout:280];area["ISO3166-1"="{iso}"][admin_level=2]->.a;({sel}{bb}(area.a););out tags {"geom" if geom else "center"};'
    f = None
    if cache:
        f = Path(cache) / (hashlib.sha1(q.encode()).hexdigest()[:16] + ".json.gz")
        if f.exists():
            with gzip.open(f, "rt", encoding="utf-8") as fh:
                return json.load(fh)
    els = _post(q, tries, log)
    if f:
        f.parent.mkdir(parents=True, exist_ok=True)
        with gzip.open(f, "wt", encoding="utf-8") as fh:
            json.dump(els, fh, separators=(",", ":"))
    return els


def split(bbox, n=2):
    s, w, nn, e = bbox
    return [(s + (nn - s) * i / n, w + (e - w) * j / n, s + (nn - s) * (i + 1) / n, w + (e - w) * (j + 1) / n) for i in range(n) for j in range(n)]


def fetch_layer(iso, sel, geom, bbox, tiles=0, log=print, cache=None, depth=0, stats=None):
    """Whole country first; if that keeps failing, split the box into 2 x 2 and retry each part, up to 3 levels deep. Merges by element id.
    A part that still fails at the last level raises, so a layer is never silently incomplete."""
    stats = stats if stats is not None else {"tiled": False, "queries": 0}
    if bbox is None or (depth == 0 and not tiles):
        try:
            stats["queries"] += 1
            return overpass(iso, sel, geom, None if depth == 0 else bbox, 3 if depth == 0 else 4, log, cache), stats
        except RuntimeError as e:
            if bbox is None:
                raise
            log(f"  whole-country query failed ({e}); splitting into boxes")
    parts = split(bbox, tiles) if depth == 0 and tiles else split(bbox)
    stats["tiled"] = True
    seen = {}
    for k, part in enumerate(parts):
        els = None
        for rnd in range(4):  # a server that is only busy (502/503/504, queue full) is waited for; splitting does not help it
            try:
                stats["queries"] += 1
                els = overpass(iso, sel, geom, part, 5, log, cache)
                break
            except RuntimeError as e:
                if "HTTP Error 50" not in str(e) or rnd == 3:
                    err = e
                    break
                log(f"  box {k + 1}/{len(parts)}: servers busy, waiting 120 s before round {rnd + 2}")
                time.sleep(120)
        if els is None:
            e = err
            if depth >= 3:
                raise e
            log(f"  box {k + 1}/{len(parts)} at depth {depth} failed ({str(e)[:80]}); splitting it")
            els, _ = fetch_layer(iso, sel, geom, part, 0, log, cache, depth + 1, stats)
            els = list(els)
        for el in els:
            seen[(el["type"], el["id"])] = el
    return list(seen.values()), stats


def simplify(pts, tol_m):
    """Douglas-Peucker on a local flat projection; keeps the ends."""
    if len(pts) < 3:
        return pts
    c = math.cos(math.radians(pts[0][0]))
    xy = [(p[1] * 111195 * c, p[0] * 111195) for p in pts]
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        (ax, ay), (bx, by) = xy[a], xy[b]
        dx, dy = bx - ax, by - ay
        n = math.hypot(dx, dy) or 1e-9
        best, k = 0, -1
        for i in range(a + 1, b):
            d = abs((xy[i][0] - ax) * dy - (xy[i][1] - ay) * dx) / n
            if d > best:
                best, k = d, i
        if best > tol_m:
            keep[k] = True
            stack += [(a, k), (k, b)]
    return [p for p, f in zip(pts, keep) if f]


def kv(tags):
    """Highest voltage on the line in kV, or None when the tag is missing or unreadable."""
    best = None
    for part in str(tags.get("voltage", "")).split(";"):
        try:
            v = float(part) / 1000
            best = v if best is None or v > best else best
        except ValueError:
            pass
    return best


def power_lines(els, min_kv, tol):
    lines = []
    for w in els:
        v = kv(w.get("tags", {}))
        if v is None or v < min_kv or "geometry" not in w:
            continue
        pts = simplify([(g["lat"], g["lon"]) for g in w["geometry"]], tol)
        lines.append({"id": w["id"], "kv": round(v), "pts": [[round(a, 5), round(b, 5)] for a, b in pts]})
    return lines


def merge_ways(items):
    """Join ways that carry the same ref (else the same name) and meet end to end into one line: OSM splits a road at every
    junction, and a country-sized road layer is otherwise mostly per-way overhead. items: [(id, key, [(lat, lon), ...])].
    Returns [(first id, how many ways, key, points)]. Ways without a ref or name are never joined."""
    out, groups = [], {}
    for it in items:
        if it[1] is None:
            out.append((it[0], 1, None, it[2]))
        else:
            groups.setdefault(it[1], []).append(it)
    for key, g in groups.items():
        ends = {}
        for i, w in enumerate(g):
            ends.setdefault(w[2][0], []).append(i)
            ends.setdefault(w[2][-1], []).append(i)
        used = [False] * len(g)
        for i, w in enumerate(g):
            if used[i]:
                continue
            used[i] = True
            chain, n = list(w[2]), 1
            for _ in (0, 1):  # grow at the tail, then turn the chain round and grow at the other end
                while True:
                    j = next((k for k in ends.get(chain[-1], []) if not used[k]), None)
                    if j is None:
                        break
                    used[j] = True
                    n += 1
                    p = g[j][2]
                    chain += p[1:] if p[0] == chain[-1] else p[::-1][1:]
                chain.reverse()
            out.append((w[0], n, key, chain))
    return out


def road_lines(els, tol):
    items = []
    for w in els:
        if "geometry" not in w:
            continue
        t = w.get("tags", {})
        items.append((w["id"], t.get("ref") or t.get("name") or None, [(g["lat"], g["lon"]) for g in w["geometry"]], t.get("ref"), t.get("name")))
    roads = []
    by_id = {it[0]: it for it in items}
    for wid, n, key, pts in merge_ways([(i[0], i[1], i[2]) for i in items]):
        pts = simplify(pts, tol)
        nd = 3 if tol >= 500 else 4  # coordinates no finer than the tolerance (3 decimals = 110 m)
        r = {"id": wid, "pts": [[round(a, nd), round(b, nd)] for a, b in pts]}
        if n > 1:
            r["n"] = n  # this line joins n OpenStreetMap ways; id is the first of them
        # the page labels a road by its ref, else by its name: keep only what it can use
        src = by_id[wid]
        if src[3]:
            r["ref"] = src[3]
        elif src[4]:
            r["name"] = src[4]
        roads.append(r)
    return roads


def point_assets(els):
    pts = []
    for e in els:
        la, lo = (e.get("lat"), e.get("lon")) if e["type"] == "node" else (e.get("center", {}).get("lat"), e.get("center", {}).get("lon"))
        if la is None:
            continue
        t = e.get("tags", {})
        pts.append({"id": f"{e['type'][0]}{e['id']}", "name": t.get("name"), "kind": t.get("amenity"), "lat": round(la, 5), "lon": round(lo, 5)})
    return pts


def encode(a):
    return gzip.compress(json.dumps(a, separators=(",", ":"), ensure_ascii=False).encode("utf-8"), 9)


def build(iso, preset=None, bbox=None, tiles=0, tol_power=None, tol_roads=None, max_kb=1500, log=print, cache=None):
    """Returns (assets dict, encoded gzip bytes). Layers that cannot be fetched are left out and recorded in out['layers']."""
    preset = {**DEFAULT_PRESET, **(preset or {})}
    out = {"country": iso, "fetched_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%MZ"),
           "source": "OpenStreetMap contributors, via the Overpass API", "licence": "ODbL 1.0, openstreetmap.org/copyright",
           "note": "Mapped by volunteers: can be incomplete or mislabelled, and is not the operator's record.", "layers": {}}
    raw = {}
    for layer in ALL_LAYERS:
        if layer not in preset["layers"]:
            out["layers"][layer] = {"built": False, "reason": "not built for this region"}
            continue
        t0 = time.time()
        log(f"{iso} {layer}: querying")
        try:
            els, st = fetch_layer(iso, selector(layer, preset), layer in ("power", "roads"), bbox, tiles, log, cache)
        except RuntimeError as e:
            log(f"{iso} {layer}: FAILED, left out: {e}")
            out["layers"][layer] = {"built": False, "reason": "the Overpass servers did not answer after repeated tries and splitting into boxes: " + str(e)[:160]}
            continue
        raw[layer] = els
        info = {"built": True, "seconds": round(time.time() - t0), "queries": st["queries"], "split_into_boxes": st["tiled"]}
        if layer == "power":
            info["min_kv"] = preset["power_min_kv"]
        elif layer == "roads":
            info["highway"] = preset["roads"]
        elif layer == "health":
            info["amenity"] = preset["health"]
        elif layer == "places":
            info["place"] = preset["places"]
        out["layers"][layer] = info
        log(f"{iso} {layer}: {len(els)} elements in {info['seconds']} s")
    tp, tr = [tol_power or POWER_TOL_LADDER[0]], [tol_roads or ROAD_TOL_LADDER[0]]
    while True:
        if "power" in raw:
            out["power"] = power_lines(raw["power"], preset["power_min_kv"], tp[-1])
        if "roads" in raw:
            out["roads"] = road_lines(raw["roads"], tr[-1])
        for key in ("health", "schools"):
            if key in raw:
                out[key] = point_assets(raw[key])
        if "places" in raw:
            out["places"] = [{"name": e["tags"]["name"], "type": e["tags"]["place"], "lat": round(e["lat"], 4), "lon": round(e["lon"], 4)} for e in raw["places"]]
        out["simplify_m"] = {k: v[-1] for k, v in (("power", tp), ("roads", tr)) if k in raw}
        blob = encode(out)
        if len(blob) <= max_kb * 1000:
            return out, blob
        nr, npw = [x for x in ROAD_TOL_LADDER if x > tr[-1]], [x for x in POWER_TOL_LADDER if x > tp[-1]]
        if "roads" in raw and nr:  # roads are the bulk of a big country: coarsen them first, then the power lines
            tr.append(nr[0])
        elif "power" in raw and npw:
            tp.append(npw[0])
        else:
            log(f"{iso}: still {len(blob) / 1e3:.0f} kB at the coarsest tolerance")
            return out, blob
        log(f"{iso}: {len(blob) / 1e3:.0f} kB gzipped is over {max_kb} kB; raising the simplification tolerance (power {tp[-1]} m, roads {tr[-1]} m)")


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("iso", nargs="?", default="PY")
    ap.add_argument("--layers"), ap.add_argument("--roads"), ap.add_argument("--health"), ap.add_argument("--places")
    ap.add_argument("--power-min-kv", type=float)
    ap.add_argument("--tol-power", type=float), ap.add_argument("--tol-roads", type=float)
    ap.add_argument("--max-kb", type=float, default=1500)
    ap.add_argument("--tiles", type=int, default=0)
    ap.add_argument("--cache")
    ap.add_argument("--out", type=Path, default=OUT)
    a = ap.parse_args(argv)
    iso = a.iso.upper()
    reg = load_regions().get(iso, {})
    preset = {**DEFAULT_PRESET, **reg.get("assets", {})}
    for key, val in (("layers", a.layers), ("roads", a.roads), ("health", a.health), ("places", a.places)):
        if val:
            preset[key] = [x.strip() for x in val.split(",") if x.strip()]
    if a.power_min_kv is not None:
        preset["power_min_kv"] = a.power_min_kv
    bad = [x for x in preset["layers"] if x not in ALL_LAYERS]
    if bad:
        raise SystemExit(f"unknown layer(s) {bad}; known: {', '.join(ALL_LAYERS)}")
    v = reg.get("view")
    bbox = (v[0][0], v[0][1], v[1][0], v[1][1]) if v else None
    t0 = time.time()
    out, blob = build(iso, preset, bbox, a.tiles, a.tol_power, a.tol_roads, a.max_kb, cache=a.cache)
    a.out.mkdir(parents=True, exist_ok=True)
    f = a.out / f"{iso}.json.gz"
    f.write_bytes(blob)
    print(f, f"{f.stat().st_size / 1e3:.0f} kB", {k: len(x) for k, x in out.items() if isinstance(x, list)}, "tolerance m", out.get("simplify_m"),
          "not built:", {k: v["reason"] for k, v in out["layers"].items() if not v["built"]}, f"{(time.time() - t0) / 60:.1f} min")


if __name__ == "__main__":
    main()
