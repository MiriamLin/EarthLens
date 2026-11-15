from datetime import date

import numpy as np
import pandas as pd
from pydantic import BaseModel, Field, model_validator

from .operators import ExpressionError, Value, evaluate_expression, expression_baseline, expression_keys, parse_expression
from .timeseries import TimeSeriesRequest, analyze_series, fetch_time_series


def map_sources():
    from .maps import SOURCES
    return SOURCES


def load_annual_map(key: str) -> dict:
    from .maps import load_annual_map as load
    return load(key)


class FormulaRequest(BaseModel):
    expression: str = Field(min_length=1, max_length=2000)


class ExpressionRequest(TimeSeriesRequest, FormulaRequest):
    keys: list[str] = Field(default_factory=list, max_length=20)

    @model_validator(mode='before')
    @classmethod
    def collect_keys(cls, values):
        if isinstance(values, dict) and isinstance(values.get('expression'), str):
            values = {**values, 'keys': expression_keys(parse_expression(values['expression']))}
        return values


def fetch_expression(selection: ExpressionRequest) -> dict:
    node = parse_expression(selection.expression)
    monthly = selection.temporal == 'monthly'
    start = selection.start.replace(day=1) if monthly else selection.start
    first, last = start, selection.end
    baseline = expression_baseline(node)
    if baseline:
        first = min(first, date(baseline[0], 1, 1))
        last = max(last, min(date(baseline[1], 12, 31), date.today()))
    available = (first.year - 1981) * 12 + first.month - 1 if monthly else (first - date(1981, 1, 1)).days
    history = min(node.history, available)
    offset = pd.DateOffset(months=history) if monthly else pd.DateOffset(days=history)
    warmup = (pd.Timestamp(first) - offset).date()
    source = fetch_time_series(selection.model_copy(update={'start': warmup, 'end': last}))
    frequency = 'MS' if monthly else 'D'
    dates = pd.date_range(warmup, last, freq=frequency)
    inputs = {
        series['key']: Value(
            pd.Series(series['values'], index=pd.to_datetime(series['dates']), dtype=float),
            series['units'],
        )
        for series in source['series']
    }
    computed = evaluate_expression(node, inputs, dates)
    requested_dates = pd.date_range(start, selection.end, freq=frequency)
    values = computed.data.reindex(requested_dates)
    raw = dict(zip(requested_dates.strftime('%Y%m%d'), values))
    series = {
        'key': selection.expression.strip(),
        'name': selection.expression.strip(),
        'units': computed.units or '1',
        **analyze_series(raw, requested_dates, float('nan')),
    }
    return {**source, 'start': selection.start.isoformat(), 'end': selection.end.isoformat(), 'series': [series]}


def fetch_expression_map(expression: str) -> dict:
    node = parse_expression(expression)
    keys = expression_keys(node)
    unsupported = [key for key in keys if key not in map_sources()]
    if unsupported:
        raise ExpressionError(f'Annual maps are not available for: {", ".join(unsupported)}.')
    maps = {key: load_annual_map(key) for key in keys}
    years = [frame['year'] for data in maps.values() for frame in data['frames']]
    dates = pd.date_range(f'{min(years)}-01-01', f'{max(years)}-01-01', freq='YS')
    inputs = {
        key: Value(
            pd.DataFrame([frame['values'] for frame in data['frames']],
                         index=pd.to_datetime([f"{frame['year']}-01-01" for frame in data['frames']]), dtype=float),
            data['units'],
        )
        for key, data in maps.items()
    }
    result = evaluate_expression(node, inputs, dates)
    values = result.data.to_numpy()
    finite = values[np.isfinite(values)]
    if not finite.size:
        raise ExpressionError('No valid annual values remain. Check the formula and window length.')
    frames = [
        {'year': int(stamp.year), 'values': [float(value) if np.isfinite(value) else None for value in frame]}
        for stamp, frame in zip(dates, values)
        if np.isfinite(frame).any()
    ]
    return {
        **next(iter(maps.values())),
        'key': expression.strip(), 'name': expression.strip(), 'units': result.units or '1',
        'statistic': 'Formula applied to annual 10° cell means; d counts years',
        'source': list(dict.fromkeys(data['source'] for data in maps.values())),
        'minimum': float(finite.min()), 'maximum': float(finite.max()), 'frames': frames,
    }
