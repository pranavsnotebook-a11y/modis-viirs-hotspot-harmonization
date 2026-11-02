"""Has Terra's or Aqua's overpass time drifted, and does the Aqua/Terra count ratio move with it?

Reads local solar time directly from the detections in the FIRMS yearly MODIS archives. If orbit drift changes what
MODIS sees through the fire's daily cycle, the same instrument pair should show a changing day and night ratio.
Fires and their geography also change year to year, so this shows a coincidence in time, not a cause.
usage: python -m hotspots.drift data/archive [out.csv]"""
import io
import json
import sys
import zipfile
from pathlib import Path
import numpy as np
import pandas as pd

USE = ["longitude", "acq_time", "satellite", "daynight"]
# Daily cycle from the held-out-Terra run in commit 5021b3b (docs/research/loso_results.txt): fitted on one week of 2026, no refit here.
CYCLE_C, CYCLE_S = -1.06, -0.93


def cycle(t):
    return CYCLE_C * np.cos(2 * np.pi * np.asarray(t) / 24) + CYCLE_S * np.sin(2 * np.pi * np.asarray(t) / 24)


def predicted_ratio(hour_a, hour_b):
    """Count ratio of two identical instruments implied by the daily cycle alone."""
    return np.exp(cycle(hour_a) - cycle(hour_b))


def local_hour(d):
    t = d.acq_time.astype(int)
    return (t // 100 + (t % 100) / 60 + d.longitude / 15) % 24


def circular_median(h):
    a = np.angle(np.exp(2j * np.pi * h / 24).mean()) * 24 / (2 * np.pi)
    return (((h - a + 12) % 24).median() + a - 12) % 24


def year_rows(path, year):
    frames = []
    with zipfile.ZipFile(path) as z:
        for n in z.namelist():
            if n.endswith(".csv"):
                frames.append(pd.read_csv(io.BytesIO(z.read(n)), usecols=USE, dtype={"satellite": str, "daynight": str}))
    d = pd.concat(frames, ignore_index=True)
    d["sat"] = d.satellite.str[0]
    d["h"] = local_hour(d)
    rows = []
    for (s, dn), g in d.groupby(["sat", "daynight"]):
        rows.append((year, {"T": "Terra", "A": "Aqua"}.get(s, s), dn, round(circular_median(g.h), 2), len(g)))
    return rows


def main(argv=None):
    a = argv or sys.argv[1:]
    root = Path(a[0])
    rows = []
    for y in range(2003, 2026):  # both satellites flew all of these years
        rows += year_rows(root / f"modis_{y}_all_countries.zip", y)
    t = pd.DataFrame(rows, columns=["year", "satellite", "pass", "median_local_hour", "pixels"])
    w = t.pivot_table(index="year", columns=["satellite", "pass"], values=["median_local_hour", "pixels"])
    out = pd.DataFrame({
        "aqua_D_h": w["median_local_hour"]["Aqua"]["D"], "terra_D_h": w["median_local_hour"]["Terra"]["D"],
        "aqua_N_h": w["median_local_hour"]["Aqua"]["N"], "terra_N_h": w["median_local_hour"]["Terra"]["N"],
        "aqua_over_terra_D": (w["pixels"]["Aqua"]["D"] / w["pixels"]["Terra"]["D"]).round(2),
        "aqua_over_terra_N": (w["pixels"]["Aqua"]["N"] / w["pixels"]["Terra"]["N"]).round(2),
        "terra_D": w["pixels"]["Terra"]["D"].astype(int), "aqua_D": w["pixels"]["Aqua"]["D"].astype(int),
        "terra_N": w["pixels"]["Terra"]["N"].astype(int), "aqua_N": w["pixels"]["Aqua"]["N"].astype(int)})
    out["pred_D"] = predicted_ratio(out.aqua_D_h, out.terra_D_h).round(2)
    out["pred_N"] = predicted_ratio(out.aqua_N_h, out.terra_N_h).round(2)
    print(out.to_string())
    if len(a) > 1:
        out.to_csv(a[1])
        Path("web/app-data/drift.json").write_text(json.dumps(out.reset_index().to_dict("list"), separators=(",", ":")))


if __name__ == "__main__":
    main()
