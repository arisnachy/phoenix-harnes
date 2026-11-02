import { describe, expect, it, vi } from 'vitest'
import { callHardnessMission } from '../src/client/hardness-rpc.ts'

describe('HARDNESS client RPC', () => {
  it('uses the official connection RPC channel', async () => {
    const call = vi.fn(async () => ({ ok: true as const, value: { kind: 'completed' } }))
    await expect(callHardnessMission({ rpc: { call } }, { need: { kind: 'weather' } }, new AbortController().signal)).resolves.toEqual({ ok: true, value: { kind: 'completed' } })
    expect(call).toHaveBeenCalledWith('/hardness', 'mission/run', { need: { kind: 'weather' } }, expect.any(AbortSignal))
  })
})
