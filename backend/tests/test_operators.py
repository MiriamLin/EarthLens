import unittest

import numpy as np
import pandas as pd

from app.operators import ExpressionError, Value, evaluate_expression, parse_expression


class ScientificOperatorTests(unittest.TestCase):
    def setUp(self):
        self.dates = pd.date_range('2024-01-01', periods=7)
        self.x = np.array([1, 2, 4, 8, 16, 32, 64], dtype=float)
        self.inputs = {
            'T2M': Value(pd.Series(self.x, index=self.dates), 'C'),
            'T2M_MAX': Value(pd.Series(self.x[::-1], index=self.dates), 'C'),
            'WS10M': Value(pd.Series(self.x[::-1], index=self.dates), 'm/s'),
        }

    def evaluate(self, expression):
        return evaluate_expression(parse_expression(expression), self.inputs, self.dates)

    def test_trailing_sum_extremes_std_and_zscore_use_full_windows(self):
        cases = {
            'ts_sum(T2M, 3)': [7, 14, 28, 56, 112],
            'ts_max(T2M, 3)': [4, 8, 16, 32, 64],
            'ts_min(T2M, 3)': [1, 2, 4, 8, 16],
            'ts_std(T2M, 3)': np.sqrt(7 / 3) * np.array([1, 2, 4, 8, 16]),
            'ts_zscore(T2M, 3)': [5 / np.sqrt(21)] * 5,
        }
        for formula, expected in cases.items():
            with self.subTest(formula=formula):
                result = self.evaluate(formula)
                np.testing.assert_allclose(result.data, [np.nan, np.nan, *expected], equal_nan=True)
                self.assertEqual(result.units, '1' if 'zscore' in formula else 'C')
                self.assertEqual(parse_expression(formula).history, 2)
                self.inputs['T2M'].data.iloc[-1] = 1000
                self.assertAlmostEqual(self.evaluate(formula).data.iloc[2], expected[0])
                self.inputs['T2M'].data.iloc[-1] = 64

    def test_delta_delay_and_nested_history_do_not_use_future_values(self):
        np.testing.assert_allclose(self.evaluate('ts_delta(T2M, 2)').data, [np.nan, np.nan, 3, 6, 12, 24, 48], equal_nan=True)
        np.testing.assert_allclose(self.evaluate('ts_delay(T2M, 2)').data, [np.nan, np.nan, 1, 2, 4, 8, 16], equal_nan=True)
        self.assertEqual(parse_expression('ts_mean(ts_delta(T2M, 2), 3)').history, 4)
        self.assertEqual(parse_expression('ts_delay(ts_sum(T2M, 3), 4)').history, 6)
        self.inputs['T2M'].data.iloc[1] = np.nan
        self.assertEqual(self.evaluate('ts_delta(T2M, 2)').data.iloc[2], 3)
        self.assertTrue(np.isnan(self.evaluate('ts_delay(T2M, 2)').data.iloc[3]))

    def test_correlation_is_paired_dimensionless_and_rejects_constant_windows(self):
        result = self.evaluate('ts_corr(T2M, WS10M, 3)')
        np.testing.assert_allclose(result.data, [np.nan, np.nan] + [-13 / 14] * 5, equal_nan=True)
        self.assertEqual(result.units, '1')
        self.inputs['WS10M'].data[:] = 0.1
        self.assertTrue(self.evaluate('ts_corr(T2M, WS10M, 3)').data.isna().all())
        with self.assertRaises(ExpressionError):
            parse_expression('ts_corr(T2M, T2M, 1)')

    def test_missing_values_in_either_input_invalidate_rolling_windows(self):
        self.inputs['T2M'].data.iloc[3] = np.nan
        for function in ['ts_sum', 'ts_max', 'ts_min', 'ts_std', 'ts_zscore']:
            with self.subTest(function=function):
                self.assertTrue(self.evaluate(f'{function}(T2M, 3)').data.iloc[3:6].isna().all())
        self.assertTrue(self.evaluate('ts_corr(WS10M, T2M, 3)').data.iloc[3:6].isna().all())
        self.assertTrue(self.evaluate('ts_quantile(T2M, 3, 0.25)').data.iloc[3:6].isna().all())
        for formula in ['max(T2M, T2M_MAX)', 'min(T2M, T2M_MAX)', 'abs(T2M)', 'log(T2M)', 'sqrt(T2M)', 'pow(T2M, 0)']:
            with self.subTest(formula=formula):
                self.assertTrue(np.isnan(self.evaluate(formula).data.iloc[3]))

    def test_quantiles_use_linear_interpolation_and_include_both_endpoints(self):
        np.testing.assert_allclose(self.evaluate('ts_quantile(T2M, 3, 0.25)').data,
                                   [np.nan, np.nan, 1.5, 3, 6, 12, 24], equal_nan=True)
        for q, function in [(0, 'ts_min'), (1, 'ts_max')]:
            np.testing.assert_allclose(self.evaluate(f'ts_quantile(T2M, 3, {q})').data,
                                       self.evaluate(f'{function}(T2M, 3)').data, equal_nan=True)

    def test_pointwise_functions_accept_nested_formulas_and_numeric_constants(self):
        np.testing.assert_allclose(self.evaluate('max(T2M, 10)').data, [10, 10, 10, 10, 16, 32, 64])
        np.testing.assert_allclose(self.evaluate('min(T2M, T2M_MAX)').data, [1, 2, 4, 8, 4, 2, 1])
        np.testing.assert_allclose(self.evaluate('abs(T2M - 8)').data, [7, 6, 4, 0, 8, 24, 56])
        np.testing.assert_allclose(self.evaluate('log(T2M)').data, np.arange(7) * np.log(2))
        np.testing.assert_allclose(self.evaluate('sqrt(pow(T2M, 2))').data, self.x)
        np.testing.assert_allclose(self.evaluate('pow(T2M, -1)').data, 1 / self.x)
        self.assertEqual(self.evaluate('pow(T2M, 2)').units, '(C)^2')
        self.assertEqual(self.evaluate('sqrt(T2M)').units, 'sqrt(C)')
        self.assertEqual(self.evaluate('log(T2M)').units, '1')
        self.assertEqual(self.evaluate('pow(T2M, 0)').units, '1')
        for function in ['max', 'min']:
            with self.subTest(function=function), self.assertRaises(ExpressionError):
                self.evaluate(f'{function}(T2M, WS10M)')

    def test_invalid_domains_and_zero_spread_produce_missing_values(self):
        self.inputs['T2M'].data[:] = [-4, -1, 0, 1, 4, np.nan, 16]
        np.testing.assert_allclose(self.evaluate('sqrt(T2M)').data, [np.nan, np.nan, 0, 1, 2, np.nan, 4], equal_nan=True)
        np.testing.assert_allclose(self.evaluate('log(T2M)').data,
                                   [np.nan, np.nan, np.nan, 0, np.log(4), np.nan, np.log(16)], equal_nan=True)
        np.testing.assert_allclose(self.evaluate('pow(T2M, 0.5)').data,
                                   self.evaluate('sqrt(T2M)').data, equal_nan=True)
        self.assertTrue(np.isnan(self.evaluate('pow(T2M, -1)').data.iloc[2]))
        self.inputs['T2M'].data[:] = 7
        self.assertTrue(self.evaluate('ts_zscore(T2M, 3)').data.isna().all())
        with self.assertRaises(ExpressionError):
            parse_expression('ts_std(T2M, 1)')

    def test_scalar_parameters_and_function_arity_are_validated_before_fetching(self):
        formulas = [
            'ts_quantile(T2M, 3, -0.1)', 'ts_quantile(T2M, 3, 1.1)',
            'ts_quantile(T2M, 3, True)', 'ts_quantile(T2M, 3, T2M)',
            'ts_quantile(T2M, 3, 1e999)', 'ts_quantile(T2M, 3)',
            'pow(T2M, T2M)', 'pow(T2M, 1 + 1)', 'pow(T2M, True)', 'pow(T2M, 1e999)',
            'ts_corr(T2M, WS10M, 0)', 'ts_corr(T2M, WS10M, 2.5)',
            'ts_delay(T2M, -1)', 'max(T2M)', 'abs(T2M, 2)', 'sqrt(T2M, d=2)',
        ]
        for formula in formulas:
            with self.subTest(formula=formula), self.assertRaises(ExpressionError):
                parse_expression(formula)

    def test_annual_grids_compute_each_cell_independently(self):
        self.inputs['T2M'] = Value(pd.DataFrame({0: self.x, 1: self.x}, index=self.dates), 'C')
        self.inputs['T2M_MAX'] = Value(pd.DataFrame({0: self.x[::-1], 1: self.x}, index=self.dates), 'C')
        result = self.evaluate('ts_corr(T2M, T2M_MAX, 3)').data
        self.assertEqual(result.shape, (7, 2))
        np.testing.assert_allclose(result.iloc[2:, 0], [-13 / 14] * 5)
        np.testing.assert_allclose(result.iloc[2:, 1], [1] * 5)
        for formula in ['ts_sum(T2M, 3)', 'ts_delta(T2M, 2)', 'ts_max(T2M, 3)', 'ts_min(T2M, 3)',
                        'ts_std(T2M, 3)', 'ts_delay(T2M, 2)', 'ts_zscore(T2M, 3)', 'ts_quantile(T2M, 3, 0.25)',
                        'max(T2M, 10)', 'min(T2M, 10)', 'abs(T2M)', 'log(T2M)', 'sqrt(T2M)', 'pow(T2M, -1)']:
            with self.subTest(formula=formula):
                result = self.evaluate(formula).data
                self.assertEqual(result.shape, (7, 2))
                np.testing.assert_allclose(result.iloc[:, 0], result.iloc[:, 1], equal_nan=True)
