import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  INDEPENDENT_REVIEW_TIMEOUT_MS,
  runWithIndependentReviewWatchdog,
} from '../src/review-watchdog.ts'

afterEach(() => {
  vi.useRealTimers()
})

describe('independent review watchdog', () => {
  it('aborts a verifier that never settles and reports timeout', async () => {
    vi.useFakeTimers()
    const parent = new AbortController()
    let childSignal: AbortSignal | undefined

    const outcome = runWithIndependentReviewWatchdog(parent.signal, async (signal) => {
      childSignal = signal
      return new Promise<never>(() => {})
    })

    await vi.advanceTimersByTimeAsync(INDEPENDENT_REVIEW_TIMEOUT_MS)

    await expect(outcome).resolves.toEqual({ status: 'timeout' })
    expect(childSignal?.aborted).toBe(true)
  })

  it('returns completed values without waiting for the watchdog', async () => {
    const outcome = await runWithIndependentReviewWatchdog(
      new AbortController().signal,
      async () => 'verified',
    )

    expect(outcome).toEqual({ status: 'completed', value: 'verified' })
  })

  it('propagates parent cancellation into the verifier signal', async () => {
    const parent = new AbortController()
    let childSignal: AbortSignal | undefined
    const outcome = runWithIndependentReviewWatchdog(parent.signal, async (signal) => {
      childSignal = signal
      return new Promise<never>(() => {})
    })

    parent.abort(new Error('mission cancelled'))

    await expect(outcome).resolves.toMatchObject({ status: 'aborted' })
    expect(childSignal?.aborted).toBe(true)
  })
})
