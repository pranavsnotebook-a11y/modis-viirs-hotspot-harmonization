"""python -m hotspots.cli data/modis.csv data/viirs.csv [out.csv]"""
import sys
import numpy as np
from .io import load_firms
from .merge import harmonize


def main(argv=None):
    a = argv or sys.argv[1:]
    m, v = load_firms(a[0], "MODIS"), load_firms(a[1], "VIIRS")
    out = harmonize(m, v)
    print(out.detected_by.value_counts().to_string())
    both = out[out.detected_by == "both"].dropna(subset=["modis_frp", "viirs_frp_in_modis_pixel"])
    if len(both) > 2:
        x, y = np.log10(both.modis_frp.clip(lower=0.1)), np.log10(both.viirs_frp_in_modis_pixel.clip(lower=0.1))
        print(f"matched pairs: {len(both)}; log10 FRP corr MODIS vs VIIRS-sum: {np.corrcoef(x, y)[0,1]:.3f}")
        print(f"median FRP ratio VIIRS-sum/MODIS: {(both.viirs_frp_in_modis_pixel/both.modis_frp.clip(lower=0.1)).median():.2f}")
    if len(a) > 2:
        out.to_csv(a[2], index=False)


if __name__ == "__main__":
    main()
