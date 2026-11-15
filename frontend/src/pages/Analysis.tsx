import { lazy, Suspense, useEffect, useId, useState } from 'react'
import { SAVED_DATA_DRAG_TYPE, readSavedFormulas, type DataMetadata } from '../data'
import TimeSeries from '../components/TimeSeries'
import Compare from '../components/Compare'

const WorldMap = lazy(() => import('../components/WorldMap'))
import Sound from '../components/Sound'
import type { CompareRow } from '../lib/compare'
import DataDropZone from '../components/DataDropZone'
import { DEFAULT_LOCATION } from '../components/LocationField'
import { fetchJson } from '../lib/api'
import { usePersistentState } from '../lib/persist'
import Alert from '../components/Alert'
import ErrorBoundary from '../components/ErrorBoundary'
import { GripIcon, PanelIcon, TrashIcon } from '../components/Icons'

const tools = ['Time Series', 'Compare', 'Map', 'Sound'] as const
export type AnalysisTool = (typeof tools)[number]

const TOOL_ICONS: Record<AnalysisTool, string> = {
  'Time Series': 'M3 3v18h18M7 15l4-4 3 3 6-6',
  Compare: 'M3 3v18h18M7 16l4-6 4 3 5-7M7 12l4 2 4-4 5 3',
  Map: 'M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14',
  Sound: 'M9 18V5l12-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM21 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
}

function ToolIcon({ tool }: { tool: AnalysisTool }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d={TOOL_ICONS[tool]} />
    </svg>
  )
}

function isCompareRows(value: unknown) {
  return Array.isArray(value) && value.length > 0 && value.every((row) => typeof row?.id === 'number'
    && typeof row.key === 'string' && typeof row.latitude === 'string' && typeof row.longitude === 'string')
}

export default function Analysis({ active, onToolChange }: { active: boolean; onToolChange?: (tool: AnalysisTool) => void }) {
  const [tool, setTool] = usePersistentState<AnalysisTool>('earthlens.tool', 'Time Series', (value) => tools.includes(value as AnalysisTool) && value !== 'Map')

  useEffect(() => {
    onToolChange?.(tool)
  }, [tool, onToolChange])
  const [data, setData] = useState<DataMetadata[]>([])
  const [formulas, setFormulas] = useState(readSavedFormulas)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [mapKey, setMapKey] = useState('')
  const [savedOpen, setSavedOpen] = usePersistentState('earthlens.savedOpen', true)
  const id = useId()
  const [compareRows, setCompareRows] = usePersistentState<CompareRow[]>('earthlens.compare.rows', [
    { id: 1, key: '', latitude: DEFAULT_LOCATION.latitude, longitude: DEFAULT_LOCATION.longitude },
  ], isCompareRows)

  useEffect(() => {
    localStorage.setItem('earthlens.formulas', JSON.stringify(formulas))
  }, [formulas])

  useEffect(() => {
    const controller = new AbortController()

    async function loadData() {
      try {
        const metadata = await fetchJson<DataMetadata[]>('/api/metadata', { signal: controller.signal })
        if (!controller.signal.aborted) setData(metadata)
      } catch (error) {
        if (!controller.signal.aborted) {
          setError(error instanceof Error ? error.message : 'Unable to load data.')
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }

    void loadData()
    return () => controller.abort()
  }, [])

  const items = formulas.map((formula) => ({
    key: formula,
    name: data.find((item) => item.key === formula)?.name || formula,
  }))

  function saveFormula(expression: string) {
    if (formulas.includes(expression)) return false
    setFormulas((current) => current.includes(expression) ? current : [...current, expression])
    return true
  }

  function removeFormula(expression: string) {
    setFormulas((current) => current.filter((item) => item !== expression))
  }

  const needsFormula = !loading && !error && tool !== 'Time Series' && items.length === 0

  return (
    <section aria-label="Analysis" className="flex min-h-0 min-w-0 flex-1">
      <nav aria-label="Analysis tools" className="flex w-[76px] shrink-0 flex-col gap-1 overflow-y-auto border-r border-line bg-white p-2">
        {tools.filter((name) => name !== 'Map').map((name) => (
          <button
            key={name}
            type="button"
            aria-pressed={tool === name}
            onClick={() => setTool(name)}
            className={`flex cursor-pointer flex-col items-center gap-1 rounded-lg px-1 py-2.5 text-[11px] leading-tight font-medium transition-colors ${tool === name ? 'bg-navy text-white' : 'text-muted hover:bg-navy-soft hover:text-navy'}`}
          >
            <ToolIcon tool={name} />
            {name}
          </button>
        ))}
      </nav>
      <div className="flex min-h-0 min-w-0 flex-1">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {(loading || error || needsFormula) && (
            <div className="shrink-0 px-4 pt-4">
              {loading && <p className="text-sm text-subtle">Loading data…</p>}
              {error && <Alert>{error}</Alert>}
              {needsFormula && <Alert tone="info">Save a formula in Time Series first.</Alert>}
            </div>
          )}
          <div className={tool === 'Time Series' ? 'flex min-h-0 min-w-0 flex-1' : 'hidden'}>
            <ErrorBoundary label="Time Series">
              <TimeSeries data={data} onSave={saveFormula} />
            </ErrorBoundary>
          </div>
          <div className={tool === 'Compare' ? 'flex min-h-0 min-w-0 flex-1' : 'hidden'}>
            <ErrorBoundary label="Compare">
              <Compare items={items} rows={compareRows} onChange={setCompareRows} />
            </ErrorBoundary>
          </div>
          <div className={tool === 'Sound' ? 'flex min-h-0 min-w-0 flex-1' : 'hidden'}>
            <ErrorBoundary label="Sound">
              <Sound items={items} active={active && tool === 'Sound'} />
            </ErrorBoundary>
          </div>
          {tool === 'Map' && (
            <section aria-label={`${tool} workspace`} className="flex min-h-0 min-w-0 flex-1 flex-col">
              <label className="flex flex-col gap-1 p-3">
                Data
                <DataDropZone value={mapKey} onChange={setMapKey} items={items} />
              </label>
              <Suspense fallback={null}><WorldMap dataKey={mapKey} /></Suspense>
            </section>
          )}
        </div>
        <aside data-tour="saved" aria-label="Saved formulas" className={`flex min-h-0 shrink-0 flex-col border-l border-line bg-white ${savedOpen ? 'w-64 max-w-[32%]' : 'w-auto'}`}>
          <div className="flex shrink-0 items-center gap-1 px-4 pt-4 pb-2">
            {savedOpen && (
              <h2 className="flex-1 text-sm font-semibold text-ink">
                Saved formulas <span className="font-normal text-subtle tabular-nums">{formulas.length}</span>
              </h2>
            )}
            {savedOpen && formulas.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  if (window.confirm('Clear all saved formulas?')) setFormulas([])
                }}
                className="btn btn-sm text-muted hover:bg-danger-soft hover:text-danger"
              >
                Clear
              </button>
            )}
            <button
              type="button"
              aria-expanded={savedOpen}
              aria-controls={`${id}-saved`}
              aria-label={savedOpen ? 'Collapse saved formulas' : 'Expand saved formulas'}
              title={savedOpen ? 'Collapse' : 'Expand'}
              onClick={() => setSavedOpen((open) => !open)}
              className="icon-btn"
            >
              <PanelIcon />
            </button>
          </div>
          <ErrorBoundary label="Saved formulas">
          <div id={`${id}-saved`} hidden={!savedOpen} className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
            {items.length === 0 ? (
              <div className="rounded-lg border border-dashed border-line px-4 py-6 text-center">
                <p className="text-sm text-muted">No saved formulas</p>
              </div>
            ) : (
              <>
                <ul className="space-y-1.5">
                  {items.map((item) => (
                    <li
                      key={item.key}
                      draggable
                      onDragStart={(event) => {
                        event.dataTransfer.setData(SAVED_DATA_DRAG_TYPE, item.key)
                        event.dataTransfer.effectAllowed = 'copy'
                      }}
                      className="group flex cursor-grab items-center gap-2 rounded-lg border border-line bg-white py-2 pr-1 pl-2 transition-colors hover:border-navy-line hover:bg-navy-soft/60 active:cursor-grabbing"
                    >
                      <GripIcon className="shrink-0 text-subtle group-hover:text-navy" />
                      <span className="scroll-x-thin min-w-0 flex-1 overflow-x-auto pb-0.5 whitespace-nowrap" title={item.name}>
                        <span className="block text-sm font-medium text-ink">{item.name}</span>
                        {item.name !== item.key && <code className="block font-mono text-[11px] text-subtle">{item.key}</code>}
                      </span>
                      <button
                        type="button"
                        draggable={false}
                        aria-label={`Delete ${item.name}`}
                        title="Delete"
                        onClick={() => removeFormula(item.key)}
                        className="icon-btn icon-btn-danger opacity-60 group-hover:opacity-100"
                      >
                        <TrashIcon />
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
          </ErrorBoundary>
        </aside>
      </div>
    </section>
  )
}
