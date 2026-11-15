import { useEffect, useMemo, useState } from 'react'
import type { GeoPermissibleObjects } from 'd3-geo'
import { createMapCells, mapColor, mapPath } from '../lib/map'
import { isDataKey } from '../lib/series'
import { fetchJson } from '../lib/api'

type AnnualMap = {
  key: string
  name: string
  units: string
  minimum: number
  maximum: number
  statistic: string
  frames: { year: number; values: (number | null)[] }[]
}

const cells = createMapCells().map((cell) => ({ ...cell, path: mapPath(cell.geometry) ?? '' }))
const sphere = mapPath({ type: 'Sphere' }) ?? ''

export default function WorldMap({ dataKey }: { dataKey: string }) {
  const [data, setData] = useState<AnnualMap | null>(null)
  const [index, setIndex] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [land, setLand] = useState<GeoPermissibleObjects | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    void fetchJson<GeoPermissibleObjects>('/land.geojson', { signal: controller.signal })
      .then((geometry) => { if (!controller.signal.aborted) setLand(geometry) })
      .catch(() => {})
    return () => controller.abort()
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    setData(null)
    setError('')
    setLoading(Boolean(dataKey))
    if (!dataKey) return () => controller.abort()

    async function load() {
      try {
        const raw = isDataKey(dataKey)
        const body = await fetchJson<AnnualMap>(raw ? `/api/map/${encodeURIComponent(dataKey)}` : '/api/map/expression', {
          signal: controller.signal,
          ...(raw ? {} : {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ expression: dataKey }),
          }),
        })
        if (!controller.signal.aborted) {
          setData(body)
          setIndex(body.frames.length - 1)
        }
      } catch (error) {
        if (!controller.signal.aborted) setError(error instanceof Error ? error.message : 'Unable to load annual data.')
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }
    void load()
    return () => controller.abort()
  }, [dataKey])

  const landPath = useMemo(() => land ? mapPath(land) ?? '' : '', [land])
  const frame = data?.frames[index]

  return (
    <section aria-label="Annual global data map" className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-3 pb-3">
      {loading && <p role="status">Loading NASA annual data...</p>}
      {error && <p role="alert">{error}</p>}
      {data && frame && <p>{data.name} · {frame.year} · {data.units} · 10° × 10° / 648 cells</p>}
      {data && <p className="text-sm">{data.statistic}</p>}
      <div className="min-h-64 flex-1">
        <svg viewBox="0 0 1000 500" role="img" aria-label={frame ? `${data?.name}, ${frame.year}, global annual means` : 'Global 10 degree grid'} className="h-full w-full">
          <path d={sphere} fill="white" stroke="#777" />
          {cells.map((cell, cellIndex) => {
            const value = frame?.values[cellIndex]
            return (
              <path key={cellIndex} d={cell.path} fill={data ? mapColor(value, data.minimum, data.maximum) : 'transparent'} stroke="#aaa" strokeWidth={0.3}>
                <title>{cell.south}° to {cell.north}° latitude, {cell.west}° to {cell.east}° longitude: {value == null ? 'No data' : `${value} ${data?.units}`}</title>
              </path>
            )
          })}
          {landPath && <path d={landPath} fill="none" stroke="#333" strokeWidth={0.7} pointerEvents="none" />}
        </svg>
      </div>
      {data && frame && (
        <>
          <div className="flex items-center gap-3 text-sm">
            <span>{Number(data.minimum.toPrecision(5))}</span>
            <div className="h-3 max-w-80 flex-1 border" style={{ background: `linear-gradient(to right, ${mapColor(data.minimum, data.minimum, data.maximum)}, ${mapColor(data.maximum, data.minimum, data.maximum)})` }} />
            <span>{Number(data.maximum.toPrecision(5))} {data.units}</span>
            <span>No data: transparent</span>
          </div>
          <label className="flex items-center gap-3">
            Year: <output className="w-12">{frame.year}</output>
            <input type="range" aria-label="Year" aria-valuetext={String(frame.year)} min={0} max={data.frames.length - 1} step={1} value={index} onChange={(event) => setIndex(Number(event.target.value))} className="min-w-0 flex-1" />
          </label>
          <div className="flex justify-between text-sm"><span>{data.frames[0].year}</span><span>{data.frames[data.frames.length - 1].year}</span></div>
        </>
      )}
      <p className="text-sm">Equal Earth projection · Area-weighted means · NASA POWER · Land outlines: Natural Earth</p>
    </section>
  )
}
