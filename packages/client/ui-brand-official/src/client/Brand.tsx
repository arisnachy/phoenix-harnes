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
      style={{ display: 'inline-flex', alignItems: 'center', width: 162, height: 38 }}
    >
      <svg
        aria-hidden="true"
        width="162"
        height="38"
        viewBox="0 0 162 38"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <g
          fill="currentColor"
          fontFamily="Impact, Haettenschweiler, 'Arial Narrow Bold', sans-serif"
          fontSize="22"
          fontWeight="700"
          letterSpacing="1.7"
        >
          <text x="1" y="27">PH</text>
          <text x="79" y="27">ENIX</text>
        </g>
        <ellipse cx="61" cy="19" rx="14.5" ry="16.5" stroke="currentColor" strokeWidth="2.2" />
        <ellipse cx="61" cy="19" rx="11.8" ry="13.8" stroke="currentColor" strokeOpacity="0.58" strokeWidth="1" />
        <path d="M40 19H47M75 19H82" stroke="currentColor" strokeOpacity="0.7" strokeWidth="1" />
        <path d="M61 2.5L62.3 7.5L66.3 8.8L62.3 10.1L61 15.1L59.7 10.1L55.7 8.8L59.7 7.5L61 2.5Z" fill="currentColor" fillOpacity="0.72" />
        <path
          data-wordmark-o-flame="true"
          d="M61 8C57.8 13.2 62.4 14.8 62 18C61.7 20.6 59.5 21.7 61.2 26.7C56.2 24.3 55 19.9 57.6 16.9C56.2 14.6 58.2 10.4 61 8Z"
          fill="currentColor"
        />
        <path d="M61 16.4C59.3 19.1 60 21.1 61.6 22.8C62.7 20.8 62.6 18.8 61 16.4Z" fill="currentColor" fillOpacity="0.32" />
        <path d="M61 27L62.3 31.3L61 35.5L59.7 31.3L61 27Z" fill="currentColor" fillOpacity="0.7" />
      </svg>
    </span>
  )
}
