"""Does orbit drift push Terra out of the fixed match window? Match share per MODIS satellite and pass, by year and window.
usage: python -m hotspots.drift_window data/archive docs/research/drift_window.csv 2021 2025"""
import sys
from pathlib import Path
import pandas as pd
from . import archive

WINDOWS = (180, 300)


def main(argv=None):
    a = argv or sys.argv[1:]
    root, out, years = Path(a[0]), a[1], [int(y) for y in a[2:]]
    rows = []
    for y in years:
        m = archive.add_heading(archive.prepare(archive.read_zip(root / f"modis_{y}_all_countries.zip"), "MODIS"))
        v = archive.add_heading(archive.prepare(archive.read_zip(root / f"viirs-snpp_{y}_all_countries.zip"), "VIIRS"))
        for w in WINDOWS:
            archive.WINDOW = w
            vm, mm = archive.match_year(m, v)
            t = pd.DataFrame({"sat": m.satellite.map({"T": "Terra", "A": "Aqua"}).values, "dn": m.daynight.values, "matched": mm})
            for (s, dn), g in t.groupby(["sat", "dn"]):
                rows.append((y, w, s, dn, len(g), round(100 * g.matched.mean(), 1)))
            rows.append((y, w, "All MODIS", "all", len(m), round(100 * mm.mean(), 1)))
            rows.append((y, w, "S-NPP", "all", len(v), round(100 * vm.mean(), 1)))
            rows.append((y, w, "Harmonized / S-NPP", "all", len(m) + len(v) - int(vm.sum()), round(100 * (len(m) + len(v) - vm.sum()) / len(v), 1)))
            print(pd.DataFrame(rows[-7:], columns=["year", "window", "sat", "pass", "n", "pct"]).to_string(index=False), flush=True)
    pd.DataFrame(rows, columns=["year", "window_min", "group", "pass", "n", "matched_pct"]).to_csv(out, index=False)


if __name__ == "__main__":
    main()
