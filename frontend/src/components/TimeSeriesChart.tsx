import { useEffect, useRef } from 'react'
import 'uplot/dist/uPlot.min.css'
import type { TimeSeriesData } from '../data'
import { chartAxes, mountChart } from '../lib/chart'

import { OBSERVED_COLOR, TREND_COLOR } from '../lib/palette'

export default function TimeSeriesChart({ series }: { series: TimeSeriesData }) {
  const container = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!container.current) return
    return mountChart(container.current, {
      scales: { x: { time: true } },
      axes: chartAxes(series.units),
      series: [
        { label: 'Date' },
        { label: 'Observed', stroke: OBSERVED_COLOR, width: 1.75, points: { show: series.statistics.count < 60 } },
        { label: 'Trend (OLS)', stroke: TREND_COLOR, width: 2, dash: [6, 4], points: { show: false } },
      ],
    }, [
      series.dates.map((date) => Date.parse(date) / 1000),
      series.values,
      series.trend,
    ])
  }, [series])

  return <div ref={container} role="img" aria-label={`${series.name} time series and trend line`} className="h-full w-full overflow-hidden" />
}
