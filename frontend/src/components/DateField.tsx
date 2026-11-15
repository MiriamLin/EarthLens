import { useEffect, useRef, useState } from 'react'

type Props = {
  value: string
  monthly: boolean
  min: string
  max: string
  label: string
  onChange: (value: string) => void
}

export function displayDate(value: string, monthly: boolean) {
  return (monthly ? value.slice(0, 7) : value.slice(0, 10)).replaceAll('-', '/')
}

export function parseDate(text: string, monthly: boolean) {
  const match = monthly
    ? text.trim().match(/^(\d{4})[/.-](\d{1,2})$/)
    : text.trim().match(/^(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})$/)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = monthly ? 1 : Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null
  return date.toISOString().slice(0, 10)
}

export default function DateField({ value, monthly, min, max, label, onChange }: Props) {
  const [draft, setDraft] = useState(() => displayDate(value, monthly))
  const [invalid, setInvalid] = useState(false)
  const picker = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setDraft(displayDate(value, monthly))
    setInvalid(false)
  }, [value, monthly])

  function commit() {
    const parsed = parseDate(draft, monthly)
    if (!parsed) {
      setInvalid(true)
      return
    }
    const lower = monthly ? `${min.slice(0, 7)}-01` : min
    const clamped = parsed < lower ? lower : parsed > max ? max : parsed
    setInvalid(false)
    setDraft(displayDate(clamped, monthly))
    if (clamped !== value) onChange(clamped)
  }

  return (
    <span className="relative flex">
      <input
        type="text"
        inputMode="numeric"
        aria-label={label}
        aria-invalid={invalid}
        placeholder={monthly ? 'YYYY/MM' : 'YYYY/MM/DD'}
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value)
          setInvalid(false)
        }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            commit()
          }
        }}
        className={`field pr-9 tabular-nums ${monthly ? 'w-32' : 'w-40'} ${invalid ? 'border-danger focus:border-danger focus:ring-danger/15' : ''}`}
      />
      <button
        type="button"
        aria-label={`Open calendar for ${label.toLowerCase()}`}
        title="Calendar"
        onClick={() => picker.current?.showPicker()}
        className="icon-btn absolute top-1 right-1"
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3.5" y="5" width="17" height="15" rx="2" />
          <path d="M3.5 10h17M8 3v4M16 3v4" />
        </svg>
      </button>
      <input
        ref={picker}
        type={monthly ? 'month' : 'date'}
        tabIndex={-1}
        aria-hidden="true"
        min={monthly ? min.slice(0, 7) : min}
        max={monthly ? max.slice(0, 7) : max}
        value={monthly ? value.slice(0, 7) : value}
        onChange={(event) => {
          if (event.target.value) onChange(monthly ? `${event.target.value}-01` : event.target.value)
        }}
        className="pointer-events-none absolute bottom-0 left-0 h-0 w-full opacity-0"
      />
    </span>
  )
}
