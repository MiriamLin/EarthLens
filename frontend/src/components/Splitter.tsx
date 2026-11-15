import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'

type Axis = 'x' | 'y'

function readSize(storageKey: string, initial: number) {
  try {
    const saved = Number(localStorage.getItem(storageKey))
    return saved > 0 ? saved : initial
  } catch {
    return initial
  }
}

export function useResizable(storageKey: string, axis: Axis, initial: number, min: number, reserve: number) {
  const container = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState(() => readSize(storageKey, initial))

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, String(Math.round(size)))
    } catch {
      return
    }
  }, [storageKey, size])

  function clamp(value: number) {
    const box = container.current
    const total = box ? (axis === 'x' ? box.clientWidth : box.clientHeight) : Infinity
    return Math.max(min, Math.min(value, total - reserve))
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return
    event.preventDefault()
    const origin = axis === 'x' ? event.clientX : event.clientY
    const start = Math.min(size, clamp(size))
    const move = (moveEvent: globalThis.PointerEvent) => {
      setSize(clamp(start + (axis === 'x' ? moveEvent.clientX : moveEvent.clientY) - origin))
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    document.body.style.cursor = axis === 'x' ? 'col-resize' : 'row-resize'
    document.body.style.userSelect = 'none'
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const keys = axis === 'x' ? ['ArrowLeft', 'ArrowRight'] : ['ArrowUp', 'ArrowDown']
    const direction = keys.indexOf(event.key)
    if (direction < 0) return
    event.preventDefault()
    const step = event.shiftKey ? 64 : 16
    setSize((current) => clamp(Math.min(current, clamp(current)) + (direction === 0 ? -step : step)))
  }

  const style = axis === 'x'
    ? { width: size, maxWidth: `calc(100% - ${reserve}px)` }
    : { height: size, maxHeight: `calc(100% - ${reserve}px)` }

  return { container, style, handle: { axis, size, onPointerDown, onKeyDown } }
}

type SplitterProps = {
  axis: Axis
  size: number
  label: string
  onPointerDown: (event: PointerEvent<HTMLDivElement>) => void
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void
}

export default function Splitter({ axis, size, label, onPointerDown, onKeyDown }: SplitterProps) {
  const vertical = axis === 'x'
  return (
    <div
      role="separator"
      aria-label={label}
      aria-orientation={vertical ? 'vertical' : 'horizontal'}
      aria-valuenow={Math.round(size)}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      className={`group flex shrink-0 touch-none items-center justify-center outline-none ${vertical ? 'w-4 cursor-col-resize' : 'h-4 cursor-row-resize'}`}
    >
      <span className={`rounded-full bg-navy-line transition-colors group-hover:bg-navy group-focus-visible:bg-navy ${vertical ? 'h-10 w-1' : 'h-1 w-10'}`} />
    </div>
  )
}
