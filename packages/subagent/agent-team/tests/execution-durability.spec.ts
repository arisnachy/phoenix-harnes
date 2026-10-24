import { describe, expect, it, vi } from 'vitest'
import { Session, SessionId } from '@phoenix-ai/dsh-session'
import type { Agent } from '@phoenix-ai/dsh-agent'
import { TeamJournal } from '../src/journal.ts'
import { TeamExecutionRuntime } from '../src/execution-runtime.ts'
import { UniversalMissionLedger } from '../src/universal-mission.ts'

describe('execution persistence failure recovery', () => {
  it('bounds Host disposal when an adapter ignores cancellation and preserves uncertain tracking', async () => {
    const session = Session.create(SessionId('teardown-lead'))
    const root = { id: session.id, session, options: { provider: 'openai-codex', model: 'gpt-6-luna' } } as Agent
    const journal = new TeamJournal({ sessions: { flush: async () => true } } as never, () => {})
    const runtime = new TeamExecutionRuntime(journal, new UniversalMissionLedger(journal), () => {},
      { maxOperations: 8, maxTaskBytes: 4096, maxOutputBytes: 4096, disposalTimeoutMs: 20 })
    const entered = Promise.withResolvers<undefined>()
    const finish = Promise.withResolvers<{ status: 'completed' }>()
    runtime.register({ engine: 'codex', probe: async () => ({ engine: 'codex', connected: true,
      version: 'fixture', providers: ['openai-codex'], capabilities: ['code'] }),
    run: async (context) => {
      await context.checkpoint('running', { sessionId: 'native', turnId: 'turn' })
      entered.resolve(undefined)
      return await finish.promise
    }, recover: async () => ({ status: 'uncertain' }),
    })
    const running = runtime.execute(root, { task: 'one task', idempotencyKey: 'one-key', capabilities: ['code'] })
    await entered.promise
    await expect(runtime.dispose()).rejects.toThrow(/teardown timed out/)
    await expect(runtime.execute(root, { task: 'one task', idempotencyKey: 'one-key', capabilities: ['code'] })).rejects.toThrow(/closed/)
    finish.resolve({ status: 'completed' })
    expect((await running).phase).toBe('uncertain')
  })

  it('refuses uncommitted receipts, repairs the barrier, and dispatches a reserved task only once', async () => {
    const session = Session.create(SessionId('durability-lead'))
    const root = { id: session.id, session, options: { provider: 'openai-codex', model: 'gpt-6-luna' } } as Agent
    let available = true
    let probes = 0
    const flush = vi.fn(async () => {
      if (!available) throw new Error('storage unavailable')
      return true
    })
    const journal = new TeamJournal({ sessions: { flush } } as never, () => {})
    const runtime = new TeamExecutionRuntime(journal, new UniversalMissionLedger(journal), () => {},
      { maxOperations: 8, maxTaskBytes: 4096, maxOutputBytes: 4096 })
    const run = vi.fn(async () => ({ status: 'completed' as const }))
    runtime.register({ engine: 'codex', run, recover: run, probe: async () => {
      if (probes++ === 0) available = false
      return { engine: 'codex', connected: true, version: 'fixture', providers: ['openai-codex'], capabilities: ['code'] }
    } })
    const request = { task: 'one task', idempotencyKey: 'one-key', capabilities: ['code'] as const }
    await expect(runtime.execute(root, request)).rejects.toThrow(/storage/)
    expect(() => runtime.list(root)).toThrow(/durably persisted/)
    expect(run).not.toHaveBeenCalled()
    available = true
    const recovered = await runtime.execute(root, request)
    expect(recovered.phase).toBe('completed')
    expect(run).toHaveBeenCalledTimes(1)
    expect(runtime.list(root)).toHaveLength(1)
  })
})
