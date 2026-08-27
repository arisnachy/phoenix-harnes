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
      style={{ display: 'inline-flex', alignItems: 'center', width: 142, height: 34 }}
    >
      <svg
        aria-hidden="true"
        width="142"
        height="34"
        viewBox="0 0 142 34"
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
          <text x="1" y="24.5">PH</text>
          <text x="57" y="24.5">ENIX</text>
        </g>
        <ellipse cx="43" cy="17" rx="9" ry="10.5" stroke="currentColor" strokeWidth="2.2" />
        <path
          data-wordmark-o-spark="true"
          d="M43 10.2L44.35 15.65L49.2 17L44.35 18.35L43 23.8L41.65 18.35L36.8 17L41.65 15.65L43 10.2Z"
          fill="currentColor"
          fillOpacity="0.72"
        />
      </svg>
    </span>
  )
}
