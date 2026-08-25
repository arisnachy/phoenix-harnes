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
    <span style={{ position: 'relative', display: 'block', width: 156, height: 52 }}>
      <img
        src="/phoenix-wordmark.png"
        width="156"
        height="52"
        alt="PHOENIX"
        draggable={false}
        style={{ display: 'block', width: 156, height: 52, objectFit: 'contain' }}
      />
      <span
        data-phoenix-auto-update-canary="9"
        style={{
          position: 'absolute',
          right: 2,
          top: 2,
          padding: '2px 5px',
          borderRadius: 999,
          background: '#9333ea',
          color: '#fff',
          fontSize: 8,
          fontWeight: 800,
          lineHeight: 1.2,
          letterSpacing: '0.06em',
          pointerEvents: 'none',
        }}
      >
        AUTO TEST 9
      </span>
    </span>
  )
}
