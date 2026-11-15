import type { ReactNode, SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement> & { size?: number }

function Icon({ size = 16, children, ...props }: IconProps & { children: ReactNode }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      {children}
    </svg>
  )
}

export const SearchIcon = (props: IconProps) => <Icon {...props}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></Icon>
export const FilterIcon = (props: IconProps) => <Icon {...props}><path d="M4 5h16l-6 7.5V19l-4 1.5v-8z" /></Icon>
export const TrashIcon = (props: IconProps) => <Icon {...props}><path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13M10 11v5.5M14 11v5.5" /></Icon>
export const PlusIcon = (props: IconProps) => <Icon {...props}><path d="M12 5v14M5 12h14" /></Icon>
export const PinIcon = (props: IconProps) => <Icon {...props}><path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z" /><circle cx="12" cy="10" r="2.5" /></Icon>
export const GripIcon = (props: IconProps) => <Icon {...props} strokeWidth="2.6"><path d="M9 6h.01M9 12h.01M9 18h.01M15 6h.01M15 12h.01M15 18h.01" /></Icon>
export const DownloadIcon = (props: IconProps) => <Icon {...props}><path d="M12 4v11m0 0-4-4m4 4 4-4M5 19h14" /></Icon>
export const ChevronDownIcon = (props: IconProps) => <Icon {...props}><path d="m6 9 6 6 6-6" /></Icon>
export const ChevronUpIcon = (props: IconProps) => <Icon {...props}><path d="m6 15 6-6 6 6" /></Icon>
export const ChevronRightIcon = (props: IconProps) => <Icon {...props}><path d="m9 6 6 6-6 6" /></Icon>
export const AlertIcon = (props: IconProps) => <Icon {...props}><circle cx="12" cy="12" r="9" /><path d="M12 7.5v5.5M12 16.5h.01" /></Icon>
export const WarningIcon = (props: IconProps) => <Icon {...props}><path d="M12 4 2.8 19.5h18.4z" /><path d="M12 10v4M12 17h.01" /></Icon>
export const CheckIcon = (props: IconProps) => <Icon {...props}><circle cx="12" cy="12" r="9" /><path d="m8 12.5 2.8 2.8L16.5 9.5" /></Icon>
export const InfoIcon = (props: IconProps) => <Icon {...props}><circle cx="12" cy="12" r="9" /><path d="M12 11v5.5M12 7.5h.01" /></Icon>
export const ChartIcon = (props: IconProps) => <Icon {...props}><path d="M4 4v16h16" /><path d="m7.5 14 3.5-4 3 3 5-6" /></Icon>
export const PanelIcon = (props: IconProps) => <Icon {...props}><rect x="3.5" y="4.5" width="17" height="15" rx="2" /><path d="M15 4.5v15" /></Icon>
export const MusicIcon = (props: IconProps) => <Icon {...props}><path d="M9 18V5l11-2v13" /><circle cx="6.5" cy="18" r="2.5" /><circle cx="17.5" cy="16" r="2.5" /></Icon>
export const PlayIcon = (props: IconProps) => <Icon {...props} fill="currentColor" stroke="none"><path d="M8 5.5v13l10.5-6.5z" /></Icon>
export const StopIcon = (props: IconProps) => <Icon {...props} fill="currentColor" stroke="none"><rect x="6.5" y="6.5" width="11" height="11" rx="1.5" /></Icon>
export const VolumeIcon = ({ level, ...props }: IconProps & { level: number }) => (
  <Icon {...props}>
    <path d="M11 5 6 9H3v6h3l5 4z" />
    {level > 0 && <path d="M15.5 8.5a5 5 0 0 1 0 7" />}
    {level > 0.5 && <path d="M18.5 5.5a9 9 0 0 1 0 13" />}
    {level === 0 && <path d="m16 9.5 5 5M21 9.5l-5 5" />}
  </Icon>
)
export const SpinnerIcon = (props: IconProps) => <Icon {...props} className={`animate-spin ${props.className ?? ''}`}><path d="M12 3a9 9 0 1 0 9 9" /></Icon>
