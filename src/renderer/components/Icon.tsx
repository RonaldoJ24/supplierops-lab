import type { ReactNode, SVGProps } from 'react'

export type IconName =
  | 'activity'
  | 'alert'
  | 'arrow-right'
  | 'check'
  | 'chevron-down'
  | 'clipboard'
  | 'close'
  | 'database'
  | 'file'
  | 'filter'
  | 'info'
  | 'lock'
  | 'moon'
  | 'play'
  | 'refresh'
  | 'search'
  | 'shield'
  | 'sun'
  | 'upload'
  | 'user-check'
  | 'warning'

const paths: Record<IconName, ReactNode> = {
  activity: (
    <>
      <path d="M3 12h4l2.2-7 4.1 14 2.2-7H21" />
    </>
  ),
  alert: (
    <>
      <path d="M10.3 3.8 2.8 17a1.5 1.5 0 0 0 1.3 2.2h15.8a1.5 1.5 0 0 0 1.3-2.2L13.7 3.8a2 2 0 0 0-3.4 0Z" />
      <path d="M12 9v4M12 16.5v.1" />
    </>
  ),
  'arrow-right': <path d="m5 12 14 0M13 6l6 6-6 6" />,
  check: <path d="m5 12 4 4L19 6" />,
  'chevron-down': <path d="m6 9 6 6 6-6" />,
  clipboard: (
    <>
      <path d="M9 4.5h6" />
      <rect x="5" y="3" width="14" height="18" rx="2" />
      <path d="M9 9h6M9 13h6M9 17h3" />
    </>
  ),
  close: <path d="m6 6 12 12M18 6 6 18" />,
  database: (
    <>
      <ellipse cx="12" cy="5" rx="7" ry="3" />
      <path d="M5 5v7c0 1.7 3.1 3 7 3s7-1.3 7-3V5M5 12v7c0 1.7 3.1 3 7 3s7-1.3 7-3v-7" />
    </>
  ),
  file: (
    <>
      <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z" />
      <path d="M14 3v6h6M8 13h8M8 17h6" />
    </>
  ),
  filter: <path d="M4 6h16M7 12h10M10 18h4" />,
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8.2v.1" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="10" width="14" height="10" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v2" />
    </>
  ),
  moon: <path d="M20.5 14.8A8.5 8.5 0 0 1 9.2 3.5 8.5 8.5 0 1 0 20.5 14.8Z" />,
  play: <path d="m9 6 9 6-9 6V6Z" />,
  refresh: (
    <>
      <path d="M20 11a8 8 0 0 0-14.8-3L3 11" />
      <path d="M3 6v5h5M4 13a8 8 0 0 0 14.8 3L21 13" />
      <path d="M21 18v-5h-5" />
    </>
  ),
  search: (
    <>
      <circle cx="10.8" cy="10.8" r="6.8" />
      <path d="m16 16 5 5" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3 20 6v5c0 5.1-3.3 8.9-8 10-4.7-1.1-8-4.9-8-10V6l8-3Z" />
      <path d="m8.5 12 2.2 2.2 4.8-4.8" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="3.5" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </>
  ),
  upload: (
    <>
      <path d="M12 15V3M7 8l5-5 5 5" />
      <path d="M5 14v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4" />
    </>
  ),
  'user-check': (
    <>
      <circle cx="9" cy="8" r="3" />
      <path d="M3.5 20a5.5 5.5 0 0 1 11 0M16 13l2 2 4-4" />
    </>
  ),
  warning: (
    <>
      <path d="M10.3 3.8 2.8 17a1.5 1.5 0 0 0 1.3 2.2h15.8a1.5 1.5 0 0 0 1.3-2.2L13.7 3.8a2 2 0 0 0-3.4 0Z" />
      <path d="M12 9v4M12 16.5v.1" />
    </>
  ),
}

export function Icon({
  name,
  size = 18,
  strokeWidth = 1.8,
  ...props
}: { name: IconName; size?: number; strokeWidth?: number } & Omit<
  SVGProps<SVGSVGElement>,
  'name'
>) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      {paths[name]}
    </svg>
  )
}
