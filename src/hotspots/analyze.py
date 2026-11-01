"""Sensitivity analysis: time-window sweep and FRP agreement by confidence."""
import sys
import numpy as np
from .io import load_firms
from .merge import harmonize


def corr(out):
    b = out[out.detected_by == "both"].dropna(subset=["modis_frp", "viirs_frp_in_modis_pixel"])
    x = np.log10(b.modis_frp.clip(lower=0.1)); y = np.log10(b.viirs_frp_in_modis_pixel.clip(lower=0.1))
    return len(b), float(np.corrcoef(x, y)[0, 1]) if len(b) > 2 else float("nan"), b


def main(argv=None):
    a = argv or sys.argv[1:]
    m, v = load_firms(a[0], "MODIS"), load_firms(a[1], "VIIRS")
    print("max_dt_min  both  corr")
    for dt in (15, 30, 60, 120, 180):
        n, c, _ = corr(harmonize(m, v, max_dt_min=dt))
        print(f"{dt:>9} {n:>6} {c:.3f}")
    _, _, b = corr(harmonize(m, v, max_dt_min=30))
    print("\nBy MODIS confidence class (dt<=30):")
    for k, g in b.groupby("conf_class"):
        if len(g) > 2:
            print(k, len(g), f"corr={np.corrcoef(np.log10(g.modis_frp.clip(lower=0.1)), np.log10(g.viirs_frp_in_modis_pixel.clip(lower=0.1)))[0,1]:.3f}")


if __name__ == "__main__":
    main()
