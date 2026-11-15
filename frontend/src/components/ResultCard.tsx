import type { ReactNode } from 'react'
import Alert from './Alert'
import { ChartIcon, ChevronDownIcon, ChevronUpIcon, DownloadIcon } from './Icons'

type Props = {
  label: string
  summary?: ReactNode
  actions?: ReactNode
  toggle?: ReactNode
  children: ReactNode
}

export default function ResultCard({ label, summary, actions, toggle, children }: Props) {
  return (
    <section aria-label={label} className="card flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
      {(summary || actions || toggle) && (
        <header className="flex items-start gap-4 border-b border-line px-5 py-4">
          <div className="min-w-0 flex-1 space-y-1.5 text-sm">{summary}</div>
          <div className="flex shrink-0 items-center gap-1">
            {actions}
            {toggle}
          </div>
        </header>
      )}
      <div className="relative min-h-[22rem] flex-1">{children}</div>
    </section>
  )
}

export function CardMessage({ children, tone = 'muted', hint }: { children: ReactNode; tone?: 'muted' | 'error' | 'loading'; hint?: ReactNode }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center p-8">
      {tone === 'error' ? (
        <Alert className="max-w-md">{children}</Alert>
      ) : (
        <div className="max-w-sm text-center">
          <span className={`mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-navy-soft text-navy ${tone === 'loading' ? 'animate-pulse' : ''}`}>
            <ChartIcon size={20} />
          </span>
          <p className="text-sm text-muted">{children}</p>
          {hint && <p className="mt-1 text-sm text-muted">{hint}</p>}
        </div>
      )}
    </div>
  )
}

export function PanelToggle({ open, label, onToggle, tone = 'light' }: { open: boolean; label: string; onToggle: () => void; tone?: 'light' | 'dark' }) {
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-label={open ? `Hide ${label}` : `Show ${label}`}
      title={open ? `Hide ${label}` : `Show ${label}`}
      onClick={onToggle}
      className={`inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-lg transition-colors ${tone === 'dark' ? 'text-white/60 hover:bg-white/10 hover:text-white' : 'text-subtle hover:bg-navy-soft hover:text-navy'}`}
    >
      {open ? <ChevronUpIcon size={18} /> : <ChevronDownIcon size={18} />}
    </button>
  )
}

export function ExportButtons({ onPng, onCsv }: { onPng: () => void; onCsv: () => void }) {
  return (
    <div className="flex items-center rounded-lg border border-line">
      {([['PNG', onPng], ['CSV', onCsv]] as const).map(([label, action], index) => (
        <button
          key={label}
          type="button"
          aria-label={`Download ${label}`}
          title={`Download ${label}`}
          onClick={action}
          className={`flex h-8 cursor-pointer items-center gap-1.5 px-2.5 text-xs font-medium text-muted transition-colors hover:bg-navy-soft hover:text-navy ${index ? 'border-l border-line' : ''}`}
        >
          <DownloadIcon size={14} />
          {label}
        </button>
      ))}
    </div>
  )
}

export function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <span className="whitespace-nowrap">
      <span className="text-subtle">{label}</span> <span className="font-medium text-ink tabular-nums">{value}</span>
    </span>
  )
}

export function MetaLine({ items }: { items: ReactNode[] }) {
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-muted">
      {items.map((item, index) => (
        <span key={index} className="flex items-center gap-x-2">
          {index > 0 && <span aria-hidden="true" className="text-navy-line">•</span>}
          {item}
        </span>
      ))}
    </p>
  )
}

export function TrendBadge({ p }: { p: number | null }) {
  if (p === null || !Number.isFinite(p)) return null
  const significant = p < 0.05
  return (
    <span
      title={significant ? 'p < 0.05: the trend is unlikely to be random.' : 'p ≥ 0.05: the trend could be random variation.'}
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap ${significant ? 'border-success-line bg-success-soft text-success' : 'border-warning-line bg-warning-soft text-warning'}`}
    >
      <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${significant ? 'bg-success' : 'bg-[#d39b00]'}`} />
      {significant ? 'Significant trend' : 'No clear trend'}
    </span>
  )
}
