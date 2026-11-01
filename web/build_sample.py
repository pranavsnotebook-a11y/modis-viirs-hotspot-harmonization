"""Build web/sample.json from data/harmonized.csv (all 'both' rows kept, others sampled).
Usage: python3 web/build_sample.py [harmonized.csv] [out.json]   (stdlib only)
FRP histograms and counts are computed on the FULL data, not the sample."""
import csv, json, math, random, sys, os

SRC = sys.argv[1] if len(sys.argv) > 1 else "data/harmonized.csv"
OUT = sys.argv[2] if len(sys.argv) > 2 else os.path.join(os.path.dirname(__file__), "sample.json")
PER_CLASS = 9000  # sampled rows for each of viirs-only / modis-only
random.seed(42)

def f(x):
    return float(x) if x not in ("", None) else None

rows = {"viirs": [], "modis": [], "both": []}
counts = {"viirs": 0, "modis": 0, "both": 0}
EDGES = [round(10 ** (-1 + 0.2 * i), 4) for i in range(0, 26)]  # 0.1 .. 1e4 MW, log bins
hist = {"MODIS": [0] * (len(EDGES) - 1), "VIIRS": [0] * (len(EDGES) - 1)}

def add_hist(sensor, v):
    if v is None or v <= 0:
        return
    i = int((math.log10(v) + 1) / 0.2)
    i = max(0, min(len(EDGES) - 2, i))
    hist[sensor][i] += 1

with open(SRC) as fh:
    for r in csv.DictReader(fh):
        k = r["detected_by"]
        counts[k] += 1
        own = f(r["modis_frp"]) if r["sensor"] == "MODIS" else f(r["viirs_frp"])
        add_hist(r["sensor"], own)
        rows[k].append([round(float(r["latitude"]), 3), round(float(r["longitude"]), 3),
                        own, f(r["modis_frp"]) if k == "both" else None, r["time"][11:16]])

out_rows = []
for k, lst in rows.items():
    if k != "both" and len(lst) > PER_CLASS:
        lst = random.sample(lst, PER_CLASS)
    for lat, lon, frp, mfrp, t in lst:
        out_rows.append([lat, lon, k, frp, mfrp, t])

data = {"columns": ["lat", "lon", "detected_by", "frp", "modis_frp", "utc_hhmm"],
        "rows": out_rows, "counts": counts, "hist_edges": EDGES, "hist": hist,
        "note": "Rows: all 'both' + random sample of others. Counts/hist use full data. 'frp' is the row's own sensor FRP (MW)."}
with open(OUT, "w") as fh:
    json.dump(data, fh, separators=(",", ":"))
print(OUT, os.path.getsize(OUT) / 1e6, "MB", counts, len(out_rows), "rows")
