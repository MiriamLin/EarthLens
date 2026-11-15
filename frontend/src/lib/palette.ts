export const OBSERVED_COLOR = '#0b3d91'
export const TREND_COLOR = '#fc3d21'
export const SERIES_COLORS = ['#0b3d91', '#fc3d21', '#1d7a4c', '#d39b00', '#6f42c9', '#0e7490']

export function seriesColor(order: string[], key: string) {
  return SERIES_COLORS[Math.max(0, order.indexOf(key)) % SERIES_COLORS.length]
}
