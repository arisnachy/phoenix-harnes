import { describe, expect, it } from 'vitest'
import { findRewindBoundary } from '../src/index.ts'

const event = (type: string, seq: number) => ({ type, seq, time: seq, data: {} })

describe('rewind boundary selection', () => {
  it('rewinds by completed turns without mutating the source', () => {
    const events = [
      event('turn/start', 0), event('user/message', 1), event('turn/end', 2),
      event('turn/start', 3), event('assistant/message', 4), event('turn/end', 5),
      event('turn/start', 6), event('assistant/message', 7), event('turn/end', 8),
    ]
    expect(findRewindBoundary(events as never, 1)).toBe(6)
    expect(findRewindBoundary(events as never, 2)).toBe(3)
    expect(events).toHaveLength(9)
  })

  it('rejects an unavailable rewind depth', () => {
    expect(() => findRewindBoundary([event('turn/start', 0), event('turn/end', 1)] as never, 2)).toThrow(/completed turn/i)
  })
})
