import { lazy, Suspense, useCallback, useId, useRef, useState } from 'react'

const LocationPicker = lazy(() => import('./LocationPicker'))
import { PinIcon } from './Icons'

export const DEFAULT_LOCATION = { latitude: '25.0330', longitude: '121.5654' }

export function isValidLocation(latitude: string, longitude: string) {
  const lat = Number(latitude)
  const lon = Number(longitude)
  return latitude.trim() !== '' && longitude.trim() !== '' && Math.abs(lat) <= 90 && Math.abs(lon) <= 180
}

type Props = {
  latitude: string
  longitude: string
  onChange: (latitude: string, longitude: string) => void
  label?: string
  compact?: boolean
}

export default function LocationField({ latitude, longitude, onChange, label = 'Location', compact = false }: Props) {
  const id = useId()
  const dialog = useRef<HTMLDialogElement>(null)
  const [showMap, setShowMap] = useState(false)
  const change = useRef(onChange)
  change.current = onChange
  const pick = useCallback((lat: number, lon: number) => {
    change.current(lat.toFixed(4), lon.toFixed(4))
    dialog.current?.close()
  }, [])
  const input = 'no-spin w-[5.5rem] min-w-0 bg-transparent text-sm text-ink tabular-nums outline-none placeholder:text-subtle'

  return (
    <div className="flex flex-col gap-1.5">
      {!compact && <span className="field-label">{label}</span>}
      <div className={`flex items-center gap-1.5 rounded-lg border border-line bg-white pr-2 pl-1 transition-colors hover:border-navy-line focus-within:border-navy focus-within:ring-3 focus-within:ring-navy/15 ${compact ? 'h-9' : 'h-10'}`}>
        <button
          type="button"
          aria-label={`Pick ${label.toLowerCase()} on map`}
          title="Pick on map"
          aria-haspopup="dialog"
          aria-controls={`${id}-dialog`}
          onClick={() => {
            setShowMap(true)
            dialog.current?.showModal()
          }}
          className="icon-btn h-7 w-7 text-navy"
        >
          <PinIcon />
        </button>
        <input
          type="number"
          inputMode="decimal"
          step="any"
          min={-90}
          max={90}
          required
          aria-label={`${label} latitude`}
          placeholder="Lat"
          value={latitude}
          onChange={(event) => onChange(event.target.value, longitude)}
          className={input}
        />
        <span aria-hidden="true" className="h-4 w-px shrink-0 bg-line" />
        <input
          type="number"
          inputMode="decimal"
          step="any"
          min={-180}
          max={180}
          required
          aria-label={`${label} longitude`}
          placeholder="Lon"
          value={longitude}
          onChange={(event) => onChange(latitude, event.target.value)}
          className={input}
        />
      </div>
      <dialog
        id={`${id}-dialog`}
        ref={dialog}
        aria-labelledby={`${id}-title`}
        onClose={() => setShowMap(false)}
        className="fixed inset-0 m-auto max-h-[90dvh] w-[34rem] max-w-[92vw] overflow-y-auto rounded-xl border border-line bg-white p-5 shadow-xl backdrop:bg-ink/40"
      >
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 id={`${id}-title`} className="text-base font-semibold text-ink">Pick a location</h2>
          <button type="button" onClick={() => dialog.current?.close()} className="btn btn-secondary btn-sm">Done</button>
        </div>
        {showMap && (
          <Suspense fallback={<div className="h-80 w-full animate-pulse rounded-lg bg-surface" />}>
            <LocationPicker
              latitude={latitude === '' ? null : Number(latitude)}
              longitude={longitude === '' ? null : Number(longitude)}
              onChange={pick}
              className="h-80 w-full overflow-hidden rounded-lg border border-line"
            />
          </Suspense>
        )}
        <p className="mt-3 text-sm text-muted tabular-nums">Selected: {latitude || '—'}, {longitude || '—'}</p>
      </dialog>
    </div>
  )
}
