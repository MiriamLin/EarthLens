from functools import lru_cache
from pathlib import Path
from typing import Callable
from urllib.error import HTTPError, URLError

from fastapi import FastAPI, HTTPException, Response
from fastapi.staticfiles import StaticFiles

from .data import load_metadata
from .timeseries import TimeSeriesRequest, fetch_time_series
from .expressions import ExpressionRequest, FormulaRequest, fetch_expression, fetch_expression_map, load_annual_map, map_sources
from .operators import ExpressionError, expression_tree, expression_units, operator_catalog, parse_expression

app = FastAPI(title="EarthLens")
STATIC_CACHE = "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800"


@lru_cache(maxsize=1)
def metadata_units() -> dict[str, str]:
    return {item["key"]: item["units"] for item in load_metadata()}


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/metadata")
def metadata(response: Response) -> list[dict[str, str]]:
    response.headers["Cache-Control"] = STATIC_CACHE
    try:
        return load_metadata()
    except (OSError, ValueError, KeyError) as error:
        raise HTTPException(status_code=500, detail="Unable to load data metadata.") from error


def load_series(selection: TimeSeriesRequest, fetcher: Callable) -> dict:
    try:
        return fetcher(selection)
    except ExpressionError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    except HTTPError as error:
        if error.code == 422:
            raise HTTPException(status_code=422, detail="NASA POWER rejected the variable, location or date range.") from error
        if error.code == 429:
            raise HTTPException(status_code=503, detail="NASA POWER is busy. Try again later.") from error
        raise HTTPException(status_code=502, detail="Unable to retrieve NASA POWER data.") from error
    except TimeoutError as error:
        raise HTTPException(status_code=504, detail="NASA POWER request timed out. Try again.") from error
    except (URLError, OSError, ValueError, KeyError) as error:
        raise HTTPException(status_code=502, detail="Unable to retrieve NASA POWER data.") from error


@app.post("/api/timeseries")
def time_series(selection: TimeSeriesRequest) -> dict:
    return load_series(selection, fetch_time_series)


@app.get("/api/operators")
def operators(response: Response) -> list[dict]:
    response.headers["Cache-Control"] = STATIC_CACHE
    return operator_catalog()


@app.post("/api/expression")
def expression(selection: ExpressionRequest) -> dict:
    return load_series(selection, fetch_expression)


@app.post("/api/expression/validate")
def validate_formula(selection: FormulaRequest) -> dict:
    try:
        expression_units(parse_expression(selection.expression), metadata_units())
        return {"expression": selection.expression.strip()}
    except ExpressionError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@app.post("/api/expression/parse")
def parse_formula(selection: FormulaRequest) -> dict:
    try:
        return {'tree': expression_tree(parse_expression(selection.expression, require_data=False))}
    except ExpressionError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


def map_errors() -> tuple[type[BaseException], ...]:
    try:
        import aiohttp
    except ImportError as error:
        raise HTTPException(status_code=503, detail="Annual maps are not available in this deployment.") from error
    return (OSError, ValueError, KeyError, aiohttp.ClientError)


@app.post("/api/map/expression")
def expression_map(selection: FormulaRequest) -> dict:
    errors = map_errors()
    try:
        return fetch_expression_map(selection.expression)
    except ExpressionError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    except errors as error:
        raise HTTPException(status_code=502, detail="Unable to load NASA annual map data. Try again.") from error


@app.get("/api/map/{key}")
def annual_map(key: str) -> dict:
    errors = map_errors()
    if key not in map_sources():
        raise HTTPException(status_code=422, detail="Annual maps are not available for this variable.")
    try:
        return load_annual_map(key)
    except errors as error:
        raise HTTPException(status_code=502, detail="Unable to load NASA annual map data. Try again.") from error


frontend_dist = Path(__file__).resolve().parents[2] / "frontend" / "dist"

if frontend_dist.is_dir():
    app.mount("/", StaticFiles(directory=frontend_dist, html=True), name="frontend")
