"""Hot Spot Explorer server: the web app plus a small JSON API. Python standard library only.

The FIRMS MAP_KEY stays here: it is read from FIRMS_MAP_KEY (environment or .env) and is never sent to the browser.
  GET /api/status                       key configured?, data mode, bundle date, transaction use
  GET /api/firms?product=&bbox=&days=&date=      normalized FIRMS records for one product
  GET /api/harmonize?bbox=&days=&date=&window=   MODIS + all VIIRS for a box, matched (hotspots.harmonize)
  GET /api/weather?lat=&lon=&time=      modelled wind, boundary layer and CAMS PM2.5 at a point (Open-Meteo)
  GET /api/population?bbox=             GHS-POP 2025 population grid for a small box
usage: python -m hotspots.server [--port 8000] [--host 127.0.0.1]"""
import argparse
import json
import math
import mimetypes
import time
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


def api_population(q):
    w, s, e, n = bbox_arg(q, max_deg=70)  # FIRELAB asks for a fixed 200 km half-width square around a fire
    g = population.window(w, s, e, n)
    if g is None:
        raise BadRequest("population grid not built on this server: python -m hotspots.population build <GHS-POP tif>")
    return g


ROUTES = {"/api/status": api_status, "/api/firms": api_firms, "/api/harmonize": api_harmonize,
          "/api/weather": api_weather, "/api/population": api_population}


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **k):
        super().__init__(*a, directory=str(WEB), **k)

    def log_message(self, fmt, *args):  # never log query strings (they could carry user input)
        print(f"{self.address_string()} {self.command} {self.path.split('?')[0]} {args[1] if len(args) > 1 else ''}", flush=True)

    def end_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        if self.path.startswith(("/app-data/", "/js/", "/css/", "/index.html")) or self.path in ("/", ""):
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
            self.path = "/index.html"
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
