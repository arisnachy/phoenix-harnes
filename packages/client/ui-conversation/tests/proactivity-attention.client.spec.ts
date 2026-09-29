import { describe, expect, it, vi } from 'vitest'
import { createSnapshotStore } from '@phoenix-ai/dsh-client-runtime/client'
import type { ProactivityAttentionItem } from '../src/client/contract/slots.ts'
import { parseProactivityAttention, refreshProactivityAttention } from '../src/client/skeleton/ProactivityAttention.ts'

const ROW = {
  id: 't:result:1',
  taskId: 't',
  kind: 'result',
  title: ' NBA intelligence ',
  detail: ' Two games changed. ',
  at: '2026-09-29T15:00:00-04:00',
  score: 110,
} as const

describe('proactivity attention client bridge', () => {
  it('validates, normalizes, and bounds host rows', () => {
    const rows = parseProactivityAttention(Array.from({ length: 10 }, (_, index) => ({
      ...ROW, id: `row-${index}`, taskId: `task-${index}`, detail: index === 0 ? ' ' : ROW.detail,
    })))
    expect(rows).toHaveLength(8)
    expect(rows?.[0]).toEqual({
      id: 'row-0', taskId: 'task-0', kind: 'result', title: 'NBA intelligence',
      at: '2026-09-29T19:00:00.000Z', score: 110,
    })
    expect(rows?.[1]?.detail).toBe('Two games changed.')
    expect(parseProactivityAttention({})).toBeUndefined()
    expect(parseProactivityAttention([{ ...ROW, score: Number.NaN }])).toBeUndefined()
  })

  it('updates only on a valid changed RPC snapshot and stays quiet across transport failures', async () => {
    const store = createSnapshotStore<readonly ProactivityAttentionItem[]>([])
    const call = vi.fn()
      .mockResolvedValueOnce({ ok: true, value: [ROW] })
      .mockResolvedValueOnce({ ok: true, value: [ROW] })
      .mockResolvedValueOnce({ ok: false, error: { code: 'internal', message: 'nope', details: {} } })
      .mockRejectedValueOnce(new Error('offline'))
    const connection = { rpc: { call } } as never
    const listener = vi.fn()
    store.subscribe(listener)

    await refreshProactivityAttention(connection, store)
    expect(store.getSnapshot()).toHaveLength(1)
    expect(listener).toHaveBeenCalledTimes(1)
    await refreshProactivityAttention(connection, store)
    expect(listener).toHaveBeenCalledTimes(1)
    await refreshProactivityAttention(connection, store)
    await refreshProactivityAttention(connection, store)
    await refreshProactivityAttention(undefined, store)
    expect(store.getSnapshot()).toHaveLength(1)
  })
})
