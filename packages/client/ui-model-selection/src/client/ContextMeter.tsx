/** Sidebar status for the selected OpenAI route's remaining request context. */
import { useSyncExternalStore } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the sidebar footer SlotMap row into this program.
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
// Type-only: installs the contextPressure projection key augmentation.
import type {} from '@deepseek-ai/dsh-token-meter/client'
import type { ContextMeterInjected } from './slots.ts'
import { isOpenAiContextProvider, remainingContextPercent } from './context-meter.ts'
import css from './ContextMeter.module.css'

type ContextMeterProps =
  Pick<PropsRuntime<'sidebar.footer.action'>, 'wide' | 'useProjection'>
  & ContextMeterInjected
  & PropsLocale<'model'>

/**
 * Render remaining OpenAI context for the current session.
 * @param props - footer geometry, current-session directory, projection hook, and locale seat.
 * @returns a compact meter, or null outside OpenAI routes/collapsed layout.
 */
export function ContextMeter({ wide, directory, useProjection, t }: ContextMeterProps) {
  const state = useSyncExternalStore(
    listener => directory?.subscribe(listener) ?? (() => {}),
    () => directory?.getSnapshot(),
    () => directory?.getSnapshot(),
  )
  const pressure = useProjection('contextPressure')
  const provider = state?.current?.provider

  if (!wide || !isOpenAiContextProvider(provider)) return null

  const remaining = remainingContextPercent(pressure)
  const ariaLabel = remaining === undefined
    ? t('context.waitingAria')
    : t('context.remainingAria', { percent: remaining })

  return (
    <div className={css.root} role="status" aria-label={ariaLabel}>
      <div className={css.header}>
        <span className={css.label}>{t('context.label')}</span>
        <span className={css.value}>{remaining === undefined ? '—' : `${remaining}%`}</span>
      </div>
      <div className={css.track} aria-hidden="true">
        <span className={css.fill} style={{ inlineSize: `${remaining ?? 0}%` }} />
      </div>
    </div>
  )
}
