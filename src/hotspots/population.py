"""Gridded population for FIRELAB exposure estimates.

Source: GHS-POP R2023A, epoch 2025 (European Commission JRC, Global Human Settlement Layer), WGS84 30 arc-second
grid. It is a modelled population distribution, not a census count for any day. `build` sums 3 x 3 native cells
into a 0.025 deg grid (about 2.8 km at the equator); totals are preserved.
usage: python -m hotspots.population build data/pop/GHS_POP_E2025_GLOBE_R2023A_4326_30ss_V1_0.tif"""
import json
import sys
from pathlib import Path
import numpy as np

ROOT = Path("data/pop")
GRID, META = ROOT / "ghs_pop_2025_0025deg.npy", ROOT / "ghs_pop_2025_0025deg.json"
F = 3
SOURCE = "GHS-POP R2023A epoch 2025, JRC Global Human Settlement Layer (modelled population, 30 arc-second, summed to 0.025 deg)"


def build(tif):
    import tifffile
    import zarr
    t = tifffile.TiffFile(tif)
    g = t.geotiff_metadata
    sx, sy = g["ModelPixelScale"][:2]
    x0, y0 = g["ModelTiepoint"][3:5]
    z = zarr.open(t.pages[0].aszarr(), mode="r")
    H, W = z.shape
    h, w = H // F, W // F
    tmp = GRID.with_suffix(".part.npy")
    out = np.lib.format.open_memmap(tmp, mode="w+", dtype=np.float32, shape=(h, w))
    step = 256 * F
    for r in range(0, h * F, step):
        a = np.asarray(z[r:min(r + step, h * F), : w * F], dtype=np.float64)
        a[~np.isfinite(a) | (a < 0)] = 0
        out[r // F: r // F + a.shape[0] // F] = a.reshape(a.shape[0] // F, F, w, F).sum(axis=(1, 3))
    out.flush()
    meta = {"x0": x0, "y0": y0, "dx": sx * F, "dy": sy * F, "rows": h, "cols": w, "total": float(out.sum(dtype=np.float64)), "source": SOURCE}
    META.write_text(json.dumps(meta))
    del out
    tmp.replace(GRID)  # appears only when complete
    print(meta)


_grid = None


def grid():
    global _grid
    if _grid is None:
        if not GRID.exists():
            return None, None
        _grid = (np.load(GRID, mmap_mode="r"), json.loads(META.read_text()))
    return _grid


def window(west, south, east, north, max_cells=200_000):
    """Population per cell inside a box (no antimeridian crossing). Returns None if the grid is not built."""
    a, m = grid()
    if a is None:
        return None
    c0 = max(0, int(np.floor((west - m["x0"]) / m["dx"])))
    c1 = min(m["cols"], int(np.ceil((east - m["x0"]) / m["dx"])))
    r0 = max(0, int(np.floor((m["y0"] - north) / m["dy"])))
    r1 = min(m["rows"], int(np.ceil((m["y0"] - south) / m["dy"])))
    if c1 <= c0 or r1 <= r0:
        return {"rows": 0, "cols": 0, "values": []}
    if (c1 - c0) * (r1 - r0) > max_cells:
        raise ValueError("box too large for one population request")
    v = np.asarray(a[r0:r1, c0:c1], dtype=np.float64)
    return {"west": m["x0"] + c0 * m["dx"], "north": m["y0"] - r0 * m["dy"], "dx": m["dx"], "dy": m["dy"],
            "rows": r1 - r0, "cols": c1 - c0, "values": np.round(v, 1).ravel().tolist(), "source": m["source"]}


if __name__ == "__main__":
    if sys.argv[1] == "build":
        build(sys.argv[2])
