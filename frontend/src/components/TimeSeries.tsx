import { lazy, Suspense, useRef } from 'react'
import AnalysisWorkspace from './AnalysisWorkspace'
import type { DataMetadata, TimeSeriesResult } from '../data'
import { OBSERVED_COLOR, TREND_COLOR } from '../lib/palette'

const TimeSeriesChart = lazy(() => import('./TimeSeriesChart'))
import ResultCard, { CardMessage, ExportButtons, MetaLine, Stat, TrendBadge } from './ResultCard'
import { formatNumber, formatP, formatPeriod, formatTemporal } from '../lib/format'
import { downloadChartPng, downloadCsv } from '../lib/export'

function TimeSeriesResultCard({ result }: { result: TimeSeriesResult }) {
  const chart = useRef<HTMLDivElement>(null)
  const series = result.series[0]
  if (!series) {
    return <ResultCard label="Time series results"><CardMessage>No data returned.</CardMessage></ResultCard>
  }
  const { statistics, units } = series
  const place = `${result.latitude}, ${result.longitude}`
  const period = formatPeriod(result.start, result.end, result.temporal)
  const temporal = formatTemporal(result.temporal)

  return (
    <ResultCard
      label="Time series results"
      summary={(
        <>
          <h2 className="flex flex-wrap items-center gap-x-2 gap-y-1 text-base font-semibold text-ink">
            {series.name}
            {series.key !== series.name && <code className="rounded bg-navy-soft px-1.5 py-0.5 font-mono text-xs font-normal text-navy">{series.key}</code>}
          </h2>
          <MetaLine items={[place, period, temporal, units]} />
          <p className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-1">
            <TrendBadge p={statistics.p_value} />
            <Stat label="Slope" value={`${formatNumber(statistics.slope)} ${units}/yr`} />
            <Stat label="R²" value={formatNumber(statistics.r_squared)} />
            <Stat label="p" value={formatP(statistics.p_value)} />
            <Stat label="Valid / missing" value={`${statistics.count} / ${statistics.missing}`} />
          </p>
          {series.note && <p className="text-xs text-subtle">{series.note}</p>}
        </>
      )}
      actions={statistics.count > 0 && (
        <ExportButtons
          onPng={() => downloadChartPng(chart.current, 'earthlens-time-series.png', `${series.name} · ${place} · ${period} · ${temporal}`, [
            { label: `Observed (${units})`, color: OBSERVED_COLOR },
            { label: 'Trend (OLS)', color: TREND_COLOR },
          ])}
          onCsv={() => downloadCsv('earthlens-time-series.csv', ['date', `${series.name} (${units})`, 'trend'], series.dates.map((date, index) => [
            date, series.values[index], series.trend[index],
          ]))}
        />
      )}
    >
      {statistics.count > 0
        ? <div ref={chart} className="absolute inset-0 px-4 pt-4 pb-2"><Suspense fallback={null}><TimeSeriesChart series={series} /></Suspense></div>
        : <CardMessage>No data available for this location and date range.</CardMessage>}
    </ResultCard>
  )
}

export default function TimeSeries({ data, onSave }: { data: DataMetadata[]; onSave: (expression: string) => boolean }) {
  return (
    <AnalysisWorkspace title="Time Series" data={data} onSave={onSave}>
      {(result) => <TimeSeriesResultCard result={result} />}
    </AnalysisWorkspace>
  )
}
