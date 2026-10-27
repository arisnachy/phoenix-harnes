/** Live, locally collected token-usage dashboard inside Settings. */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { TokenTelemetrySnapshot } from '@phoenix-ai/dsh-api-remotes/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@phoenix-ai/dsh-client-ui-slots'
import type { SettingsKey } from './locales.ts'
import css from './TokenTelemetrySection.module.css'

/** Trusted Host-only snapshot and mutation methods. */
export interface TokenTelemetrySectionInjected {
  readTelemetry: () => Promise<TokenTelemetrySnapshot>
  setTelemetry: (enabled: boolean) => Promise<TokenTelemetrySnapshot>
  clearTelemetry: () => Promise<TokenTelemetrySnapshot>
}

export type TokenTelemetrySectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'settings'>
  & InjectFace<TokenTelemetrySectionInjected>

type Period = '5h' | '24h' | '7d'
type Contribution = {
  readonly key: SettingsKey
  readonly size: number
}

const COMPONENT_KEYS = [
  ['telemetry.system', 'systemChars'],
  ['telemetry.tools', 'schemaChars'],
  ['telemetry.human', 'humanChars'],
  ['telemetry.assistant', 'assistantChars'],
  ['telemetry.toolResults', 'toolResultChars'],
  ['telemetry.memory', 'runtimeContextChars'],
  ['telemetry.other', 'otherHistoryChars'],
] as const satisfies readonly (readonly [SettingsKey, keyof TokenTelemetrySnapshot['records'][number]])[]
const PERIOD_MS: Record<Period, number> = { '5h': 5 * 3_600_000, '24h': 24 * 3_600_000, '7d': 7 * 86_400_000 }

function number(value: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value)
}

/**
 * Show current provider usage and non-sensitive request composition in Settings.
 * @param props - Host-backed telemetry actions and the current Settings locale.
 * @returns A themed interactive dashboard without any model request.
 */
export function TokenTelemetrySection({
  t, readTelemetry, setTelemetry, clearTelemetry,
}: TokenTelemetrySectionProps): ReactNode {
  const [snapshot, setSnapshot] = useState<TokenTelemetrySnapshot | undefined>()
  const [period, setPeriod] = useState<Period>('5h')
  const [error, setError] = useState<string | undefined>()
  const operationId = useRef(0)
  const [busy, setBusy] = useState(false)
  const [now, setNow] = useState(() => Date.now())

  const refresh = useCallback(async (): Promise<void> => {
    const request = operationId.current
    try {
      const data = await readTelemetry()
      if (request !== operationId.current) return
      setSnapshot(data)
      setNow(Date.now())
      setError(undefined)
    } catch (reason: unknown) {
      if (request !== operationId.current) return
      setError(reason instanceof Error ? reason.message : 'UNAVAILABLE')
    }
  }, [readTelemetry])

  useEffect(() => {
    void refresh()
    const interval = window.setInterval(() => { void refresh() }, 10_000)
    return () => { window.clearInterval(interval) }
  }, [refresh])

  const mutate = async (operation: () => Promise<TokenTelemetrySnapshot>): Promise<void> => {
    if (busy) return
    operationId.current += 1
    setBusy(true)
    try {
      setSnapshot(await operation())
      setNow(Date.now())
      setError(undefined)
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : 'UNAVAILABLE')
    } finally {
      setBusy(false)
    }
  }

  const selected = useMemo(() => (snapshot?.records ?? [])
    .filter(record => record.at >= now - PERIOD_MS[period] && record.at <= now + 60_000), [snapshot, period, now])
  const completed = selected.filter(record => record.inputTokens !== undefined)
  const inputTokens = completed.reduce((sum, record) => sum + (record.inputTokens ?? 0), 0)
  const outputTokens = completed.reduce((sum, record) => sum + (record.outputTokens ?? 0), 0)
  const cacheReported = completed.filter(record => record.cacheReadTokens !== undefined)
  const cacheTokens = cacheReported.reduce((sum, record) => sum + (record.cacheReadTokens ?? 0), 0)
  // Pre-fix legacy zeros cannot be distinguished from first-after-restart.
  // Do not misrepresent those unknown comparisons as confirmed 0% stability.
  const legacyUnknownCount = selected.filter(record =>
    record.prefixComparison === undefined && record.reusedSystemPrefixChars === 0).length
  const baselineCount = selected.filter(record => record.prefixComparison === 'baseline').length
  const prefixSamples = selected.filter(record => record.reusedSystemPrefixChars !== undefined
    && (record.prefixComparison === 'compared'
      || (record.prefixComparison === undefined && record.reusedSystemPrefixChars > 0)))
  const systemChars = prefixSamples.reduce((sum, record) => sum + record.systemChars, 0)
  const reusedPrefixChars = prefixSamples.reduce((sum, record) => sum + (record.reusedSystemPrefixChars ?? 0), 0)
  const prefixReusePercent = systemChars > 0 ? number(reusedPrefixChars / systemChars * 100) : undefined
  const reasoningTokens = completed.reduce((sum, record) => sum + (record.reasoningTokens ?? 0), 0)
  const contributions: Contribution[] = COMPONENT_KEYS.map(([key, property]) => ({
    key, size: selected.reduce((sum, record) => {
      const sdk = Math.min(record.systemChars, record.systemSdkChars ?? 0)
      if (property === 'systemChars') return sum + record.systemChars - sdk
      if (property === 'schemaChars') return sum + record.schemaChars + sdk
      return sum + record[property]
    }, 0),
  })).sort((a, b) => b.size - a.size)
  const totalChars = contributions.reduce((sum, item) => sum + item.size, 0)
  const legacySdkUnknown = selected.some(record => record.systemSdkChars === undefined)
  const models = useMemo(() => {
    const grouped = new Map<string, { calls: number; input: number; output: number }>()
    for (const item of selected) {
      const key = [item.provider, item.model, item.reasoningEffort].filter(Boolean).join(' / ') || '—'
      const previous = grouped.get(key) ?? { calls: 0, input: 0, output: 0 }
      grouped.set(key, {
        calls: previous.calls + 1,
        input: previous.input + (item.inputTokens ?? 0),
        output: previous.output + (item.outputTokens ?? 0),
      })
    }
    return [...grouped.entries()].sort((a, b) =>
      b[1].input + b[1].output - a[1].input - a[1].output)
  }, [selected])

  return (
    <section className={css.root} data-phoenix-telemetry="true" aria-label={t('telemetry.nav')}>
      <div className={css.heading}>
        <div>
          <h2>{t('telemetry.heading')}</h2>
          <p>{t('telemetry.description')}</p>
        </div>
        <button className={css.button} type="button" onClick={() => { void refresh() }}>
          {t('telemetry.refresh')}
        </button>
      </div>
      <div className={css.toolbar}>
        <label className={css.toggle}>
          <input
            type="checkbox"
            disabled={busy}
            checked={snapshot?.enabled ?? false}
            onChange={(event) => {
              const enabled = event.currentTarget.checked
              void mutate(() => setTelemetry(enabled))
            }}
          />
          <span>{t('telemetry.enabled')}</span>
        </label>
        <div className={css.periods} role="group" aria-label={t('telemetry.period')}>
          {(['5h', '24h', '7d'] as const).map(value => (
            <button
              key={value}
              type="button"
              className={period === value ? css.active : css.period}
              aria-pressed={period === value}
              onClick={() => { setPeriod(value) }}
            >{value}</button>
          ))}
        </div>
      </div>
      {error !== undefined ? (
        <div className={css.notice} role="alert">
          <p>{error === 'TELEMETRY_HOST_UPDATE_REQUIRED'
            ? t('telemetry.hostUnavailable')
            : t('telemetry.error')}</p>
          <code>{error.replace(/[^a-zA-Z0-9_.:-]/gu, '').slice(0, 64)}</code>
        </div>
      ) : null}
      {snapshot?.enabled === false ? <p className={css.notice}>{t('telemetry.disabled')}</p> : null}
      <div className={css.stats}>
        {([
          [t('telemetry.input'), completed.length > 0 ? number(inputTokens) : '—'],
          [t('telemetry.output'), completed.length > 0 ? number(outputTokens) : '—'],
          [t('telemetry.cache'), cacheReported.length > 0 ? number(cacheTokens) : '—'],
          [t('telemetry.reasoning'),
            completed.some(record => record.reasoningTokens !== undefined) ? number(reasoningTokens) : '—'],
        ] as const).map(([label, amount]) => (
          <div className={css.stat} key={label}>
            <span>{label}</span>
            <strong>{amount}</strong>
          </div>
        ))}
      </div>
      <p className={css.note}>{t('telemetry.actualNote')}</p>
      <div className={css.panel}>
        <h3>{t('telemetry.cachePrefix')}</h3>
        <p className={css.diagnosis}>
          {prefixReusePercent === undefined ? t('telemetry.cachePrefixPending')
            : `${prefixReusePercent}% ${t('telemetry.cachePrefixReused')}`}
        </p>
        <p className={css.note}>{t('telemetry.cachePrefixExplainer')}</p>
        {baselineCount > 0 ? (
          <p className={css.note}>{baselineCount} {t('telemetry.cachePrefixBaseline')}</p>
        ) : null}
        {legacyUnknownCount > 0 ? (
          <p className={css.note}>{legacyUnknownCount} {t('telemetry.cachePrefixLegacyUnknown')}</p>
        ) : null}
        {completed.length > 0 && cacheReported.length === 0
          ? <p className={css.notice}>{t('telemetry.cacheUnknown')}</p>
          : null}
      </div>
      <div className={css.panel}>
        <h3>{t('telemetry.breakdown')}</h3>
        {legacySdkUnknown ? <p className={css.note}>{t('telemetry.sdkLegacyUnknown')}</p> : null}
        {selected.length === 0 ? <p className={css.notice}>{t('telemetry.empty')}</p> : (
          <>
            {contributions.map(item => (
              <div className={css.breakdownRow} key={item.key}>
                <div className={css.rowLabel}>
                  <span>{t(item.key)}</span>
                  <span>{totalChars > 0 ? number(item.size / totalChars * 100) : '0'}%</span>
                </div>
                <div className={css.track}>
                  <div className={css.fill} style={{ width: `${totalChars > 0 ? item.size / totalChars * 100 : 0}%` }} />
                </div>
              </div>
            ))}
            <p className={css.note}>{t('telemetry.estimateNote')}</p>
            <p className={css.diagnosis} role="status">
              {t('telemetry.top')}: {contributions[0] === undefined ? '—' : t(contributions[0].key)}
            </p>
          </>
        )}
      </div>
      <div className={css.panel}>
        <h3>{t('telemetry.models')}</h3>
        {models.length === 0 ? <p className={css.notice}>{t('telemetry.empty')}</p> : (
          <div className={css.modelList}>
            {models.map(([model, usage]) => (
              <div className={css.model} key={model}>
                <strong>{model}</strong>
                <span>{usage.calls} {t('telemetry.calls')} · {number(usage.input)} ↓ / {number(usage.output)} ↑</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className={css.footer}>
        <span>{selected.length} {t('telemetry.requests')} · {completed.length} {t('telemetry.reported')}</span>
        <button
          className={css.button}
          disabled={busy || snapshot === undefined || snapshot.records.length === 0}
          type="button"
          onClick={() => { void mutate(clearTelemetry) }}
        >{t('telemetry.clear')}</button>
      </div>
      <p className={css.note}>{t('telemetry.privacy')}</p>
    </section>
  )
}
