export function formatNumber(value: number | null | undefined) {
  return value === null || value === undefined || !Number.isFinite(value) ? '—' : Number(value.toPrecision(4)).toString()
}

export function formatP(value: number | null) {
  if (value === null || !Number.isFinite(value)) return '—'
  return value < 0.0001 ? '< 0.0001' : formatNumber(value)
}

export function isMonthly(temporal: string) {
  return temporal.toLowerCase() === 'monthly'
}

export function formatTemporal(temporal: string) {
  return isMonthly(temporal) ? 'Monthly' : 'Daily'
}

export function formatPeriod(start: string, end: string, temporal: string) {
  const date = (value: string) => (isMonthly(temporal) ? value.slice(0, 7) : value.slice(0, 10)).replaceAll('-', '/')
  return `${date(start)} – ${date(end)}`
}
