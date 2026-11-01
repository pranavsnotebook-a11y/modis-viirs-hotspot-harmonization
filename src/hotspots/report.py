"""FRP model, confidence and detection-probability report on real FIRMS data.
python -m hotspots.report modis.csv viirs1.csv [viirs2.csv ...]"""
import sys
import pandas as pd
from .confidence import calibrate_viirs_map
from .detection import detection_table, frp_floor, fit_logistic, observed_viirs
from .frp import coincident_pairs, fit_frp_model, fit_quality, harmonized_frp, quality_by
from .io import load_firms
from .merge import harmonize
from .regional import combine_viirs, region_of


def main(argv=None):
    a = argv or sys.argv[1:]
    m, v = load_firms(a[0], "MODIS"), combine_viirs(a[1:])
    out = harmonize(m, v, max_dt_min=30)
    pairs = coincident_pairs(out, m)
    pairs["region"] = [region_of(la, lo) for la, lo in zip(pairs.latitude, pairs.longitude)]
    pd.set_option("display.width", 200)
    print(f"Coincident pairs (dt<=30 min, per MODIS pixel x VIIRS satellite): {len(pairs)}")
    print("All:", fit_quality(pairs.modis_frp, pairs.viirs_sum))
    for col in ("region", "daynight", "modis_conf", "satellite", "modis_sat"):
        print(f"\nBy {col}:\n{quality_by(pairs, col).to_string(index=False)}")
    model = fit_frp_model(pairs.modis_frp, pairs.viirs_sum)
    print("\nExample harmonized MODIS FRP 10/50/200 MW ->\n",
          harmonized_frp([10, 50, 200], "MODIS", model).round(1).to_string(index=False))

    both = out[(out.detected_by == "both")]
    vb = both.assign(ms=both.modis_idx.map(m.conf_score))
    print("\nVIIRS class -> median MODIS conf score of coincident match:",
          calibrate_viirs_map(vb.conf_class, vb.ms), "\nn:", vb.conf_class.value_counts().to_dict())
    print("Unified event_conf by detected_by:\n",
          out.groupby("detected_by").event_conf.describe()[["count", "mean", "50%"]].round(2).to_string())

    print("\nMODIS FRP floor by pixel area (km^2):\n", frp_floor(m, [0, 1.5, 3, 6, 99]).to_string())
    print("VIIRS FRP floor by pixel area (km^2):\n", frp_floor(v, [0, 0.2, 0.3, 0.5, 9]).to_string())
    for dn, g in v.groupby("daynight"):
        print(f"  {dn}: VIIRS pixels with FRP < 5 MW: {(g.frp < 5).mean():.2f}")
    obs = observed_viirs(out, m)
    print(f"\nVIIRS pixels in MODIS-observed areas: {len(obs)}, detected by MODIS: {obs.detected.mean():.2f}")
    print("Detection fraction by local VIIRS FRP (MW) x MODIS pixel area (km^2):")
    print(detection_table(obs).to_string())
    print("Logistic fit:", fit_logistic(obs.local_frp, obs.modis_area_km2, obs.detected))
    for nk in (5, 20, 50):
        o = observed_viirs(out, m, near_km=nk)
        print(f"  near_km={nk}: n={len(o)}, detected={o.detected.mean():.2f},",
              fit_logistic(o.local_frp, o.modis_area_km2, o.detected))


if __name__ == "__main__":
    main()
