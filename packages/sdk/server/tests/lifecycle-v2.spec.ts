import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { Agent, AgentHandle } from '@deepseek-ai/dsh-agent'
import type { JsonRpcTransportPeer } from '@deepseek-ai/dsh-sdk-protocol'
import { HarnessSdkJsonRpcServer } from '../src/server.ts'

class SilentTransport implements JsonRpcTransportPeer {
  request(): Promise<unknown> { return Promise.reject(new Error('server must not request from client')) }
  notify(): void {}
}

function fakeContext(status: 'idle' | 'running' = 'idle'): {
  ctx: Context
  cancel: ReturnType<typeof vi.fn>
  dispose: ReturnType<typeof vi.fn>
} {
  const live = new Map<string, Agent>()
  const cancel = vi.fn()
  const dispose = vi.fn(async function (this: void) {})
  const create = vi.fn(async ({ sessionId }: { sessionId: ReturnType<typeof SessionId> }): Promise<AgentHandle> => {
    const id = String(sessionId)
    const agent = {
      id: sessionId,
      status,
      session: { id: sessionId },
      followup: vi.fn(),
      cancel,
    } as unknown as Agent
    live.set(id, agent)
    return {
      agent,
      dispose: async () => {
        live.delete(id)
        await dispose()
      },
    }
  })
  const ctx = {
    on: vi.fn(() => () => undefined),
    agents: {
      create,
      get: (id: ReturnType<typeof SessionId>) => live.get(String(id)),
    },
    get: (name: string) => name === 'llm'
      ? { listProviders: () => [{ id: 'test-provider', name: 'Test' }] }
      : undefined,
  } as unknown as Context
  return { ctx, cancel, dispose }
}

describe('Harness SDK protocol v2 lifecycle', () => {
  it('keeps legacy initialize shape for v1 clients and negotiates v2 capabilities explicitly', async () => {
    const { ctx } = fakeContext()
    const server = new HarnessSdkJsonRpcServer(ctx, new SilentTransport())

    await expect(server.initialize({ cwd: '.', provider: 'test-provider', model: 'm' }))
      .resolves.toEqual({ serverInfo: { name: 'deepseek-harness-sdk-runtime', version: '0.0.1' } })

    await expect(server.initialize({ cwd: '.', provider: 'test-provider', model: 'm', protocolVersion: 99 }))
      .resolves.toEqual({
        serverInfo: { name: 'deepseek-harness-sdk-runtime', version: '0.0.1' },
        protocolVersion: 2,
        capabilities: { sessionInterrupt: true, sessionClose: true },
      })
  })

  it('interrupts only active SDK-owned work and preserves the queued inbox', async () => {
    const { ctx, cancel } = fakeContext('running')
    const server = new HarnessSdkJsonRpcServer(ctx, new SilentTransport())
    await server.initialize({ cwd: '.', provider: 'test-provider', model: 'm', protocolVersion: 2 })
    await server.prompt({ sessionId: 's1', contentBlocks: [{ type: 'text', text: 'hello' }] })

    await expect(server.handleRequest('session/interrupt', { sessionId: 's1' }))
      .resolves.toEqual({ found: true, wasRunning: true })
    expect(cancel).toHaveBeenCalledWith({ kind: 'user' }, { keepInbox: true })
    await expect(server.handleRequest('session/interrupt', { sessionId: 'missing' }))
      .resolves.toEqual({ found: false, wasRunning: false })
  })

  it('closes one session without shutting down the runtime and is idempotent after disposal', async () => {
    const { ctx, dispose } = fakeContext()
    const server = new HarnessSdkJsonRpcServer(ctx, new SilentTransport())
    await server.initialize({ cwd: '.', provider: 'test-provider', model: 'm', protocolVersion: 2 })
    await server.prompt({ sessionId: 's1', contentBlocks: [{ type: 'text', text: 'hello' }] })

    await expect(server.handleRequest('session/close', { sessionId: 's1' }))
      .resolves.toEqual({ found: true })
    expect(dispose).toHaveBeenCalledOnce()
    await expect(server.handleRequest('session/close', { sessionId: 's1' }))
      .resolves.toEqual({ found: false })

    await expect(server.prompt({ sessionId: 's2', contentBlocks: [{ type: 'text', text: 'still alive' }] }))
      .resolves.toMatchObject({ messageId: expect.any(String) })
  })
})