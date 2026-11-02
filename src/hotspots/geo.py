"""Offline geography from Natural Earth (public domain): country raster and nearest listed place.

Everything is resolved at build time so the browser never calls a reverse geocoder per hotspot.
A 0.1 deg raster is used for both the recent records and the 25-year archive, so a region means the
same thing everywhere. Cells within about 30 km of a country that fall offshore take that country."""
import json
from pathlib import Path
import numpy as np
from scipy import ndimage
from scipy.spatial import cKDTree
import shapely

RES = 0.1


class Geo:
    def __init__(self, root="data/geo"):
        root = Path(root)
        feats = json.load(open(root / "countries.geojson"))["features"]
        self.names = [f["properties"]["ADMIN"] for f in feats]
        self.continents = [f["properties"]["CONTINENT"] for f in feats]
        cache = root / "raster.npy"
        if cache.exists():
            self.raster = np.load(cache)
        else:
            geoms = shapely.from_geojson([json.dumps(f["geometry"]) for f in feats])
            geoms = shapely.make_valid(geoms)
            ny, nx = int(180 / RES), int(360 / RES)
            la = -90 + (np.arange(ny) + .5) * RES
            lo = -180 + (np.arange(nx) + .5) * RES
            xx, yy = np.meshgrid(lo, la)
            pts = shapely.points(xx.ravel(), yy.ravel())
            tree = shapely.STRtree(geoms)
            p_i, g_i = tree.query(pts, predicate="intersects")
            r = np.full(ny * nx, -1, dtype=np.int16)
            r[p_i] = g_i
            r = r.reshape(ny, nx)
            dist, idx = ndimage.distance_transform_edt(r < 0, return_indices=True)
            near = (r < 0) & (dist <= 3)
            r[near] = r[idx[0][near], idx[1][near]]
            self.raster = r
            np.save(cache, r)
        pl = json.load(open(root / "places.geojson"))["features"]
        self.place_names = [p["properties"]["name"] for p in pl]
        self.place_country = [p["properties"].get("adm0name") or "" for p in pl]
        self.place_lat = np.array([p["geometry"]["coordinates"][1] for p in pl])
        self.place_lon = np.array([p["geometry"]["coordinates"][0] for p in pl])
        la, lo = np.radians(self.place_lat), np.radians(self.place_lon)
        self._tree = cKDTree(np.column_stack([np.cos(la) * np.cos(lo), np.cos(la) * np.sin(lo), np.sin(la)]))

    def country_idx(self, lat, lon) -> np.ndarray:
        """Index into self.names, -1 for open ocean or unassigned."""
        i = np.clip(((np.asarray(lat) + 90) / RES).astype(int), 0, self.raster.shape[0] - 1)
        j = np.clip(((np.asarray(lon) + 180) / RES).astype(int), 0, self.raster.shape[1] - 1)
        return self.raster[i, j]

    def nearest_place(self, lat, lon) -> np.ndarray:
        la, lo = np.radians(lat), np.radians(lon)
        return self._tree.query(np.column_stack([np.cos(la) * np.cos(lo), np.cos(la) * np.sin(lo), np.sin(la)]))[1]
