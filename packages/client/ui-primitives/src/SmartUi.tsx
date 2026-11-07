import type { ReactNode } from 'react'
import css from './SmartUi.module.css'

/** Small, theme-aware outline icon set for assistant-generated UI. No remote assets or icon fonts. */
export type PhoenixUiIconName =
  | 'bot' | 'brain' | 'code' | 'check' | 'alert' | 'table' | 'calculator'
  | 'copy' | 'download' | 'reset' | 'clipboard' | 'plus' | 'file' | 'search'
  | 'settings' | 'calendar' | 'activity' | 'shield' | 'chart' | 'info'
  | 'trophy' | 'star' | 'heart' | 'stethoscope' | 'hospital' | 'pill'
  | 'microscope' | 'graduation-cap' | 'book' | 'globe' | 'map-pin' | 'clock'
  | 'user' | 'users' | 'briefcase' | 'wallet' | 'building' | 'target'
  | 'trending-up' | 'sparkles' | 'database' | 'image' | 'basketball'
  | 'soccer' | 'baseball' | 'football' | 'filter' | 'award'

/** Render an icon by a validated, fixed identifier. */
export function PhoenixUiIcon({ name, size = 18, className }: {
  name: PhoenixUiIconName
  size?: number
  className?: string
}): ReactNode {
  const glyphs: Record<PhoenixUiIconName, ReactNode> = {
    bot: <><rect x="4" y="7" width="16" height="13" rx="4" /><path d="M12 3v4M9 3h6M4 12H2m20 0h-2" /><path d="M9 13h.01M15 13h.01" strokeWidth="3" /></>,
    brain: <><path d="M12 18V5a3 3 0 0 0-5.5-1.6A4 4 0 0 0 4 10a4 4 0 0 0 1 6.8A4 4 0 0 0 12 18Z" /><path d="M12 18V5a3 3 0 0 1 5.5-1.6A4 4 0 0 1 20 10a4 4 0 0 1-1 6.8A4 4 0 0 1 12 18ZM8 9c2 0 4 2 4 4m4-4c-2 0-4 2-4 4" /></>,
    code: <><path d="m8 8-4 4 4 4m8-8 4 4-4 4m-3-12-2 16" /></>,
    check: <path d="m4 12 5 5L20 6" />,
    alert: <><path d="m12 3 10 18H2L12 3Z" /><path d="M12 9v5m0 4h.01" /></>,
    table: <><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M9 3v18M3 15h18" /></>,
    calculator: <><rect x="5" y="2" width="14" height="20" rx="2" /><path d="M8 6h8M8 11h2m4 0h2m-8 4h2m4 0h2m-8 4h2m4 0h2" /></>,
    copy: <><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" /></>,
    download: <><path d="M12 3v12m-5-5 5 5 5-5M4 18v3h16v-3" /></>,
    reset: <><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /></>,
    clipboard: <><rect x="5" y="4" width="14" height="18" rx="2" /><rect x="9" y="2" width="6" height="4" rx="1" /><path d="M9 12h6m-6 4h6" /></>,
    plus: <path d="M12 4v16M4 12h16" />,
    file: <><path d="M5 2h9l5 5v15H5V2Z" /><path d="M14 2v5h5M8 12h8M8 16h8" /></>,
    search: <><circle cx="10" cy="10" r="7" /><path d="m15 15 6 6" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M10 2h4l.6 2.5 2 1 2.3-1.1 2.8 2.8-1.1 2.3 1 2L24 12l-2.4 2.5-1 2 1.1 2.3-2.8 2.8-2.3-1.1-2 1L14 24h-4l-.6-2.5-2-1-2.3 1.1-2.8-2.8 1.1-2.3-1-2L0 12l2.4-2.5 1-2-1.1-2.3 2.8-2.8 2.3 1.1 2-1Z" transform="translate(3 3) scale(.75)" /></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M8 2v6m8-6v6M3 10h18" /></>,
    activity: <path d="M2 12h5l3-8 4 16 3-8h5" />,
    shield: <><path d="M12 2 21 6v6c0 5-4 8-9 10-5-2-9-5-9-10V6l9-4Z" /><path d="m8 12 3 3 5-6" /></>,
    chart: <><path d="M3 3v18h18M7 16v-4m5 4V7m5 9V5" /></>,
    info: <><circle cx="12" cy="12" r="10" /><path d="M12 11v6m0-10h.01" /></>,
    trophy: <><path d="M7 4h10v6a5 5 0 0 1-10 0V4ZM7 6H4v2a4 4 0 0 0 4 4m9-6h3v2a4 4 0 0 1-4 4M12 15v4m-5 2h10" /></>,
    star: <path d="m12 2 3.1 6.4 7.1 1-5.1 5 1.2 7-6.3-3.3-6.3 3.3 1.2-7-5.1-5 7.1-1L12 2Z" />,
    heart: <path d="M20.8 4.9a5.4 5.4 0 0 0-7.6 0L12 6.1l-1.2-1.2a5.4 5.4 0 0 0-7.6 7.6L12 21l8.8-8.5a5.4 5.4 0 0 0 0-7.6Z" />,
    stethoscope: <><path d="M6 3v8a5 5 0 0 0 10 0V3M4 3h4m6 0h4M11 16v1a4 4 0 0 0 8 0v-2" /><circle cx="19" cy="13" r="2" /></>,
    hospital: <><rect x="4" y="3" width="16" height="19" rx="2" /><path d="M10 7h4m-2-2v4M8 22v-7h8v7M7 11h2m6 0h2" /></>,
    pill: <><rect x="3" y="7" width="18" height="10" rx="5" transform="rotate(-45 12 12)" /><path d="m8.5 8.5 7 7" /></>,
    microscope: <><path d="m9 3 5 5-3 3-5-5 3-3ZM11 11l-2 2m5-1a6 6 0 0 1-6 6M5 21h14M8 18v3m10-5h2" /></>,
    'graduation-cap': <><path d="m2 9 10-5 10 5-10 5L2 9Zm4 3v5c4 3 8 3 12 0v-5m4-3v8" /></>,
    book: <><path d="M3 4h8a3 3 0 0 1 3 3v14H6a3 3 0 0 0-3 0V4Zm18 0h-4a3 3 0 0 0-3 3v14h4a3 3 0 0 1 3 0V4Z" /></>,
    globe: <><circle cx="12" cy="12" r="10" /><path d="M2 12h20M12 2c6 5 6 15 0 20M12 2c-6 5-6 15 0 20" /></>,
    'map-pin': <><path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z" /><circle cx="12" cy="10" r="2.5" /></>,
    clock: <><circle cx="12" cy="12" r="10" /><path d="M12 6v6l4 2" /></>,
    user: <><circle cx="12" cy="7" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
    users: <><circle cx="9" cy="8" r="3.5" /><path d="M2 21a7 7 0 0 1 14 0m0-16a4 4 0 0 1 0 7m1 3a6 6 0 0 1 5 6" /></>,
    briefcase: <><rect x="2" y="7" width="20" height="14" rx="2" /><path d="M8 7V4h8v3M2 12c6 4 14 4 20 0" /></>,
    wallet: <><rect x="2" y="5" width="20" height="16" rx="3" /><path d="M2 9h20m-6 4h6v5h-6a2.5 2.5 0 0 1 0-5Z" /></>,
    building: <><rect x="4" y="3" width="16" height="19" rx="1" /><path d="M8 7h2m4 0h2M8 11h2m4 0h2M8 15h2m4 0h2m-6 7v-4h8v4" /></>,
    target: <><circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="6" /><circle cx="12" cy="12" r="2" /></>,
    'trending-up': <><path d="m3 17 6-6 4 4 8-8m-6 0h6v6" /></>,
    sparkles: <><path d="m12 2 2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5L12 2Zm7 0v4m-2-2h4M4 3v4M2 5h4" /></>,
    database: <><ellipse cx="12" cy="5" rx="9" ry="3" /><path d="M3 5v14c0 4 18 4 18 0V5M3 12c0 4 18 4 18 0" /></>,
    image: <><rect x="2" y="3" width="20" height="18" rx="2" /><circle cx="8" cy="9" r="2" /><path d="m3 18 6-6 4 4 3-3 5 5" /></>,
    basketball: <><circle cx="12" cy="12" r="10" /><path d="M12 2v20M2 12h20M4 6c8 1 12 6 16 12M20 6C12 7 8 12 4 18" /></>,
    soccer: <><circle cx="12" cy="12" r="10" /><path d="m12 7 4 3-1.5 4.5h-5L8 10l4-3ZM12 7V3m4 7 4-2m-5.5 6.5 2.5 4M9.5 14.5 7 18M8 10 4 8" /></>,
    baseball: <><circle cx="12" cy="12" r="10" /><path d="M7 4c4 5 4 11 0 16M17 4c-4 5-4 11 0 16M6 8l3 1m-3 4 3-1m9-4-3 1m3 4-3-1" /></>,
    football: <><path d="M3 17C2 11 8 4 21 6c1 6-5 13-18 11Z" /><path d="m9 12 6 1m-3-3v5m2-5v5" /></>,
    filter: <path d="M3 4h18l-7 8v7l-4 2v-9L3 4Z" />,
    award: <><circle cx="12" cy="8" r="6" /><path d="m8 13-2 9 6-3 6 3-2-9" /></>,

  }
  return <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"
    strokeLinejoin="round" className={className} aria-hidden="true">{glyphs[name]}</svg>
}

export type PhoenixStatusTone = 'positive' | 'warning' | 'negative' | 'info' | 'neutral'

/** Soft, compact semantic state matching the conversation's light/dark theme. */
export function PhoenixStatusPill({ label, tone = 'neutral' }: {
  label: string
  tone?: PhoenixStatusTone
}): ReactNode {
  return <span className={css.statusPill} data-tone={tone}>{label}</span>
}

/** Compact avatar + message row for model/team activity in the transcript. */
export function PhoenixAgentLine({ name, role, message, icon = 'bot' }: {
  name: string
  role: string
  message: string
  icon?: PhoenixUiIconName
}): ReactNode {
  return <div className={css.agentRow} data-phoenix-agent={name}>
    <span className={css.avatar}><PhoenixUiIcon name={icon} size={19} /></span>
    <div className={css.agentContent}>
      <div className={css.agentHeader}><strong>{name}</strong><span>{role}</span></div>
      <p>{message}</p>
    </div>
  </div>
}
