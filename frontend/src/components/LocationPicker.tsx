import { useEffect, useRef } from 'react'
import * as L from 'leaflet'
import 'leaflet/dist/leaflet.css'

type Props = {
  latitude: number | null
  longitude: number | null
  onChange: (latitude: number, longitude: number) => void
  className?: string
  scrollWheelZoom?: boolean
}

export default function LocationPicker({ latitude, longitude, onChange, className = 'h-52 w-full border', scrollWheelZoom = false }: Props) {
  const container = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const marker = useRef<L.CircleMarker | null>(null)

  useEffect(() => {
    if (!container.current) return
    const instance = L.map(container.current, { scrollWheelZoom, minZoom: 1 }).setView([20, 0], 2)
    map.current = instance
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(instance)
    instance.on('click', (event: L.LeafletMouseEvent) => {
      const point = event.latlng.wrap()
      onChange(point.lat, point.lng)
    })
    const observer = new ResizeObserver(() => instance.invalidateSize({ pan: false }))
    observer.observe(container.current)

    return () => {
      observer.disconnect()
      instance.remove()
      map.current = null
      marker.current = null
    }
  }, [onChange, scrollWheelZoom])

  useEffect(() => {
    if (!map.current) return
    if (latitude === null || longitude === null || !Number.isFinite(latitude) || !Number.isFinite(longitude)
      || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
      marker.current?.remove()
      marker.current = null
      return
    }
    const position: L.LatLngExpression = [latitude, longitude]
    if (marker.current) marker.current.setLatLng(position)
    else marker.current = L.circleMarker(position, { radius: 7, color: '#ffffff', weight: 2, fillColor: '#fc3d21', fillOpacity: 1, interactive: false }).addTo(map.current)
    map.current.panTo(position, { animate: false })
  }, [latitude, longitude])

  return <div ref={container} role="region" aria-label="Location map" className={`relative z-0 ${className}`} />
}
