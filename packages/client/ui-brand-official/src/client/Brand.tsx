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
      style={{ display: 'inline-flex', alignItems: 'center', width: 138, height: 28 }}
    >
      <svg
        aria-hidden="true"
        width="138"
        height="28"
        viewBox="0 0 138 28"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <text
          x="1"
          y="18"
          fill="currentColor"
          fontFamily="'Avenir Next', 'Inter', ui-sans-serif, system-ui, sans-serif"
          fontSize="15"
          fontWeight="600"
          letterSpacing="2.7"
        >
          PHOENIX
        </text>
        <path d="M1 23.5H63L69 21L75 23.5H137" stroke="currentColor" strokeOpacity="0.28" strokeWidth="0.9" />
        <path d="M69 19.6L70.6 21.2L69 22.8L67.4 21.2L69 19.6Z" fill="currentColor" fillOpacity="0.7" />
      </svg>
    </span>
  )
}
