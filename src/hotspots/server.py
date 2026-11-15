"""Hot Spot Explorer server: the web app plus a small JSON API. Python standard library only.

The FIRMS MAP_KEY stays here: it is read from FIRMS_MAP_KEY (environment or .env) and is never sent to the browser.
  GET /api/status                       key configured?, data mode, bundle date, transaction use
  GET /api/firms?product=&bbox=&days=&date=      normalized FIRMS records for one product
  GET /api/harmonize?bbox=&days=&date=&window=   MODIS + all VIIRS for a box, matched (hotspots.harmonize)
  GET /api/weather?lat=&lon=&time=      modelled wind, boundary layer and CAMS PM2.5 at a point (Open-Meteo)
  GET /api/population?bbox=             GHS-POP 2025 population grid for a small box
  GET /api/route?from=lat,lon&to=lat,lon   up to 3 driving routes (OSRM demo server, OpenStreetMap data), cached, 1 request a second
usage: python -m hotspots.server [--port 8000] [--host 127.0.0.1]"""
import argparse
import json
import math
import mimetypes
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import numpy as np
import pandas as pd
from . import firms, population
from .harmonize import CRITERIA, WINDOW, harmonize

WEB = Path(__file__).resolve().parents[2] / "web"
MAX_RECORDS = 25000
VIIRS = ("VIIRS_SNPP", "VIIRS_NOAA20", "VIIRS_NOAA21")
_mem = {}


def memo(key, ttl, fn):
    hit = _mem.get(key)
    if hit and time.time() - hit[0] < ttl:
        return hit[1]
    v = fn()
    _mem[key] = (time.time(), v)
    if len(_mem) > 500:
        for k in sorted(_mem, key=lambda k: _mem[k][0])[:100]:
            _mem.pop(k, None)
    return v


class BadRequest(Exception):
    pass


def arg(q, name, default=None, kind=str):
    v = q.get(name, [default])[0]
    if v is None:
        raise BadRequest(f"missing {name}")
    try:
        return kind(v)
    except ValueError:
        raise BadRequest(f"bad {name}") from None


def bbox_arg(q, max_deg=None):
    try:
        b = [float(x) for x in arg(q, "bbox").split(",")]
    except ValueError:
        raise BadRequest("bbox must be west,south,east,north") from None
    if len(b) != 4:
        raise BadRequest("bbox must be west,south,east,north")
    w, s, e, n = b
    w, e = max(-180, w), min(180, e)
    s, n = max(-90, s), min(90, n)
    if not (w < e and s < n):
        raise BadRequest("bbox is empty")
    if max_deg and (e - w) * (n - s) > max_deg:
        raise BadRequest(f"area too large: at most {max_deg} square degrees")
    return w, s, e, n


def records_json(df):
    if df.empty:
        return []
    out = pd.DataFrame({
        "id": df.get("record_id", pd.Series(range(len(df)))).values,
        "product": df["product"].values, "processing": df["processing"].values,
        "sensor": df.sensor.values, "sat": df.sat.astype(int).values,
        "lat": df.latitude.round(5).values, "lon": df.longitude.round(5).values,
        "time": df.time.dt.strftime("%Y-%m-%dT%H:%MZ").values, "frp": df.frp.round(2).values,
        "conf": df.confidence_raw.values, "scan": df.scan_km.values, "track": df.track_km.values,
        "daynight": df.daynight.values,
    })
    for c in ("status", "group_id", "dt_min", "dist_km", "n_cand", "dt2_min", "strength", "ambiguous"):
        if c in df:
            out[c] = df[c].values
    out = out.replace({np.nan: None})
    return out.to_dict("records")


def products_for(processing):
    return ["MODIS_" + processing] + [v + "_" + processing for v in VIIRS]


def api_status(q):
    key = firms.map_key() is not None
    meta = json.loads((WEB / "app-data" / "meta.json").read_text()) if (WEB / "app-data" / "meta.json").exists() else {}
    return {
        "server": "ok", "map_key_configured": key,
        "mode": "FIRMS area API (MAP_KEY on server)" if key else "FIRMS public global NRT files (no key: last 7 days, NRT only)",
        "products": {k: {"label": v["label"], "processing": v["processing"], "available": key or bool(v["public"])} for k, v in firms.PRODUCTS.items()},
        "key_status": memo("ks", 120, firms.key_status) if key else None,
        "bundle": {"days": [meta.get("days", [None])[0], meta.get("days", [None])[-1]] if meta else None, "generated_at": meta.get("generated_at"), "products": meta.get("products")},
        "population_grid": population.GRID.exists(),
        "harmonization": CRITERIA,
    }


def api_firms(q):
    product = arg(q, "product")
    if product not in firms.PRODUCTS:
        raise BadRequest("unknown product")
    bbox = bbox_arg(q)
    days = arg(q, "days", "1", int)
    day = q.get("date", [None])[0]
    df, info = memo(("firms", product, bbox, days, day), 600, lambda: firms.get(product, bbox, days, day))
    df = firms.clip(df, bbox)
    trunc = len(df) > MAX_RECORDS
    return {"product": product, "info": info, "count": len(df), "truncated": trunc,
            "records": records_json(df.nlargest(MAX_RECORDS, "frp") if trunc else df)}


def public_norm(p):
    def load():
        raw, info = firms.public(p, "7d")
        return firms.normalize(raw, p), info
    return memo(("pub", p), 900, load)


def api_harmonize(q):
    bbox = bbox_arg(q, max_deg=2500)
    days = arg(q, "days", "2", int)
    if not 1 <= days <= 7:
        raise BadRequest("days must be 1 to 7")
    day = q.get("date", [None])[0]
    window = arg(q, "window", str(WINDOW), int)
    if not 10 <= window <= 360:
        raise BadRequest("window must be 10 to 360 minutes")
    processing = arg(q, "processing", "NRT")
    if processing not in ("NRT", "SP"):
        raise BadRequest("processing must be NRT or SP")
    frames, info = {}, {}
    for p in products_for(processing):
        try:
            if firms.map_key():
                d, i = memo(("firms", p, bbox, days, day), 600, lambda p=p: firms.get(p, bbox, days, day))
                i = {**i, "no_data": False}
            else:  # one global file per product, normalized once, clipped here
                d, i = public_norm(p)
                i = {**i, "no_data": len(d) == 0}  # nothing anywhere on Earth: not observing, not "no fires"
            frames[p], info[p] = firms.clip(d, bbox), i
        except firms.FirmsError as e:
            frames[p], info[p] = pd.DataFrame(), {"error": str(e), "no_data": True}
    # One common period for every product, so no sensor is counted over a different span.
    end = max((f.time.max() for f in frames.values() if len(f)), default=None)
    if day:
        start = pd.Timestamp(day, tz="UTC"); stop = start + pd.Timedelta(days=days)
    elif end is not None:
        stop = end + pd.Timedelta(minutes=1); start = stop - pd.Timedelta(days=days)
    else:
        start = stop = None
    for p, f in frames.items():
        if len(f) and start is not None:
            frames[p] = f[(f.time >= start) & (f.time < stop)].reset_index(drop=True)
        info[p]["records_in_box"] = len(frames[p])
    m = frames["MODIS_" + processing]
    v = pd.concat([frames[p] for p in products_for(processing)[1:] if len(frames[p])], ignore_index=True) if any(len(frames[p]) for p in products_for(processing)[1:]) else pd.DataFrame()
    if m.empty and v.empty:
        recs, summary = pd.DataFrame(), {"modis": 0, "viirs": 0, "harmonized": 0, "window_min": window, "criteria": CRITERIA}
    else:
        if m.empty:
            m = v.iloc[0:0].copy()
        if v.empty:
            v = m.iloc[0:0].copy()
        recs, summary = harmonize(m, v, window)
    trunc = len(recs) > MAX_RECORDS
    return {"bbox": bbox, "period_utc": [str(start) if start is not None else None, str(stop) if stop is not None else None],
            "processing": processing, "products": info, "summary": summary, "truncated": trunc,
            "records": records_json(recs.nlargest(MAX_RECORDS, "frp") if trunc else recs)}


def _fetch_json(url, timeout=40):
    req = urllib.request.Request(url, headers={"User-Agent": "FIREVERSE-HotSpotExplorer/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())


def api_weather(q):
    lat, lon = arg(q, "lat", kind=float), arg(q, "lon", kind=float)
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        raise BadRequest("lat/lon out of range")
    t = pd.Timestamp(arg(q, "time")).tz_convert("UTC") if pd.Timestamp(arg(q, "time")).tzinfo else pd.Timestamp(arg(q, "time"), tz="UTC")
    d0, d1 = (t - pd.Timedelta(hours=6)).date().isoformat(), (t + pd.Timedelta(hours=30)).date().isoformat()
    age = (datetime.now(timezone.utc).date() - t.date()).days
    base = "https://api.open-meteo.com/v1/forecast" if age <= 80 else "https://archive-api.open-meteo.com/v1/archive"
    model = "Open-Meteo best-match weather models (forecast/analysis)" if age <= 80 else "ERA5 reanalysis via Open-Meteo"
    hourly = "wind_speed_10m,wind_direction_10m,wind_speed_100m,wind_direction_100m,boundary_layer_height,temperature_2m,relative_humidity_2m,cloud_cover"
    u = f"{base}?latitude={lat:.4f}&longitude={lon:.4f}&hourly={hourly}&start_date={d0}&end_date={d1}&wind_speed_unit=ms&timezone=GMT"
    out = {"lat": lat, "lon": lon, "time": t.isoformat(), "weather_source": model, "weather": None, "air_quality": None, "errors": {}}
    try:
        out["weather"] = memo(("wx", u), 3600, lambda: _fetch_json(u))["hourly"]
    except Exception as e:
        out["errors"]["weather"] = f"weather model data unavailable ({type(e).__name__})"
    ua = f"https://air-quality-api.open-meteo.com/v1/air-quality?latitude={lat:.4f}&longitude={lon:.4f}&hourly=pm2_5,carbon_monoxide&start_date={d0}&end_date={d1}&timezone=GMT"
    try:
        out["air_quality"] = memo(("aq", ua), 3600, lambda: _fetch_json(ua))["hourly"]
        out["air_quality_source"] = "CAMS atmospheric composition model via Open-Meteo (all sources, modelled, not a measurement)"
    except Exception as e:
        out["errors"]["air_quality"] = f"CAMS model data unavailable ({type(e).__name__})"
    return out


WIND_DIR = Path(__file__).resolve().parents[2] / "data" / "cache" / "wind"
WIND_HOURLY = "wind_speed_10m,wind_speed_100m,wind_direction_100m,boundary_layer_height,cloud_cover"


def api_wind(q):
    """Modelled wind (Open-Meteo) for up to 60 quarter-degree cells, kept on disk so that repeat visits do not spend
    the free service's quota. Nothing is altered: each cell is the upstream hourly block as received."""
    import re
    cells = [c for c in arg(q, "cells").split(";") if c]
    if not 1 <= len(cells) <= 60 or not all(re.fullmatch(r"-?\d{1,2}\.\d{2},-?\d{1,3}\.\d{2}", c) for c in cells):
        raise BadRequest("cells must be 1 to 60 of lat,lon with two decimals, separated by ;")
    d0, d1 = arg(q, "d0"), arg(q, "d1")
    try:
        a, b = datetime.strptime(d0, "%Y-%m-%d").date(), datetime.strptime(d1, "%Y-%m-%d").date()
    except ValueError:
        raise BadRequest("d0 and d1 must be YYYY-MM-DD") from None
    if not 0 <= (b - a).days <= 10:
        raise BadRequest("date range must be 0 to 10 days")
    old = arg(q, "old", "0") == "1"
    final = b < datetime.now(timezone.utc).date() - timedelta(days=1)  # hours that are over do not change much; today's still do
    folder = WIND_DIR / f"{d0}_{d1}_{'era5' if old else 'fc'}"
    out, need = {}, []
    for c in cells:
        f = folder / (c.replace(",", "_") + ".json")
        try:
            if f.exists() and (final or time.time() - f.stat().st_mtime < 3600):
                out[c] = json.loads(f.read_text())
                continue
        except (OSError, ValueError):
            pass
        need.append(c)
    if need:
        base = "https://archive-api.open-meteo.com/v1/archive" if old else "https://api.open-meteo.com/v1/forecast"
        u = (f"{base}?latitude={','.join(c.split(',')[0] for c in need)}&longitude={','.join(c.split(',')[1] for c in need)}"
             f"&hourly={WIND_HOURLY}&start_date={d0}&end_date={d1}&wind_speed_unit=ms&timezone=GMT")
        try:
            j = _fetch_json(u, 45)
            j = j if isinstance(j, list) else [j]
            folder.mkdir(parents=True, exist_ok=True)
            for c, item in zip(need, j):
                h = item.get("hourly") if isinstance(item, dict) else None
                if h and h.get("time"):
                    out[c] = h
                    (folder / (c.replace(",", "_") + ".json")).write_text(json.dumps(h, separators=(",", ":")))
        except Exception:
            pass  # the cells stay missing; the page then asks the wind service itself and reports what it could not get
    return {"source": "Open-Meteo " + ("ERA5 reanalysis" if old else "best-match weather models"), "cells": {c: out.get(c) for c in cells}}


def api_population(q):
    w, s, e, n = bbox_arg(q, max_deg=70)  # FIRELAB asks for a fixed 200 km half-width square around a fire
    g = population.window(w, s, e, n)
    if g is None:
        raise BadRequest("population grid not built on this server: python -m hotspots.population build <GHS-POP tif>")
    return g


ROUTE_DIR = Path(__file__).resolve().parents[2] / "data" / "cache" / "route"
ROUTE_TTL = 24 * 3600          # road geometry changes slowly; the OSRM demo server has no traffic anyway
ROUTE_MAX_KM = 1500            # straight-line limit: the demo server is for light use
ROUTE_BASE = "https://router.project-osrm.org/route/v1/driving/"
_route_lock = threading.Lock()
_route_last = [0.0]            # time of the last request to the routing service
_route_mem = {}


def _route_point(q, name):
    import re
    v = arg(q, name)
    if not re.fullmatch(r"-?\d{1,2}(\.\d{1,8})?,-?\d{1,3}(\.\d{1,8})?", v):
        raise BadRequest(f"{name} must be lat,lon in degrees")
    lat, lon = (float(x) for x in v.split(","))
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        raise BadRequest(f"{name} is out of range")
    return round(lat, 4), round(lon, 4)  # 4 decimals is about 11 m: also what the cache is keyed on


def _route_fetch(url):
    """One request to the routing service, never faster than one a second (its usage policy for the demo server)."""
    with _route_lock:
        wait = 1.0 - (time.time() - _route_last[0])
        if wait > 0:
            time.sleep(wait)
        try:
            return _fetch_json(url, 30)
        finally:
            _route_last[0] = time.time()


def api_route(q):
    """Up to 3 driving routes between two points from the OSRM demo server (OpenStreetMap data), with geometry as GeoJSON
    order [lon, lat], distance in metres and duration in seconds. Answers are kept in memory and on disk."""
    (la1, lo1), (la2, lo2) = _route_point(q, "from"), _route_point(q, "to")
    if (la1, lo1) == (la2, lo2):
        raise BadRequest("from and to are the same point")
    if math.hypot((la2 - la1) * 111.195, (lo2 - lo1) * 111.195 * math.cos(math.radians((la1 + la2) / 2))) > ROUTE_MAX_KM:
        raise BadRequest(f"from and to are more than {ROUTE_MAX_KM} km apart")
    key = f"{la1:.4f},{lo1:.4f}>{la2:.4f},{lo2:.4f}"
    hit = _route_mem.get(key)
    if hit and time.time() - hit[0] < ROUTE_TTL:
        return {**hit[1], "cached": True}
    f = ROUTE_DIR / (key.replace(",", "_").replace(">", "__") + ".json")
    try:
        if f.exists() and time.time() - f.stat().st_mtime < ROUTE_TTL:
            out = json.loads(f.read_text())
            _route_mem[key] = (time.time(), out)
            return {**out, "cached": True}
    except (OSError, ValueError):
        pass
    url = f"{ROUTE_BASE}{lo1:.4f},{la1:.4f};{lo2:.4f},{la2:.4f}?alternatives=3&overview=full&geometries=geojson&steps=false"
    try:
        j = _route_fetch(url)
    except Exception as e:
        if isinstance(e, urllib.error.HTTPError) and e.code == 400:  # e.g. a point too far from any road
            j = {"code": "NoRoute", "routes": []}
        else:
            raise firms.FirmsError(f"routing service unavailable ({type(e).__name__})") from None
    if not isinstance(j, dict) or j.get("code") not in ("Ok", "NoRoute", "NoSegment"):
        raise firms.FirmsError("routing service gave an unexpected answer")
    routes = []
    for r in (j.get("routes") or [])[:3]:
        coords = (r.get("geometry") or {}).get("coordinates")
        if coords and len(coords) >= 2:
            routes.append({"coords": [[round(c[0], 5), round(c[1], 5)] for c in coords], "distance": float(r["distance"]), "duration": float(r["duration"])})
    out = {"source": "OSRM demo server (router.project-osrm.org), OpenStreetMap data", "code": "Ok" if routes else "NoRoute", "routes": routes}
    _route_mem[key] = (time.time(), out)
    if len(_route_mem) > 300:
        for k in sorted(_route_mem, key=lambda k: _route_mem[k][0])[:100]:
            _route_mem.pop(k, None)
    if routes:
        try:
            ROUTE_DIR.mkdir(parents=True, exist_ok=True)
            f.write_text(json.dumps(out, separators=(",", ":")))
        except OSError:
            pass
    return out


ROUTES = {"/api/status": api_status, "/api/firms": api_firms, "/api/harmonize": api_harmonize,
          "/api/weather": api_weather, "/api/wind": api_wind, "/api/population": api_population, "/api/route": api_route}


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=str(WEB), **k)

    def log_message(self, fmt, *args):  # never log query strings (they could carry user input)
        print(f"{self.address_string()} {self.command} {self.path.split('?')[0]} {args[1] if len(args) > 1 else ''}", flush=True)

    def end_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        if self.path.startswith(("/app-data/", "/js/", "/css/", "/index.html", "/start.html", "/role.html", "/route.html")) or self.path in ("/", ""):
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def send_json(self, code, obj):
        body = json.dumps(obj, separators=(",", ":"), default=str).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        u = urllib.parse.urlsplit(self.path)
        if u.path.startswith("/api/"):
            fn = ROUTES.get(u.path)
            if not fn:
                return self.send_json(404, {"error": "unknown endpoint"})
            try:
                return self.send_json(200, fn(urllib.parse.parse_qs(u.query)))
            except BadRequest as e:
                return self.send_json(400, {"error": str(e)})
            except firms.FirmsError as e:
                return self.send_json(502, {"error": str(e)})
            except Exception as e:  # keep the server up; the message names the type only
                return self.send_json(500, {"error": f"server error ({type(e).__name__})"})
        if u.path == "/":
            self.path = "/start.html"  # the front door is the role picker; index.html (the analyst workspace) stays at its own address
        return super().do_GET()

    def list_directory(self, path):
        self.send_error(404)


mimetypes.add_type("application/gzip", ".gz")


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--host", default="127.0.0.1")
    a = ap.parse_args(argv)
    s = ThreadingHTTPServer((a.host, a.port), Handler)
    print(f"Hot Spot Explorer on http://{a.host}:{a.port}  (FIRMS MAP_KEY configured: {firms.map_key() is not None})", flush=True)
    s.serve_forever()


if __name__ == "__main__":
    main()
