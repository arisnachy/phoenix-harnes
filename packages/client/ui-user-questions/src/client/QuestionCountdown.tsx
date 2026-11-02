import { useEffect, useRef, useState } from 'react'
import type { QuestionDeadline } from '@phoenix-ai/dsh-user-questions/types'
import css from './QuestionCountdown.module.css'

/** Props for the quiet, second-readable question deadline. */
export interface QuestionCountdownProps {
  /** Host-issued deadline. */
  readonly deadline: QuestionDeadline
  /** Label of the answer that will be applied automatically. */
  readonly recommendation: string
  /** Called once when the deadline expires. */
  readonly onExpire: () => void
  /** Accessible/localized copy for the status line. */
  readonly labels?: Partial<{ automatic: string; seconds: string }>
}

const DEFAULT_LABELS = { automatic: 'Automatic choice', seconds: 'seconds remaining' }

/** Display and enforce a one-minute question deadline without blocking the card. */
export function QuestionCountdown({ deadline, recommendation, onExpire, labels }: QuestionCountdownProps) {
  const copy = { ...DEFAULT_LABELS, ...labels }
  const [remaining, setRemaining] = useState(() => Math.max(0, Math.ceil((deadline.expiresAt - Date.now()) / 1_000)))
  const settled = useRef(false)

  useEffect(() => {
    settled.current = false
    const update = (): void => {
      const next = Math.max(0, Math.ceil((deadline.expiresAt - Date.now()) / 1_000))
      setRemaining(next)
      if (next === 0 && !settled.current) {
        settled.current = true
        onExpire()
      }
    }
    update()
    const timer = window.setInterval(update, 250)
    return () => { window.clearInterval(timer) }
  }, [deadline, onExpire])

  const total = Math.max(1, deadline.expiresAt - deadline.requestedAt)
  const progress = Math.max(0, Math.min(1, (deadline.expiresAt - Date.now()) / total))
  return (
    <div className={css.root} data-question-countdown="" data-seconds={remaining}>
      <div className={css.status} role="status" aria-label={`${remaining} ${copy.seconds}`}>
        <span>{copy.automatic}: <strong>{recommendation}</strong></span>
        <span className={css.timer}>{remaining} {copy.seconds}</span>
      </div>
      <div className={css.track} aria-hidden="true"><span className={css.progress} style={{ transform: `scaleX(${progress})` }} /></div>
    </div>
  )
}
