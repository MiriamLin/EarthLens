import type { TimeSeriesResult } from '../data.ts'
import { fetchJson } from './api.ts'
import { monthEnd } from './sound.ts'

export type Temporal = 'daily' | 'monthly'

export type SeriesSelection = {
  latitude: number
  longitude: number
  start: string
  end: string
  temporal?: Temporal
}

export function requestPeriod(temporal: Temporal, start: string, end: string) {
  const today = new Date().toISOString().slice(0, 10)
  const last = temporal === 'monthly' ? monthEnd(end.slice(0, 7)) : end
  return {
    start: temporal === 'monthly' ? `${start.slice(0, 7)}-01` : start,
    end: last > today ? today : last,
    temporal,
  }
}

export function isDataKey(value: string) {
  return /^[A-Za-z_]\w*$/.test(value)
}

const CACHE_MS = 30 * 60 * 1000
const CACHE_ENABLED = typeof window !== 'undefined'
const CACHE_SIZE = 40
const cache = new Map<string, { time: number; result: TimeSeriesResult }>()

export function clearSeriesCache() {
  cache.clear()
}

export async function fetchSeries(data: string, selection: SeriesSelection, signal: AbortSignal): Promise<TimeSeriesResult> {
  const raw = isDataKey(data)
  const url = raw ? '/api/timeseries' : '/api/expression'
  const body = JSON.stringify({ ...selection, ...(raw ? { keys: [data] } : { expression: data }) })
  const key = `${url} ${body}`
  const hit = CACHE_ENABLED ? cache.get(key) : undefined
  if (hit && Date.now() - hit.time < CACHE_MS) {
    signal.throwIfAborted()
    return hit.result
  }
  const result = await fetchJson<TimeSeriesResult>(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body,
  })
  if (!CACHE_ENABLED) return result
  cache.delete(key)
  cache.set(key, { time: Date.now(), result })
  while (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value as string)
  return result
}
