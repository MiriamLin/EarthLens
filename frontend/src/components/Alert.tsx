import type { ReactNode } from 'react'
import { AlertIcon, CheckIcon, InfoIcon, WarningIcon } from './Icons'

type Tone = 'error' | 'warning' | 'success' | 'info'

const STYLES: Record<Tone, string> = {
  error: 'border-danger-line bg-danger-soft text-danger',
  warning: 'border-warning-line bg-warning-soft text-warning',
  success: 'border-success-line bg-success-soft text-success',
  info: 'border-navy-line bg-navy-soft text-navy',
}

const ICONS = { error: AlertIcon, warning: WarningIcon, success: CheckIcon, info: InfoIcon }

export default function Alert({ tone = 'error', children, className = '' }: { tone?: Tone; children: ReactNode; className?: string }) {
  const Icon = ICONS[tone]
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={`flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-sm ${STYLES[tone]} ${className}`}>
      <Icon size={16} className="mt-0.5 shrink-0" />
      <div className="min-w-0 leading-5">{children}</div>
    </div>
  )
}
