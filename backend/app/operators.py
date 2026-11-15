import ast
import math
import operator
from dataclasses import dataclass
from typing import Callable

import numpy as np
import pandas as pd

from .data import DATA_KEYS

MAX_LENGTH = 2000
MAX_NODES = 256
MAX_DEPTH = 32
MAX_WINDOW = 36525
MIN_YEAR = 1981
MAX_YEAR = 2100


class ExpressionError(ValueError):
    pass


@dataclass(frozen=True)
class Operator:
    parameters: tuple[str, ...]
    function: Callable
    definition: str
    units: Callable = lambda units, *args: units
    history: Callable = lambda *args: 0
    syntax: type[ast.AST] | None = None
    min_window: int = 1
    result_type: str = 'number'
    check: Callable | None = None


@dataclass(frozen=True)
class Node:
    operation: str
    arguments: tuple = ()
    value: str | float | None = None
    history: int = 0
    result_type: str = 'number'


@dataclass(frozen=True)
class Value:
    data: pd.Series | pd.DataFrame
    units: str


def is_scalar(units: str) -> bool:
    return units in ('', '1')


def add_units(left: str, right: str) -> str:
    if left and right and left != right:
        raise ExpressionError(f'Inputs require matching units: {left} and {right}.')
    return left or right


def comparison_units(left: str, right: str) -> str:
    add_units(left, right)
    return '1'


def scalar_units(left: str, right: str) -> str:
    return '1' if '1' in (left, right) else ''


def multiply_units(left: str, right: str) -> str:
    if is_scalar(left) and is_scalar(right):
        return scalar_units(left, right)
    if is_scalar(left):
        return right
    if is_scalar(right):
        return left
    return f'({left})*({right})'


def divide_units(left: str, right: str) -> str:
    if is_scalar(left) and is_scalar(right):
        return scalar_units(left, right)
    if is_scalar(right):
        return left
    if left == right:
        return '1'
    return f'({left or "1"})/({right})'


def power_units(units: str, p: float) -> str:
    if units == '':
        return ''
    if units == '1' or p == 0:
        return '1'
    if p == 1:
        return units
    if p == 0.5:
        return f'sqrt({units})'
    return f'({units})^{p:g}'


def dimensionless(*args) -> str:
    return '1'


def log_units(units: str) -> str:
    return units if units == '' else '1'


def window_history(x, d, *args) -> int:
    return d - 1


def lag_history(x, d) -> int:
    return d


def rolling(x, d):
    return x.rolling(d, min_periods=d)


def zscore(x, d):
    window = rolling(x, d)
    return (x - window.mean()) / window.std(ddof=1)


def correlation(x, y, d):
    left, right = rolling(x, d), rolling(y, d)
    result = left.corr(y, pairwise=False)
    valid = (left.std(ddof=1) > 0) & (right.std(ddof=1) > 0) & np.isfinite(result)
    return result.where(valid).clip(-1, 1)


def compare(function, left, right):
    return function(left, right).astype(float).where(left.notna() & right.notna())


def if_else(condition, true_value, false_value):
    return true_value.where(condition.eq(1), false_value).where(condition.notna())


def power(x, p):
    return x.pow(p).where(x.notna())


def anomaly(x, from_year, to_year):
    index = x.index
    daily = bool((index.day != 1).any())
    key = np.asarray(index.month * 100 + index.day if daily else index.month)
    years = np.asarray(index.year)
    baseline = (years >= from_year) & (years <= to_year)
    normal = x.loc[baseline].groupby(key[baseline]).mean()
    expected = normal.reindex(key)
    expected.index = index
    return x - expected


def ordered_years(x, from_year, to_year):
    if from_year > to_year:
        raise ExpressionError('from_year must not be after to_year.')


def literal_number(node: ast.AST) -> float:
    sign = 1
    if isinstance(node, ast.UnaryOp) and isinstance(node.op, (ast.UAdd, ast.USub)):
        sign = -1 if isinstance(node.op, ast.USub) else 1
        node = node.operand
    if not isinstance(node, ast.Constant) or type(node.value) not in (int, float):
        raise ExpressionError('Use a finite numeric literal for this parameter.')
    try:
        value = sign * float(node.value)
    except OverflowError as error:
        raise ExpressionError('Numeric constants must be finite.') from error
    if not math.isfinite(value):
        raise ExpressionError('Numeric constants must be finite.')
    return value


def window_size(node: ast.AST) -> int:
    if not isinstance(node, ast.Constant) or type(node.value) is not int or not 1 <= node.value <= MAX_WINDOW:
        raise ExpressionError(f'Window d must be an integer between 1 and {MAX_WINDOW}.')
    return node.value


def year_value(node: ast.AST) -> int:
    if not isinstance(node, ast.Constant) or type(node.value) is not int or not MIN_YEAR <= node.value <= MAX_YEAR:
        raise ExpressionError(f'Years must be whole numbers from {MIN_YEAR} to {MAX_YEAR}.')
    return node.value


def quantile_level(node: ast.AST) -> float:
    value = literal_number(node)
    if not 0 <= value <= 1:
        raise ExpressionError('Quantile q must be between 0 and 1.')
    return value


PARAMETERS = {'d': window_size, 'q': quantile_level, 'p': literal_number, 'from_year': year_value, 'to_year': year_value}
DEFAULTS = {'d': 30, 'q': 0.5, 'p': 2, 'true_value': 1, 'from_year': 1991, 'to_year': 2020}


def parameter_type(parameter: str) -> str:
    if parameter in PARAMETERS:
        return 'literal'
    return 'boolean' if parameter == 'condition' else 'number'


def comparison(function: Callable, syntax: type[ast.cmpop], meaning: str) -> Operator:
    return Operator(
        ('x', 'y'), lambda x, y: compare(function, x, y),
        definition=f'True where x {meaning} y. Data units must match; numeric constants are allowed. '
                   'Missing inputs produce a missing condition.',
        units=comparison_units, syntax=syntax, result_type='boolean',
    )


OPERATORS = {
    '+': Operator(
        ('x', 'y'), operator.add,
        definition='Add x and y at each date. Data series must have matching units; either input can also be a number.',
        units=add_units, syntax=ast.Add,
    ),
    '-': Operator(
        ('x', 'y'), operator.sub,
        definition='Subtract y from x at each date. Data series must have matching units; either input can also be a number.',
        units=add_units, syntax=ast.Sub,
    ),
    '*': Operator(
        ('x', 'y'), operator.mul,
        definition='Multiply x and y at each date. Inputs can be data series, formulas, or numbers. Output units are multiplied.',
        units=multiply_units, syntax=ast.Mult,
    ),
    '/': Operator(
        ('x', 'y'), operator.truediv,
        definition='Divide x by y at each date. Inputs can be data series, formulas, or numbers. Output units are divided; '
                   'division by zero produces a missing value.',
        units=divide_units, syntax=ast.Div,
    ),
    '>': comparison(operator.gt, ast.Gt, 'is greater than'),
    '<': comparison(operator.lt, ast.Lt, 'is less than'),
    '>=': comparison(operator.ge, ast.GtE, 'is greater than or equal to'),
    '<=': comparison(operator.le, ast.LtE, 'is less than or equal to'),
    '==': comparison(operator.eq, ast.Eq, 'equals'),
    'if_else': Operator(
        ('condition', 'true_value', 'false_value'), if_else,
        definition='Select true_value where the Boolean condition is true and false_value otherwise, independently at each date. '
                   'Branch units must match; numeric constants are allowed. A missing condition or selected value stays missing.',
        units=lambda condition, true_value, false_value: add_units(true_value, false_value),
    ),
    'ts_mean': Operator(
        ('x', 'd'), lambda x, d: rolling(x, d).mean(),
        definition='Trailing mean of x over d observations, including the current one. x is a data key or formula; '
                   'd is an integer from 1 to 36525. A window containing missing values has no result. Units are unchanged. '
                   'd counts days for daily data, months for monthly data, and years for annual maps.',
        history=window_history,
    ),
    'ts_sum': Operator(
        ('x', 'd'), lambda x, d: rolling(x, d).sum(),
        definition='Sum of the last d observations, including the current one. Requires a complete window; units are unchanged.',
        history=window_history,
    ),
    'ts_delta': Operator(
        ('x', 'd'), lambda x, d: x.diff(d),
        definition='Current value minus the value d observations earlier. Both values must be available; units are unchanged.',
        history=lag_history,
    ),
    'ts_max': Operator(
        ('x', 'd'), lambda x, d: rolling(x, d).max(),
        definition='Maximum of the last d observations, including the current one. Requires a complete window; units are unchanged.',
        history=window_history,
    ),
    'ts_min': Operator(
        ('x', 'd'), lambda x, d: rolling(x, d).min(),
        definition='Minimum of the last d observations, including the current one. Requires a complete window; units are unchanged.',
        history=window_history,
    ),
    'ts_std': Operator(
        ('x', 'd'), lambda x, d: rolling(x, d).std(ddof=1),
        definition='Sample standard deviation of the last d observations (ddof=1), including the current one. '
                   'Requires a complete window and d >= 2; units are unchanged.',
        history=window_history, min_window=2,
    ),
    'ts_corr': Operator(
        ('x', 'y', 'd'), correlation,
        definition='Pearson correlation of x and y over the last d observations, including the current one. '
                   'Requires d >= 2, complete paired values and nonzero variance in both series. Output is dimensionless.',
        units=dimensionless, history=lambda x, y, d: d - 1, min_window=2,
    ),
    'ts_delay': Operator(
        ('x', 'd'), lambda x, d: x.shift(d),
        definition='Value of x from d observations earlier. Shifts values forward without filling missing data; units are unchanged.',
        history=lag_history,
    ),
    'ts_zscore': Operator(
        ('x', 'd'), zscore,
        definition='Current value minus its trailing d-observation mean, divided by the sample standard deviation (ddof=1). '
                   'Includes the current observation and requires a complete window with nonzero standard deviation. '
                   'Output is dimensionless.',
        units=dimensionless, history=window_history, min_window=2,
    ),
    'ts_quantile': Operator(
        ('x', 'd', 'q'), lambda x, d, q: rolling(x, d).quantile(q, interpolation='linear'),
        definition='Quantile q of the last d observations, including the current one, using linear interpolation. '
                   'q is a numeric literal from 0 to 1. Requires a complete window; units are unchanged.',
        history=window_history,
    ),
    'ts_anomaly': Operator(
        ('x', 'from_year', 'to_year'), anomaly,
        definition='Value of x minus its average for the same month (monthly data) or the same day of the year (daily data) '
                   'over the years from_year to to_year, for example 1991 to 2020. The baseline years are downloaded automatically, '
                   'so a single year can be compared with the long-term normal. Units are unchanged.',
        check=ordered_years,
    ),
    'max': Operator(
        ('a', 'b'), np.maximum,
        definition='Larger of a and b at each date. Data units must match; numeric constants are allowed. Missing inputs remain missing.',
        units=add_units,
    ),
    'min': Operator(
        ('a', 'b'), np.minimum,
        definition='Smaller of a and b at each date. Data units must match; numeric constants are allowed. Missing inputs remain missing.',
        units=add_units,
    ),
    'abs': Operator(
        ('x',), np.abs,
        definition='Absolute value of x at each date. Units are unchanged.',
    ),
    'log': Operator(
        ('x',), np.log,
        definition='Natural logarithm of numeric values in their reported units. Values <= 0 are missing. Output is dimensionless.',
        units=log_units,
    ),
    'sqrt': Operator(
        ('x',), np.sqrt,
        definition='Square root of x at each date. Negative inputs are missing. Output units are the square root of the input units.',
        units=lambda x: power_units(x, 0.5),
    ),
    'pow': Operator(
        ('x', 'p'), power,
        definition='Raise x to the fixed finite numeric exponent p. Missing inputs, non-real results and nonfinite results remain missing. '
                   'Output units are raised to p.',
        units=power_units,
    ),
}


def parse_expression(expression: str, *, require_data: bool = True) -> Node:
    if not expression.strip() or len(expression) > MAX_LENGTH:
        raise ExpressionError(f'Enter a formula of at most {MAX_LENGTH} characters.')
    try:
        tree = ast.parse(expression.strip(), mode='eval')
    except (SyntaxError, RecursionError, ValueError) as error:
        raise ExpressionError('Invalid formula syntax.') from error
    if sum(1 for _ in ast.walk(tree)) > MAX_NODES:
        raise ExpressionError('The formula is too complex.')
    root = Parser().build(tree.body)
    if require_data and not expression_keys(root):
        raise ExpressionError('The formula must reference at least one data key.')
    return root


class Parser:
    def __init__(self):
        self.symbols = {spec.syntax: name for name, spec in OPERATORS.items() if spec.syntax}

    def build(self, node: ast.AST, depth: int = 0) -> Node:
        if depth > MAX_DEPTH:
            raise ExpressionError('The formula is nested too deeply.')
        if isinstance(node, ast.Name):
            return self.data(node)
        if isinstance(node, ast.Constant) and type(node.value) in (int, float):
            return Node('number', value=literal_number(node))
        if isinstance(node, ast.UnaryOp) and isinstance(node.op, (ast.UAdd, ast.USub)):
            return self.sign(node, depth)
        if isinstance(node, ast.BinOp) and type(node.op) in self.symbols:
            name = self.symbols[type(node.op)]
            return self.operation(name, (self.build(node.left, depth + 1), self.build(node.right, depth + 1)))
        if isinstance(node, ast.Compare):
            return self.comparison(node, depth)
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
            return self.call(node, depth)
        raise ExpressionError('Use data keys, numbers, + - * /, parentheses, and supported functions.')

    def data(self, node: ast.Name) -> Node:
        if node.id not in DATA_KEYS:
            raise ExpressionError(f'Unknown data key: {node.id}.')
        return Node('data', value=node.id)

    def sign(self, node: ast.UnaryOp, depth: int) -> Node:
        child = self.build(node.operand, depth + 1)
        if child.result_type != 'number':
            raise ExpressionError('A numeric expression is required after a sign.')
        if isinstance(node.op, ast.UAdd):
            return child
        if child.operation == 'number':
            return Node('number', value=-child.value)
        return Node('-', (Node('number', value=0.0), child), history=child.history)

    def comparison(self, node: ast.Compare, depth: int) -> Node:
        if len(node.ops) != 1 or type(node.ops[0]) not in self.symbols:
            raise ExpressionError('Use a single comparison: >, <, >=, <= or ==.')
        name = self.symbols[type(node.ops[0])]
        return self.operation(name, (self.build(node.left, depth + 1), self.build(node.comparators[0], depth + 1)))

    def call(self, node: ast.Call, depth: int) -> Node:
        name = node.func.id
        if name not in OPERATORS:
            raise ExpressionError(f'Unknown operator: {name}.')
        spec = OPERATORS[name]
        if node.keywords or len(node.args) != len(spec.parameters):
            raise ExpressionError(f'{name} expects {", ".join(spec.parameters)}.')
        arguments = tuple(
            self.literal(name, spec, parameter, argument) if parameter in PARAMETERS else self.build(argument, depth + 1)
            for argument, parameter in zip(node.args, spec.parameters)
        )
        if spec.check:
            spec.check(*arguments)
        return self.operation(name, arguments)

    def literal(self, name: str, spec: Operator, parameter: str, node: ast.AST):
        value = PARAMETERS[parameter](node)
        if parameter == 'd' and value < spec.min_window:
            raise ExpressionError(f'{name} requires window d >= {spec.min_window}.')
        return value

    def operation(self, name: str, arguments: tuple) -> Node:
        spec = OPERATORS[name]
        for parameter, argument in zip(spec.parameters, arguments):
            expected = parameter_type(parameter)
            if isinstance(argument, Node) and argument.result_type != expected:
                raise ExpressionError(f'{name}: {parameter} requires a {expected} expression.')
        history = max((argument.history for argument in arguments if isinstance(argument, Node)), default=0)
        return Node(name, arguments, history=history + spec.history(*arguments), result_type=spec.result_type)


def expression_baseline(node: Node) -> tuple[int, int] | None:
    spans = []
    if node.operation == 'ts_anomaly':
        spans.append((int(node.arguments[1]), int(node.arguments[2])))
    for argument in node.arguments:
        if isinstance(argument, Node) and (span := expression_baseline(argument)):
            spans.append(span)
    if not spans:
        return None
    return min(span[0] for span in spans), max(span[1] for span in spans)


def expression_keys(node: Node) -> list[str]:
    if node.operation == 'data':
        return [str(node.value)]
    return list(dict.fromkeys(
        key for argument in node.arguments if isinstance(argument, Node)
        for key in expression_keys(argument)
    ))


def evaluate_expression(node: Node, inputs: dict[str, Value], dates: pd.DatetimeIndex) -> Value:
    if node.operation == 'data':
        return load_data(inputs[str(node.value)], dates)
    if node.operation == 'number':
        return constant(node.value, inputs, dates)
    spec = OPERATORS[node.operation]
    arguments = [evaluate_expression(argument, inputs, dates) if isinstance(argument, Node) else argument
                 for argument in node.arguments]
    units = spec.units(*(argument.units if isinstance(argument, Value) else argument for argument in arguments))
    with np.errstate(divide='ignore', invalid='ignore', over='ignore'):
        result = spec.function(*(argument.data if isinstance(argument, Value) else argument for argument in arguments))
    return Value(result.replace([np.inf, -np.inf], np.nan), units)


def data_units(units: str) -> str:
    return '1' if units == 'dimensionless' else units or 'unknown'


def load_data(source: Value, dates: pd.DatetimeIndex) -> Value:
    return Value(source.data.reindex(dates), data_units(source.units))


def expression_units(node: Node, units: dict[str, str]) -> str:
    if node.operation == 'data':
        return data_units(units.get(str(node.value), ''))
    if node.operation == 'number':
        return ''
    spec = OPERATORS[node.operation]
    return spec.units(*(expression_units(argument, units) if isinstance(argument, Node) else argument for argument in node.arguments))


def constant(value: float, inputs: dict[str, Value], dates: pd.DatetimeIndex) -> Value:
    template = next(iter(inputs.values())).data
    if isinstance(template, pd.DataFrame):
        return Value(pd.DataFrame(value, index=dates, columns=template.columns, dtype=float), '')
    return Value(pd.Series(value, index=dates, dtype=float), '')


def operator_catalog() -> list[dict]:
    return [
        {
            'name': name,
            'signature': f' {name} '.join(spec.parameters) if spec.syntax else f'{name}({", ".join(spec.parameters)})',
            'definition': spec.definition,
            'parameters': [
                {'name': parameter, 'type': parameter_type(parameter), 'default': DEFAULTS.get(parameter, 0)}
                for parameter in spec.parameters
            ],
            'result_type': spec.result_type,
            'syntax': 'infix' if spec.syntax else 'function',
        }
        for name, spec in OPERATORS.items()
    ]


def expression_tree(node: Node | float | int) -> dict:
    if not isinstance(node, Node):
        return {'operation': 'number', 'arguments': [], 'value': node, 'result_type': 'number'}
    return {
        'operation': node.operation,
        'arguments': [expression_tree(argument) for argument in node.arguments],
        'value': node.value,
        'result_type': node.result_type,
    }
