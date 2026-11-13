/** Official native Codex reset controls with an explicit human confirmation. */
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { ModelsKey } from './locales.ts'
import styles from './ModelsSection.module.css'

const CODEX_USAGE_URL = 'https://chatgpt.com/codex/settings/usage'

/** Secret-free state read via the trusted PHOENIX Host. */
export interface CodexResetSnapshot {
  readonly connected: boolean
  readonly availableCount?: number
  readonly credits: readonly {
    readonly id: string
    readonly status: string
    readonly resetType: string
    readonly expiresAt?: number
    readonly title?: string
  }[]
  readonly primary?: { readonly usedPercent: number; readonly windowDurationMins?: number; readonly resetsAt?: number }
  readonly secondary?: { readonly usedPercent: number; readonly windowDurationMins?: number; readonly resetsAt?: number }
  readonly checkedAt: number
}

/** The Host RPC adapter used by the reset card. */
export interface CodexResetClient {
  state(): Promise<CodexResetSnapshot>
  redeem(request: { idempotencyKey: string; creditId?: string }): Promise<{
    outcome: 'reset' | 'alreadyRedeemed' | 'nothingToReset' | 'noCredit'
    state?: CodexResetSnapshot
  }>
}

/** Native reset card dependency injection. */
interface CodexResetsPanelProps {
  t: (key: ModelsKey) => string
  client?: CodexResetClient
}

function formatExpires(unixSeconds: number | undefined): string | undefined {
  if (unixSeconds === undefined) return undefined
  return new Date(unixSeconds * 1000).toLocaleString()
}

/** The reset confirmation remains a UI action, never an agent-initiated tool. */
export function CodexResetsPanel({ t, client }: CodexResetsPanelProps): ReactNode {
  const [snapshot, setSnapshot] = useState<CodexResetSnapshot | undefined>()
  const [loading, setLoading] = useState(false)
  const [redeeming, setRedeeming] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [notice, setNotice] = useState<string | undefined>()
  const [failure, setFailure] = useState<string | undefined>()
  // Hold the exact same UUID through retries after an uncertain network response.
  const attempt = useRef<string | undefined>(undefined)

  const refresh = (): void => {
    if (client === undefined || loading || redeeming) return
    setLoading(true)
    setFailure(undefined)
    void client.state().then(
      state => { setSnapshot(state); setConfirming(false) },
      () => { setFailure(t('codexResetsUnavailable')) },
    ).finally(() => { setLoading(false) })
  }

  useEffect(() => {
    if (client === undefined) return
    let mounted = true
    void client.state().then(
      state => { if (mounted) setSnapshot(state) },
      () => { if (mounted) setFailure(t('codexResetsUnavailable')) },
    )
    return () => { mounted = false }
  }, [client, t])

  const credit = snapshot?.credits.find(row =>
    row.status === 'available' && row.resetType === 'codexRateLimits'
    && (row.expiresAt === undefined || row.expiresAt > Date.now() / 1000))
  const count = snapshot?.availableCount
  const knownWindows = [snapshot?.primary, snapshot?.secondary].filter(
    (item): item is NonNullable<typeof snapshot>['primary'] & {} => item !== undefined,
  )
  const canResetWindow = knownWindows.length === 0
    || knownWindows.some(window => window.usedPercent > 20)
  const canRedeem = client !== undefined && snapshot?.connected === true
    && count !== undefined && count > 0 && canResetWindow

  const redeem = (): void => {
    if (client === undefined || !canRedeem || redeeming || !confirming) return
    attempt.current ??= globalThis.crypto.randomUUID()
    const idempotencyKey = attempt.current
    setRedeeming(true)
    setFailure(undefined)
    void client.redeem({
      idempotencyKey,
      ...credit === undefined ? {} : { creditId: credit.id },
    }).then(
      result => {
        setNotice(t(result.outcome === 'reset' || result.outcome === 'alreadyRedeemed'
          ? 'codexResetsRedeemed'
          : result.outcome === 'nothingToReset'
            ? 'codexResetsNotNeeded'
            : 'codexResetsNoCredits'))
        if (result.state !== undefined) setSnapshot(result.state)
        else if (result.outcome === 'reset' || result.outcome === 'alreadyRedeemed') {
          setFailure(t('codexResetsRefreshNeeded'))
        }
        attempt.current = undefined
        setConfirming(false)
      },
      () => {
        setFailure(t('codexResetsUncertain'))
        // Retain idempotencyKey so retrying this exact attempt cannot redeem twice.
      },
    ).finally(() => { setRedeeming(false) })
  }

  return (
    <section className={styles['authorizationPanel']} aria-labelledby="codex-resets-heading">
      <h2 id="codex-resets-heading" className={styles['title']}>{t('codexResetsTitle')}</h2>
      <p className={styles['intro']}>{t('codexResetsIntro')}</p>
      {snapshot?.connected === true ? (
        <>
          <p className={styles['rowName']}>
            {count === undefined ? t('codexResetsCountUnknown') : `${t('codexResetsAvailable')}: ${count}`}
          </p>
          {snapshot.primary !== undefined ? (
            <p className={styles['intro']}>{`${t('codexResetsPrimary')}: ${Math.max(0, 100 - snapshot.primary.usedPercent).toFixed(0)}%`}</p>
          ) : null}
          {snapshot.secondary !== undefined ? (
            <p className={styles['intro']}>{`${t('codexResetsSecondary')}: ${Math.max(0, 100 - snapshot.secondary.usedPercent).toFixed(0)}%`}</p>
          ) : null}
          {snapshot.credits.filter(row => row.status === 'available').map(row => (
            <p className={styles['intro']} key={row.id}>
              {row.title ?? t('codexResetsTitle')}
              {formatExpires(row.expiresAt) === undefined ? '' : ` · ${t('codexResetsExpires')} ${formatExpires(row.expiresAt)}`}
            </p>
          ))}
          {count !== undefined && count > 0 && !canResetWindow
            ? <p className={styles['intro']}>{t('codexResetsNotNeeded')}</p> : null}
        </>
      ) : snapshot !== undefined
        ? <p className={styles['notice']}>{t('codexResetsConnect')}</p> : null}
      <div className={styles['authorizationActions']}>
        <button type="button" className={styles['secondaryButton']} disabled={loading || redeeming || client === undefined} onClick={refresh}>
          {loading ? t('fetching') : t('codexResetsRefresh')}
        </button>
        {confirming ? (
          <>
            <button type="button" className={styles['primaryButton']} disabled={!canRedeem || redeeming} onClick={redeem}>
              {redeeming ? t('applying') : t('codexResetsConfirm')}
            </button>
            <button type="button" className={styles['secondaryButton']} disabled={redeeming} onClick={() => { setConfirming(false); attempt.current = undefined }}>
              {t('cancel')}
            </button>
          </>
        ) : (
          <button type="button" className={styles['primaryButton']} disabled={!canRedeem || loading || redeeming} onClick={() => { setNotice(undefined); setConfirming(true) }}>
            {t('codexResetsActivate')}
          </button>
        )}
        <a className={styles['secondaryButton']} href={CODEX_USAGE_URL} target="_blank" rel="noopener noreferrer">
          {t('codexResetsOpenUsage')}
        </a>
      </div>
      {confirming ? <p className={styles['notice']} role="alert">{t('codexResetsConfirmWarning')}</p> : null}
      {notice !== undefined ? <p className={styles['savedNotice']} role="status">{notice}</p> : null}
      {failure !== undefined ? <p className={styles['notice']} role="alert">{failure}</p> : null}
      <p className={styles['intro']}>{t('codexResetsCli')}</p>
      <p className={styles['intro']}>{t('codexResetsFallback')}</p>
      <p className={styles['intro']}>{t('codexResetsSafety')}</p>
    </section>
  )
}
