import io
import json
import unittest
from unittest.mock import patch

import numpy as np
import pandas as pd
from pydantic import ValidationError

from app.timeseries import TimeSeriesRequest, analyze_series, fetch_time_series


class RegressionTests(unittest.TestCase):
    def test_slope_uses_elapsed_years_and_missing_days_stay_missing(self):
        dates = pd.date_range("2020-01-01", "2022-01-01")
        offsets = [0, 32, 366, 731]
        raw = {dates[i].strftime("%Y%m%d"): 3 + 2.5 * i / 365.2425 for i in offsets}
        raw["20200201"] = -999
        result = analyze_series(raw, dates, -999)
        self.assertAlmostEqual(result["statistics"]["slope"], 2.5)
        self.assertAlmostEqual(result["statistics"]["intercept"], 3)
        self.assertAlmostEqual(result["statistics"]["r_squared"], 1)
        self.assertLess(result["statistics"]["p_value"], 0.0001)
        self.assertEqual(result["statistics"]["count"], 4)
        self.assertEqual(result["statistics"]["missing"], len(dates) - 4)
        self.assertIsNone(result["values"][31])
        self.assertAlmostEqual(result["trend"][-1], 3 + 2.5 * 731 / 365.2425)

    def test_known_regression_and_two_sided_p_value(self):
        dates = pd.date_range("2024-01-01", periods=5)
        raw = dict(zip(dates.strftime("%Y%m%d"), [1, 2, 4, 3, 5]))
        statistics = analyze_series(raw, dates, -999)["statistics"]
        self.assertAlmostEqual(statistics["slope"], 0.9 * 365.2425)
        self.assertAlmostEqual(statistics["r_squared"], 0.81)
        self.assertAlmostEqual(statistics["p_value"], 0.0373860734684986)

    def test_negative_trend(self):
        dates = pd.date_range("2024-01-01", periods=4)
        raw = dict(zip(dates.strftime("%Y%m%d"), [8, 6, 4, 2]))
        self.assertAlmostEqual(analyze_series(raw, dates, -999)["statistics"]["slope"], -2 * 365.2425)

    def test_constant_series_has_no_invented_significance(self):
        dates = pd.date_range("2024-01-01", periods=4)
        raw = dict.fromkeys(dates.strftime("%Y%m%d"), 7)
        result = analyze_series(raw, dates, -999)
        self.assertEqual(result["statistics"]["slope"], 0)
        self.assertIsNone(result["statistics"]["r_squared"])
        self.assertIsNone(result["statistics"]["p_value"])
        self.assertEqual(result["trend"], [7.0] * 4)

    def test_invalid_values_are_not_zeros_or_nan_in_json(self):
        dates = pd.date_range("2024-01-01", periods=5)
        raw = dict(zip(dates.strftime("%Y%m%d"), [-999, None, np.nan, np.inf, "bad"]))
        result = analyze_series(raw, dates, -999)
        self.assertEqual(result["statistics"]["count"], 0)
        self.assertEqual(result["values"], [None] * 5)
        self.assertIsNone(result["statistics"]["p_value"])
        json.dumps(result, allow_nan=False)

    def test_short_series_retains_values_without_regression(self):
        dates = pd.date_range("2024-01-01", periods=2)
        result = analyze_series({"20240101": 1, "20240102": 2}, dates, -999)
        self.assertEqual(result["values"], [1, 2])
        self.assertEqual(result["trend"], [None, None])
        self.assertIsNone(result["statistics"]["slope"])

    def test_leap_day_is_included(self):
        dates = pd.date_range("2024-02-28", "2024-03-01")
        result = analyze_series({}, dates, -999)
        self.assertEqual(result["dates"], ["2024-02-28", "2024-02-29", "2024-03-01"])


class RequestTests(unittest.TestCase):
    def selection(self, **overrides):
        values = dict(keys=["T2M"], latitude=25, longitude=121.5, start="2024-01-01", end="2024-01-03")
        return TimeSeriesRequest(**{**values, **overrides})

    def test_invalid_requests(self):
        for values in (
            {"keys": []}, {"keys": ["UNKNOWN"]}, {"latitude": 91},
            {"latitude": float("nan")}, {"longitude": 181},
            {"start": "1980-01-01"}, {"end": "2023-01-01"},
            {"end": "9999-01-01"},
        ):
            with self.subTest(values=values), self.assertRaises(ValidationError):
                self.selection(**values)

    def test_duplicate_keys_are_removed(self):
        self.assertEqual(self.selection(keys=["T2M", "WS10M", "T2M"]).keys, ["T2M", "WS10M"])

    def test_monthly_data_excludes_annual_summary_and_respects_month_range(self):
        payload = {
            "header": {"fill_value": -999, "sources": ["MERRA2"]},
            "properties": {"parameter": {"T2M": {"202401": 10, "202402": -999, "202403": 20, "202413": 9999}}},
            "parameters": {"T2M": {"longname": "Temperature at 2 Meters", "units": "C"}},
        }
        with patch("app.timeseries.urlopen", return_value=io.StringIO(json.dumps(payload))) as upstream:
            result = fetch_time_series(self.selection(temporal="monthly", start="2024-01-01", end="2024-03-31"))
        self.assertIn("/monthly/point?", upstream.call_args.args[0])
        self.assertIn("start=2024&end=2024", upstream.call_args.args[0])
        self.assertEqual(result["temporal"], "MONTHLY")
        self.assertEqual(result["series"][0]["dates"], ["2024-01-01", "2024-02-01", "2024-03-01"])
        self.assertEqual(result["series"][0]["values"], [10, None, 20])

    def test_multiple_variables_use_one_nasa_request(self):
        payload = {
            "header": {"fill_value": -999, "time_standard": "UTC", "sources": ["MERRA2"]},
            "properties": {"parameter": {"T2M": {"20240101": 1, "20240102": 2, "20240103": 3}}},
            "parameters": {"T2M": {"longname": "Temperature at 2 Meters", "units": "C"}},
        }
        with patch("app.timeseries.urlopen", return_value=io.StringIO(json.dumps(payload))) as upstream:
            result = fetch_time_series(self.selection(keys=["T2M", "WS10M"]))
        upstream.assert_called_once()
        self.assertIn("parameters=T2M%2CWS10M", upstream.call_args.args[0])
        self.assertIn("time-standard=UTC", upstream.call_args.args[0])
        self.assertEqual(result["time_standard"], "UTC")
        self.assertEqual(result["series"][0]["statistics"]["count"], 3)
        self.assertEqual(result["series"][1]["statistics"]["count"], 0)
        json.dumps(result, allow_nan=False)


if __name__ == "__main__":
    unittest.main()
