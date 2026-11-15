export type DataMetadata = {
  key: string
  type: string
  subtype: string
  temporal: string
  name: string
  definition: string
  units: string
}

export type OperatorInfo = {
  name: string
  signature: string
  definition: string
  parameters: { name: string; type: 'number' | 'boolean' | 'literal'; default: number }[]
  result_type: 'number' | 'boolean'
  syntax: 'infix' | 'function'
}

export type DataOption = Pick<DataMetadata, 'key' | 'name'>

export const SAVED_DATA_DRAG_TYPE = 'application/x-earthlens-data'

export type TimeSeriesData = {
  key: string
  name: string
  units: string
  dates: string[]
  values: (number | null)[]
  trend: (number | null)[]
  statistics: {
    count: number
    missing: number
    slope: number | null
    intercept: number | null
    r_squared: number | null
    p_value: number | null
  }
  note: string
}

export type TimeSeriesResult = {
  latitude: number
  longitude: number
  start: string
  end: string
  temporal: string
  time_standard: string
  sources: string[]
  series: TimeSeriesData[]
}

export const DEFAULT_FORMULAS = ['ts_mean(ts_anomaly(T2M, 1991, 2020), 12)', 'PRECTOTCORR']

export function readSavedFormulas(): string[] {
  const formulas = readList('earthlens.formulas')
  const legacy = readList('earthlens.selectedDataKeys')
  if (!legacy.length) return formulas.length ? formulas : DEFAULT_FORMULAS
  const merged = [...new Set([...legacy, ...formulas])]
  try {
    localStorage.setItem('earthlens.formulas', JSON.stringify(merged))
    localStorage.removeItem('earthlens.selectedDataKeys')
  } catch {
    return merged
  }
  return merged
}

function readList(storageKey: string): string[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(storageKey) ?? '[]')
    return Array.isArray(saved) && saved.every((key) => typeof key === 'string') ? saved : []
  } catch {
    return []
  }
}
