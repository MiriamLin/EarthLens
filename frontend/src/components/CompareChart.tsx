import { useEffect, useRef } from 'react'
import 'uplot/dist/uPlot.min.css'
import type { prepareComparison } from '../lib/compare'
import { chartAxes, mountChart } from '../lib/chart'

import { seriesColor } from '../lib/palette'

export default function CompareChart({ comparison, order }: { comparison: ReturnType<typeof prepareComparison>; order: string[] }) {
  const container = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!container.current) return
    return mountChart(container.current, {
      scales: { x: { time: true } },
      axes: chartAxes(comparison.units),
      series: [
        { label: 'Date' },
        ...comparison.series.map((item) => ({
          label: item.name,
          stroke: seriesColor(order, item.key),
          width: 2,
          points: { show: item.values.filter((value) => value !== null).length < 60 },
        })),
      ],
    }, [
      comparison.dates.map((date) => Date.parse(date) / 1000),
      ...comparison.series.map((item) => item.values),
    ])
  }, [comparison, order])

  return <div ref={container} role="img" aria-label="Comparison of selected time series" className="h-full w-full overflow-hidden" />
}
