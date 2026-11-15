"""Prep for the 2025 alert-load comparison (distance rule vs wind rule) on Paraguay 500 kV lines.
Writes data/replay/alert_load_dets.json, alert_load_lines.json and caches ERA5 cells in data/replay/era5_2025/.
usage: .venv/bin/python scripts/alert_load_prep.py"""
import json, math, os, sys, time, urllib.request, urllib.error
import numpy as np, pandas as pd
from scipy.spatial import cKDTree

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
R = os.path.join(ROOT, 'data/replay')
KM = 111.195
FILES = [('viirs-jpss1_2025_Paraguay.csv', lambda d: 'NOAA-20'), ('viirs-snpp_2025_Paraguay.csv', lambda d: 'S-NPP'),
         ('modis_2025_Paraguay.csv', lambda d: d['satellite'].map({'Terra': 'Terra', 'Aqua': 'Aqua'}))]

# 500 kV lines
els = json.load(open(os.path.join(R, 'lines.json')))['elements']
lines = []
for e in els:
    v = (e.get('tags') or {}).get('voltage', '')
    if '500000' in v and e.get('geometry'):
        lines.append({'id': 'w%d' % e['id'], 'pts': [[round(g['lat'], 6), round(g['lon'], 6)] for g in e['geometry']]})
json.dump(lines, open(os.path.join(R, 'alert_load_lines.json'), 'w'))
print('500 kV ways:', len(lines))

# densify to ~200 m in a local km frame (equirectangular around lat -24)
lat0 = -24.0; c0 = math.cos(math.radians(lat0))
def xy(lat, lon): return np.column_stack([np.asarray(lat) * KM, np.asarray(lon) * KM * c0])
dense = []
for L in lines:
    p = np.array(L['pts'])
    for a, b in zip(p[:-1], p[1:]):
        n = max(1, int(math.ceil(math.hypot((b[0]-a[0])*KM, (b[1]-a[1])*KM*c0) / 0.2)))
        for k in range(n + 1): dense.append(a + (b - a) * k / n)
dense = np.array(dense)
tree = cKDTree(xy(dense[:, 0], dense[:, 1]))

frames = []
for f, satf in FILES:
    d = pd.read_csv(os.path.join(R, f), dtype={'acq_time': str})
    n0 = len(d); d = d[d['type'] == 0].copy()
    d['sat'] = satf(d)
    print(f, 'rows', n0, 'type0', len(d), 'unmapped sat', int(d['sat'].isna().sum()))
    frames.append(d[['latitude', 'longitude', 'acq_date', 'acq_time', 'sat', 'frp']])
df = pd.concat(frames, ignore_index=True).dropna(subset=['sat'])
dist, _ = tree.query(xy(df['latitude'], df['longitude']))
df = df[dist <= 25].copy()
df['acq_time'] = df['acq_time'].str.zfill(4)
df['time'] = df['acq_date'] + 'T' + df['acq_time'].str[:2] + ':' + df['acq_time'].str[2:] + 'Z'
dets = [{'lat': float(r.latitude), 'lon': float(r.longitude), 'time': r.time, 'sat': r.sat, 'frp': float(r.frp)} for r in df.itertuples()]
json.dump(dets, open(os.path.join(R, 'alert_load_dets.json'), 'w'))
print('detections within 25 km of a 500 kV line:', len(dets), df['sat'].value_counts().to_dict())

# ERA5 cells
q = lambda x: round(x * 4) / 4
cells = sorted({(q(d['lat']), q(d['lon'])) for d in dets})
print('cells:', len(cells))
os.makedirs(os.path.join(R, 'era5_2025'), exist_ok=True)
H = 'wind_speed_10m,wind_speed_100m,wind_direction_100m,boundary_layer_height,cloud_cover'
failed = []
for i, (la, lo) in enumerate(cells):
    fp = os.path.join(R, 'era5_2025', '%.2f_%.2f.json' % (la, lo))
    if os.path.exists(fp) and os.path.getsize(fp) > 1000: continue
    url = ('https://archive-api.open-meteo.com/v1/archive?latitude=%.2f&longitude=%.2f&hourly=%s&start_date=2025-01-01&end_date=2025-12-31'
           '&wind_speed_unit=ms&timezone=GMT' % (la, lo, H))
    ok = False
    for attempt in range(8):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'fireverse-alert-load/1.0 (research script)'})
            j = json.load(urllib.request.urlopen(req, timeout=120))
            h = j['hourly']
            json.dump({'lat': la, 'lon': lo, 'hourly': h}, open(fp, 'w')); ok = True; break
        except urllib.error.HTTPError as e:
            wait = 65 if e.code == 429 else 5 * 2 ** attempt
            body = e.read()[:200]
            print('  cell', la, lo, 'HTTP', e.code, body, 'wait', wait, file=sys.stderr)
            if e.code == 400: break
            time.sleep(wait)
        except Exception as e:
            print('  cell', la, lo, 'error', e, file=sys.stderr); time.sleep(5 * 2 ** attempt)
    if not ok: failed.append([la, lo])
    print('cell %d/%d %.2f %.2f %s' % (i + 1, len(cells), la, lo, 'ok' if ok else 'FAILED'), flush=True)
    time.sleep(1)
json.dump({'cells': len(cells), 'failed': failed}, open(os.path.join(R, 'alert_load_fetch.json'), 'w'))
print('failed cells:', len(failed))
