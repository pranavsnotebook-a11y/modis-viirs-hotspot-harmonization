"""Reduced C-Cox: shared latent activity + per-instrument operator + daily cycle, tested by holding a
satellite out. Criteria are fixed in docs/research/preregistration_loso.md.
usage: python -m hotspots.latent modis.csv n20.csv n21.csv --drop-after YYYY-MM-DD"""
import argparse
import numpy as np
import pandas as pd
from scipy.optimize import minimize
from .floor import read
from .overpass import local_solar_hour
from .regional import REGIONS

PASSES = ("D", "N")
INST = {"Aqua": 0, "Terra": 0, "NOAA-20": 1, "NOAA-21": 1}
PRIOR = 0.1


def build(sats: dict, floor: float = 20.0, fine: float = 0.05) -> tuple[pd.DataFrame, dict]:
    """One row per satellite, pass and 1 deg cell-local-day with a target count; hours per satellite-pass."""
    frames, hours = [], {}
    for name, d in sats.items():
        d = d.dropna(subset=["frp"]).copy()
        lst = local_solar_hour(d)
        z = np.exp(2j * np.pi * lst / 24)
        for p in PASSES:  # circular median of pass local time
            x = lst[d.daynight == p]
            a = np.angle(z[d.daynight == p].mean()) * 24 / (2 * np.pi)
            hours[(name, p)] = float(((x - a + 12) % 24).median() + a - 12) % 24
        utc = pd.to_datetime(d.acq_date) + pd.to_timedelta(d.acq_time.astype(int) // 100, unit="h") \
            + pd.to_timedelta(d.acq_time.astype(int) % 100, unit="m")
        d["lday"] = (utc + pd.to_timedelta(d.longitude / 15, unit="h")).dt.floor("D")
        d["fla"], d["flo"] = np.floor(d.latitude / fine), np.floor(d.longitude / fine)
        g = d.groupby(["lday", "daynight", "fla", "flo"]).frp.sum().reset_index()
        g = g[g.frp >= floor]
        g["la"], g["lo"] = np.floor(g.fla * fine + 1e-9).astype(int), np.floor(g.flo * fine + 1e-9).astype(int)
        c = g.groupby(["lday", "daynight", "la", "lo"]).size().rename("y").reset_index()
        c["sat"] = name
        frames.append(c)
    a = pd.concat(frames, ignore_index=True).rename(columns={"daynight": "pass_"})
    days = sorted(a.lday.unique())[1:-1]
    return a[a.lday.isin(days)], hours


def grid(obs: pd.DataFrame, train: list, sats: list) -> pd.DataFrame:
    """Every satellite and pass for each cell-day a TRAINING satellite detected fire in (zeros included).
    Choosing rows from training satellites only keeps held-out detections from picking the test rows."""
    keys = obs[obs.sat.isin(train)][["lday", "la", "lo"]].drop_duplicates()
    full = keys.merge(pd.MultiIndex.from_product([sats, PASSES], names=["sat", "pass_"]).to_frame(index=False), how="cross")
    full = full.merge(obs, how="left", on=["lday", "la", "lo", "sat", "pass_"])
    full["y"] = full.y.fillna(0.0)
    full["cd"] = full.groupby(["lday", "la", "lo"]).ngroup()
    return full


def design(df, hours, harmonics=1, region=None):
    t = np.array([hours[(s, p)] for s, p in zip(df.sat, df.pass_)])
    cols = [df.sat.map(INST).values.astype(float)]
    for k in range(1, harmonics + 1):
        cols += [np.cos(2 * np.pi * k * t / 24), np.sin(2 * np.pi * k * t / 24)]
    return np.column_stack(cols)


def fit_predict(df, hours, train, test, harmonics=1):
    """Poisson with profiled cell-day effect; alpha comes only from training satellites."""
    tr, te = df[df.sat.isin(train)], df[df.sat == test]
    Xtr, Xte = design(tr, hours, harmonics), design(te, hours, harmonics)
    cd, y, n = tr.cd.values, tr.y.values, df.cd.max() + 1
    rate = y.sum() / len(y)
    b = PRIOR / max(rate, 1e-9)

    def alpha(theta):
        sy = np.bincount(cd, y, n) + PRIOR
        se = np.bincount(cd, np.exp(Xtr @ theta), n) + b
        return np.log(sy / se)

    def nll(theta):
        eta = Xtr @ theta + alpha(theta)[cd]
        return np.exp(eta).sum() - (y * eta).sum()

    th = minimize(nll, np.zeros(Xtr.shape[1]), method="L-BFGS-B").x if Xtr.shape[1] else np.zeros(0)
    pred = np.exp(Xte @ th + alpha(th)[te.cd.values])
    return te.assign(mu=pred), th


def deviance(y, mu):
    mu = np.maximum(mu, 1e-9)
    t = np.where(y > 0, y * np.log(np.maximum(y, 1e-12) / mu), 0.0)
    return float(np.mean(2 * (t - (y - mu))))


def baselines(df, hours, train, test):
    """B0/B1 use the test satellite's instrument twin when it is in training."""
    te = df[df.sat == test].copy()
    twin = next(s for s in train if INST[s] == INST[test])
    tw = df[df.sat == twin].set_index(["cd", "pass_"]).y
    te["B0"] = tw.reindex(list(zip(te.cd, te.pass_))).values
    te["B1"] = te.cd.map(df[df.sat == twin].groupby("cd").y.mean())
    te["B2"] = fit_predict(df, hours, train, test, harmonics=0)[0].mu.values
    try:
        from sklearn.ensemble import HistGradientBoostingRegressor as H
    except ImportError:
        te["B3"] = np.nan
        return te

    def feats(frame, others):
        act = df[df.sat.isin(others)].groupby("cd").y.mean()
        h = np.array([hours[(s, p)] for s, p in zip(frame.sat, frame.pass_)])
        return np.column_stack([frame.la, frame.lo, h, frame.sat.map(INST), frame.cd.map(act).fillna(0)])
    Xs, ys = [], []
    for s in train:  # leave-own-satellite-out activity feature
        f = df[df.sat == s]
        Xs.append(feats(f, [o for o in train if o != s])); ys.append(f.y.values)
    m = H(loss="poisson", random_state=0).fit(np.vstack(Xs), np.concatenate(ys))
    te["B3"] = m.predict(feats(te, train))
    return te


def region_of(la, lo):
    for r, (a0, a1, o0, o1) in REGIONS.items():
        if a0 <= la + .5 <= a1 and o0 <= lo + .5 <= o1:
            return r
    return "Other"


def experiment(obs, hours, test, all_sats, harmonics=1):
    train = [s for s in all_sats if s != test]
    df = grid(obs, train, all_sats)
    res, th = fit_predict(df, hours, train, test, harmonics)
    b = baselines(df, hours, train, test)
    res = res.assign(**{k: b[k].values for k in ("B0", "B1", "B2", "B3")})
    print(f"\n=== Hold out {test} (harmonics={harmonics}) === beta_viirs={th[0]:.2f} cycle={np.round(th[1:], 2).tolist()} n={len(res)}")
    out = {}
    for p in PASSES:
        g = res[res.pass_ == p]
        devs = {k: deviance(g.y.values, g[k].values) for k in ("mu", "B0", "B1", "B2", "B3") if g[k].notna().all()}
        out[p] = devs
        print(f" {p}: actual={g.y.sum():.0f} model={g.mu.sum():.0f} ratio={g.mu.sum() / max(g.y.sum(), 1):.2f}  deviance " + " ".join(f"{k}={v:.3f}" for k, v in devs.items()))
    return res, df, out


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("modis"); ap.add_argument("n20"); ap.add_argument("n21"); ap.add_argument("--drop-after")
    a = ap.parse_args(argv)
    m = read(a.modis, a.drop_after)
    s = m.satellite.astype(str).str[0]
    sats = {"Aqua": m[s == "A"], "Terra": m[s == "T"], "NOAA-20": read(a.n20, a.drop_after), "NOAA-21": read(a.n21, a.drop_after)}
    obs, hours = build(sats)
    names = list(sats)
    print("pass hours:", {f"{k[0]} {k[1]}": round(v, 1) for k, v in hours.items()})
    res, df, dev = experiment(obs, hours, "Terra", names)
    th_all = fit_predict(df, hours, [n for n in names if n != "Terra"], "Terra")[1]
    beta, th_cycle = th_all[0], th_all[1:3]

    # Pre-registered verdict
    c1 = all(dev[p]["mu"] < min(v for k, v in dev[p].items() if k != "mu") for p in PASSES)
    tot = {p: res[res.pass_ == p].mu.sum() / max(res[res.pass_ == p].y.sum(), 1) for p in PASSES}
    c2 = all(1 / 1.5 <= v <= 1.5 for v in tot.values())
    aq = df[df.sat == "Aqua"].assign(region=lambda d: [region_of(x, y) for x, y in zip(d.la, d.lo)])
    r2 = res.assign(region=[region_of(x, y) for x, y in zip(res.la, res.lo)])
    flips = 0
    print("\nRegion: Aqua/Terra predicted (actual), day | night")
    for r in REGIONS:
        q = []
        ok = True
        for p, want in (("D", 1), ("N", -1)):  # the flip must be predicted AND actually present
            A = aq[(aq.region == r) & (aq.pass_ == p)].y.sum()
            T = r2[(r2.region == r) & (r2.pass_ == p)]
            pr, ac = A / max(T.mu.sum(), 1e-9), A / max(T.y.sum(), 1e-9)
            ok &= (pr - 1) * want > 0 and (ac - 1) * want > 0
            q.append(f"{pr:.2f} ({ac:.2f})")
        flips += ok
        print(f"  {r:14s} {q[0]:>16s} | {q[1]:>16s}  {'flip matches' if ok else 'NO match'}")
    c3 = flips >= 5
    # Cluster bootstrap by 1 deg cell: predictions fixed, deviance gain over the best baseline
    rng = np.random.default_rng(0)
    r3 = res.assign(cell=res.la.astype(str) + "," + res.lo.astype(str))
    print("\nBootstrap by cell, 2000 draws: deviance gain over best baseline, 95% interval")
    for p in PASSES:
        g = r3[r3.pass_ == p]
        best = min((k for k in ("B0", "B1", "B2", "B3") if g[k].notna().all()), key=lambda k: deviance(g.y.values, g[k].values))
        def unit(mu):
            mu = np.maximum(mu, 1e-9)
            return 2 * (np.where(g.y > 0, g.y * np.log(np.maximum(g.y, 1e-12) / mu), 0.0) - (g.y - mu))
        diff = pd.DataFrame({"cell": g.cell.values, "d": np.asarray(unit(g[best].values)) - np.asarray(unit(g.mu.values))}).groupby("cell").d.agg(["sum", "size"])
        idx = rng.integers(0, len(diff), (2000, len(diff)))
        boots = diff["sum"].values[idx].sum(1) / diff["size"].values[idx].sum(1)
        print(f"  {p}: vs {best}: {diff['sum'].sum() / diff['size'].sum():.3f} [{np.percentile(boots, 2.5):.3f}, {np.percentile(boots, 97.5):.3f}]")
    ang = np.arctan2(th_cycle[1], th_cycle[0]) % (2 * np.pi)
    print(f"Learned without Terra: operator VIIRS/MODIS {np.exp(beta):.2f}x, activity peak {ang * 24 / (2 * np.pi):.1f} h local, peak/trough {np.exp(2 * np.hypot(*th_cycle)):.1f}x")
    print(f"\nPRIMARY: C1 beats all baselines={c1}  C2 totals within 1.5x={c2} {({k: round(v, 2) for k, v in tot.items()})}  C3 flip in >=5/6={c3} ({flips}/6)")
    print("VERDICT:", "PASS" if c1 and c2 and c3 else "FAIL")

    print("\n--- Controls and secondary (cannot rescue the primary) ---")
    experiment(obs, hours, "Aqua", names)
    experiment(obs, hours, "NOAA-21", names)
    experiment(obs, hours, "Terra", names, harmonics=2)


if __name__ == "__main__":
    main()
