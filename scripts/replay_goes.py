#!/usr/bin/env python3
"""GOES-16 ABI-L2-FDCF replay of the 8 January 2025 line trip (fires A and B).

Question fixed in advance: did GOES-16 flag a fire pixel covering fire A or fire B
before the 20:01 UTC trip, and when was the FIRST such scan on 8 and on 7 January 2025?

Needs only numpy and h5py. The project .venv is Python 3.15, for which no h5py wheel
exists; any Python with numpy+h5py works, e.g.
    uv venv --python 3.14 /tmp/v && uv pip install --python /tmp/v/bin/python h5py numpy
    /tmp/v/bin/python -I scripts/replay_goes.py
Downloads are cached in data/replay/goes/ (git-ignored). Output: docs/research/replay_2025-01-08/goes.json
"""
import json, math, os, re, sys, time, urllib.request
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
import numpy as np
import h5py

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CACHE = os.path.join(ROOT, "data", "replay", "goes")
OUT = os.path.join(ROOT, "docs", "research", "replay_2025-01-08", "goes.json")
BUCKET = "noaa-goes16"
BASE = f"https://{BUCKET}.s3.amazonaws.com/"
PRODUCT = "ABI-L2-FDCF"
# (day of year, first HHMM, last HHMM) by scan start time, inclusive
WINDOWS = {"2025-01-08": (8, "1000", "2010"), "2025-01-07": (7, "1200", "2350")}
TRIP = "2025-01-08T20:01"
SITES = {"A": (-25.265, -56.765), "B": (-25.215, -57.069)}
PARK = (-25.2271, -56.7900)
ASUNCION = (-25.28, -57.64)
NEAR_KM = 4.0
PARK_KM = 30.0
LATENCY_MIN = 30  # assumption (NASA FIRMS typical figure for geostationary data), not measured
HALF = 24         # window half-size in pixels around each site

def http(url, tries=4):
    for i in range(tries):
        try:
            with urllib.request.urlopen(url, timeout=60) as r:
                return r.read()
        except Exception:
            if i == tries - 1:
                raise
            time.sleep(2 * (i + 1))

def list_keys(doy, hh):
    prefix = f"{PRODUCT}/2025/{doy:03d}/{hh:02d}/"
    keys, token = [], None
    while True:
        url = f"{BASE}?list-type=2&prefix={prefix}" + (f"&continuation-token={urllib.parse.quote(token)}" if token else "")
        root = ET.fromstring(http(url))
        ns = {"s": "http://s3.amazonaws.com/doc/2006-03-01/"}
        keys += [(c.find("s:Key", ns).text, int(c.find("s:Size", ns).text)) for c in root.findall("s:Contents", ns)]
        if root.find("s:IsTruncated", ns).text == "true":
            token = root.find("s:NextContinuationToken", ns).text
        else:
            return keys

import urllib.parse

def parse_name(key):
    m = re.search(r"_s(\d{4})(\d{3})(\d{2})(\d{2})(\d{2})(\d)_e(\d{4})(\d{3})(\d{2})(\d{2})(\d{2})", key)
    y, d, hh, mm, ss, _, ey, ed, ehh, emm, ess = m.groups()
    return dict(doy=int(d), start=f"{hh}:{mm}:{ss}", end=f"{ehh}:{emm}:{ess}", hhmm=hh + mm, ehhmm=ehh + emm)

def fetch(item):
    key, size = item
    path = os.path.join(CACHE, os.path.basename(key))
    if os.path.exists(path) and os.path.getsize(path) == size:
        return path
    data = http(BASE + key)
    with open(path + ".part", "wb") as f:
        f.write(data)
    os.replace(path + ".part", path)
    return path

# ---------- ABI fixed grid <-> lat/lon (GOES-R PUG formulas) ----------
class Proj:
    def __init__(self, a):
        self.h = float(a["perspective_point_height"][0]); self.req = float(a["semi_major_axis"][0])
        self.rpol = float(a["semi_minor_axis"][0]); self.lon0 = math.radians(float(a["longitude_of_projection_origin"][0]))
        self.H = self.h + self.req
    def to_lonlat(self, x, y):
        x = np.asarray(x, float); y = np.asarray(y, float)
        req, rpol, H = self.req, self.rpol, self.H
        a = np.sin(x)**2 + np.cos(x)**2 * (np.cos(y)**2 + (req**2 / rpol**2) * np.sin(y)**2)
        b = -2 * H * np.cos(x) * np.cos(y)
        c = H**2 - req**2
        disc = b**2 - 4 * a * c
        ok = disc >= 0
        rs = np.where(ok, (-b - np.sqrt(np.where(ok, disc, 0))) / (2 * a), np.nan)
        sx = rs * np.cos(x) * np.cos(y); sy = -rs * np.sin(x); sz = rs * np.cos(x) * np.sin(y)
        lat = np.arctan((req**2 / rpol**2) * sz / np.sqrt((H - sx)**2 + sy**2))
        lon = self.lon0 - np.arctan(sy / (H - sx))
        return np.degrees(lat), np.degrees(lon)
    def to_xy(self, lat, lon):
        req, rpol, H = self.req, self.rpol, self.H
        phi = math.radians(lat); lam = math.radians(lon)
        e2 = 1 - rpol**2 / req**2
        phic = math.atan((rpol**2 / req**2) * math.tan(phi))
        rc = rpol / math.sqrt(1 - e2 * math.cos(phic)**2)
        sx = H - rc * math.cos(phic) * math.cos(lam - self.lon0)
        sy = -rc * math.cos(phic) * math.sin(lam - self.lon0)
        sz = rc * math.sin(phic)
        return math.asin(-sy / math.sqrt(sx**2 + sy**2 + sz**2)), math.atan(sz / sx)

def hav(lat1, lon1, lat2, lon2):
    p1, p2 = np.radians(lat1), np.radians(lat2)
    d = np.sin((p2 - p1) / 2)**2 + np.cos(p1) * np.cos(p2) * np.sin(np.radians(lon2 - lon1) / 2)**2
    return 2 * 6371.0088 * np.arcsin(np.sqrt(d))

def scaled(ds):
    s = ds.attrs.get("scale_factor"); o = ds.attrs.get("add_offset")
    v = ds[()].astype(np.float64)
    if s is not None:
        v = v * float(s[0]) + float(o[0])
    return v

def main():
    os.makedirs(CACHE, exist_ok=True)
    # 1. list
    items = []
    for day, (doy, lo, hi) in WINDOWS.items():
        found = 0
        for hh in range(int(lo[:2]), int(hi[:2]) + 1):
            for key, size in list_keys(doy, hh):
                p = parse_name(key)
                if lo <= p["hhmm"] <= hi:
                    items.append((key, size, day, p)); found += 1
        print(day, "files in window:", found, flush=True)
    if not items:
        sys.exit("no GOES-16 files found; check noaa-goes19 / noaa-goes18 before substituting anything")
    # 2. download
    todo = [(k, s) for k, s, _, _ in items]
    with ThreadPoolExecutor(3) as ex:
        paths = list(ex.map(fetch, todo))
    print("downloaded/cached:", len(paths), flush=True)
    items.sort(key=lambda t: (t[2], t[3]["start"]))

    # 3. projection from first file, checks
    with h5py.File(paths[0]) as f:
        proj = Proj(dict(f["goes_imager_projection"].attrs))
        x = scaled(f["x"]); y = scaled(f["y"])
        mattrs = f["Mask"].attrs
        flag_values = [int(v) for v in mattrs["flag_values"]]
        flag_meanings = mattrs["flag_meanings"].decode().split()
        lon0_file = float(f["goes_imager_projection"].attrs["longitude_of_projection_origin"][0])
    names = dict(zip(flag_values, flag_meanings))
    fire_codes = sorted(v for v, n in names.items() if n.endswith("fire_pixel") and v != 0 and not n.startswith("processed"))
    # cloud: names containing 'cloud' that are not cloud-contaminated FIRE pixels
    cloud_codes = sorted(v for v, n in names.items() if "cloud" in n and "fire_pixel" not in n)
    sub_lat, sub_lon = proj.to_lonlat(0.0, 0.0)
    checks = {"projection_origin_lon_in_file": lon0_file,
              "subsatellite_lat_lon": [float(sub_lat), float(sub_lon)]}
    chk = {}
    for nm, (la, lo) in dict(ASUNCION=ASUNCION, A=SITES["A"], B=SITES["B"], PARK=PARK).items():
        xr, yr = proj.to_xy(la, lo)
        ix = int(np.argmin(np.abs(x - xr))); iy = int(np.argmin(np.abs(y - yr)))
        plat, plon = proj.to_lonlat(x[ix], y[iy])
        rl, ro = proj.to_lonlat(xr, yr)
        chk[nm] = dict(row=iy, col=ix, pixel_centre_lat=float(plat), pixel_centre_lon=float(plon),
                       roundtrip_error_km=float(hav(la, lo, rl, ro)),
                       pixel_centre_to_point_km=float(hav(la, lo, plat, plon)))
    checks["points"] = chk
    sizes = {}
    for nm in ("A", "B", "PARK"):
        r, c = chk[nm]["row"], chk[nm]["col"]
        la0, lo0 = proj.to_lonlat(x[c], y[r])
        la1, lo1 = proj.to_lonlat(x[c + 1], y[r]); la2, lo2 = proj.to_lonlat(x[c], y[r + 1])
        ew, ns = float(hav(la0, lo0, la1, lo1)), float(hav(la0, lo0, la2, lo2))
        sizes[nm] = dict(east_west_km=ew, north_south_km=ns)
    checks["pixel_size_km"] = sizes
    print(json.dumps(checks, indent=1), flush=True)

    # precompute windows
    wins = {}
    for nm, (la, lo) in dict(A=SITES["A"], B=SITES["B"], PARK=PARK).items():
        r, c = chk[nm]["row"], chk[nm]["col"]
        r0, r1, c0, c1 = r - HALF, r + HALF + 1, c - HALF, c + HALF + 1
        XX, YY = np.meshgrid(x[c0:c1], y[r0:r1])
        glat, glon = proj.to_lonlat(XX, YY)
        wins[nm] = dict(sl=(slice(r0, r1), slice(c0, c1)), lat=glat, lon=glon,
                        dist=hav(la, lo, glat, glon), site=(r - r0, c - c0))

    # 4. per scan
    scans = []
    for (key, size, day, p), path in zip(items, paths):
        with h5py.File(path) as f:
            m = {nm: f["Mask"][w["sl"]] for nm, w in wins.items()}
            pw = {nm: f["Power"][w["sl"]] for nm, w in wins.items()}
            dq = {nm: f["DQF"][w["sl"]] for nm, w in wins.items()}
        rec = dict(day=day, start=p["start"], end=p["end"], file=os.path.basename(key),
                   pre_trip=(f"{day}T{p['end'][:5]}" <= TRIP) if day == "2025-01-08" else None)
        for nm in ("A", "B"):
            w = wins[nm]; sr, sc = w["site"]; M = m[nm]
            code = int(M[sr, sc])
            near = []
            for iy, ix in zip(*np.where(np.isin(M, fire_codes) & (w["dist"] <= NEAR_KM))):
                near.append(dict(mask=int(M[iy, ix]), class_name=names[int(M[iy, ix])],
                                 frp_mw=(None if pw[nm][iy, ix] < 0 or np.isnan(pw[nm][iy, ix]) else round(float(pw[nm][iy, ix]), 2)),
                                 dist_km=round(float(w["dist"][iy, ix]), 2)))
            ff = np.isin(M, fire_codes)
            nearest = round(float(w["dist"][ff].min()), 2) if ff.any() else None  # context only, whole window (about 50 km square)
            blk = M[sr - 1:sr + 2, sc - 1:sc + 2]
            rec[nm] = dict(site_pixel_mask=code, site_pixel_class=names.get(code, "other"),
                           site_pixel_dqf=int(dq[nm][sr, sc]),
                           site_pixel_is_cloud=code in cloud_codes,
                           cloud_pixels_in_3x3=int(np.isin(blk, cloud_codes).sum()),
                           fire_pixels_within_4km=near,
                           nearest_fire_pixel_km_in_window=nearest,
                           detected=len(near) > 0)
        w = wins["PARK"]; M = m["PARK"]; sel = np.isin(M, fire_codes) & (w["dist"] <= PARK_KM)
        by = {}
        for v in M[sel]:
            by[names[int(v)]] = by.get(names[int(v)], 0) + 1
        rec["park_fire_pixels_within_30km"] = int(sel.sum())
        rec["park_fire_pixel_latlon"] = [[round(float(w["lat"][i, j]), 3), round(float(w["lon"][i, j]), 3), names[int(M[i, j])]] for i, j in zip(*np.where(sel))]
        rec["park_fire_pixels_by_class"] = by
        scans.append(rec)

    # 5. summary
    def summ(nm, day):
        sc = [s for s in scans if s["day"] == day]
        det = [s for s in sc if s[nm]["detected"]]
        pre = [s for s in det if s["pre_trip"]] if day == "2025-01-08" else det
        px = [q for s in pre for q in s[nm]["fire_pixels_within_4km"]]
        frp = [q["frp_mw"] for q in px if q["frp_mw"] is not None]
        cloudcodes = {}
        for s in sc:
            k = s[nm]["site_pixel_class"]; cloudcodes[k] = cloudcodes.get(k, 0) + 1
        out = dict(scans_in_window=len(sc), scans_with_detection=len(det),
                   scans_with_detection_before_trip=(len(pre) if day == "2025-01-08" else None),
                   first_detection_start_utc=det[0]["start"] if det else None,
                   first_detection_end_utc=det[0]["end"] if det else None,
                   last_detection_start_utc=det[-1]["start"] if det else None,
                   detection_start_times_utc=[s["start"] for s in det],
                   classes_seen=sorted({q["class_name"] for q in px}),
                   class_counts=({c: sum(1 for q in px if q["class_name"] == c) for c in sorted({q["class_name"] for q in px})}),
                   frp_min_mw=min(frp) if frp else None, frp_max_mw=max(frp) if frp else None,
                   min_distance_km=min((q["dist_km"] for q in px), default=None),
                   site_pixel_class_counts=cloudcodes,
                   scans_site_pixel_cloud=sum(1 for s in sc if s[nm]["site_pixel_is_cloud"]),
                   scans_cloud_in_3x3=sum(1 for s in sc if s[nm]["cloud_pixels_in_3x3"] > 0))
        if day == "2025-01-08" and pre:
            h, mi, se = map(int, pre[0]["start"].split(":")); e = list(map(int, pre[0]["end"].split(":")))
            trip = 20 * 60 + 1
            out["lead_min_if_30min_after_scan_start"] = trip - (h * 60 + mi + LATENCY_MIN)
            out["lead_min_if_30min_after_scan_end"] = trip - (e[0] * 60 + e[1] + LATENCY_MIN)
        if day == "2025-01-07" and det:
            h, mi, _ = map(int, det[0]["start"].split(":"))
            out["lead_min_to_trip_if_30min_after_scan_start"] = (24 * 60 - (h * 60 + mi + LATENCY_MIN)) + 20 * 60 + 1
        if day == "2025-01-08":
            late = [s for s in det if s["pre_trip"]]
            if late:
                lh, lm, _ = map(int, late[-1]["start"].split(":"))
                out["last_pre_trip_detection_start_utc"] = late[-1]["start"]
        return out
    summary = {nm: {d: summ(nm, d) for d in WINDOWS} for nm in ("A", "B")}
    park_pre = [s["park_fire_pixels_within_30km"] for s in scans if s["day"] == "2025-01-08" and s["pre_trip"]]
    summary["park_30km_pre_trip_8jan"] = dict(
        scans=len(park_pre), min=min(park_pre), max=max(park_pre),
        first_scan_with_any=next((s["start"] for s in scans if s["day"] == "2025-01-08" and s["park_fire_pixels_within_30km"] > 0), None))
    summary["scans_total"] = len(scans)
    summary["scans_8jan_after_trip_in_window"] = sum(1 for s in scans if s["day"] == "2025-01-08" and not s["pre_trip"])
    out = dict(question="Did GOES-16 flag a fire pixel covering fire A or fire B before the 20:01 UTC trip on 2025-01-08; first such scan on 8 and 7 January 2025?",
               bucket=BUCKET, product=PRODUCT, trip_utc=TRIP, near_km=NEAR_KM, latency_assumption_min=LATENCY_MIN,
               latency_note="30 min is NASA's stated typical figure for geostationary data in FIRMS; assumption, not measured",
               sites=SITES, park=PARK, fire_mask_codes_used=fire_codes,
               fire_code_names={str(c): names[c] for c in fire_codes},
               cloud_codes_used=cloud_codes, cloud_code_names={str(c): names[c] for c in cloud_codes},
               projection_checks=checks, summary=summary, scans=scans)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w") as f:
        json.dump(out, f, indent=1)
    print(json.dumps(summary, indent=1))

if __name__ == "__main__":
    main()
