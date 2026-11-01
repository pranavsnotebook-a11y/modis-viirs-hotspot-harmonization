"""MODIS <-> VIIRS FRP harmonization from near-coincident pixel pairs.

Model (log10 space): log10(VIIRS FRP summed over the MODIS footprint) = a + b*log10(MODIS FRP),
fitted robustly (Theil-Sen; Huber reported as a cross-check) on pairs with |dt| <= 30 min.
The common scale is therefore *VIIRS-equivalent FRP over a MODIS-pixel footprint*:
VIIRS values pass through unchanged, MODIS values are mapped with the fit plus a
log-normal prediction interval from the robust residual scatter.

Caveats: MODIS FRP is the noisy regressor, so the slope is attenuated toward 0
(regression dilution); dt <= 30 min still lets fires change; VIIRS pixels that MODIS
missed or that fall in overlapping MODIS pixels are only partly represented; VIIRS FRP
uncertainty itself is not modelled.
"""
from dataclasses import dataclass
import numpy as np
import pandas as pd
from scipy import optimize, stats

MAD_TO_SIGMA = 1.4826


def coincident_pairs(out: pd.DataFrame, modis: pd.DataFrame, max_dt_min: float = 30) -> pd.DataFrame:
    """One row per (MODIS pixel, VIIRS satellite) from `harmonize` output with dt <= max_dt_min."""
    b = out[(out.detected_by == "both") & (out.dt_min <= max_dt_min)]
    b = b[(b.modis_frp > 0) & (b.viirs_frp_in_modis_pixel > 0)]
    g = b.groupby(["modis_idx", "satellite"], as_index=False).agg(
        viirs_sum=("viirs_frp_in_modis_pixel", "first"), n_viirs=("viirs_frp", "size"),
        dt_min=("dt_min", "max"))
    m = modis.loc[g.modis_idx.astype(int)].reset_index(drop=True)
    return g.assign(modis_frp=m.frp.values, latitude=m.latitude.values, longitude=m.longitude.values,
                    daynight=m.daynight.values, modis_conf=m.conf_class.values,
                    modis_area_km2=(m.scan_km * m.track_km).values, modis_sat=m.satellite.values)


@dataclass
class FRPModel:
    intercept: float
    slope: float
    slope_ci: tuple
    sigma_dex: float  # robust residual scatter in log10 units
    n: int

    def to_viirs_scale(self, modis_frp):
        x = np.log10(np.clip(np.asarray(modis_frp, float), 0.1, None))
        return 10 ** (self.intercept + self.slope * x)


def _huber(x, y):
    r = optimize.least_squares(lambda p: y - (p[0] + p[1] * x), [0.0, 1.0], loss="huber", f_scale=0.2)
    return r.x


def fit_frp_model(modis_frp, viirs_sum, fixed_slope: float | None = None) -> FRPModel:
    """Theil-Sen fit in log10 space. With `fixed_slope` (e.g. 1.0 = constant ratio) only
    the intercept is fitted, as the median offset -- more stable for small samples."""
    x, y = np.log10(np.asarray(modis_frp, float)), np.log10(np.asarray(viirs_sum, float))
    if fixed_slope is None:
        slope, intercept, lo, hi = stats.theilslopes(y, x)
    else:
        slope = lo = hi = fixed_slope
        intercept = np.median(y - slope * x)
    resid = y - (intercept + slope * x)
    sigma = MAD_TO_SIGMA * np.median(np.abs(resid - np.median(resid)))
    return FRPModel(float(intercept), float(slope), (float(lo), float(hi)), float(sigma), len(x))


def harmonized_frp(frp, sensor, model: FRPModel, k: float = 1.0) -> pd.DataFrame:
    """FRP on the common (VIIRS-equivalent) scale with a +/- k-sigma interval.

    `sensor` is a scalar or array of 'MODIS'/'VIIRS'. VIIRS FRP passes through with a
    zero-width interval (its own retrieval uncertainty is not modelled here).
    """
    frp = np.asarray(frp, float)
    is_m = np.broadcast_to(np.char.upper(np.asarray(sensor, str)) == "MODIS", frp.shape)
    val = np.where(is_m, model.to_viirs_scale(frp), frp)
    f = np.where(is_m, 10 ** (k * model.sigma_dex), 1.0)
    return pd.DataFrame({"frp_h": val, "frp_lo": val / f, "frp_hi": val * f})


def fit_quality(modis_frp, viirs_sum) -> dict:
    """Fit stats plus leave-one-out median |error| (log10 dex) of the free-slope model, a
    constant-ratio model (slope 1) and no correction at all (identity)."""
    x, y = np.log10(np.asarray(modis_frp, float)), np.log10(np.asarray(viirs_sum, float))
    n = len(x)
    if n < 5:
        return {"n": n}
    m = fit_frp_model(10 ** x, 10 ** y)

    def loo(fixed):
        e = [y[i] - np.log10(fit_frp_model(10 ** np.delete(x, i), 10 ** np.delete(y, i), fixed)
                             .to_viirs_scale(10 ** x[i])) for i in range(n)]
        return round(float(np.median(np.abs(e))), 3)

    hb = _huber(x, y)
    return {"n": n, "slope": round(m.slope, 2), "slope_ci": tuple(round(c, 2) for c in m.slope_ci),
            "intercept": round(m.intercept, 2), "huber_slope": round(float(hb[1]), 2),
            "sigma_dex": round(m.sigma_dex, 2), "spearman": round(float(stats.spearmanr(x, y)[0]), 2),
            "median_ratio": round(float(np.median(10 ** (y - x))), 2),
            "loo_medae_dex": loo(None), "loo_ratio_medae_dex": loo(1.0),
            "identity_medae_dex": round(float(np.median(np.abs(y - x))), 3)}


def quality_by(pairs: pd.DataFrame, col: str) -> pd.DataFrame:
    rows = [{col: k, **fit_quality(g.modis_frp, g.viirs_sum)} for k, g in pairs.groupby(col)]
    return pd.DataFrame(rows)
