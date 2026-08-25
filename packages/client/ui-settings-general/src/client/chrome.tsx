/**
 * Shell chrome content registered into the shell's trigger/header seats: the
 * trigger row icon + label (figma sidebar foot) and the panel title text.
 * The shell renders the surrounding chrome (button, nav heading row) and
 * reads each entry's `label` option for aria text.
 */
import { useEffect, useState } from 'react'
import { IconSettingsOutline14, IconSettingsOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { IApiClient } from '@deepseek-ai/dsh-api-remotes/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './chrome.module.css'

type AuthorizationClient = IApiClient['authorization']

interface RateLimitWindow {
  usedPercent: number
  windowDurationMins?: number
  resetsAt?: number
}

interface AccountTelemetry {
  kind: 'account'
  provider: string
  primaryLimit?: RateLimitWindow
  secondaryLimit?: RateLimitWindow
}

interface AuthorizationEntry {
  key: string
  telemetry?: AccountTelemetry
}

interface CodexQuotaSnapshot {
  primary?: RateLimitWindow
  secondary?: RateLimitWindow
}

/** Registrant-owned wire dependency for the Settings trigger. */
export interface TriggerContentInjected {
  /** Authorization catalog carrying native Codex account telemetry. */
  authorization?: AuthorizationClient
}

/** Trigger content props: sidebar state, standard locale seat, and telemetry wire. */
export type TriggerContentProps =
  PropsRuntime<'settings.trigger'> & PropsLocale<'settings'> & InjectFace<TriggerContentInjected>

/** Header content props: the standard locale seat only. */
export type HeaderContentProps = PropsRuntime<'settings.header'> & PropsLocale<'settings'>

const QUOTA_REFRESH_MS = 60_000

function remaining(limit: RateLimitWindow): number {
  return Math.max(0, Math.min(100, Math.round(100 - limit.usedPercent)))
}

function primaryLabel(limit: RateLimitWindow): string {
  const minutes = limit.windowDurationMins
  if (minutes === undefined) return '5 h'
  if (minutes >= 60 && minutes % 60 === 0) return `${minutes / 60} h`
  return `${Math.round(minutes)} min`
}

function resetLabel(limit: RateLimitWindow): string | undefined {
  if (limit.resetsAt === undefined) return undefined
  return new Intl.DateTimeFormat(undefined, {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  }).format(new Date(limit.resetsAt * 1000))
}

function quotaTitle(label: string, limit: RateLimitWindow): string {
  const reset = resetLabel(limit)
  return `Codex · ${label}: ${remaining(limit)}% remaining${reset === undefined ? '' : ` · resets ${reset}`}`
}

function isCodex(entry: AuthorizationEntry): boolean {
  return entry.key === 'openai-codex' || entry.telemetry?.provider.toLowerCase().includes('codex') === true
}

function CodexQuota({ authorization }: { authorization?: AuthorizationClient }) {
  const [quota, setQuota] = useState<CodexQuotaSnapshot | undefined>()

  useEffect(() => {
    if (authorization === undefined) return
    let stale = false
    const load = async (): Promise<void> => {
      try {
        const response = await authorization.list({})
        if (stale || !response.result.ok) return
        const entry = (response.result.value.entries as AuthorizationEntry[]).find(isCodex)
        const telemetry = entry?.telemetry
        if (telemetry === undefined || (telemetry.primaryLimit === undefined && telemetry.secondaryLimit === undefined)) {
          setQuota(undefined)
          return
        }
        setQuota({
          ...(telemetry.primaryLimit === undefined ? {} : { primary: telemetry.primaryLimit }),
          ...(telemetry.secondaryLimit === undefined ? {} : { secondary: telemetry.secondaryLimit }),
        })
      } catch {
        // Sidebar chrome is non-critical: keep the last known telemetry on a
        // transient transport failure rather than turning Settings into an error surface.
      }
    }

    void load()
    const timer = window.setInterval(() => { void load() }, QUOTA_REFRESH_MS)
    return () => {
      stale = true
      window.clearInterval(timer)
    }
  }, [authorization])

  if (quota === undefined) return null
  const primary = quota.primary
  const secondary = quota.secondary
  const primaryName = primary === undefined ? undefined : primaryLabel(primary)

  return (
    <span className={css.quotaGroup} aria-hidden="true">
      {primary === undefined || primaryName === undefined ? null : (
        <span className={css.quotaChip} title={quotaTitle(primaryName, primary)}>
          <span className={css.quotaMeta}>
            <span className={css.quotaLabel}>{primaryName}</span>
            <strong className={css.quotaValue}>{remaining(primary)}%</strong>
          </span>
          <span className={css.quotaTrack}>
            <span className={css.quotaFill} style={{ width: `${remaining(primary)}%` }} />
          </span>
        </span>
      )}
      {secondary === undefined ? null : (
        <span className={css.quotaChip} title={quotaTitle('Total', secondary)}>
          <span className={css.quotaMeta}>
            <span className={css.quotaLabel}>Total</span>
            <strong className={css.quotaValue}>{remaining(secondary)}%</strong>
          </span>
          <span className={css.quotaTrack}>
            <span className={css.quotaFill} style={{ width: `${remaining(secondary)}%` }} />
          </span>
        </span>
      )}
    </span>
  )
}

/**
 * Render the trigger row content (icon; label and native Codex quota only in
 * the wide column). The quota is read from the same authorization telemetry
 * used by the Models settings panel; no context-window estimate is invented.
 * @param props - composed slot props.
 * @returns the trigger content fragment.
 */
export function TriggerContent({ wide, t, authorization }: TriggerContentProps) {
  return (
    <>
      {wide ? <IconSettingsOutline16 size={16} /> : <IconSettingsOutline14 size={18} />}
      {wide && <span className={css.triggerLabel}>{t('trigger')}</span>}
      {wide && <CodexQuota authorization={authorization} />}
    </>
  )
}

/**
 * Render the panel title text.
 * @param props - composed slot props.
 * @returns the title text node.
 */
export function HeaderContent({ t }: HeaderContentProps) {
  return <>{t('title')}</>
}

/** Close-button label text props: the standard locale seat only. */
export type CloseLabelProps = PropsRuntime<'settings.close'> & PropsLocale<'settings'>

/**
 * Render the close button's visually-hidden label text.
 * @param props - composed slot props.
 * @returns the label text node.
 */
export function CloseLabel({ t }: CloseLabelProps) {
  return <>{t('close')}</>
}
