import { describe, expect, it, vi } from 'vitest'
import type { ConnectionRpcHandler, HostConnectionHandle } from '@phoenix-ai/dsh-client-connection'
import { installHardnessMissionRpc } from '../src/hardness-rpc.ts'

describe('HARDNESS host RPC', () => {
  it('registers loopback mission/run and delegates validated payloads', async () => {
    let handler: ((endpoint: string, payload: unknown, signal: AbortSignal) => Promise<unknown>) | undefined
    const handle = vi.fn((_channel: string, candidate: ConnectionRpcHandler) => { handler = candidate; return async () => {} })
    const connection: HostConnectionHandle = { rpc: { handle } as never }
    const run = vi.fn(async (payload: unknown) => ({ ok: true, payload }))
    installHardnessMissionRpc(connection, run)
    await expect(handler?.('mission/run', { need: { kind: 'weather' } }, new AbortController().signal)).resolves.toEqual({ ok: true, value: { ok: true, payload: { need: { kind: 'weather' } } } })
    expect(handle).toHaveBeenCalledWith('/hardness', expect.any(Function), { authority: 'loopback' })
  })

  it('rejects unknown endpoints and malformed payloads before delegation', async () => {
    let handler: ((endpoint: string, payload: unknown, signal: AbortSignal) => Promise<unknown>) | undefined
    const handle = vi.fn((_channel: string, candidate: ConnectionRpcHandler) => { handler = candidate; return async () => {} })
    const connection: HostConnectionHandle = { rpc: { handle } as never }
    const run = vi.fn(async () => ({ ok: true }))
    installHardnessMissionRpc(connection, run)
    await expect(handler?.('other', {}, new AbortController().signal)).resolves.toMatchObject({ ok: false })
    await expect(handler?.('mission/run', null, new AbortController().signal)).resolves.toMatchObject({ ok: false })
    expect(run).not.toHaveBeenCalled()
  })
})
