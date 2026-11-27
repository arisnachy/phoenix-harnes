import { describe, expect, it } from 'vitest'
import { NetworkWatch } from '../src/network-watch.ts'

describe('NetworkWatch', () => {
  it('coalesces samples, records actual rates and keeps bounded aggregate history', async () => {
    let calls = 0
    let now = 100000
    let saved: unknown
    const watch = new NetworkWatch(async () => {
      calls++
      return { status: 'completed', neighborCount: 4, receivedBytesPerSecond: 30, sentBytesPerSecond: 20,
        newlyObserved: ['opaque'], noLongerObserved: [], private: 'never stored' }
    }, { read: async () => [], write: async rows => { saved = rows } }, () => now)
    await Promise.all([watch.tick(), watch.tick()])
    expect(calls).toBe(1)
    expect(watch.report()).toMatchObject({ status: 'completed', persisted: true, retainedSamples: 1, latest: { neighbors: 4, rx: 30, added: 1 } })
    expect(JSON.stringify(saved)).not.toMatch(/private|opaque/u)
    now += 190000
    expect(watch.report().status).toBe('degraded')
  })
  it('restores only bounded recent rows, fails soft without local disk', async () => {
    const now = 90000000
    const watch = new NetworkWatch(async () => ({ status: 'completed', neighborCount: 0 }), {
      read: async () => [{ at: 0, neighbors: 3 }, { at: now - 1000, neighbors: 2 }, { at: now, neighbors: -1 }],
      write: async () => { throw new Error('disk unavailable') },
    }, () => now)
    await watch.tick()
    expect(watch.report()).toMatchObject({ persisted: false, retainedSamples: 2, latest: { neighbors: 0, rx: null } })
  })
  it('does not invent data on an unavailable network', async () => {
    const watch = new NetworkWatch(async () => ({ status: 'unavailable' }), null)
    await watch.tick()
    expect(watch.report()).toMatchObject({ status: 'degraded', retainedSamples: 0, latest: null })
  })
})
