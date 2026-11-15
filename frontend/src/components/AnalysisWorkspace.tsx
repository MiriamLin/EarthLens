import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react'
import type { DataMetadata, TimeSeriesResult } from '../data'
import { fetchSeries, requestPeriod, type Temporal } from '../lib/series'
import { fetchJson } from '../lib/api'
import PeriodFields from './PeriodFields'
import LocationField, { DEFAULT_LOCATION, isValidLocation } from './LocationField'
import FormulaEditor from './FormulaEditor'
import ResultCard, { CardMessage, PanelToggle } from './ResultCard'
import Splitter, { useResizable } from './Splitter'
import { GUIDE_EVENT } from './Guide'
import ErrorBoundary from './ErrorBoundary'
import { usePersistentState } from '../lib/persist'
import { AlertIcon, CheckIcon, WarningIcon, SpinnerIcon } from './Icons'

type Props = {
  title: string
  data: DataMetadata[]
  onSave: (expression: string) => boolean
  children: (result: TimeSeriesResult) => ReactNode
}

type SaveStatus = { kind: 'saved' | 'duplicate' | 'error'; message: string }

const STATUS = {
  saved: { color: 'text-[#8fdcb3]', Icon: CheckIcon },
  duplicate: { color: 'text-[#f7c86a]', Icon: WarningIcon },
  error: { color: 'text-[#ffb4a6]', Icon: AlertIcon },
}

export default function AnalysisWorkspace({ title, data, onSave, children }: Props) {
  const id = useId()
  const [latitude, setLatitude] = usePersistentState('earthlens.timeSeries.latitude', DEFAULT_LOCATION.latitude)
  const [longitude, setLongitude] = usePersistentState('earthlens.timeSeries.longitude', DEFAULT_LOCATION.longitude)
  const [temporal, setTemporal] = usePersistentState<Temporal>('earthlens.timeSeries.temporal', 'monthly', (value) => value === 'daily' || value === 'monthly')
  const [start, setStart] = usePersistentState('earthlens.timeSeries.start', '2001-01-01')
  const [end, setEnd] = usePersistentState('earthlens.timeSeries.end', `${new Date().getFullYear() - 1}-12-31`)
  const [expression, setExpression] = usePersistentState('earthlens.timeSeries.expression', '')
  const [result, setResult] = useState<TimeSeriesResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState<SaveStatus | null>(null)
  const [error, setError] = useState('')
  const [formulaOpen, setFormulaOpen] = useState(true)
  const request = useRef<AbortController | null>(null)
  const saveRequest = useRef<AbortController | null>(null)
  const located = isValidLocation(latitude, longitude)
  const rows = useResizable('earthlens.layout.timeSeries.settings', 'y', 96, 56, 240)
  const columns = useResizable('earthlens.layout.timeSeries.formula', 'x', 380, 260, 300)

  useEffect(() => {
    request.current?.abort()
    setResult(null)
    setError('')
    setLoading(false)
    return () => request.current?.abort()
  }, [latitude, longitude, temporal, start, end, expression])

  useEffect(() => {
    function follow(event: Event) {
      if ((event as CustomEvent<string>).detail === 'open-formula') setFormulaOpen(true)
    }
    window.addEventListener(GUIDE_EVENT, follow)
    return () => window.removeEventListener(GUIDE_EVENT, follow)
  }, [])

  useEffect(() => {
    saveRequest.current?.abort()
    setSaving(false)
    setSaveStatus(null)
    return () => saveRequest.current?.abort()
  }, [expression])

  async function save() {
    saveRequest.current?.abort()
    const controller = new AbortController()
    saveRequest.current = controller
    setSaving(true)
    setSaveStatus(null)
    try {
      const body = await fetchJson<{ expression: string }>('/api/expression/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({ expression }),
      })
      if (!controller.signal.aborted) {
        setSaveStatus(onSave(body.expression)
          ? { kind: 'saved', message: 'Saved' }
          : { kind: 'duplicate', message: 'Already saved' })
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        setSaveStatus({ kind: 'error', message: `Error: ${error instanceof Error ? error.message : 'Unable to save formula.'}` })
      }
    } finally {
      if (!controller.signal.aborted) setSaving(false)
    }
  }

  function cancel() {
    request.current?.abort()
    setLoading(false)
  }

  async function analyze(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!located) {
      setError('Enter a valid latitude (−90 to 90) and longitude (−180 to 180).')
      return
    }
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    setLoading(true)
    setError('')
    setResult(null)
    try {
      const body = await fetchSeries(expression.trim(), {
        latitude: Number(latitude),
        longitude: Number(longitude),
        ...requestPeriod(temporal, start, end),
      }, controller.signal)
      if (!controller.signal.aborted) {
        setResult(body)
        setFormulaOpen(false)
      }
    } catch (error) {
      if (!controller.signal.aborted) setError(error instanceof Error ? error.message : 'Unable to analyze data.')
    } finally {
      if (!controller.signal.aborted) setLoading(false)
    }
  }

  const toggle = <PanelToggle open={formulaOpen} label="formula" onToggle={() => setFormulaOpen((open) => !open)} tone="dark" />
  const buttons = (
    <>
      {loading ? (
        <button type="button" onClick={cancel} className="btn btn-light"><SpinnerIcon size={15} />Cancel</button>
      ) : (
        <button type="submit" form={`${id}-form`} disabled={!expression.trim() || !located} className="btn btn-light">Generate</button>
      )}
      <button type="button" onClick={() => void save()} disabled={saving || !expression.trim()} className="btn btn-outline-light">
        {saving ? 'Saving…' : 'Save'}
      </button>
      {saveStatus && (() => {
        const { color, Icon } = STATUS[saveStatus.kind]
        return (
          <p role="status" className={`flex min-w-0 items-center gap-1.5 text-sm ${color}`}>
            <Icon size={15} className="shrink-0" />
            <span className="min-w-0">{saveStatus.message}</span>
          </p>
        )
      })()}
    </>
  )

  return (
    <section ref={rows.container} aria-label={`${title} workspace`} className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden px-5 pt-4 pb-5">
      <form data-tour="ts-settings" id={`${id}-form`} onSubmit={analyze} style={rows.style} className="shrink-0 overflow-y-auto">
        <div className="flex flex-wrap items-end gap-3 pb-2">
          <LocationField latitude={latitude} longitude={longitude} onChange={(lat, lon) => { setLatitude(lat); setLongitude(lon) }} />
          <PeriodFields
            temporal={temporal}
            start={start}
            end={end}
            onTemporalChange={setTemporal}
            onStartChange={setStart}
            onEndChange={setEnd}
          />
        </div>
      </form>
      <Splitter {...rows.handle} label="Resize settings and results" />
      <div ref={columns.container} className="flex min-h-0 min-w-0 flex-1">
        <section
          data-tour="ts-formula"
          aria-label="Formula editor"
          style={columns.style}
          className={`${formulaOpen ? 'flex' : 'hidden'} min-w-0 shrink-0 flex-col overflow-hidden rounded-xl bg-navy p-4 text-white shadow-sm`}
        >
          <ErrorBoundary label="Formula editor">
            <FormulaEditor
              id={`${id}-expression`}
              form={`${id}-form`}
              data={data}
              value={expression}
              onChange={setExpression}
              headerAction={toggle}
              actions={buttons}
            />
          </ErrorBoundary>
        </section>
        {formulaOpen && <Splitter {...columns.handle} label="Resize formula and results" />}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
          {!formulaOpen && (
            <section data-tour="ts-formula" aria-label="Formula" className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 rounded-xl bg-navy px-4 py-2.5 text-white shadow-sm">
              <span className="eyebrow shrink-0 text-white/60">Formula</span>
              <code className="min-w-0 flex-1 basis-40 truncate font-mono text-sm" title={expression}>{expression || '—'}</code>
              <div data-tour="ts-actions" className="ml-auto flex shrink-0 flex-wrap items-center gap-2 text-sm">
                {buttons}
                {toggle}
              </div>
            </section>
          )}
          <Results result={result} loading={loading} error={error}>{children}</Results>
        </div>
      </div>
    </section>
  )
}

function Results({ result, loading, error, children }: {
  result: TimeSeriesResult | null
  loading: boolean
  error: string
  children: (result: TimeSeriesResult) => ReactNode
}) {
  return (
    <div data-tour="ts-result" className="flex min-h-0 min-w-0 flex-1">
      {result ? <ErrorBoundary label="Chart" resetKey={result}>{children(result)}</ErrorBoundary> : (
        <ResultCard label="Time series results">
          {error
            ? <CardMessage tone="error">{error}</CardMessage>
            : loading
              ? <CardMessage tone="loading">Loading NASA data…</CardMessage>
              : <CardMessage>No chart yet</CardMessage>}
        </ResultCard>
      )}
    </div>
  )
}
