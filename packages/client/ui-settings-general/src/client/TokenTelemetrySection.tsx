/** Live, locally collected token-usage dashboard inside Settings. */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
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
  const [error, setError] = useState(false)
  const [busy, setBusy] = useState(false)
  const [now, setNow] = useState(() => Date.now())

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const data = await readTelemetry()
      setSnapshot(data)
      setNow(Date.now())
      setError(false)
    } catch {
      setError(true)
    }
  }, [readTelemetry])

  useEffect(() => {
    void refresh()
    const interval = window.setInterval(() => { void refresh() }, 10_000)
    return () => { window.clearInterval(interval) }
  }, [refresh])

  const mutate = async (operation: () => Promise<TokenTelemetrySnapshot>): Promise<void> => {
    if (busy) return
    setBusy(true)
    try {
      setSnapshot(await operation())
      setNow(Date.now())
      setError(false)
    } catch {
      setError(true)
    } finally {
      setBusy(false)
    }
  }

  const selected = useMemo(() => (snapshot?.records ?? [])
    .filter(record => record.at >= now - PERIOD_MS[period] && record.at <= now + 60_000), [snapshot, period, now])
  const completed = selected.filter(record => record.inputTokens !== undefined)
  const inputTokens = completed.reduce((sum, record) => sum + (record.inputTokens ?? 0), 0)
  const outputTokens = completed.reduce((sum, record) => sum + (record.outputTokens ?? 0), 0)
  const cacheTokens = completed.reduce((sum, record) => sum + (record.cacheReadTokens ?? 0), 0)
  const reasoningTokens = completed.reduce((sum, record) => sum + (record.reasoningTokens ?? 0), 0)
  const contributions: Contribution[] = COMPONENT_KEYS.map(([key, property]) => ({
    key, size: selected.reduce((sum, record) => sum + record[property], 0),
  })).sort((a, b) => b.size - a.size)
  const totalChars = contributions.reduce((sum, item) => sum + item.size, 0)
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
            disabled={busy || snapshot === undefined}
            checked={snapshot?.enabled ?? false}
            onChange={event => { void mutate(() => setTelemetry(event.currentTarget.checked)) }}
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
      {error ? <p className={css.notice} role="alert">{t('telemetry.error')}</p> : null}
      {!snapshot?.enabled ? <p className={css.notice}>{t('telemetry.disabled')}</p> : null}
      <div className={css.stats}>
        {([
          [t('telemetry.input'), inputTokens],
          [t('telemetry.output'), outputTokens],
          [t('telemetry.cache'), cacheTokens],
          [t('telemetry.reasoning'), reasoningTokens],
        ] as const).map(([label, amount]) => (
          <div className={css.stat} key={label}>
            <span>{label}</span>
            <strong>{completed.length > 0 ? number(amount) : '—'}</strong>
          </div>
        ))}
      </div>
      <p className={css.note}>{t('telemetry.actualNote')}</p>
      <div className={css.panel}>
        <h3>{t('telemetry.breakdown')}</h3>
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
