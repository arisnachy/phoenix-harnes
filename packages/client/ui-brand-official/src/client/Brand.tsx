import { PhoenixLogo } from '@deepseek-ai/dsh-client-ui-primitives'
import type { HeroBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SidebarBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'

type PhoenixBrandMarkProps = HeroBrandMarkOwnerProps & SidebarBrandMarkOwnerProps

/**
 * Render the PHOENIX mark with the presentation requested by its host surface.
 * @param props - Host-supplied mark presentation.
 * @returns the PHOENIX emblem.
 */
export function PhoenixBrandMark({ size, className }: PhoenixBrandMarkProps) {
  return <PhoenixLogo size={size} {...(className === undefined ? {} : { className })} />
}

/**
 * Render the PHOENIX name artwork without its independently slotted mark.
 * @returns the PHOENIX name wordmark.
 */
export function PhoenixBrandName() {
  return (
    <span
      role="img"
      aria-label="PHOENIX"
      style={{ display: 'inline-flex', alignItems: 'center', width: 150, height: 36 }}
    >
      <svg
        aria-hidden="true"
        width="150"
        height="36"
        viewBox="0 0 150 36"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <g
          fill="currentColor"
          fontFamily="'Segoe UI Variable Display', 'Avenir Next', ui-sans-serif, system-ui, sans-serif"
          fontSize="21"
          fontWeight="650"
          letterSpacing="2.2"
        >
          <text x="1" y="25.5">PH</text>
          <text x="61" y="25.5">ENIX</text>
        </g>
        <ellipse cx="47" cy="18" rx="13" ry="15" stroke="currentColor" strokeWidth="1.7" />
        <ellipse cx="47" cy="18" rx="10.5" ry="12.5" stroke="currentColor" strokeOpacity="0.65" strokeWidth="1" />
        <path d="M30 18H38M56 18H64" stroke="currentColor" strokeOpacity="0.65" strokeWidth="0.9" />
        <path d="M47 5.2L48.1 9.8L51.8 11L48.1 12.2L47 16.8L45.9 12.2L42.2 11L45.9 9.8L47 5.2Z" fill="currentColor" fillOpacity="0.55" />
        <path
          data-wordmark-o-flame="true"
          d="M47 8.2C44.8 12.8 49.2 14 48.7 16.8C48.3 19.1 46.4 20.1 47.5 23.8C43.5 21.8 42.5 18.3 44.5 15.7C43.4 13.9 44.9 10.3 47 8.2Z"
          fill="currentColor"
        />
        <path d="M47 16.2C45.7 18.5 46.2 20.1 47.4 21.5C48.4 19.9 48.4 18.2 47 16.2Z" fill="currentColor" fillOpacity="0.32" />
        <path d="M47 25L48.1 28.2L47 31.4L45.9 28.2L47 25Z" fill="currentColor" fillOpacity="0.72" />
      </svg>
    </span>
  )
}
