import type { TimeSeriesData } from '../data'
import { fetchSeries, requestPeriod, type Temporal } from './series.ts'

type Input = Pick<TimeSeriesData, 'key' | 'name' | 'units' | 'dates' | 'values'>

export type CompareRow = {
  id: number
  key: string
  latitude: string
  longitude: string
}

export type CompareResult = {
  start: string
  end: string
  temporal: string
  sources: string[]
  series: TimeSeriesData[]
}

const MAX_PARALLEL_REQUESTS = 4

export type ComparisonCache = Map<string, { item: TimeSeriesData; sources: string[]; temporal?: string }>

export async function fetchComparison(
  rows: CompareRow[],
  start: string,
  end: string,
  signal: AbortSignal,
  temporal?: Temporal,
  cache?: ComparisonCache,
): Promise<CompareResult> {
  if (rows.length === 0 || rows.some((row) => !row.key || row.latitude === '' || row.longitude === '')) {
    throw new Error('Select data and a location for every row.')
  }
  const period = temporal ? requestPeriod(temporal, start, end) : { start, end }
  signal.throwIfAborted()
  const keyOf = (row: CompareRow) => JSON.stringify([row.key, Number(row.latitude), Number(row.longitude), period])
  const pending = new Map<string, CompareRow>()
  for (const row of rows) {
    const cacheKey = keyOf(row)
    if (!cache?.has(cacheKey) && !pending.has(cacheKey)) pending.set(cacheKey, row)
  }
  const loaded = new Map<string, NonNullable<ReturnType<ComparisonCache['get']>>>()
  const queue = [...pending.entries()]
  async function worker() {
    for (let next = queue.shift(); next; next = queue.shift()) {
      const [cacheKey, row] = next
      signal.throwIfAborted()
      let body
      try {
        body = await fetchSeries(row.key, {
          latitude: Number(row.latitude),
          longitude: Number(row.longitude),
          ...period,
        }, signal)
      } catch (error) {
        signal.throwIfAborted()
        throw new Error(`${row.key} (${row.latitude}, ${row.longitude}): ${error instanceof Error ? error.message : 'Unable to load data.'}`)
      }
      const item: TimeSeriesData | undefined = body.series?.[0]
      if (!item) throw new Error(`${row.key} (${row.latitude}, ${row.longitude}): No data returned.`)
      const entry = { item, sources: body.sources ?? [], temporal: body.temporal }
      loaded.set(cacheKey, entry)
      cache?.set(cacheKey, entry)
    }
  }
  await Promise.all(Array.from({ length: Math.min(MAX_PARALLEL_REQUESTS, queue.length) }, worker))
  const series: TimeSeriesData[] = []
  const sources = new Set<string>()
  let returnedTemporal: string | undefined
  for (const row of rows) {
    const entry = loaded.get(keyOf(row)) ?? cache?.get(keyOf(row))
    if (!entry) throw new Error(`${row.key} (${row.latitude}, ${row.longitude}): No data returned.`)
    returnedTemporal ??= entry.temporal
    series.push({
      ...entry.item,
      key: `${row.id}:${row.key}`,
      name: `${entry.item.name || row.key} (${row.latitude}, ${row.longitude})`,
    })
    for (const source of entry.sources) sources.add(source)
  }
  return {
    start: period.start,
    end: period.end,
    temporal: (returnedTemporal ?? temporal ?? 'daily').toUpperCase(),
    sources: [...sources],
    series,
  }
}

export function prepareComparison(input: Input[]) {
  const available = input.filter((item) => item.values.some((value) => value !== null && Number.isFinite(value)))
  const standardized = new Set(available.map((item) => item.units)).size > 1
  const dates = [...new Set(available.flatMap((item) => item.dates))].sort()
  const omitted: string[] = []
  const series = available.flatMap((item) => {
    const byDate = new Map(item.dates.map((date, index) => [date, item.values[index]]))
    let values = dates.map((date) => {
      const value = byDate.get(date)
      return value != null && Number.isFinite(value) ? value : null
    })
    if (standardized) {
      const valid = values.filter((value): value is number => value !== null)
      const mean = valid.reduce((sum, value) => sum + value, 0) / valid.length
      const deviation = valid.every((value) => value === valid[0])
        ? 0
        : Math.sqrt(valid.reduce((sum, value) => sum + (value - mean) ** 2, 0) / valid.length)
      if (deviation === 0) {
        omitted.push(item.name)
        return []
      }
      values = values.map((value) => value === null ? null : (value - mean) / deviation)
    }
    return [{ key: item.key, name: item.name, values }]
  })
  return { dates, series, standardized, units: standardized ? 'z-score' : available[0]?.units ?? '', omitted }
}

export function correlation(left: Input, right: Input) {
  const byDate = new Map(right.dates.map((date, index) => [date, right.values[index]]))
  const pairs: [number, number][] = []
  left.dates.forEach((date, index) => {
    const a = left.values[index]
    const b = byDate.get(date)
    if (a != null && b != null && Number.isFinite(a) && Number.isFinite(b)) pairs.push([a, b])
  })
  if (pairs.length < 3) return { r: null, n: pairs.length }
  const meanA = pairs.reduce((sum, [a]) => sum + a, 0) / pairs.length
  const meanB = pairs.reduce((sum, [, b]) => sum + b, 0) / pairs.length
  let covariance = 0
  let varianceA = 0
  let varianceB = 0
  for (const [a, b] of pairs) {
    covariance += (a - meanA) * (b - meanB)
    varianceA += (a - meanA) ** 2
    varianceB += (b - meanB) ** 2
  }
  const r = varianceA > 0 && varianceB > 0 ? covariance / Math.sqrt(varianceA * varianceB) : null
  return { r: r === null ? null : Math.max(-1, Math.min(1, r)), n: pairs.length }
}

export function pairCorrelations(input: Input[]) {
  return input.flatMap((left, index) => input.slice(index + 1).map((right) => ({
    left: left.key,
    right: right.key,
    ...correlation(left, right),
  })))
}
