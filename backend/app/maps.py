import json
import time
from datetime import date
from pathlib import Path
from tempfile import NamedTemporaryFile
from threading import Lock

import aiohttp
import fsspec
import numpy as np
import xarray as xr

SOURCES = {
    "T2M": "merra2",
    "PRECTOTCORR": "merra2",
    "WS10M": "merra2",
    "CLOUD_AMT": "syn1deg",
    "ALLSKY_SFC_SW_DWN": "syn1deg",
}
CACHE_DIR = Path(__file__).resolve().parents[1] / "data" / "maps"
CACHE_LOCK = Lock()


def grid_weights(latitudes: np.ndarray, longitudes: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    lat_edges = np.r_[-90, (latitudes[:-1] + latitudes[1:]) / 2, 90]
    lon_step = np.median(np.diff(longitudes))
    lon_edges = np.r_[longitudes[0] - lon_step / 2, (longitudes[:-1] + longitudes[1:]) / 2, longitudes[-1] + lon_step / 2]
    south = np.arange(-90, 90, 10)[:, None]
    north = south + 10
    lower = np.maximum(south, lat_edges[:-1])
    upper = np.minimum(north, lat_edges[1:])
    lat_weights = np.where(upper > lower, np.sin(np.deg2rad(upper)) - np.sin(np.deg2rad(lower)), 0)
    west = np.arange(-180, 180, 10)[:, None]
    east = west + 10
    lon_weights = np.zeros((36, len(longitudes)))
    for offset in (-360, 0, 360):
        lower = np.maximum(west, lon_edges[:-1] + offset)
        upper = np.minimum(east, lon_edges[1:] + offset)
        lon_weights += np.deg2rad(np.maximum(0, upper - lower))
    return lat_weights, lon_weights


def aggregate_grid(values: np.ndarray, latitudes: np.ndarray, longitudes: np.ndarray) -> np.ndarray:
    lat_weights, lon_weights = grid_weights(latitudes, longitudes)
    valid = np.isfinite(values) & (values != -999)
    numerator = np.einsum("ai,tij,bj->tab", lat_weights, np.where(valid, values, 0), lon_weights, optimize=True)
    denominator = np.einsum("ai,tij,bj->tab", lat_weights, valid.astype(float), lon_weights, optimize=True)
    return np.divide(numerator, denominator, out=np.full_like(numerator, np.nan), where=denominator > 0)


def build_annual_map(key: str) -> dict:
    source = SOURCES[key]
    url = f"https://nasa-power.s3.us-west-2.amazonaws.com/{source}/temporal/power_{source}_annual_temporal_lst.zarr"
    mapper = fsspec.get_mapper(url, client_kwargs={"timeout": aiohttp.ClientTimeout(total=90)})
    with xr.open_zarr(mapper, consolidated=True, chunks=None) as dataset:
        data = dataset[key].sortby("lat").sortby("lon")
        data = data.sel(time=slice(None, f"{date.today().year - 1}-12-31"))
        units = data.attrs.get("units", "")
        name = data.attrs.get("long_name", key)
        values = data.transpose("time", "lat", "lon").values
        grid = aggregate_grid(values, data.lat.values, data.lon.values)
        years = data.time.dt.year.values

    if key == "ALLSKY_SFC_SW_DWN" and units in ("W m-2", "W/m^2", "W/m2"):
        grid *= 0.0864
        units = "MJ/m^2/day"
    frames = []
    for year, frame in zip(years, grid):
        if np.isfinite(frame).any():
            frames.append({
                "year": int(year),
                "values": [round(float(value), 4) if np.isfinite(value) else None for value in frame.ravel()],
            })
    if not frames:
        raise ValueError("No complete annual data is available.")
    finite = grid[np.isfinite(grid)]
    return {
        "key": key,
        "name": name,
        "units": units,
        "temporal": "ANNUAL",
        "statistic": "Area-weighted annual mean",
        "grid_size": 10,
        "rows": 18,
        "columns": 36,
        "minimum": float(finite.min()),
        "maximum": float(finite.max()),
        "source": url,
        "frames": frames,
    }


def load_annual_map(key: str) -> dict:
    path = CACHE_DIR / f"{key}-annual-v1.json"
    with CACHE_LOCK:
        try:
            if time.time() - path.stat().st_mtime < 86400:
                return json.loads(path.read_text(encoding="utf-8"))
        except (FileNotFoundError, json.JSONDecodeError):
            pass
        data = build_annual_map(key)
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        with NamedTemporaryFile(mode="w", encoding="utf-8", dir=CACHE_DIR, delete=False) as file:
            json.dump(data, file, allow_nan=False, separators=(",", ":"))
        Path(file.name).replace(path)
        return data
