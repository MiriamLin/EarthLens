import { geoEqualEarth, geoPath } from 'd3-geo'
import type { Polygon } from 'geojson'

export function createMapCells() {
  return Array.from({ length: 648 }, (_, index) => {
    const south = -90 + Math.floor(index / 36) * 10
    const west = -180 + (index % 36) * 10
    const ring: number[][] = []
    for (let step = 0; step < 5; step++) ring.push([west, south + step * 2])
    for (let step = 0; step < 5; step++) ring.push([west + step * 2, south + 10])
    for (let step = 0; step < 5; step++) ring.push([west + 10, south + 10 - step * 2])
    for (let step = 0; step < 5; step++) ring.push([west + 10 - step * 2, south])
    ring.push(ring[0])
    const geometry: Polygon = { type: 'Polygon', coordinates: [ring] }
    return { west, south, east: west + 10, north: south + 10, geometry }
  })
}

export const mapPath = geoPath(geoEqualEarth().fitExtent([[8, 8], [992, 492]], { type: 'Sphere' }))

export function mapColor(value: number | null | undefined, minimum: number, maximum: number) {
  if (value == null || !Number.isFinite(value)) return 'transparent'
  const ratio = maximum === minimum ? 0.5 : Math.max(0, Math.min(1, (value - minimum) / (maximum - minimum)))
  const start = [239, 246, 255]
  const end = [30, 58, 138]
  return `rgb(${start.map((channel, index) => Math.round(channel + (end[index] - channel) * ratio)).join(',')})`
}
