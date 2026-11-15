import ast
import io
import json
import operator
import unittest
from datetime import date
from unittest.mock import patch

import numpy as np
import pandas as pd
from pydantic import ValidationError

from app.expressions import ExpressionRequest, fetch_expression, fetch_expression_map
from app.data import DATA_KEYS
from app.operators import OPERATORS, ExpressionError, Operator, Value, evaluate_expression, expression_keys, operator_catalog, parse_expression


class OperatorTests(unittest.TestCase):
    def setUp(self):
        self.dates = pd.date_range('2024-01-01', periods=7)
        self.inputs = {
            'T2M': Value(pd.Series([1, 2, 3, 4, 5, 6, 7], index=self.dates, dtype=float), 'C'),
            'T2M_MAX': Value(pd.Series([5, 6, 7, 8, 9, 10, 11], index=self.dates, dtype=float), 'C'),
            'T2M_MIN': Value(pd.Series([1] * 7, index=self.dates, dtype=float), 'C'),
            'PRECTOTCORR': Value(pd.Series([2] * 7, index=self.dates, dtype=float), 'mm/day'),
        }

    def evaluate(self, expression):
        return evaluate_expression(parse_expression(expression), self.inputs, self.dates)

    def test_precedence_parentheses_unary_signs_and_constants(self):
        result = self.evaluate('-(T2M_MAX - T2M_MIN) / 2 + 3')
        np.testing.assert_allclose(result.data, [1, 0.5, 0, -0.5, -1, -1.5, -2])
        self.assertEqual(result.units, 'C')
        np.testing.assert_allclose(self.evaluate('T2M + 2 * 3').data, [7, 8, 9, 10, 11, 12, 13])

    def test_mean_uses_full_trailing_window_without_future_data(self):
        result = self.evaluate('ts_mean(T2M, 3)')
        np.testing.assert_allclose(result.data, [np.nan, np.nan, 2, 3, 4, 5, 6], equal_nan=True)
        self.assertEqual(result.units, 'C')
        self.inputs['T2M'].data.iloc[-1] = 1000
        self.assertEqual(self.evaluate('ts_mean(T2M, 3)').data.iloc[2], 2)

    def test_missing_observations_are_not_filled_or_ignored(self):
        self.inputs['T2M'].data.iloc[3] = np.nan
        np.testing.assert_allclose(self.evaluate('ts_mean(T2M, 3)').data, [np.nan, np.nan, 2, np.nan, np.nan, np.nan, 6], equal_nan=True)

    def test_series_align_by_date_instead_of_array_position(self):
        self.inputs['T2M_MIN'] = Value(pd.Series([1, 2, 3], index=self.dates[[0, 2, 4]], dtype=float), 'C')
        np.testing.assert_allclose(self.evaluate('T2M_MAX - T2M_MIN').data, [4, np.nan, 5, np.nan, 6, np.nan, np.nan], equal_nan=True)

    def test_nested_windows_collect_history_and_deduplicate_sources(self):
        root = parse_expression('ts_mean(ts_mean(T2M, 3), 4) + T2M')
        self.assertEqual(root.history, 5)
        self.assertEqual(expression_keys(root), ['T2M'])
        np.testing.assert_allclose(self.evaluate('ts_mean(ts_mean(T2M, 3), 4)').data, [np.nan] * 5 + [3.5, 4.5], equal_nan=True)

    def test_division_by_zero_and_intermediate_infinity_remain_missing(self):
        self.assertTrue(self.evaluate('T2M / (T2M - T2M)').data.isna().all())
        self.assertTrue(self.evaluate('1 / (T2M / 0)').data.isna().all())
        self.assertTrue(self.evaluate('T2M * 1e308').data.iloc[1:].isna().all())
        self.assertEqual(self.evaluate('T2M / T2M').units, '1')
        np.testing.assert_allclose(self.evaluate('T2M / T2M').data, np.ones(7))

    def test_units_are_checked_and_compound_units_are_retained(self):
        for expression in ['T2M + PRECTOTCORR', 'T2M - PRECTOTCORR']:
            with self.subTest(expression=expression), self.assertRaises(ExpressionError):
                self.evaluate(expression)
        self.assertEqual(self.evaluate('T2M * PRECTOTCORR').units, '(C)*(mm/day)')
        self.assertEqual(self.evaluate('T2M / PRECTOTCORR').units, '(C)/(mm/day)')
        self.inputs['PRECTOTCORR'] = Value(self.inputs['PRECTOTCORR'].data, 'dimensionless')
        self.assertEqual(self.evaluate('PRECTOTCORR').units, '1')
        self.assertEqual(self.evaluate('T2M * PRECTOTCORR').units, 'C')
        self.inputs['PRECTOTCORR'] = Value(self.inputs['PRECTOTCORR'].data, '')
        self.assertEqual(self.evaluate('PRECTOTCORR').units, 'unknown')

    def test_unknown_syntax_code_execution_and_invalid_windows_are_rejected(self):
        expressions = [
            '__import__("os")', 'T2M.__class__', 'T2M[0]', '(lambda: T2M)()',
            '[x for x in T2M]', 'T2M ** 2', 'T2M != 0', 'UNKNOWN', 'True',
            'ts_unknown(T2M, 1)', 'ts_mean(T2M)', 'ts_mean(T2M, d=3)',
            'ts_mean(T2M, 0)', 'ts_mean(T2M, -1)', 'ts_mean(T2M, 2.5)',
            'ts_mean(T2M, True)', 'ts_mean(T2M, T2M)', 'ts_mean(T2M, 36526)',
            '1 + 2', '1e999 + T2M', 'T2M +', '', 'T2M+' * 150 + 'T2M',
        ]
        for expression in expressions:
            with self.subTest(expression=expression), self.assertRaises(ExpressionError):
                parse_expression(expression)

    def test_registering_a_function_needs_no_parser_changes(self):
        spec = Operator(
            ('x', 'd'), lambda x, d: x.rolling(d, min_periods=d).sum(),
            definition='Trailing sum of x over d days.', history=lambda x, d: d - 1,
        )
        with patch.dict(OPERATORS, {'ts_custom': spec}):
            np.testing.assert_allclose(self.evaluate('ts_custom(T2M, 3)').data, [np.nan, np.nan, 6, 9, 12, 15, 18], equal_nan=True)
            self.assertEqual(self.evaluate('ts_custom(T2M, 3)').units, 'C')
            self.assertEqual(parse_expression('ts_custom(T2M, 3)').history, 2)
            metadata = next(item for item in operator_catalog() if item['name'] == 'ts_custom')
            self.assertEqual(metadata['signature'], 'ts_custom(x, d)')
            self.assertEqual(metadata['definition'], 'Trailing sum of x over d days.')
            self.assertEqual(metadata['parameters'], [
                {'name': 'x', 'type': 'number', 'default': 0},
                {'name': 'd', 'type': 'literal', 'default': 30},
            ])

    def test_binary_syntax_is_registered_with_the_operator(self):
        spec = Operator(('x', 'y'), operator.mod, definition='Remainder of x divided by y.', syntax=ast.Mod)
        with patch.dict(OPERATORS, {'%': spec}):
            np.testing.assert_allclose(self.evaluate('T2M % 2').data, [1, 0, 1, 0, 1, 0, 1])
            metadata = next(item for item in operator_catalog() if item['name'] == '%')
            self.assertEqual(metadata['signature'], 'x % y')
            self.assertEqual(metadata['syntax'], 'infix')
        with self.assertRaises(ExpressionError):
            parse_expression('T2M % 2')


class ExpressionRequestTests(unittest.TestCase):
    def selection(self, **updates):
        values = {'expression': 'ts_mean(T2M, 3)', 'latitude': 25, 'longitude': 121.5, 'start': '2024-01-01', 'end': '2024-01-05'}
        return ExpressionRequest(**{**values, **updates})

    def payload(self):
        dates = pd.date_range('2023-12-30', '2024-01-05')
        return {
            'header': {'fill_value': -999, 'sources': ['MERRA2'], 'time_standard': 'UTC'},
            'properties': {'parameter': {
                'T2M': dict(zip(dates.strftime('%Y%m%d'), range(1, 8))),
                'T2M_MAX': dict(zip(dates.strftime('%Y%m%d'), range(5, 12))),
                'T2M_MIN': dict.fromkeys(dates.strftime('%Y%m%d'), 1),
            }},
            'parameters': {key: {'units': 'C', 'longname': key} for key in ['T2M', 'T2M_MAX', 'T2M_MIN']},
        }

    def test_existing_location_dates_and_parameter_limits_are_validated(self):
        for updates in [{'latitude': 91}, {'longitude': 181}, {'start': '1980-01-01'}, {'start': '2024-02-01'}, {'end': '9999-01-01'}, {'temporal': 'annual'}, {'expression': 'UNKNOWN'}]:
            with self.subTest(updates=updates), self.assertRaises(ValidationError):
                self.selection(**updates)
        selection = self.selection(expression='T2M_MAX - T2M_MIN + T2M_MAX', keys=['UNKNOWN'])
        self.assertEqual(selection.keys, ['T2M_MAX', 'T2M_MIN'])
        with self.assertRaises(ValidationError):
            self.selection(expression=' + '.join(DATA_KEYS[:21]))

    def test_fetches_warmup_and_returns_only_requested_dates_with_recomputed_regression(self):
        with patch('app.timeseries.urlopen', return_value=io.StringIO(json.dumps(self.payload()))) as upstream:
            result = fetch_expression(self.selection())
        self.assertIn('start=20231230', upstream.call_args.args[0])
        self.assertEqual(result['start'], '2024-01-01')
        series = result['series'][0]
        self.assertEqual(series['dates'], ['2024-01-01', '2024-01-02', '2024-01-03', '2024-01-04', '2024-01-05'])
        self.assertEqual(series['values'], [2, 3, 4, 5, 6])
        self.assertEqual(series['statistics']['count'], 5)
        self.assertAlmostEqual(series['statistics']['slope'], 365.2425)
        self.assertAlmostEqual(series['statistics']['r_squared'], 1)
        self.assertEqual(series['units'], 'C')
        json.dumps(result, allow_nan=False)

    def test_multiple_data_sources_are_requested_together(self):
        with patch('app.timeseries.urlopen', return_value=io.StringIO(json.dumps(self.payload()))) as upstream:
            result = fetch_expression(self.selection(expression='ts_mean(T2M_MAX - T2M_MIN, 3) / 2'))
        upstream.assert_called_once()
        self.assertIn('parameters=T2M_MAX%2CT2M_MIN', upstream.call_args.args[0])
        self.assertEqual(result['series'][0]['values'], [2.5, 3, 3.5, 4, 4.5])

    def test_nested_lag_and_rolling_sum_fetch_the_full_required_history(self):
        selection = self.selection(expression='ts_delta(ts_sum(T2M, 3), 2)', start='2024-01-03')
        with patch('app.timeseries.urlopen', return_value=io.StringIO(json.dumps(self.payload()))) as upstream:
            result = fetch_expression(selection)
        self.assertIn('start=20231230', upstream.call_args.args[0])
        self.assertEqual(result['series'][0]['values'], [6, 6, 6])
        self.assertEqual(result['series'][0]['dates'], ['2024-01-03', '2024-01-04', '2024-01-05'])

    def test_scalar_parameter_and_pointwise_function_work_in_generated_results(self):
        selection = self.selection(expression='max(ts_quantile(T2M, 3, 0.25), ts_delay(T2M, 2))')
        with patch('app.timeseries.urlopen', return_value=io.StringIO(json.dumps(self.payload()))):
            result = fetch_expression(selection)
        self.assertEqual(result['series'][0]['values'], [1.5, 2.5, 3.5, 4.5, 5.5])
        self.assertEqual(result['series'][0]['units'], 'C')
        json.dumps(result, allow_nan=False)

    def test_history_stops_at_the_existing_1981_boundary(self):
        selection = self.selection(expression='ts_mean(ts_mean(T2M, 36525), 36525)', start='1981-01-01', end='1981-01-05')
        payload = self.payload()
        payload['properties']['parameter']['T2M'] = {'19810101': 1}
        with patch('app.timeseries.urlopen', return_value=io.StringIO(json.dumps(payload))) as upstream:
            result = fetch_expression(selection)
        self.assertIn('start=19810101', upstream.call_args.args[0])
        self.assertEqual(result['series'][0]['values'], [None] * 5)
        self.assertEqual(result['series'][0]['statistics']['count'], 0)

    def test_division_by_zero_stays_valid_json_without_fake_regression(self):
        with patch('app.timeseries.urlopen', return_value=io.StringIO(json.dumps(self.payload()))):
            result = fetch_expression(self.selection(expression='T2M / 0'))
        self.assertEqual(result['series'][0]['values'], [None] * 5)
        self.assertIsNone(result['series'][0]['statistics']['p_value'])
        json.dumps(result, allow_nan=False)

    def test_monthly_formula_uses_monthly_warmup_across_year_boundary(self):
        payload = self.payload()
        payload['properties']['parameter']['T2M'] = {
            '202311': 1, '202312': 2, '202313': 999,
            '202401': 3, '202402': 4, '202403': 5,
        }
        selection = self.selection(temporal='monthly', start='2024-01-01', end='2024-03-31')
        with patch('app.timeseries.urlopen', return_value=io.StringIO(json.dumps(payload))) as upstream:
            result = fetch_expression(selection)
        self.assertIn('/monthly/point?', upstream.call_args.args[0])
        self.assertIn('start=2023', upstream.call_args.args[0])
        self.assertEqual(result['temporal'], 'MONTHLY')
        self.assertEqual(result['series'][0]['dates'], ['2024-01-01', '2024-02-01', '2024-03-01'])
        self.assertEqual(result['series'][0]['values'], [2, 3, 4])


class ExpressionMapTests(unittest.TestCase):
    def annual_map(self, key='T2M', years=(2020, 2021, 2022), units='C'):
        return {
            'key': key, 'name': key, 'units': units, 'source': f'NASA/{key}',
            'temporal': 'ANNUAL', 'grid_size': 10, 'rows': 18, 'columns': 36,
            'frames': [{'year': year, 'values': [float(year - 2019)] * 648} for year in years],
        }

    def test_formula_reuses_cached_maps_and_rolls_each_cell_over_years(self):
        source = self.annual_map()
        source['frames'][1]['values'][0] = None
        with patch('app.expressions.load_annual_map', return_value=source) as load:
            result = fetch_expression_map('ts_mean((T2M + T2M) / 2 + 3, 2)')
        load.assert_called_once_with('T2M')
        self.assertEqual(result['units'], 'C')
        self.assertEqual([frame['year'] for frame in result['frames']], [2021, 2022])
        self.assertEqual(result['frames'][0]['values'][1], 4.5)
        self.assertEqual(result['frames'][1]['values'][1], 5.5)
        self.assertIsNone(result['frames'][0]['values'][0])
        self.assertIsNone(result['frames'][1]['values'][0])
        self.assertEqual(len(result['frames'][0]['values']), 648)
        self.assertEqual(result['minimum'], 4.5)
        self.assertEqual(result['maximum'], 5.5)
        json.dumps(result, allow_nan=False)

    def test_missing_years_are_not_bridged_and_sources_align_by_year(self):
        maps = {
            'T2M': self.annual_map(years=(2019, 2020, 2022, 2023, 2024)),
            'WS10M': self.annual_map('WS10M', years=(2020, 2022, 2023, 2024), units='m/s'),
        }
        with patch('app.expressions.load_annual_map', side_effect=maps.__getitem__):
            result = fetch_expression_map('ts_mean(T2M / WS10M, 2)')
        self.assertEqual([frame['year'] for frame in result['frames']], [2023, 2024])
        self.assertEqual(result['units'], '(C)/(m/s)')
        self.assertEqual(result['frames'][0]['values'], [1.0] * 648)

    def test_unsupported_sources_empty_results_and_mismatched_units_are_rejected(self):
        with patch('app.expressions.load_annual_map') as load:
            with self.assertRaisesRegex(ExpressionError, 'T2M_MAX'):
                fetch_expression_map('T2M_MAX - T2M')
            load.assert_not_called()
        for formula in ['T2M / 0', 'ts_mean(T2M, 4)', 'T2M + WS10M']:
            with self.subTest(formula=formula), patch('app.expressions.load_annual_map', side_effect=lambda key: self.annual_map(key, units='C' if key == 'T2M' else 'm/s')):
                with self.assertRaises(ExpressionError):
                    fetch_expression_map(formula)


if __name__ == '__main__':
    unittest.main()
