import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { readStored, writeStored } from '../lib/persist'

export type GuideId = 'data' | 'timeSeries' | 'compare' | 'sound'

type GuideAction = 'open-formula' | 'text' | 'blocks'
type Step = { target: string; title: string; body: string; actions?: GuideAction[] }

export const GUIDE_EVENT = 'earthlens:guide'

function signal(action: GuideAction | 'start' | 'end') {
  window.dispatchEvent(new CustomEvent(GUIDE_EVENT, { detail: action }))
}

export const GUIDES: Record<GuideId, Step[]> = {
  data: [
    { target: 'data-switch', title: 'Data or functions', body: 'Switch between NASA variables and the functions you can use in formulas.' },
    { target: 'data-search', title: 'Search', body: 'Type a name, a code like T2M, or any word from the description.' },
    { target: 'data-filter', title: 'Filter', body: 'Show only one category, such as Temperature or Wind & Pressure.' },
    { target: 'data-list', title: 'Details', body: 'Click a row to see what it measures and its units. Use the blue code in your formulas.' },
  ],
  timeSeries: [
    { target: 'ts-settings', title: 'Place and time', body: 'Type a latitude and longitude or pick one on the map, then choose the period. Monthly is faster for long ranges.' },
    { target: 'ts-text', title: 'Formula', body: 'Write a formula with data codes and functions. Suggestions appear as you type; use ↑ ↓ and Enter to pick one.', actions: ['open-formula', 'text'] },
    { target: 'ts-mode', title: 'Text or blocks', body: 'Prefer not to type? Switch to Blocks and build the same formula by dragging.', actions: ['open-formula', 'text'] },
    { target: 'ts-palette', title: 'Blocks', body: 'Open a category and drag a block down, or click it to drop it into the selected slot. Colours show the kind of block.', actions: ['open-formula', 'blocks'] },
    { target: 'ts-blocks', title: 'Build', body: 'Drop a block onto another to replace it, or drag it outside the box to remove it. Square slots only take numbers.', actions: ['open-formula', 'blocks'] },
    { target: 'ts-actions', title: 'Generate and save', body: 'Generate draws the chart. Save keeps a formula that worked so you can use it in Compare and Sound.' },
    { target: 'ts-result', title: 'Result', body: 'The line is your data and the dashed red line is the trend. Download a PNG or CSV at the top right.' },
    { target: 'saved', title: 'Saved formulas', body: 'Everything you save shows up here. Drag an item into Compare or Sound.' },
  ],
  compare: [
    { target: 'cmp-rows', title: 'What to compare', body: 'Drag saved formulas into these rows. Each row can use its own location.' },
    { target: 'cmp-add', title: 'More rows', body: 'Add another row to compare more data or more places.' },
    { target: 'cmp-period', title: 'Period', body: 'Pick the time range and press Compare.' },
    { target: 'cmp-result', title: 'Result', body: 'Each line matches the coloured dot of its row. Correlation shows how closely two series move together.' },
  ],
  sound: [
    { target: 'snd-form', title: 'New card', body: 'Drag a saved formula into Data, choose a place, period and instrument, then press Create card.' },
    { target: 'snd-cards', title: 'Cards', body: 'Each card turns its data into a melody: higher values play higher notes. Click the waveform to play from any point.' },
    { target: 'snd-tracks', title: 'Tracks', body: 'Drag cards onto tracks to hear several together, and set each track’s volume.' },
  ],
}

const SEEN_KEY = 'earthlens.guides.seen'
const WIDTH = 300
const GAP = 14
const MARGIN = 12

export function hasSeenGuide(id: GuideId) {
  return readStored<GuideId[]>(SEEN_KEY, []).includes(id)
}

export function markGuideSeen(id: GuideId) {
  const seen = readStored<GuideId[]>(SEEN_KEY, [])
  if (!seen.includes(id)) writeStored(SEEN_KEY, [...seen, id])
}

function findTarget(name: string) {
  return [...document.querySelectorAll<HTMLElement>(`[data-tour="${name}"]`)].find((element) => element.offsetParent !== null) ?? null
}

type Layout = {
  spot: DOMRect | null
  left: number
  top: number
  arrow: { side: 'top' | 'bottom' | 'left' | 'right'; offset: number } | null
}

function place(spot: DOMRect | null, height: number): Layout {
  const viewWidth = window.innerWidth
  const viewHeight = window.innerHeight
  const clampX = (value: number) => Math.max(MARGIN, Math.min(value, viewWidth - WIDTH - MARGIN))
  const clampY = (value: number) => Math.max(MARGIN, Math.min(value, viewHeight - height - MARGIN))
  if (!spot) return { spot, left: (viewWidth - WIDTH) / 2, top: (viewHeight - height) / 2, arrow: null }
  const centerX = spot.left + spot.width / 2
  const centerY = spot.top + spot.height / 2
  if (viewHeight - spot.bottom >= height + GAP + MARGIN) {
    const left = clampX(centerX - WIDTH / 2)
    return { spot, left, top: spot.bottom + GAP, arrow: { side: 'top', offset: centerX - left } }
  }
  if (spot.top >= height + GAP + MARGIN) {
    const left = clampX(centerX - WIDTH / 2)
    return { spot, left, top: spot.top - GAP - height, arrow: { side: 'bottom', offset: centerX - left } }
  }
  if (viewWidth - spot.right >= WIDTH + GAP + MARGIN) {
    const top = clampY(centerY - height / 2)
    return { spot, left: spot.right + GAP, top, arrow: { side: 'left', offset: centerY - top } }
  }
  if (spot.left >= WIDTH + GAP + MARGIN) {
    const top = clampY(centerY - height / 2)
    return { spot, left: spot.left - GAP - WIDTH, top, arrow: { side: 'right', offset: centerY - top } }
  }
  return { spot, left: clampX(spot.left + 20), top: clampY(spot.top + 20), arrow: null }
}

export default function Guide({ id, onClose }: { id: GuideId; onClose: () => void }) {
  const steps = GUIDES[id]
  const [index, setIndex] = useState(0)
  const [layout, setLayout] = useState<Layout | null>(null)
  const card = useRef<HTMLDivElement>(null)
  const next = useRef<HTMLButtonElement>(null)
  const step = steps[index]
  const last = index === steps.length - 1

  useEffect(() => {
    signal('start')
    return () => signal('end')
  }, [])

  useEffect(() => {
    for (const action of step.actions ?? []) signal(action)
  }, [step])

  const measure = useCallback(() => {
    const target = findTarget(step.target)
    if (target) target.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    const rect = target?.getBoundingClientRect() ?? null
    const spot = rect ? new DOMRect(rect.left - 6, rect.top - 6, rect.width + 12, rect.height + 12) : null
    setLayout(place(spot, card.current?.offsetHeight ?? 180))
  }, [step.target])

  useLayoutEffect(() => {
    measure()
    const timer = setInterval(measure, 200)
    return () => clearInterval(timer)
  }, [measure])

  useEffect(() => {
    next.current?.focus()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [measure])

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
      if (event.key === 'ArrowRight') last ? onClose() : setIndex((current) => current + 1)
      if (event.key === 'ArrowLeft') setIndex((current) => Math.max(0, current - 1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [last, onClose])

  const spot = layout?.spot
  const arrow = layout?.arrow

  return (
    <div className="fixed inset-0 z-50">
      {spot ? (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed rounded-xl ring-2 ring-white transition-all duration-200"
          style={{ left: spot.left, top: spot.top, width: spot.width, height: spot.height, boxShadow: '0 0 0 9999px rgba(18, 26, 44, 0.55)' }}
        />
      ) : (
        <div aria-hidden="true" className="fixed inset-0 bg-ink/55" />
      )}
      <div
        ref={card}
        role="dialog"
        aria-modal="true"
        aria-labelledby="guide-title"
        aria-describedby="guide-body"
        className="fixed rounded-xl bg-white p-4 shadow-2xl transition-[left,top] duration-200"
        style={{ width: WIDTH, left: layout?.left ?? -9999, top: layout?.top ?? -9999 }}
      >
        {arrow && (
          <span
            aria-hidden="true"
            className="absolute h-3 w-3 rotate-45 bg-white"
            style={arrow.side === 'top' ? { top: -6, left: Math.max(16, Math.min(arrow.offset - 6, WIDTH - 28)) }
              : arrow.side === 'bottom' ? { bottom: -6, left: Math.max(16, Math.min(arrow.offset - 6, WIDTH - 28)) }
                : arrow.side === 'left' ? { left: -6, top: Math.max(16, arrow.offset - 6) }
                  : { right: -6, top: Math.max(16, arrow.offset - 6) }}
          />
        )}
        <div className="relative">
          <div className="mb-1 flex items-center justify-between">
            <span className="eyebrow">{index + 1} / {steps.length}</span>
            <button type="button" onClick={onClose} className="cursor-pointer text-xs font-medium text-subtle hover:text-ink">Skip</button>
          </div>
          <h2 id="guide-title" className="text-sm font-semibold text-ink">{step.title}</h2>
          <p id="guide-body" className="mt-1 text-sm leading-6 text-muted">{step.body}</p>
          <div className="mt-4 flex items-center justify-between">
            <div className="flex gap-1">
              {steps.map((item, position) => (
                <span key={item.target} aria-hidden="true" className={`h-1.5 rounded-full transition-all ${position === index ? 'w-4 bg-navy' : 'w-1.5 bg-navy-line'}`} />
              ))}
            </div>
            <div className="flex gap-2">
              {index > 0 && <button type="button" onClick={() => setIndex(index - 1)} className="btn btn-secondary btn-sm">Back</button>}
              <button ref={next} type="button" onClick={() => last ? onClose() : setIndex(index + 1)} className="btn btn-primary btn-sm">
                {last ? 'Done' : 'Next'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export function GuideButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Open guide"
      title="Guide"
      className="fixed bottom-4 left-4 z-40 flex h-10 w-10 cursor-pointer items-center justify-center rounded-full border border-line bg-white text-navy shadow-md transition-colors hover:border-navy hover:bg-navy hover:text-white"
    >
      <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="9.5" />
        <path d="M9.4 9.3a2.7 2.7 0 0 1 5.2 1c0 1.8-2.6 2.4-2.6 4" />
        <path d="M12 17.3h.01" />
      </svg>
    </button>
  )
}
