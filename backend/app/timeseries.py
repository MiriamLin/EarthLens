import json
import math
import os
import time
from collections import OrderedDict
from datetime import date
from threading import Lock
from typing import Literal
from urllib.parse import urlencode
from urllib.request import urlopen

import numpy as np
import pandas as pd
from pydantic import BaseModel, Field, model_validator

from .data import DATA_KEYS


class TimeSeriesRequest(BaseModel):
    keys: list[str] = Field(min_length=1, max_length=20)
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    start: date
    end: date
    temporal: Literal["daily", "monthly"] = "daily"

    @model_validator(mode="after")
    def validate_selection(self) -> "TimeSeriesRequest":
        self.keys = list(dict.fromkeys(self.keys))
        if any(key not in DATA_KEYS for key in self.keys):
            raise ValueError("Select a variable from the data list.")
        if self.start < date(1981, 1, 1) or self.end > date.today():
            raise ValueError("Dates must be between 1981-01-01 and today.")
        if self.start > self.end:
            raise ValueError("Start date must not be after end date.")
        return self


def _continued_fraction(a: float, b: float, x: float) -> float:
    tiny = 1e-300
    c, d = 1.0, 1.0 - (a + b) * x / (a + 1.0)
    d = 1.0 / (d if abs(d) > tiny else tiny)
    result = d
    for m in range(1, 300):
        for numerator in (m * (b - m) * x / ((a + 2 * m - 1) * (a + 2 * m)),
                          -(a + m) * (a + b + m) * x / ((a + 2 * m) * (a + 2 * m + 1))):
            d = 1.0 + numerator * d
            d = 1.0 / (d if abs(d) > tiny else tiny)
            c = 1.0 + numerator / c
            c = c if abs(c) > tiny else tiny
            result *= d * c
        if abs(d * c - 1.0) < 1e-15:
            break
    return result


def _incomplete_beta(a: float, b: float, x: float) -> float:
    if x <= 0:
        return 0.0
    if x >= 1:
        return 1.0
    front = math.exp(math.lgamma(a + b) - math.lgamma(a) - math.lgamma(b) + a * math.log(x) + b * math.log1p(-x))
    if x < (a + 1) / (a + b + 2):
        return front * _continued_fraction(a, b, x) / a
    return 1.0 - front * _continued_fraction(b, a, 1.0 - x) / b


def linear_trend(x: np.ndarray, y: np.ndarray) -> tuple[float, float, float, float]:
    x_mean, y_mean = x.mean(), y.mean()
    sxx = float(((x - x_mean) ** 2).sum())
    syy = float(((y - y_mean) ** 2).sum())
    sxy = float(((x - x_mean) * (y - y_mean)).sum())
    slope = sxy / sxx
    intercept = float(y_mean - slope * x_mean)
    r = max(-1.0, min(1.0, sxy / math.sqrt(sxx * syy)))
    df = len(x) - 2
    if abs(r) >= 1.0:
        p_value = 0.0
    else:
        t_squared = r * r * df / (1.0 - r * r)
        p_value = _incomplete_beta(df / 2.0, 0.5, df / (df + t_squared))
    return slope, intercept, r * r, p_value


def analyze_series(raw: dict, dates: pd.DatetimeIndex, fill_value: float) -> dict:
    values = pd.to_numeric(pd.Series(raw, dtype="object"), errors="coerce")
    values.index = pd.to_datetime(values.index, format="%Y%m%d", errors="coerce")
    values = values[~values.index.isna()].reindex(dates).to_numpy(dtype=float)
    values[(values == fill_value) | ~np.isfinite(values)] = np.nan
    valid = np.isfinite(values)
    count = int(valid.sum())
    years = np.asarray((dates - dates[0]).days, dtype=float) / 365.2425
    trend = np.full(len(dates), np.nan)
    statistics = {
        "count": count,
        "missing": int(len(dates) - count),
        "slope": None,
        "intercept": None,
        "r_squared": None,
        "p_value": None,
    }
    note = ""

    if count < 3:
        note = "At least 3 valid observations are required for regression."
    elif np.ptp(values[valid]) == 0:
        statistics.update(slope=0.0, intercept=float(values[valid][0]))
        trend[:] = values[valid][0]
        note = "Constant series: R² and p-value are undefined."
    else:
        slope, intercept, r_squared, p_value = linear_trend(years[valid], values[valid])
        statistics.update(
            slope=float(slope),
            intercept=intercept,
            r_squared=float(r_squared),
            p_value=float(p_value) if np.isfinite(p_value) else None,
        )
        trend = intercept + slope * years

    return {
        "dates": dates.strftime("%Y-%m-%d").tolist(),
        "values": [float(value) if np.isfinite(value) else None for value in values],
        "trend": [float(value) if np.isfinite(value) else None for value in trend],
        "statistics": statistics,
        "note": note,
    }


CACHE_SECONDS = float(os.environ.get("EARTHLENS_CACHE_SECONDS", 43200 if os.environ.get("VERCEL") else 0))
CACHE_SIZE = 64
_cache: OrderedDict[str, tuple[float, dict]] = OrderedDict()
_cache_lock = Lock()


def fetch_power(url: str) -> dict:
    now = time.monotonic()
    if CACHE_SECONDS > 0:
        with _cache_lock:
            hit = _cache.get(url)
            if hit and now - hit[0] < CACHE_SECONDS:
                _cache.move_to_end(url)
                return hit[1]
    with urlopen(url, timeout=60) as response:
        payload = json.load(response)
    if CACHE_SECONDS > 0:
        with _cache_lock:
            _cache[url] = (now, payload)
            _cache.move_to_end(url)
            while len(_cache) > CACHE_SIZE:
                _cache.popitem(last=False)
    return payload


def fetch_time_series(selection: TimeSeriesRequest) -> dict:
    query = urlencode({
        "parameters": ",".join(selection.keys),
        "community": "AG",
        "latitude": selection.latitude,
        "longitude": selection.longitude,
        "start": selection.start.strftime("%Y%m%d") if selection.temporal == "daily" else str(selection.start.year),
        "end": selection.end.strftime("%Y%m%d") if selection.temporal == "daily" else str(selection.end.year),
        "format": "JSON",
    })
    if selection.temporal == "daily":
        query += "&time-standard=UTC"
    payload = fetch_power(f"https://power.larc.nasa.gov/api/temporal/{selection.temporal}/point?{query}")

    if selection.temporal == "monthly":
        dates = pd.date_range(selection.start.replace(day=1), selection.end.replace(day=1), freq="MS")
    else:
        dates = pd.date_range(selection.start, selection.end, freq="D")
    parameters = payload["properties"]["parameter"]
    fill_value = payload["header"].get("fill_value", -999)
    series = []
    for key in selection.keys:
        metadata = payload.get("parameters", {}).get(key, {})
        raw = parameters.get(key, {})
        if selection.temporal == "monthly":
            raw = {f"{stamp}01": value for stamp, value in raw.items()
                   if len(stamp) == 6 and stamp.isdigit() and 1 <= int(stamp[-2:]) <= 12}
        series.append({
            "key": key,
            "name": metadata.get("longname", key),
            "units": metadata.get("units", ""),
            **analyze_series(raw, dates, fill_value),
        })

    return {
        "latitude": selection.latitude,
        "longitude": selection.longitude,
        "start": selection.start.isoformat(),
        "end": selection.end.isoformat(),
        "temporal": selection.temporal.upper(),
        "time_standard": payload["header"].get("time_standard", "UTC"),
        "sources": payload["header"].get("sources", []),
        "series": series,
    }
