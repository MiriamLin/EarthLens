import { useState } from 'react'
import { SAVED_DATA_DRAG_TYPE, type DataOption } from '../data'

type Props = {
  id?: string
  label?: string
  className?: string
  items: DataOption[]
  value: string
  onChange: (value: string) => void
}

export default function DataDropZone({ id, label, className = '', items, value, onChange }: Props) {
  const [over, setOver] = useState(false)
  const name = items.find((item) => item.key === value)?.name || value

  return (
    <div
      className={`drop-zone ${className}`}
      data-over={over}
      data-filled={Boolean(value)}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes(SAVED_DATA_DRAG_TYPE)) return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'copy'
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        setOver(false)
        const key = event.dataTransfer.getData(SAVED_DATA_DRAG_TYPE)
        if (!items.some((item) => item.key === key)) return
        event.preventDefault()
        onChange(key)
      }}
    >
      <svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`pointer-events-none shrink-0 ${value ? 'text-navy' : 'text-subtle'}`}>
        {value
          ? <><path d="M4 4v16h16" /><path d="m7.5 14 3.5-4 3 3 5-6" /></>
          : <><path d="M12 4v10m0 0-3.5-3.5M12 14l3.5-3.5" /><path d="M4 15v4h16v-4" /></>}
      </svg>
      <input
        id={id}
        aria-label={label}
        readOnly
        value={name}
        title={name}
        placeholder={over ? 'Release' : 'Drop a saved formula'}
        className="pointer-events-none min-w-0 flex-1 truncate bg-transparent font-medium outline-none placeholder:font-normal placeholder:text-subtle"
      />
      {value && (
        <button
          type="button"
          aria-label={`Clear ${label ?? 'data'}`}
          title="Clear"
          onClick={() => onChange('')}
          className="-mr-1.5 inline-flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded text-subtle hover:bg-surface hover:text-ink"
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6 6 18" /></svg>
        </button>
      )}
    </div>
  )
}
