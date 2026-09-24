import { describe, expect, it } from 'vitest'
import { shouldPauseGoalAfterCancellation } from '../src/index.ts'

describe('goal-round cancellation recovery', () => {
  it('pauses only for an explicit user stop with no replacement input', () => {
    expect(shouldPauseGoalAfterCancellation({ kind: 'user' }, false)).toBe(true)
    expect(shouldPauseGoalAfterCancellation({ kind: 'user' }, true)).toBe(false)
  })

  it('automatically recovers infrastructure and lifecycle aborts', () => {
    expect(shouldPauseGoalAfterCancellation({ kind: 'hook', reason: 'verifier transport reset' }, false)).toBe(false)
    expect(shouldPauseGoalAfterCancellation({ kind: 'parent' }, false)).toBe(false)
    expect(shouldPauseGoalAfterCancellation({ kind: 'disposed' }, false)).toBe(false)
    expect(shouldPauseGoalAfterCancellation({ kind: 'legacy' }, false)).toBe(false)
    expect(shouldPauseGoalAfterCancellation(undefined, false)).toBe(false)
  })
})
