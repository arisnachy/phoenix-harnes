import { useEffect, useRef, useState } from 'react'
import type { ApprovalDeadline, ApprovalOutcome } from '@phoenix-ai/dsh-user-approval'
import { Button } from '@phoenix-ai/dsh-client-ui-primitives'
import css from './ApprovalCountdown.module.css'

/** User-facing labels for the countdown action row. */
export interface ApprovalCountdownLabels {
  readonly allow: string
  readonly reject: string
  readonly automatic: string
  readonly seconds: string
}

/** Props for the single bounded approval surface. */
export interface ApprovalCountdownProps {
  /** Persisted server deadline and risk-derived recommendation. */
  readonly deadline: ApprovalDeadline
  /** Called once when the deadline applies its recommendation. */
  readonly onExpire: (outcome: 'allowed-once' | 'rejected') => void
  /** Called once when the user chooses an explicit outcome. */
  readonly onChoose: (outcome: 'allowed-once' | 'rejected') => void
  /** Optional localized labels; English is the stable fallback. */
  readonly labels?: Partial<ApprovalCountdownLabels>
}

const DEFAULT_LABELS: ApprovalCountdownLabels = {
  allow: 'Allow once',
  reject: 'Reject',
  automatic: 'Automatic decision',
  seconds: 'seconds remaining',
}

/** Render a second-readable approval deadline and settle it exactly once. */
export function ApprovalCountdown({ deadline, onExpire, onChoose, labels }: ApprovalCountdownProps) {
  const copy = { ...DEFAULT_LABELS, ...labels }
  const [remaining, setRemaining] = useState(() => Math.max(0, Math.ceil((deadline.expiresAt - Date.now()) / 1000)))
  const settled = useRef(false)

  useEffect(() => {
    const settleExpiry = (): void => {
      if (settled.current) return
      settled.current = true
      onExpire(deadline.recommendation)
    }
    const update = (): void => {
      const next = Math.max(0, Math.ceil((deadline.expiresAt - Date.now()) / 1000))
      setRemaining(next)
      if (next === 0) settleExpiry()
    }
    update()
    const timer = window.setInterval(update, 250)
    return () => { window.clearInterval(timer) }
  }, [deadline, onExpire])

  const choose = (outcome: 'allowed-once' | 'rejected'): void => {
    if (settled.current) return
    settled.current = true
    onChoose(outcome)
  }
  const recommendation = deadline.recommendation === 'allowed-once' ? copy.allow : copy.reject
  const secondsLabel = `${remaining} ${copy.seconds}`

  return (
    <div className={css.root} data-approval-countdown="" data-risk={deadline.risk}>
      <div className={css.status} role="status" aria-label={secondsLabel}>
        <span className={css.label}>{copy.automatic}: {recommendation}</span>
        <span className={css.timer}>{secondsLabel}</span>
      </div>
      <div className={css.progressTrack} aria-hidden="true">
        <span
          className={css.progress}
          style={{ transform: `scaleX(${Math.max(0, Math.min(1, (deadline.expiresAt - Date.now()) / Math.max(1, deadline.expiresAt - deadline.requestedAt)))})` }}
        />
      </div>
      <div className={css.actions}>
        <Button variant="outline" disabled={settled.current} onClick={() => { choose('rejected') }}>
          {copy.reject}
        </Button>
        <Button variant="primary" disabled={settled.current} onClick={() => { choose('allowed-once') }}>
          {copy.allow}
        </Button>
      </div>
    </div>
  )
}

/** Keep the imported outcome vocabulary visible to declaration emitters. */
export type ApprovalCountdownOutcome = Extract<ApprovalOutcome, 'allowed-once' | 'rejected'>
