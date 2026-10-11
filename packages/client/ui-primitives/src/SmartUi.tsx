import type { ReactNode } from 'react'
import css from './SmartUi.module.css'

/** Small, theme-aware outline icon set for assistant-generated UI. No remote assets or icon fonts. */
export type PhoenixUiIconName =
  | 'bot' | 'brain' | 'code' | 'check' | 'alert' | 'table' | 'calculator'
  | 'copy' | 'download' | 'reset' | 'clipboard' | 'plus' | 'file' | 'search'
  | 'settings' | 'calendar' | 'activity' | 'shield' | 'chart' | 'info'

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
