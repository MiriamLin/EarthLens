import { useEffect, useId, useMemo, useState } from 'react'
import type { SoundPlayer } from '../lib/sound'

export default function DataWaveform({ values, playback, onSeek, className = 'h-36 w-full' }: {
  values: (number | null)[]
  playback: Pick<SoundPlayer, 'progress'> | null
  onSeek?: (position: number) => void
  className?: string
}) {
  const clipId = useId()
  const [progress, setProgress] = useState(0)
  const path = useMemo(() => {
    let minimum = Infinity
    let maximum = -Infinity
    for (const value of values) {
      if (value === null || !Number.isFinite(value)) continue
      minimum = Math.min(minimum, value)
      maximum = Math.max(maximum, value)
    }
    let path = ''
    let connected = false
    values.forEach((value, index) => {
      if (value === null || !Number.isFinite(value)) {
        connected = false
        return
      }
      const x = index * 1000 / values.length
      const y = maximum === minimum ? 80 : 150 - (value - minimum) / (maximum - minimum) * 140
      path += `${connected ? 'L' : 'M'}${x},${y}l0,0`
      if (index === values.length - 1) path += `L1000,${y}`
      connected = true
    })
    return path
  }, [values])

  useEffect(() => {
    let frame = 0
    function tick() {
      const position = playback?.progress() ?? 0
      setProgress(position)
      if (playback && position < 1) frame = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(frame)
  }, [playback, values])

  return (
    <svg
      viewBox="0 0 1000 160"
      preserveAspectRatio="none"
      role="img"
      aria-label={onSeek ? 'Data values. Click to play from a position.' : 'Data values with played portions in red'}
      onClick={onSeek && ((event) => {
        const box = event.currentTarget.getBoundingClientRect()
        if (box.width > 0) onSeek(Math.max(0, Math.min(1, (event.clientX - box.left) / box.width)))
      })}
      className={`${className} ${onSeek ? 'cursor-pointer' : ''}`}
    >
      <defs>
        <clipPath id={clipId} clipPathUnits="userSpaceOnUse">
          <rect width={progress * 1000} height="160" />
        </clipPath>
      </defs>
      <path d={path} fill="none" stroke="#8b94a5" strokeWidth="1.75" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
      <path d={path} fill="none" stroke="#0b3d91" strokeWidth="2" strokeLinecap="round" vectorEffect="non-scaling-stroke" clipPath={`url(#${clipId})`} />
      {playback && progress > 0 && progress < 1 && (
        <line x1={progress * 1000} x2={progress * 1000} y1="0" y2="160" stroke="#fc3d21" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      )}
    </svg>
  )
}
