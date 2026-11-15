import assert from 'node:assert/strict'
import test from 'node:test'
import { fetchSeries } from '../src/lib/series.ts'

const selection = { latitude: 25, longitude: 121.5, start: '2024-01-01', end: '2024-03-31' }

test('raw data and formulas use their own API with the selected location, dates and temporal', async (t) => {
  const requests = []
  const result = { temporal: 'MONTHLY', series: [{ values: [1, 2, 3] }] }
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push({ url, body: JSON.parse(options.body), signal: options.signal })
    return { ok: true, json: async () => result }
  })
  const signal = new AbortController().signal
  for (const data of ['T2M', 'ts_mean(T2M, 3)', 'T2M / 2']) {
    assert.deepEqual(await fetchSeries(data, { ...selection, temporal: 'monthly' }, signal), result)
  }
  assert.equal(requests[0].url, '/api/timeseries')
  assert.deepEqual(requests[0].body, { ...selection, temporal: 'monthly', keys: ['T2M'] })
  for (const [index, expression] of ['ts_mean(T2M, 3)', 'T2M / 2'].entries()) {
    assert.equal(requests[index + 1].url, '/api/expression')
    assert.deepEqual(requests[index + 1].body, { ...selection, temporal: 'monthly', expression })
    assert.equal(requests[index + 1].signal, signal)
  }
})

test('formula and request validation errors are shown to the user', async (t) => {
  for (const detail of ['Unknown operator: ts_unknown.', [{ msg: 'Invalid formula syntax.' }]]) {
    t.mock.method(globalThis, 'fetch', async () => ({ ok: false, json: async () => ({ detail }) }))
    await assert.rejects(fetchSeries('ts_unknown(T2M)', selection, new AbortController().signal),
      new RegExp(typeof detail === 'string' ? 'Unknown operator' : 'Invalid formula'))
  }
})
