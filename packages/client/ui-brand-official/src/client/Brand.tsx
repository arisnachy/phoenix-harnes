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
    <>
      <img
        src="/phoenix-wordmark.png"
        width="156"
        height="52"
        alt="PHOENIX"
        draggable={false}
        style={{ display: 'block', width: 156, height: 52, objectFit: 'contain' }}
      />
      <span
        data-phoenix-main-sync-test="true"
        title="PHOENIX main automatic-update verification marker"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          height: 16,
          padding: '0 5px',
          borderRadius: 999,
          color: 'var(--dsw-alias-label-primary-inverted)',
          background: 'var(--dsw-alias-label-primary)',
          fontSize: 8,
          fontWeight: 700,
          lineHeight: '16px',
          letterSpacing: '0.05em',
          whiteSpace: 'nowrap',
        }}
      >
        MAIN TEST
      </span>
    </>
  )
}
