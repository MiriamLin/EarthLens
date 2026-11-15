import { lazy, Suspense, useEffect, useId, useMemo, useRef, useState, type Dispatch, type FormEvent, type SetStateAction } from 'react'
import { SERIES_COLORS, seriesColor } from '../lib/palette'

const CompareChart = lazy(() => import('./CompareChart'))
import { fetchComparison, pairCorrelations, prepareComparison, type CompareResult, type CompareRow, type ComparisonCache } from '../lib/compare'
import type { DataOption } from '../data'
import DataDropZone from './DataDropZone'
import PeriodFields from './PeriodFields'
import LocationField, { DEFAULT_LOCATION, isValidLocation } from './LocationField'
import type { Temporal } from '../lib/series'
import ResultCard, { CardMessage, ExportButtons, MetaLine, Stat, TrendBadge } from './ResultCard'
import Alert from './Alert'
import { PlusIcon, TrashIcon, SpinnerIcon } from './Icons'
import Splitter, { useResizable } from './Splitter'
import ErrorBoundary from './ErrorBoundary'
import { usePersistentState } from '../lib/persist'
import { formatNumber, formatP, formatPeriod, formatTemporal } from '../lib/format'
import { downloadChartPng, downloadCsv } from '../lib/export'

type Props = {
  items: DataOption[]
  rows: CompareRow[]
  onChange: Dispatch<SetStateAction<CompareRow[]>>
}

function rowColor(index: number) {
  return SERIES_COLORS[index % SERIES_COLORS.length]
}

function Dot({ color }: { color: string }) {
  return <span aria-hidden="true" className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color }} />
}

function baseName(name: string) {
  return name.replace(/ \([^()]*\)$/, '')
}

function Results({ result, stale }: { result: CompareResult; stale: boolean }) {
  const chart = useRef<HTMLDivElement>(null)
  const comparison = useMemo(() => prepareComparison(result.series), [result.series])
  const order = useMemo(() => result.series.map((item) => item.key), [result.series])
  const correlations = useMemo(() => pairCorrelations(result.series), [result.series])
  const color = (key: string) => seriesColor(order, key)
  const topic = [...new Set(result.series.map((item) => baseName(item.name)))].join(' vs ')
  const period = formatPeriod(result.start, result.end, result.temporal)
  const temporal = formatTemporal(result.temporal)
  const scale = comparison.standardized ? 'Z-scores (units differ)' : comparison.units

  function exportCsv() {
    const dates = [...new Set(result.series.flatMap((item) => item.dates))].sort()
    const columns = result.series.map((item) => new Map(item.dates.map((date, index) => [date, item.values[index]])))
    downloadCsv(
      'earthlens-compare.csv',
      ['date', ...result.series.map((item) => `${item.name} (${item.units})`)],
      dates.map((date) => [date, ...columns.map((column) => column.get(date) ?? null)]),
    )
  }

  return (
    <ResultCard
      label="Comparison results"
      summary={(
        <>
          <h2 className="flex flex-wrap items-center gap-x-3 gap-y-1 text-base font-semibold text-ink">
            {topic}
            {stale && (
              <span className="inline-flex items-center gap-1 rounded-full border border-warning-line bg-warning-soft px-2 py-0.5 text-[11px] font-medium text-warning">
                Outdated
              </span>
            )}
          </h2>
          <MetaLine items={[`${result.series.length} series`, period, temporal, scale]} />
          <ul className="space-y-1.5 pt-1.5">
            {result.series.map((item) => (
              <li key={item.key} className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <span className="flex min-w-0 items-center gap-2 font-medium text-ink">
                  <Dot color={color(item.key)} />{item.name}
                </span>
                <TrendBadge p={item.statistics.p_value} />
                <Stat label="Slope" value={`${formatNumber(item.statistics.slope)} ${item.units}/yr`} />
                <Stat label="R²" value={formatNumber(item.statistics.r_squared)} />
                <Stat label="p" value={formatP(item.statistics.p_value)} />
                <Stat label="Valid / missing" value={`${item.statistics.count} / ${item.statistics.missing}`} />
              </li>
            ))}
          </ul>
          {correlations.length > 0 && (
            <p className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line pt-2">
              <span className="text-subtle">Correlation</span>
              {correlations.map((pair) => (
                <span key={`${pair.left}|${pair.right}`} className="flex items-center gap-1.5 whitespace-nowrap">
                  <span className="flex -space-x-0.5"><Dot color={color(pair.left)} /><Dot color={color(pair.right)} /></span>
                  <span className="font-medium text-ink tabular-nums">r = {formatNumber(pair.r)}</span>
                  <span className="text-subtle tabular-nums">n = {pair.n}</span>
                </span>
              ))}
            </p>
          )}
          {comparison.omitted.length > 0 && <p className="text-xs text-subtle">Constant series cannot be standardized: {comparison.omitted.join(', ')}.</p>}
        </>
      )}
      actions={comparison.series.length > 0 && (
        <ExportButtons
          onPng={() => downloadChartPng(chart.current, 'earthlens-compare.png', `${topic} · ${period} · ${temporal} · ${scale}`,
            comparison.series.map((item) => ({ label: item.name, color: color(item.key) })))}
          onCsv={exportCsv}
        />
      )}
    >
      {comparison.series.length > 0
        ? <div ref={chart} className="absolute inset-0 px-4 pt-4 pb-2"><Suspense fallback={null}><CompareChart comparison={comparison} order={order} /></Suspense></div>
        : <CardMessage>No comparable data is available for these selections.</CardMessage>}
    </ResultCard>
  )
}

export default function Compare({ items, rows, onChange }: Props) {
  const id = useId()
  const nextRowId = useRef(Math.max(...rows.map((row) => row.id)) + 1)
  const [temporal, setTemporal] = usePersistentState<Temporal>('earthlens.compare.temporal', 'monthly', (value) => value === 'daily' || value === 'monthly')
  const [start, setStart] = usePersistentState('earthlens.compare.start', '2001-01-01')
  const [end, setEnd] = usePersistentState('earthlens.compare.end', `${new Date().getFullYear() - 1}-12-31`)
  const [result, setResult] = useState<CompareResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [stale, setStale] = useState(false)
  const request = useRef<AbortController | null>(null)
  const cache = useRef<ComparisonCache>(new Map())
  const split = useResizable('earthlens.layout.compare.inputs', 'y', 300, 120, 200)
  const complete = rows.every((row) => row.key && isValidLocation(row.latitude, row.longitude))

  useEffect(() => {
    request.current?.abort()
    setStale(true)
    setError('')
    setLoading(false)
    return () => request.current?.abort()
  }, [rows, temporal, start, end])

  function updateRow(rowId: number, change: Partial<CompareRow>) {
    onChange((current) => current.map((row) => row.id === rowId ? { ...row, ...change } : row))
  }

  function addRow() {
    const rowId = nextRowId.current++
    onChange((current) => {
      const last = current[current.length - 1]
      return [...current, {
        id: rowId,
        key: '',
        latitude: last?.latitude || DEFAULT_LOCATION.latitude,
        longitude: last?.longitude || DEFAULT_LOCATION.longitude,
      }]
    })
  }

  function removeRow(rowId: number) {
    if (rows.length === 1) return
    onChange((current) => current.length > 1 ? current.filter((row) => row.id !== rowId) : current)
  }

  function cancel() {
    request.current?.abort()
    setLoading(false)
  }

  async function compare(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    setLoading(true)
    setError('')
    try {
      const data = await fetchComparison(rows, start, end, controller.signal, temporal, cache.current)
      if (!controller.signal.aborted) {
        setResult(data)
        setStale(false)
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        setError(error instanceof Error ? error.message : 'Unable to compare data.')
      }
    } finally {
      if (!controller.signal.aborted) setLoading(false)
    }
  }


  return (
    <section ref={split.container} aria-label="Compare workspace" className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden px-5 pt-4 pb-5">
      <form id={`${id}-form`} onSubmit={compare} style={split.style} className="card flex shrink-0 flex-col overflow-y-auto">
        <h2 className="px-5 pt-4 pb-3 text-base font-semibold text-ink">Data to compare</h2>
        <ol data-tour="cmp-rows" aria-label="Comparison data" className="divide-y divide-line border-y border-line">
          {rows.map((row, index) => (
            <li key={row.id} className="flex flex-wrap items-center gap-3 px-5 py-2.5">
              <span className="flex w-5 shrink-0 justify-center"><Dot color={rowColor(index)} /></span>
              <DataDropZone
                id={`${id}-data-${row.id}`}
                label={`Data ${index + 1}`}
                value={row.key}
                onChange={(key) => updateRow(row.id, { key })}
                items={items}
                className="h-9 min-w-48 flex-1"
              />
              <LocationField
                compact
                label={`Data ${index + 1} location`}
                latitude={row.latitude}
                longitude={row.longitude}
                onChange={(latitude, longitude) => updateRow(row.id, { latitude, longitude })}
              />
              <button
                type="button"
                aria-label={`Remove data ${index + 1}`}
                title="Remove"
                disabled={rows.length === 1}
                onClick={() => removeRow(row.id)}
                className="icon-btn icon-btn-danger disabled:invisible"
              >
                <TrashIcon />
              </button>
            </li>
          ))}
        </ol>
        <div className="px-5 pt-2">
          <button data-tour="cmp-add" type="button" onClick={addRow} className="btn btn-ghost btn-sm -ml-3">
            <PlusIcon size={15} />
            Add data
          </button>
        </div>
        <div data-tour="cmp-period" className="flex flex-wrap items-end gap-3 px-5 pt-3 pb-5">
          <PeriodFields
            temporal={temporal}
            start={start}
            end={end}
            onTemporalChange={setTemporal}
            onStartChange={setStart}
            onEndChange={setEnd}
          />
          {loading ? (
            <button type="button" onClick={cancel} className="btn btn-secondary"><SpinnerIcon size={15} />Cancel</button>
          ) : (
            <button type="submit" disabled={!complete} title={complete ? undefined : 'Every row needs data and a valid location'} className="btn btn-primary">Compare</button>
          )}
        </div>
      </form>
      <Splitter {...split.handle} label="Resize inputs and results" />
      <div data-tour="cmp-result" className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
        {result && error && <Alert className="shrink-0">{error}</Alert>}
        {result ? <ErrorBoundary label="Chart" resetKey={result}><Results result={result} stale={stale} /></ErrorBoundary> : (
          <ResultCard label="Comparison results">
            {error
              ? <CardMessage tone="error">{error}</CardMessage>
              : loading
                ? <CardMessage tone="loading">Loading NASA data…</CardMessage>
                : <CardMessage>No comparison yet</CardMessage>}
          </ResultCard>
        )}
      </div>
    </section>
  )
}
