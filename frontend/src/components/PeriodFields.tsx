import type { Temporal } from '../lib/series'
import { monthEnd } from '../lib/sound'
import DateField from './DateField'

type Props = {
  temporal: Temporal
  start: string
  end: string
  onTemporalChange: (temporal: Temporal) => void
  onStartChange: (start: string) => void
  onEndChange: (end: string) => void
}

export default function PeriodFields({ temporal, start, end, onTemporalChange, onStartChange, onEndChange }: Props) {
  const monthly = temporal === 'monthly'
  const today = new Date().toISOString().slice(0, 10)
  return (
    <>
      <label className="flex flex-col gap-1.5">
        <span className="field-label">Temporal</span>
        <select value={temporal} onChange={(event) => onTemporalChange(event.target.value as Temporal)} className="field pr-8">
          <option value="daily">Daily</option>
          <option value="monthly">Monthly</option>
        </select>
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="field-label">Start</span>
        <DateField
          label="Start"
          monthly={monthly}
          value={start}
          min="1981-01-01"
          max={end}
          onChange={onStartChange}
        />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="field-label">End</span>
        <DateField
          label="End"
          monthly={monthly}
          value={end}
          min={start}
          max={today}
          onChange={(value) => onEndChange(monthly ? monthEnd(value.slice(0, 7)) : value)}
        />
      </label>
    </>
  )
}
