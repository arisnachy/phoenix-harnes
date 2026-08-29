import { PhoenixLogo } from '@phoenix-ai/dsh-client-ui-primitives'
import type { HeroBrandMarkOwnerProps } from '@phoenix-ai/dsh-client-ui-conversation/client'
import type { SidebarBrandMarkOwnerProps } from '@phoenix-ai/dsh-client-ui-sidebar/client'

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
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        height: 34,
        color: 'var(--dsw-alias-label-primary)',
        fontFamily: "'Avenir Next', Inter, ui-sans-serif, system-ui, sans-serif",
        fontSize: 22,
        fontWeight: 600,
        letterSpacing: '0.18em',
        lineHeight: 1,
        whiteSpace: 'nowrap',
      }}
    >
      PHOENIX
    </span>
  )
}
