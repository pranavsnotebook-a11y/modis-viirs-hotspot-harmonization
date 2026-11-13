"""NASA FIRMS client: area API with a MAP_KEY, public no-key files otherwise. Server side only.

The MAP_KEY is read from the FIRMS_MAP_KEY environment variable or a git-ignored .env file in the project root.
It is never written to logs, error messages, cache file names or anything sent to a browser.

Products (https://firms.modaps.eosdis.nasa.gov/api/area/):
  MODIS_NRT, MODIS_SP                       MODIS Collection 6.1, Terra and Aqua, 1 km
  VIIRS_SNPP_NRT, VIIRS_SNPP_SP             VIIRS 375 m, Suomi NPP
  VIIRS_NOAA20_NRT, VIIRS_NOAA20_SP         VIIRS 375 m, NOAA-20
  VIIRS_NOAA21_NRT, VIIRS_NOAA21_SP         VIIRS 375 m, NOAA-21
NRT = near real time (hours after overpass). SP = standard processing (science quality, weeks to months behind).
Area API limits: DAY_RANGE 1 to 5 per request; 5000 transactions per 10 minutes per key, and a large request can
count as several. Longer periods are split into 5-day requests and paced here.

Without a key only the public global NRT files are available: the last 24 hours, 48 hours or 7 days, no SP.
"""
import hashlib
import io
import os
import re
import threading
import time
import urllib.error
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
import pandas as pd

BASE = "https://firms.modaps.eosdis.nasa.gov"
ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / "data" / "cache" / "firms"
PRODUCTS = {
    "MODIS_NRT": {"sensor": "MODIS", "processing": "NRT", "public": "modis-c6.1/csv/MODIS_C6_1_Global_{p}.csv", "label": "MODIS C6.1 Terra + Aqua, NRT"},
    "MODIS_SP": {"sensor": "MODIS", "processing": "SP", "public": None, "label": "MODIS C6.1 Terra + Aqua, standard processing"},
    "VIIRS_SNPP_NRT": {"sensor": "VIIRS", "processing": "NRT", "public": "suomi-npp-viirs-c2/csv/SUOMI_VIIRS_C2_Global_{p}.csv", "label": "VIIRS S-NPP 375 m, NRT"},
    "VIIRS_SNPP_SP": {"sensor": "VIIRS", "processing": "SP", "public": None, "label": "VIIRS S-NPP 375 m, standard processing"},
    "VIIRS_NOAA20_NRT": {"sensor": "VIIRS", "processing": "NRT", "public": "noaa-20-viirs-c2/csv/J1_VIIRS_C2_Global_{p}.csv", "label": "VIIRS NOAA-20 375 m, NRT"},
    "VIIRS_NOAA20_SP": {"sensor": "VIIRS", "processing": "SP", "public": None, "label": "VIIRS NOAA-20 375 m, standard processing"},
    "VIIRS_NOAA21_NRT": {"sensor": "VIIRS", "processing": "NRT", "public": "noaa-21-viirs-c2/csv/J2_VIIRS_C2_Global_{p}.csv", "label": "VIIRS NOAA-21 375 m, NRT"},
    "VIIRS_NOAA21_SP": {"sensor": "VIIRS", "processing": "SP", "public": None, "label": "VIIRS NOAA-21 375 m, standard processing"},
}
# Satellite code used across this project: 0 Terra, 1 Aqua, 2 S-NPP, 3 NOAA-20, 4 NOAA-21
SAT_CODE = {"T": 0, "Terra": 0, "A": 1, "Aqua": 1, "N": 2, "SNPP": 2, "N20": 3, "1": 3, "J1": 3, "N21": 4, "2": 4, "J2": 4}
PRODUCT_SAT = {"VIIRS_SNPP": 2, "VIIRS_NOAA20": 3, "VIIRS_NOAA21": 4}
MAX_DAYS = 5
LIMIT, PERIOD_S = 4500, 600  # stay under the 5000 per 10 minutes FIRMS allows


class FirmsError(Exception):
    """A FIRMS request failed. The message never contains the key."""


def _load_dotenv():
    p = ROOT / ".env"
    if not p.exists():
        return {}
    out = {}
    for line in p.read_text().splitlines():
        m = re.match(r"\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$", line)
        if m and not line.lstrip().startswith("#"):
            out[m.group(1)] = m.group(2).strip("'\"")
    return out


def map_key():
    k = os.environ.get("FIRMS_MAP_KEY") or _load_dotenv().get("FIRMS_MAP_KEY")
    return k if k and re.fullmatch(r"[A-Za-z0-9]{16,64}", k) else None


def _redact(s, key):
    return s.replace(key, "<MAP_KEY>") if key else s


class _Pacer:
    """Counts requests in the last 10 minutes and waits rather than exceed the FIRMS limit."""

    def __init__(self):
        self.t, self.lock = [], threading.Lock()

    def take(self, cost=1):
        with self.lock:
            now = time.time()
            self.t = [x for x in self.t if now - x < PERIOD_S]
            if len(self.t) + cost > LIMIT:
                wait = PERIOD_S - (now - self.t[0]) + 1
                raise FirmsError(f"local FIRMS budget reached; try again in {int(wait)} s")
            self.t += [now] * cost


PACER = _Pacer()


def _get(url, key=None, timeout=120):
    req = urllib.request.Request(url, headers={"User-Agent": "FIREVERSE-HotSpotExplorer/1.0 (NASA Space Apps)"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            body = r.read()
    except urllib.error.HTTPError as e:
        raise FirmsError(f"FIRMS returned HTTP {e.code} for {_redact(url, key)}") from None
    except (urllib.error.URLError, TimeoutError) as e:
        raise FirmsError(f"FIRMS could not be reached ({_redact(str(getattr(e, 'reason', e)), key)})") from None
    text = body[:400].decode("utf-8", "replace")
    if "Invalid MAP_KEY" in text or "MAP_KEY is invalid" in text or "exceeded" in text.lower():
        raise FirmsError("FIRMS rejected the MAP_KEY or the transaction limit was exceeded")
    if text.lstrip().startswith("<") or "Invalid" in text[:80]:
        raise FirmsError("FIRMS returned an error instead of CSV: " + _redact(text[:160].strip(), key))
    return body


def _cached(name, ttl_s, fetch):
    """Disk cache. ttl_s None means keep forever (past standard-processing data does not change)."""
    CACHE.mkdir(parents=True, exist_ok=True)
    p = CACHE / name
    if p.exists() and (ttl_s is None or time.time() - p.stat().st_mtime < ttl_s):
        return p.read_bytes(), True
    body = fetch()
    tmp = p.with_suffix(".part")
    tmp.write_bytes(body)
    tmp.replace(p)
    return body, False


def _parse(body):
    if not body.strip():
        return pd.DataFrame()
    return pd.read_csv(io.BytesIO(body), dtype={"acq_time": str, "satellite": str, "version": str, "confidence": str})


def bbox_text(b):
    w, s, e, n = (float(x) for x in b)
    if not (-180 <= w < e <= 180 and -90 <= s < n <= 90):
        raise FirmsError("area must be west,south,east,north within -180,-90,180,90 with west < east and south < north")
    return f"{w:g},{s:g},{e:g},{n:g}"


def area(source, bbox=(-180, -90, 180, 90), days=1, day=None):
    """One area API request: `days` (1-5) starting on `day` (YYYY-MM-DD, default most recent). Needs a key."""
    if source not in PRODUCTS:
        raise FirmsError(f"unknown product {source}")
    key = map_key()
    if not key:
        raise FirmsError("no FIRMS_MAP_KEY configured on the server")
    days = int(days)
    if not 1 <= days <= MAX_DAYS:
        raise FirmsError("FIRMS allows 1 to 5 days per request")
    area_s = bbox_text(bbox)
    url = f"{BASE}/api/area/csv/{key}/{source}/{area_s}/{days}" + (f"/{day}" if day else "")
    tag = hashlib.sha1(f"{source}|{area_s}|{days}|{day}".encode()).hexdigest()[:20]
    past = day and date.fromisoformat(day) + timedelta(days=days) < datetime.now(timezone.utc).date() - timedelta(days=2)
    ttl = None if (PRODUCTS[source]["processing"] == "SP" and past) else (24 * 3600 if past else 1800)

    def fetch():
        PACER.take(days)
        return _get(url, key)

    body, hit = _cached(f"area_{tag}.csv", ttl, fetch)
    return _parse(body), {"via": "FIRMS area API", "cache": "hit" if hit else "miss", "product": source, "area": area_s, "days": days, "end_date": day}


def public(source, period="7d"):
    """Public global NRT file, no key. period: 24h, 48h or 7d."""
    p = PRODUCTS.get(source, {}).get("public")
    if not p:
        raise FirmsError(f"{source} has no public no-key file; it needs FIRMS_MAP_KEY")
    if period not in ("24h", "48h", "7d"):
        raise FirmsError("period must be 24h, 48h or 7d")
    url = f"{BASE}/data/active_fire/{p.format(p=period)}"
    body, hit = _cached(f"public_{source}_{period}.csv", 1800, lambda: _get(url))
    return _parse(body), {"via": "FIRMS public global file", "cache": "hit" if hit else "miss", "product": source, "period": period}


def fetch_range(source, bbox, start, end):
    """Every record of a product in a box between two dates (inclusive), in 5-day area requests. Needs a key."""
    s, e = date.fromisoformat(str(start)), date.fromisoformat(str(end))
    if e < s:
        raise FirmsError("end date is before start date")
    if (e - s).days > 366:
        raise FirmsError("ask for at most one year at a time")
    frames, parts, d = [], [], s
    while d <= e:
        n = min(MAX_DAYS, (e - d).days + 1)
        # FIRMS: "Returns data for [DATE] .. [DATE + DAY_RANGE-1]"
        f, info = area(source, bbox, n, d.isoformat())
        frames.append(f); parts.append(info)
        d += timedelta(days=n)
    out = pd.concat([f for f in frames if len(f)], ignore_index=True) if any(len(f) for f in frames) else pd.DataFrame()
    return out, {"via": "FIRMS area API", "product": source, "requests": len(parts), "cache_hits": sum(p["cache"] == "hit" for p in parts)}


def key_status():
    key = map_key()
    if not key:
        return None
    try:
        body = _get(f"{BASE}/mapserver/mapkey_status/?MAP_KEY={key}", key, timeout=30)
        import json
        j = json.loads(body)
        return {k: j.get(k) for k in ("transaction_limit", "current_transactions", "transaction_interval")}
    except Exception as e:  # status is informational only
        return {"error": _redact(str(e), key)}


def availability():
    """Date range FIRMS holds for each product (needs a key)."""
    key = map_key()
    if not key:
        return None
    body, _ = _cached("availability.csv", 6 * 3600, lambda: _get(f"{BASE}/api/data_availability/csv/{key}/all", key))
    return _parse(body).to_dict("records")


def normalize(df, source):
    """FIRMS CSV -> the columns used by the matcher and the web app. Keeps the original values beside them."""
    from .schema import normalize as base
    if df is None or df.empty:
        return pd.DataFrame()
    sensor = PRODUCTS[source]["sensor"]
    d = df.copy()
    d["acq_time"] = d["acq_time"].astype(str).str.zfill(4)
    out = base(d, sensor)
    if sensor == "MODIS":
        out["sat"] = d["satellite"].astype(str).str[0].map({"T": 0, "A": 1}).values
    else:
        out["sat"] = PRODUCT_SAT[source.rsplit("_", 1)[0]]
    out["confidence_raw"] = d["confidence"].astype(str).values
    out["product"] = source
    out["processing"] = PRODUCTS[source]["processing"]
    out["version"] = d["version"].astype(str).values if "version" in d else ""
    out["type"] = pd.to_numeric(d["type"], errors="coerce").values if "type" in d else float("nan")
    out["bright"] = pd.to_numeric(d.get("brightness", d.get("bright_ti4")), errors="coerce").values
    return out


def clip(df, bbox, start=None, end=None):
    """Restrict normalized records to a box and a UTC date range (inclusive)."""
    if df.empty:
        return df
    w, s, e, n = (float(x) for x in bbox)
    k = df.latitude.between(s, n) & df.longitude.between(w, e)
    if start:
        k &= df.time >= pd.Timestamp(start, tz="UTC")
    if end:
        k &= df.time < pd.Timestamp(end, tz="UTC") + pd.Timedelta(days=1)
    return df[k].reset_index(drop=True)


def get(source, bbox, days=1, day=None, prefer_key=True):
    """Normalized records for a product and box: area API if a key is set, else the public 7-day file clipped."""
    if prefer_key and map_key():
        if day:
            raw, info = fetch_range(source, bbox, day, (date.fromisoformat(day) + timedelta(days=int(days) - 1)).isoformat())
        else:
            raw, info = area(source, bbox, days)
        return normalize(raw, source), info
    if day:
        today = datetime.now(timezone.utc).date()
        if date.fromisoformat(day) < today - timedelta(days=6):
            raise FirmsError("dates older than 7 days need FIRMS_MAP_KEY on the server (or the yearly archive)")
    raw, info = public(source, "7d")
    n = normalize(raw, source)
    if day:
        end = (date.fromisoformat(day) + timedelta(days=int(days) - 1)).isoformat()
        n = clip(n, bbox, day, end)
    else:
        last = n.time.max() if len(n) else None
        n = clip(n, bbox, (last - pd.Timedelta(days=int(days))).date().isoformat() if last is not None else None)
        if last is not None:
            n = n[n.time > last - pd.Timedelta(days=int(days))].reset_index(drop=True)
    return n, info
