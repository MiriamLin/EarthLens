import { useEffect, useState, type ReactNode } from 'react'
import type { DataMetadata, OperatorInfo } from '../data'
import { fetchJson } from '../lib/api'
import Alert from '../components/Alert'
import { ChevronDownIcon, FilterIcon, SearchIcon } from '../components/Icons'
import { BLOCK_CATEGORIES, blockCategory } from '../lib/formula'

type View = 'data' | 'functions'

function Entry({ title, badge, children }: { title: ReactNode; badge?: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <li>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface"
      >
        <h2 className="min-w-0 truncate text-sm font-medium text-ink">{title}</h2>
        {badge}
        <span className="flex-1" />
        <ChevronDownIcon className={`shrink-0 text-subtle transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div className="space-y-2 px-4 pb-4 text-sm leading-6 text-muted">{children}</div>}
    </li>
  )
}

export default function DataRegions() {
  const [data, setData] = useState<DataMetadata[]>([])
  const [operators, setOperators] = useState<OperatorInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [view, setView] = useState<View>('data')
  const [searches, setSearches] = useState({ data: '', functions: '' })
  const [showFilters, setShowFilters] = useState(false)
  const [filters, setFilters] = useState<Record<View, string[]>>({ data: [], functions: [] })

  useEffect(() => {
    const controller = new AbortController()

    async function loadData() {
      const results = await Promise.allSettled([
        fetchJson<DataMetadata[]>('/api/metadata', { signal: controller.signal }),
        fetchJson<OperatorInfo[]>('/api/operators', { signal: controller.signal }),
      ])
      if (controller.signal.aborted) return
      const [metadata, functions] = results
      if (metadata.status === 'fulfilled') setData(metadata.value)
      if (functions.status === 'fulfilled') setOperators(functions.value)
      setError(results.flatMap((result) => result.status === 'rejected'
        ? [result.reason instanceof Error ? result.reason.message : 'Unable to load data or functions.']
        : [],
      ).join(' '))
      setLoading(false)
    }

    void loadData()
    return () => controller.abort()
  }, [])

  const search = searches[view]
  const query = search.trim().toLowerCase()
  const selected = filters[view]
  const category = (item: OperatorInfo) => blockCategory(item.name, item.result_type)
  const options = view === 'data'
    ? [...new Set(data.map((item) => item.subtype).filter(Boolean))].map((subtype) => ({ id: subtype, label: subtype }))
    : BLOCK_CATEGORIES.filter((item) => operators.some((operator) => category(operator) === item.id))
  const matchingData = data
    .filter((item) => `${item.name} ${item.key} ${item.definition} ${item.units}`.toLowerCase().includes(query))
    .filter((item) => filters.data.length === 0 || filters.data.includes(item.subtype))
  const matchingOperators = operators
    .filter((item) => `${item.name} ${item.signature} ${item.definition}`.toLowerCase().includes(query))
    .filter((item) => filters.functions.length === 0 || filters.functions.includes(category(item)))
  const views = [
    { id: 'data', label: 'Data', count: data.length },
    { id: 'functions', label: 'Functions', count: operators.length },
  ] as const
  const empty = view === 'data' ? matchingData.length === 0 : matchingOperators.length === 0

  function toggleFilter(id: string) {
    setFilters((current) => ({
      ...current,
      [view]: current[view].includes(id) ? current[view].filter((item) => item !== id) : [...current[view], id],
    }))
  }

  return (
    <section aria-label="Data" className="flex min-h-0 flex-1 flex-col">
      <div className="mx-auto flex min-h-0 w-full max-w-4xl flex-1 flex-col gap-4 px-4 py-6 sm:px-6">
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
          <div data-tour="data-switch" role="group" aria-label="Show" className="flex rounded-lg border border-line bg-white p-1">
            {views.map((item) => (
              <button
                key={item.id}
                type="button"
                aria-pressed={view === item.id}
                onClick={() => setView(item.id)}
                className={`flex cursor-pointer items-center gap-2 rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${view === item.id ? 'bg-navy text-white' : 'text-muted hover:text-ink'}`}
              >
                {item.label}
                <span className={`tabular-nums ${view === item.id ? 'text-white/70' : 'text-subtle'}`}>{item.count}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          <label data-tour="data-search" className="relative min-w-0 flex-1">
            <span className="sr-only">{view === 'data' ? 'Search data' : 'Search functions'}</span>
            <SearchIcon className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-subtle" />
            <input
              type="search"
              placeholder={view === 'data' ? 'Search name, code or description' : 'Search name or description'}
              value={search}
              onChange={(event) => setSearches((current) => ({ ...current, [view]: event.target.value }))}
              className="field w-full pl-9"
            />
          </label>
          <button
            type="button"
            aria-expanded={showFilters}
            data-tour="data-filter"
            aria-controls="data-filters"
            onClick={() => setShowFilters((show) => !show)}
            className={`btn btn-secondary ${selected.length ? 'border-navy text-navy' : ''}`}
          >
            <FilterIcon />
            Filter
            {selected.length > 0 && <span className="rounded-full bg-navy px-1.5 text-xs leading-5 text-white tabular-nums">{selected.length}</span>}
          </button>
        </div>
        {showFilters && (
          <div id="data-filters" role="group" aria-label={view === 'data' ? 'Data subtypes' : 'Function categories'} className="flex shrink-0 flex-wrap items-center gap-2">
            {options.map((option) => {
              const active = selected.includes(option.id)
              return (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => toggleFilter(option.id)}
                  className={`cursor-pointer rounded-full border px-3 py-1 text-[13px] font-medium transition-colors ${active ? 'border-navy bg-navy text-white' : 'border-line bg-white text-muted hover:border-navy-line hover:text-ink'}`}
                >
                  {option.label}
                </button>
              )
            })}
            {selected.length > 0 && (
              <button type="button" onClick={() => setFilters((current) => ({ ...current, [view]: [] }))} className="btn btn-ghost btn-sm">
                Clear filters
              </button>
            )}
          </div>
        )}
        {error && <Alert className="shrink-0">{error}</Alert>}
        <div data-tour="data-list" className="card flex min-h-0 flex-1 flex-col overflow-hidden">
          {loading ? (
            <p className="p-6 text-center text-sm text-subtle">Loading…</p>
          ) : empty ? (
            <div className="p-10 text-center">
              <p className="text-sm text-muted">No matches</p>
            </div>
          ) : (
            <ul aria-label={view === 'data' ? 'Data' : 'Functions'} tabIndex={0} className="min-h-0 flex-1 divide-y divide-line overflow-y-auto">
              {view === 'data' ? matchingData.map((item) => (
                <Entry
                  key={item.key}
                  title={item.name}
                  badge={<code className="shrink-0 rounded bg-navy-soft px-1.5 py-0.5 font-mono text-xs text-navy">{item.key}</code>}
                >
                  <p>{item.definition}</p>
                  <p className="flex flex-wrap gap-2">
                    {item.units && <span className="rounded-full bg-surface px-2.5 py-0.5 text-xs text-muted">Units · {item.units}</span>}
                    {item.subtype && <span className="rounded-full bg-surface px-2.5 py-0.5 text-xs text-muted">{item.subtype}</span>}
                  </p>
                </Entry>
              )) : matchingOperators.map((item) => (
                <Entry key={`operator-${item.name}`} title={<code className="font-mono text-[13px]">{item.signature}</code>}>
                  <p>{item.definition}</p>
                </Entry>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  )
}
