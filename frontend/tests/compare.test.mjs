import assert from 'node:assert/strict'
import test from 'node:test'
import { fetchComparison, prepareComparison } from '../src/lib/compare.ts'

function series(key, units, values, dates = ['2024-01-01', '2024-01-02', '2024-01-03']) {
  return { key, name: key, units, values, dates }
}

test('same units retain raw values and align missing dates', () => {
  const result = prepareComparison([
    series('A', 'C', [1, 3], ['2024-01-01', '2024-01-03']),
    series('B', 'C', [2, 4], ['2024-01-02', '2024-01-03']),
  ])
  assert.equal(result.standardized, false)
  assert.equal(result.units, 'C')
  assert.deepEqual(result.dates, ['2024-01-01', '2024-01-02', '2024-01-03'])
  assert.deepEqual(result.series[0].values, [1, null, 3])
  assert.deepEqual(result.series[1].values, [null, 2, 4])
})

test('different units use population z-scores without changing input', () => {
  const input = [series('A', 'C', [1, 2, 3]), series('B', '%', [10, 20, 30])]
  const original = structuredClone(input)
  const result = prepareComparison(input)
  assert.equal(result.standardized, true)
  assert.equal(result.units, 'z-score')
  const expected = [-Math.sqrt(1.5), 0, Math.sqrt(1.5)]
  for (const item of result.series) {
    item.values.forEach((value, index) => assert.ok(Math.abs(value - expected[index]) < 1e-12))
  }
  assert.deepEqual(input, original)
})

test('missing and nonfinite values remain gaps during standardization', () => {
  const result = prepareComparison([
    series('A', 'C', [1, null, 3]),
    series('B', '%', [10, Infinity, 30]),
  ])
  assert.deepEqual(result.series[0].values, [-1, null, 1])
  assert.deepEqual(result.series[1].values, [-1, null, 1])
})

test('constant series are omitted only when standardization is required', () => {
  const raw = prepareComparison([series('A', 'C', [7, 7, 7]), series('B', 'C', [1, 2, 3])])
  assert.deepEqual(raw.series[0].values, [7, 7, 7])
  const normalized = prepareComparison([series('A', 'C', [7, 7, 7]), series('B', '%', [1, 2, 3])])
  assert.deepEqual(normalized.omitted, ['A'])
  assert.deepEqual(normalized.series.map((item) => item.key), ['B'])
  const decimal = prepareComparison([series('A', 'C', [0.1, 0.1, 0.1]), series('B', '%', [1, 2, 3])])
  assert.deepEqual(decimal.omitted, ['A'])
})

test('empty data does not invent values or units', () => {
  const result = prepareComparison([series('A', 'C', [null, null, null])])
  assert.deepEqual(result.dates, [])
  assert.deepEqual(result.series, [])
  assert.equal(result.units, '')
})

function payload() {
  return {
    sources: ['MERRA2'],
    series: [{
      ...series('T2M', 'C', [1, 2, 3]),
      trend: [1, 2, 3],
      statistics: { count: 3, missing: 0, slope: 365.2425, intercept: 1, r_squared: 1, p_value: 0 },
      note: '',
    }],
  }
}

test('one comparison row can load and plot data', async (t) => {
  const requests = []
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    requests.push(JSON.parse(options.body))
    return { ok: true, json: async () => payload() }
  })
  const result = await fetchComparison([
    { id: 1, key: 'T2M', latitude: '25.0330', longitude: '121.5654' },
  ], '2024-01-01', '2024-01-03', new AbortController().signal)
  assert.equal(requests.length, 1)
  assert.deepEqual(requests[0], { keys: ['T2M'], latitude: 25.033, longitude: 121.5654, start: '2024-01-01', end: '2024-01-03' })
  assert.equal(prepareComparison(result.series).series.length, 1)
})

test('the same variable at different locations retains distinct rows', async (t) => {
  const requests = []
  t.mock.method(globalThis, 'fetch', async (_url, options) => {
    requests.push(JSON.parse(options.body))
    return { ok: true, json: async () => payload() }
  })
  const result = await fetchComparison([
    { id: 1, key: 'T2M', latitude: '25', longitude: '121.5' },
    { id: 2, key: 'T2M', latitude: '51.5', longitude: '-0.1' },
  ], '2024-01-01', '2024-01-03', new AbortController().signal)
  assert.equal(requests.length, 2)
  assert.equal(requests[0].latitude, 25)
  assert.equal(requests[1].latitude, 51.5)
  assert.deepEqual(result.series.map((item) => item.key), ['1:T2M', '2:T2M'])
  assert.ok(result.series[0].name.includes('25, 121.5'))
  assert.ok(result.series[1].name.includes('51.5, -0.1'))
  assert.deepEqual(result.sources, ['MERRA2'])
})

test('incomplete and cancelled comparisons do not request data', async (t) => {
  const fetch = t.mock.method(globalThis, 'fetch')
  await assert.rejects(fetchComparison([
    { id: 1, key: 'T2M', latitude: '', longitude: '' },
  ], '2024-01-01', '2024-01-03', new AbortController().signal), /every row/)
  await assert.rejects(fetchComparison([], '2024-01-01', '2024-01-03', new AbortController().signal), /every row/)
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(fetchComparison([
    { id: 1, key: 'T2M', latitude: '25', longitude: '121.5' },
  ], '2024-01-01', '2024-01-03', controller.signal), { name: 'AbortError' })
  assert.equal(fetch.mock.callCount(), 0)
})

test('a formula can be compared with raw data at different locations', async (t) => {
  const requests = []
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push({ url, body: JSON.parse(options.body) })
    return { ok: true, json: async () => payload() }
  })
  const formula = 'ts_mean(T2M, 7)'
  const result = await fetchComparison([
    { id: 1, key: formula, latitude: '25', longitude: '121.5' },
    { id: 2, key: 'T2M', latitude: '51.5', longitude: '-0.1' },
  ], '2024-01-01', '2024-01-03', new AbortController().signal)
  assert.equal(requests[0].url, '/api/expression')
  assert.equal(requests[0].body.expression, formula)
  assert.equal(requests[1].url, '/api/timeseries')
  assert.deepEqual(result.series.map((item) => item.key), [`1:${formula}`, '2:T2M'])
})
