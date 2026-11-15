import uPlot from 'uplot'

const axis = {
  stroke: '#566176',
  font: '11px Inter, system-ui, sans-serif',
  labelFont: '500 12px Inter, system-ui, sans-serif',
  grid: { stroke: '#eef1f5', width: 1 },
  ticks: { stroke: '#e2e6ee', width: 1 },
}

export function chartAxes(units: string): uPlot.Axis[] {
  return [axis, { ...axis, label: units, size: 70 }]
}

export function mountChart(element: HTMLElement, options: Omit<uPlot.Options, 'width' | 'height'>, data: uPlot.AlignedData) {
  const measure = () => {
    const legend = element.querySelector<HTMLElement>('.u-legend')
    return {
      width: Math.max(1, element.clientWidth),
      height: Math.max(160, element.clientHeight - (legend?.offsetHeight ?? 0)),
    }
  }
  const plot = new uPlot({
    ...options,
    ...measure(),
    tzDate: (timestamp) => uPlot.tzDate(new Date(timestamp * 1000), 'UTC'),
  }, data, element)
  plot.setSize(measure())
  const observer = new ResizeObserver(() => plot.setSize(measure()))
  observer.observe(element)
  return () => {
    observer.disconnect()
    plot.destroy()
  }
}
