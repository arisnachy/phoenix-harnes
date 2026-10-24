/**
 * Pure, conservative quota reset-time recognition for durable Goal recovery.
 * A retry is scheduled only when the actual provider error gives a relative
 * wait. Unknown quota resets remain blocked for an explicit human decision.
 */
import { isHarnessError, QUOTA_EXCEEDED_CODE } from '@phoenix-ai/dsh-llm'

/** Stable prefix in the existing durable Goal.blockedReason.message. */
const RESUME_MARKER = '[Phoenix quota resume at '
const MAX_WAIT_MS = 7 * 24 * 60 * 60 * 1_000
const GRACE_MS = 30_000

/**
 * Resolve an eligible provider-stated wait, bounded to one week.
 * @param error - Actual model-provider quota failure, never an arbitrary tool error.
 * @param now - Time when Phoenix received the error.
 * @returns UTC wake instant, or undefined if no reliable reset hint exists.
 */
export function quotaResumeAt(error: unknown, now: number): string | undefined {
  if (!isHarnessError(error) || error.code !== QUOTA_EXCEEDED_CODE || !Number.isFinite(now)) return undefined
  const match = /\btry again in\s*~?\s*(\d{1,5})\s*(min(?:ute)?s?|h(?:ou)?rs?)\b/iu.exec(error.message)
  if (match === null) return undefined
  const amount = Number(match[1])
  const unit = match[2]?.toLowerCase() ?? ''
  const multiplier = unit.startsWith('h') ? 3_600_000 : 60_000
  const wait = amount * multiplier + GRACE_MS
  if (!Number.isSafeInteger(wait) || wait <= 0 || wait > MAX_WAIT_MS) return undefined
  const target = now + wait
  if (!Number.isFinite(target) || target > Date.parse('9999-12-31T23:59:59.999Z')) return undefined
  return new Date(target).toISOString()
}

/**
 * Annotate only a previously classified quota blocker with the target.
 * @param message - Existing human-facing blocker explanation.
 * @param at - Verified provider-derived UTC retry time.
 * @returns Durable message containing a parseable reset-time suffix.
 */
export function markQuotaResume(message: string, at: string): string {
  return `${message} ${RESUME_MARKER}${at}]`
}

/**
 * Recover the exact UTC target from one persisted quota blocker.
 * @param message - Persisted blockedReason.message text.
 * @returns Valid canonical UTC instant, or undefined.
 */
export function quotaResumeTarget(message: string): number | undefined {
  const match = /\[Phoenix quota resume at (\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z)\]$/u.exec(message)
  if (match === null) return undefined
  const time = Date.parse(match[1]!)
  return Number.isFinite(time) && new Date(time).toISOString() === match[1] ? time : undefined
}
