/** Compact current-session context remaining meter for the Settings footer. */
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: supplies the canonical settings.trigger.trailing SlotMap row.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import css from './ContextRemaining.module.css'

interface ContextPressureView {
  pressureTokens?: number
  projectedTokens?: number
  contextWindow?: number
}

type ContextPressureReader = (key: string) => ContextPressureView | undefined

/** Props are entirely framework-owned by the session-maybe trailing slot. */
export type ContextRemainingProps = PropsRuntime<'settings.trigger.trailing'>

/**
 * Render remaining context beside Settings. A selected session gets a visible
 * placeholder until the provider reports its first pressure/capacity pair;
 * rail and no-session states render nothing and reserve no space.
 */
export function ContextRemaining({ wide, sessionId, useProjection }: ContextRemainingProps) {
  // The projection store is an open JSON key-space at runtime. Settings owns
  // only presentation, so it reads the small browser-safe shape it needs
  // instead of taking a package dependency on token-meter's implementation.
  const pressure = (useProjection as unknown as ContextPressureReader)('contextPressure')

  if (!wide || sessionId === undefined) return null

  const usedTokens = pressure?.projectedTokens ?? pressure?.pressureTokens
  const contextWindow = pressure?.contextWindow
  const usedPercent = usedTokens === undefined || contextWindow === undefined
    ? undefined
    : Math.min(100, Math.round(usedTokens / contextWindow * 100))
  const remaining = usedPercent === undefined ? undefined : 100 - usedPercent

  return (
    <span className={css.root} aria-hidden="true">
      <strong className={css.value}>{remaining === undefined ? '—' : `${remaining}%`}</strong>
      <span className={css.track}>
        <span className={css.fill} style={{ width: `${remaining ?? 0}%` }} />
      </span>
    </span>
  )
}
