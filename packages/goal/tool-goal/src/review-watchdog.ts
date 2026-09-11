/** Bounded cancellation wrapper for independent completion verification workers. */

/** Maximum wall-clock time granted to one independent Tester/Judge worker. */
export const INDEPENDENT_REVIEW_TIMEOUT_MS = 120_000

/** Outcome of one watchdog-bounded independent worker. */
export type IndependentReviewOutcome<T> =
  | { readonly status: 'completed'; readonly value: T }
  | { readonly status: 'timeout' }
  | { readonly status: 'aborted'; readonly reason: unknown }

/**
 * Run one independent verifier with a child signal that is bounded by both the
 * parent mission cancellation and a wall-clock watchdog. The operation promise
 * is observed even after a timeout so a late rejection cannot become unhandled.
 *
 * @param parentSignal - owning mission cancellation signal.
 * @param operation - verifier operation that must receive the watchdog signal.
 * @returns completed value, timeout, or parent-aborted outcome.
 */
export async function runWithIndependentReviewWatchdog<T>(
  parentSignal: AbortSignal,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<IndependentReviewOutcome<T>> {
  if (parentSignal.aborted) {
    return { status: 'aborted', reason: parentSignal.reason }
  }

  const child = new AbortController()
  let timedOut = false
  let timeout: ReturnType<typeof setTimeout> | undefined
  let resolveStop: ((outcome: IndependentReviewOutcome<T>) => void) | undefined

  const stopped = new Promise<IndependentReviewOutcome<T>>((resolve) => {
    resolveStop = resolve
  })
  const onParentAbort = (): void => {
    child.abort(parentSignal.reason)
    resolveStop?.({ status: 'aborted', reason: parentSignal.reason })
  }
  parentSignal.addEventListener('abort', onParentAbort, { once: true })
  timeout = setTimeout(() => {
    timedOut = true
    child.abort(new Error('Independent completion verifier exceeded its watchdog budget'))
    resolveStop?.({ status: 'timeout' })
  }, INDEPENDENT_REVIEW_TIMEOUT_MS)
  timeout.unref?.()

  const running: Promise<IndependentReviewOutcome<T>> = Promise.resolve()
    .then(() => operation(child.signal))
    .then(
      value => ({ status: 'completed', value }) as const,
      error => {
        if (timedOut) return { status: 'timeout' } as const
        if (parentSignal.aborted) return { status: 'aborted', reason: parentSignal.reason } as const
        throw error
      },
    )

  try {
    return await Promise.race([running, stopped])
  } finally {
    if (timeout !== undefined) clearTimeout(timeout)
    parentSignal.removeEventListener('abort', onParentAbort)
  }
}
