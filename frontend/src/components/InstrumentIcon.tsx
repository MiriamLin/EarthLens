import type { ReactNode } from 'react'
import { INSTRUMENTS, type Instrument } from '../lib/sound'

const SHAPES: Record<Instrument, ReactNode> = {
  piano: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="1.5" />
      <path d="M9 12v8M15 12v8" />
      <path d="M7.5 4h3v8h-3zM13.5 4h3v8h-3z" fill="currentColor" />
    </>
  ),
  guitar: (
    <>
      <circle cx="9" cy="15" r="5" />
      <circle cx="9" cy="15" r="1.5" />
      <path d="M12.5 11.5 20 4M18 2.5l3.5 3.5" />
    </>
  ),
  flute: (
    <>
      <path d="M3.5 18.5 18.5 3.5l2 2-15 15z" />
      <circle cx="9" cy="15" r="0.9" fill="currentColor" />
      <circle cx="12" cy="12" r="0.9" fill="currentColor" />
      <circle cx="15" cy="9" r="0.9" fill="currentColor" />
    </>
  ),
  clarinet: (
    <>
      <path d="M11 2h2v15l3 5H8l3-5z" />
      <circle cx="12" cy="7" r="0.9" fill="currentColor" />
      <circle cx="12" cy="10.5" r="0.9" fill="currentColor" />
      <circle cx="12" cy="14" r="0.9" fill="currentColor" />
    </>
  ),
  cello: (
    <>
      <circle cx="12" cy="9.5" r="3.5" />
      <circle cx="12" cy="16" r="4.5" />
      <path d="M12 2v4M12 20.5V23M10.5 14.5v3M13.5 14.5v3" />
    </>
  ),
  marimba: (
    <>
      <path d="M3 7h18" />
      <path d="M5 7v11M9 7v9M13 7v7M17 7v5M21 7v3" />
    </>
  ),
}

export default function InstrumentIcon({ instrument, className = 'h-4 w-4' }: { instrument: Instrument; className?: string }) {
  return (
    <svg role="img" aria-label={INSTRUMENTS[instrument].label} viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {SHAPES[instrument]}
    </svg>
  )
}
