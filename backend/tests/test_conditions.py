import io
import json
import unittest
from unittest.mock import patch

import numpy as np
import pandas as pd

from app.expressions import ExpressionRequest, fetch_expression
from app.main import parse_formula
from app.expressions import FormulaRequest
from app.operators import ExpressionError, Value, evaluate_expression, expression_keys, expression_tree, operator_catalog, parse_expression


class ConditionTests(unittest.TestCase):
    def setUp(self):
        self.dates = pd.date_range('2024-01-01', periods=6)
        self.inputs = {
            'T2M': Value(pd.Series([-4, 0, 35, 36, np.nan, 40], index=self.dates), 'C'),
            'T2M_MAX': Value(pd.Series([2, np.nan, 35, 38, 40, 39], index=self.dates), 'C'),
            'WS10M': Value(pd.Series([1, 2, 3, 4, 5, 6], index=self.dates), 'm/s'),
        }

    def evaluate(self, expression):
        return evaluate_expression(parse_expression(expression), self.inputs, self.dates)

    def test_comparisons_are_elementwise_and_preserve_missing_conditions(self):
        expected = {
            '>': [0, 0, 0, 1, np.nan, 1], '<': [1, 1, 0, 0, np.nan, 0],
            '>=': [0, 0, 1, 1, np.nan, 1], '<=': [1, 1, 1, 0, np.nan, 0],
            '==': [0, 0, 1, 0, np.nan, 0],
        }
        for symbol, values in expected.items():
            with self.subTest(symbol=symbol):
                node = parse_expression(f'T2M {symbol} 35')
                self.assertEqual(node.result_type, 'boolean')
                result = self.evaluate(f'T2M {symbol} 35')
                np.testing.assert_allclose(result.data, values, equal_nan=True)
                self.assertEqual(result.units, '1')

    def test_if_else_returns_daily_numeric_values(self):
        result = self.evaluate('if_else(T2M > 35, 1, 0)')
        np.testing.assert_allclose(result.data, [0, 0, 0, 1, np.nan, 1], equal_nan=True)
        self.assertEqual(result.units, '')
        self.assertEqual(result.data.index.tolist(), self.dates.tolist())

    def test_nested_conditions_and_unselected_missing_branches(self):
        result = self.evaluate('if_else(T2M == 35, 2, if_else(T2M < 0, -1, 1))')
        np.testing.assert_allclose(result.data, [-1, 1, 2, 1, np.nan, 1], equal_nan=True)
        result = self.evaluate('if_else(T2M >= 0, sqrt(T2M), sqrt(-T2M))')
        np.testing.assert_allclose(result.data, [2, 0, np.sqrt(35), 6, np.nan, np.sqrt(40)], equal_nan=True)
        self.assertEqual(result.units, 'sqrt(C)')

    def test_missing_selected_values_and_comparison_inputs_are_not_filled(self):
        result = self.evaluate('if_else(T2M >= 0, T2M_MAX, 0)')
        np.testing.assert_allclose(result.data, [0, np.nan, 35, 38, np.nan, 39], equal_nan=True)
        result = self.evaluate('if_else(T2M == T2M_MAX, 1, 0)')
        np.testing.assert_allclose(result.data, [0, np.nan, 1, 0, np.nan, 0], equal_nan=True)

    def test_units_and_boolean_input_types_are_checked(self):
        for formula in ['T2M > WS10M', 'T2M == WS10M', 'if_else(T2M > 35, T2M, WS10M)']:
            with self.subTest(formula=formula), self.assertRaises(ExpressionError):
                self.evaluate(formula)
        self.assertEqual(self.evaluate('if_else(T2M > 35, T2M, 0)').units, 'C')
        for formula in [
            'if_else(T2M, 1, 0)', 'if_else(1, T2M, 0)',
            '(T2M > 35) + 1', 'ts_mean(T2M > 35, 3)', '-(T2M > 35)',
            '(T2M > 35) == (T2M_MAX > 35)', 'if_else(T2M > 35, T2M > 0, 0)',
            '0 < T2M < 35', 'T2M != 35', 'T2M > 0 and T2M < 35',
        ]:
            with self.subTest(formula=formula), self.assertRaises(ExpressionError):
                parse_expression(formula)

    def test_conditional_history_includes_condition_and_both_branches(self):
        node = parse_expression('if_else(ts_mean(T2M, 3) > 35, ts_delay(T2M_MAX, 7), ts_sum(T2M, 4))')
        self.assertEqual(node.history, 7)
        self.assertEqual(expression_keys(node), ['T2M', 'T2M_MAX'])
        node = parse_expression('ts_sum(if_else(T2M > ts_mean(T2M, 3), 1, 0), 4)')
        self.assertEqual(node.history, 5)

    def test_grid_conditions_select_independently_for_each_cell(self):
        self.inputs['T2M'] = Value(pd.DataFrame({0: [-1, 2, np.nan, 4, 5, 6], 1: [1, -2, 3, 4, 5, 6]}, index=self.dates), 'C')
        result = self.evaluate('if_else(T2M >= 0, T2M, 0)')
        self.assertEqual(result.data.shape, (6, 2))
        np.testing.assert_allclose(result.data.iloc[:, 0], [0, 2, np.nan, 4, 5, 6], equal_nan=True)
        np.testing.assert_allclose(result.data.iloc[:, 1], [1, 0, 3, 4, 5, 6])

    def test_parser_exports_typed_blocks_and_literal_parameters(self):
        formula = 'if_else(T2M > 35, pow(T2M, -1), ts_quantile(T2M, 3, 0.25))'
        tree = expression_tree(parse_expression(formula))
        self.assertEqual(tree['result_type'], 'number')
        self.assertEqual(tree['arguments'][0]['result_type'], 'boolean')
        self.assertEqual(tree['arguments'][1]['arguments'][1]['value'], -1)
        self.assertEqual(tree['arguments'][2]['arguments'][2]['value'], 0.25)
        self.assertEqual(parse_formula(FormulaRequest(expression=formula)), {'tree': tree})
        self.assertEqual(parse_formula(FormulaRequest(expression='0 > 0'))['tree']['result_type'], 'boolean')
        with self.assertRaises(ExpressionError):
            parse_expression('0 > 0')
        catalog = {item['name']: item for item in operator_catalog()}
        self.assertEqual(catalog['>']['result_type'], 'boolean')
        self.assertEqual(catalog['if_else']['parameters'][0]['type'], 'boolean')
        self.assertEqual(catalog['ts_quantile']['parameters'][2]['type'], 'literal')

    def test_generated_results_use_existing_fetch_statistics_and_json(self):
        selection = ExpressionRequest(expression='if_else(T2M > 35, 1, 0)', latitude=25, longitude=121.5, start='2024-01-01', end='2024-01-06')
        payload = {
            'header': {'fill_value': -999, 'sources': ['MERRA2']},
            'parameters': {'T2M': {'units': 'C'}},
            'properties': {'parameter': {'T2M': dict(zip(self.dates.strftime('%Y%m%d'), [-4, 0, 35, 36, -999, 40]))}},
        }
        with patch('app.timeseries.urlopen', return_value=io.StringIO(json.dumps(payload))):
            result = fetch_expression(selection)
        self.assertEqual(result['series'][0]['values'], [0, 0, 0, 1, None, 1])
        self.assertEqual(result['series'][0]['statistics']['count'], 5)
        self.assertEqual(result['series'][0]['statistics']['missing'], 1)
        self.assertEqual(result['series'][0]['units'], '1')
        self.assertEqual(result['temporal'], 'DAILY')
        json.dumps(result, allow_nan=False)
