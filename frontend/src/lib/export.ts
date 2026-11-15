export type LegendEntry = { label: string; color: string }

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

function csvCell(value: string | number | null | undefined) {
  if (value === null || value === undefined) return ''
  const text = String(value)
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function downloadCsv(filename: string, header: string[], rows: (string | number | null)[][]) {
  const text = [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\n')
  download(new Blob([text], { type: 'text/csv' }), filename)
}

export function downloadChartPng(host: HTMLElement | null, filename: string, title: string, legend: LegendEntry[]) {
  const source = host?.querySelector('canvas')
  if (!source) return
  const scale = source.clientWidth ? source.width / source.clientWidth : 1
  const header = Math.round((legend.length ? 60 : 40) * scale)
  const canvas = document.createElement('canvas')
  canvas.width = source.width
  canvas.height = source.height + header
  const context = canvas.getContext('2d')
  if (!context) return
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.fillStyle = '#121a2c'
  context.font = `600 ${14 * scale}px Inter, system-ui, sans-serif`
  context.fillText(title, 12 * scale, 24 * scale, canvas.width - 24 * scale)
  context.font = `${12 * scale}px Inter, system-ui, sans-serif`
  let x = 12 * scale
  for (const entry of legend) {
    context.fillStyle = entry.color
    context.fillRect(x, 38 * scale, 10 * scale, 10 * scale)
    x += 16 * scale
    context.fillStyle = '#566176'
    context.fillText(entry.label, x, 47 * scale)
    x += context.measureText(entry.label).width + 18 * scale
  }
  context.drawImage(source, 0, header)
  canvas.toBlob((blob) => blob && download(blob, filename))
}
