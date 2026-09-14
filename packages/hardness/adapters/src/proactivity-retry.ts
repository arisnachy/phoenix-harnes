import type { ProactivityEngine, ProactivityHistoryEntry } from './proactivity-engine.ts'

/** Bounded exponential backoff for scheduled work that failed after starting. */
export interface ProactivityRetryPolicy {
  readonly maxAttempts: number
  readonly retryBaseMs: number
  readonly retryMaxMs: number
}

/** Production defaults: enough persistence for transient outages without an infinite failure loop. */
export const DEFAULT_PROACTIVITY_RETRY_POLICY: ProactivityRetryPolicy = {
  maxAttempts: 5,
  retryBaseMs: 60_000,
  retryMaxMs: 3_600_000,
}

function positiveInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${field} must be a positive safe integer`)
  return value
}

function validatedPolicy(policy: ProactivityRetryPolicy): ProactivityRetryPolicy {
  const maxAttempts = positiveInteger(policy.maxAttempts, 'maxAttempts')
  const retryBaseMs = positiveInteger(policy.retryBaseMs, 'retryBaseMs')
  const retryMaxMs = positiveInteger(policy.retryMaxMs, 'retryMaxMs')
  if (retryMaxMs < retryBaseMs) throw new Error('retryMaxMs must be greater than or equal to retryBaseMs')
  return { maxAttempts, retryBaseMs, retryMaxMs }
}

function latestFailure(history: readonly ProactivityHistoryEntry[]): ProactivityHistoryEntry | undefined {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const row = history[index]
    if (row?.status === 'failed') return row
  }
  return undefined
}

function failedAttempts(history: readonly ProactivityHistoryEntry[], latest: ProactivityHistoryEntry): number {
  return history.filter(row => row.status === 'failed'
    && row.phase === latest.phase
    && row.scheduledFor === latest.scheduledFor).length
}

function delayForAttempt(attempt: number, policy: ProactivityRetryPolicy): number {
  const exponent = Math.max(0, attempt - 1)
  const multiplier = 2 ** Math.min(exponent, 30)
  return Math.min(policy.retryBaseMs * multiplier, policy.retryMaxMs)
}

/**
 * Resume failed durable tasks only when their persisted history says their
 * backoff has elapsed. Because the deadline is derived from `finishedAt`, a
 * Phoenix restart does not reset or lose the retry clock.
 *
 * @returns the number of tasks moved back to `scheduled` for this pump pass.
 */
export async function retryFailedProactivityTasks(
  engine: ProactivityEngine,
  now: Date = new Date(),
  requestedPolicy: ProactivityRetryPolicy = DEFAULT_PROACTIVITY_RETRY_POLICY,
): Promise<number> {
  const nowMs = now.getTime()
  if (!Number.isFinite(nowMs)) throw new Error('now must be a valid date')
  const policy = validatedPolicy(requestedPolicy)
  const tasks = await engine.list({ includeHidden: true, now })
  let resumed = 0

  for (const task of tasks) {
    if (task.status !== 'failed') continue
    const latest = latestFailure(task.history)
    if (latest === undefined) continue
    const attempts = failedAttempts(task.history, latest)
    if (attempts >= policy.maxAttempts) continue
    const finishedAt = Date.parse(latest.finishedAt)
    if (!Number.isFinite(finishedAt)) continue
    if (nowMs < finishedAt + delayForAttempt(attempts, policy)) continue

    try {
      await engine.resume(task.id)
      resumed += 1
    } catch {
      // Another actor may have paused/cancelled/completed it between list and
      // resume. That state wins; the next pump re-reads the durable ledger.
    }
  }

  return resumed
}
