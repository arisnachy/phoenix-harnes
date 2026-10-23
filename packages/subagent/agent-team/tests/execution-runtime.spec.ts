import { describe, expect, it, vi } from 'vitest'
import { Session, SessionId } from '@phoenix-ai/dsh-session'
import type { Agent } from '@phoenix-ai/dsh-agent'
import type { TeamJournal } from '../src/journal.ts'
import { UniversalMissionLedger } from '../src/universal-mission.ts'
import { TeamExecutionRuntime, routeExecution } from '../src/execution-runtime.ts'
import type { ExecutionAdapter, ExecutionContext, ExecutionEngineStatus, ExecutionNativePolicyRequest } from '../src/execution-types.ts'
import { unfinishedMissionWork } from '../src/mission-closure.ts'

const status = (engine: ExecutionEngineStatus['engine']): ExecutionEngineStatus => ({
  engine, connected: true, version: '1', providers: engine === 'codex' ? ['openai-codex'] : ['*'],
  capabilities: engine === 'openclaw' ? ['connector', 'automation'] : ['code', 'artifact', 'conversation'],
})
function fixture(maxProgressEvents = 1024) {
  const session = Session.create(SessionId('execution-lead'))
  const root = { id: session.id, session, options: { provider: 'openai-codex', model: 'gpt-6-luna' } } as Agent
  let tail: Promise<void> = Promise.resolve()
  const flush = vi.fn(async () => {})
  const journal = {
    assertDurable() {},
    assertAllExecutionsDurable() {},
    transact<T>(_id: unknown, task: () => Promise<T>) {
      const run = tail.then(task)
      tail = run.then(() => {}, () => {})
      return run
    },
    async appendAndFlush(_root: Agent, type: Parameters<Session['append']>[0], data: never) {
      session.append(type, data)
      await flush()
    },
  } as unknown as TeamJournal
  const missions = new UniversalMissionLedger(journal)
  const runtime = new TeamExecutionRuntime(journal,
    missions,
    () => {},
    { maxOperations: 32,
      maxTaskBytes: 65536,
      maxOutputBytes: 65536,
      maxProgressEvents })
  return { root, session, runtime, missions, flush, journal }
}
function adapter(run: ExecutionAdapter['run']): ExecutionAdapter {
  return { engine: 'codex', probe: async () => status('codex'), run, recover: run }
}
const request = { task: 'Create a file and verify it', idempotencyKey: 'human-operation-1', capabilities: ['code'] as const }
const nativePolicy = {
  provider: 'openai', model: 'gpt-6-luna', agentRuntime: 'codex', sandbox: 'workspace', approval: 'never', cwd: 'C:/phoenix-workspace',
  toolPolicy: { profile: 'minimal',
    allow: ['session_status'],
    deny: ['browser',
      'cron',
      'gateway',
      'group:fs',
      'group:runtime',
      'group:web',
      'nodes'],
    profileHash: 'sha256:fixture' },
} as const

describe('execution capability routing', () => {
  it('prioritizes a compatible Codex and preserves non-Codex provider choices', () => {
    const ready = ['internal', 'codex', 'openclaw'].map(engine => status(engine as ExecutionEngineStatus['engine']))
    expect(routeExecution(request, 'openai-codex', ready)).toBe('codex')
    expect(routeExecution(request, 'deepseek', ready)).toBe('internal')
    expect(routeExecution({ ...request, capabilities: ['connector'] }, 'openai-codex', ready)).toBe('openclaw')
    expect(() => routeExecution({ ...request, engine: 'codex' }, 'deepseek', ready)).toThrow(/incompatible/i)
    expect(() => routeExecution(request, 'openai-codex', [])).toThrow(/available/i)
  })
})
describe('durable execution admission and recovery', () => {
  it('resolves native policy from the trusted adapter before reservation flush', async () => {
    const f = fixture()
    const resolveNativePolicy = vi.fn(async (_request: ExecutionNativePolicyRequest) => nativePolicy)
    f.runtime.register({ ...adapter(async () => ({ status: 'completed' as const })), resolveNativePolicy })
    const result = await f.runtime.execute(f.root, request)
    expect(result.nativePolicy).toEqual(nativePolicy)
    expect(resolveNativePolicy).toHaveBeenCalledOnce()
    expect(resolveNativePolicy.mock.calls[0]?.[0]).toMatchObject({
      root: f.root, engine: 'codex', idempotencyKey: request.idempotencyKey,
      selection: { provider: 'openai-codex', model: 'gpt-6-luna' }, capabilities: ['code'],
    })
    expect(resolveNativePolicy.mock.calls[0]?.[0]).not.toHaveProperty('task')
    expect(resolveNativePolicy.mock.calls[0]?.[0]).not.toHaveProperty('nativePolicy')
  })

  it('rejects model supplied native restrictions when the trusted adapter disagrees', async () => {
    const f = fixture()
    f.runtime.register({ ...adapter(async () => ({ status: 'completed' as const })), resolveNativePolicy: async () => nativePolicy })
    await expect(f.runtime.execute(f.root,
      { ...request,
        nativePolicy: { ...nativePolicy,
          cwd: 'C:/untrusted' } })).rejects.toThrow(/host-authoritative/)
    expect(f.runtime.list(f.root)).toEqual([])
  })

  it('persists native policy and rejects idempotency reuse with changed restrictions', async () => {
    const f = fixture()
    const running = Promise.withResolvers<{ status: 'completed' }>()
    f.runtime.register(adapter(async (context) => {
      await context.checkpoint('prepared', { sessionId: 'native' })
      return await running.promise
    }))
    const first = f.runtime.execute(f.root, {
      ...request,
      nativePolicy: { ...nativePolicy,
        toolPolicy: { ...nativePolicy.toolPolicy,
          allow: [...nativePolicy.toolPolicy.allow].reverse(),
          deny: [...nativePolicy.toolPolicy.deny].reverse() } },
    })
    await expect.poll(() => f.runtime.list(f.root)[0]?.nativePolicy).toEqual(nativePolicy)
    await expect(f.runtime.execute(f.root,
      { ...request,
        nativePolicy: { ...nativePolicy,
          cwd: 'C:/other' } })).rejects.toThrow(/different request/)
    running.resolve({ status: 'completed' })
    await expect(first).resolves.toMatchObject({ nativePolicy })
  })

  it('keeps a dispatched native operation uncertain when cancellation is unconfirmed', async () => {
    const f = fixture()
    const entered = Promise.withResolvers<undefined>()
    const finish = Promise.withResolvers<{ status: 'uncertain' }>()
    f.runtime.register(adapter(async (context) => {
      await context.checkpoint('running', { sessionId: 'native', turnId: 'turn' })
      entered.resolve(undefined)
      await new Promise<void>(resolve => context.signal.addEventListener('abort', () => resolve(), { once: true }))
      return await finish.promise
    }))
    const running = f.runtime.execute(f.root, request)
    await entered.promise
    const current = f.runtime.list(f.root)[0]!
    expect((await f.runtime.cancel(f.root, current.id)).phase).toBe('uncertain')
    finish.resolve({ status: 'uncertain' })
    expect((await running).phase).toBe('uncertain')
    expect(unfinishedMissionWork(f.session.events)).toBe(true)
  })

  it('rejects phase regression and native identity replacement after dispatch', async () => {
    const f = fixture()
    f.runtime.register(adapter(async (context) => {
      await context.checkpoint('running', { sessionId: 'native-a', turnId: 'turn-a' })
      await expect(context.checkpoint('prepared', { sessionId: 'native-a', turnId: 'turn-a' })).rejects.toThrow(/regress/)
      await expect(context.checkpoint('running', { sessionId: 'native-b', turnId: 'turn-a' })).rejects.toThrow(/identity/)
      await expect(context.checkpoint('running', { sessionId: 'native-a', turnId: 'turn-b' })).rejects.toThrow(/identity/)
      throw new Error('lost native connection')
    }))
    const result = await f.runtime.execute(f.root, request)
    expect(result.phase).toBe('uncertain')
    expect(result.binding).toEqual({ sessionId: 'native-a', turnId: 'turn-a' })
    f.session.append('team/execution', { version: 1, snapshot: { ...result, revision: result.revision + 1,
      phase: 'running', binding: { sessionId: 'other-native', turnId: 'turn-a' } } })
    expect(() => f.runtime.list(f.root)).toThrow(/identity/)
  })

  it('retains a durable reservation when its adapter unmounts before dispatch', async () => {
    const f = fixture()
    const run = vi.fn(async () => ({ status: 'completed' as const }))
    const unregister = f.runtime.register(adapter(run))
    f.flush.mockImplementation(async () => {
      if (f.session.events.at(-1)?.type === 'team/execution') unregister()
    })
    await expect(f.runtime.execute(f.root, request)).rejects.toThrow(/not registered/)
    expect(f.runtime.list(f.root)[0]?.phase).toBe('reserved')
    expect(run).not.toHaveBeenCalled()
    f.flush.mockImplementation(async () => {})
    f.runtime.register(adapter(run))
    expect((await f.runtime.execute(f.root, request)).phase).toBe('completed')
    expect(run).toHaveBeenCalledOnce()
  })

  it('never sends an input whose durability barrier failed', async () => {
    const f = fixture()
    const entered = Promise.withResolvers<undefined>()
    const finish = Promise.withResolvers<{ status: 'completed' }>()
    const steer = vi.fn(async () => {})
    f.runtime.register({ ...adapter(async (context) => {
      await context.checkpoint('running', { sessionId: 'native', turnId: 'turn' })
      entered.resolve(undefined)
      return await finish.promise
    }), steer })
    const running = f.runtime.execute(f.root, request)
    await entered.promise
    const id = f.runtime.list(f.root)[0]!.id
    f.flush.mockRejectedValueOnce(new Error('disk unavailable'))
    await expect(f.runtime.steer(f.root, id, 'input-one', 'Inspect first')).rejects.toThrow(/disk/)
    expect(steer).not.toHaveBeenCalled()
    expect((await f.runtime.steer(f.root, id, 'input-one', 'Inspect first')).phase).toBe('reserved')
    expect(steer).not.toHaveBeenCalled()
    finish.resolve({ status: 'completed' })
    await running
    f.session.append('team/execution-input',
      { version: 1,
        executionId: id,
        idempotencyKey: 'input-one',
        text: 'changed',
        phase: 'submitted' })
    expect(() => f.runtime.list(f.root)).toThrow(/immutable/)
  })

  it('persists steering before dispatch and never resends an uncertain input key', async () => {
    const f = fixture()
    const entered = Promise.withResolvers<undefined>()
    const finish = Promise.withResolvers<{ status: 'completed' }>()
    const steer = vi.fn(async () => {
      expect(f.session.events.some(event => event.type === 'team/execution-input'
        && event.data.phase === 'reserved')).toBe(true)
      throw new Error('lost acknowledgement')
    })
    f.runtime.register({ ...adapter(async (context) => {
      await context.checkpoint('running', { sessionId: 'native', turnId: 'turn' })
      entered.resolve(undefined)
      return await finish.promise
    }), steer })
    const running = f.runtime.execute(f.root, request)
    await entered.promise
    const id = f.runtime.list(f.root)[0]!.id
    expect((await f.runtime.steer(f.root, id, 'input-one', 'Check the tests first')).phase).toBe('uncertain')
    expect((await f.runtime.steer(f.root, id, 'input-one', 'Check the tests first')).phase).toBe('uncertain')
    expect(steer).toHaveBeenCalledOnce()
    await expect(f.runtime.steer(f.root, id, 'input-one', 'Different instruction')).rejects.toThrow(/different/)
    finish.resolve({ status: 'completed' })
    await running
    expect(unfinishedMissionWork(f.session.events)).toBe(true)
  })

  it('does not reserve or dispatch after shutdown overtakes a readiness probe', async () => {
    const f = fixture()
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    const run = vi.fn(async () => ({ status: 'completed' as const }))
    f.runtime.register({ ...adapter(run), probe: async () => {
      entered.resolve(undefined)
      await release.promise
      return status('codex')
    } })
    const pending = f.runtime.execute(f.root, request)
    await entered.promise
    await f.runtime.dispose()
    release.resolve(undefined)
    await expect(pending).rejects.toThrow(/closed/)
    expect(run).not.toHaveBeenCalled()
    expect(f.session.events.filter(event => event.type === 'team/execution')).toHaveLength(0)
  })

  it('fences admission before the asynchronous Host idle check and releases after failure', async () => {
    const f = fixture()
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    const operation = vi.fn(async () => { throw new Error('update failed') })
    const maintenance = f.runtime.withMaintenance(async () => {
      entered.resolve(undefined)
      await release.promise
    }, operation)
    await entered.promise
    await expect(f.runtime.execute(f.root, request)).rejects.toThrow(/maintenance/)
    await expect(f.runtime.withMaintenance(async () => {}, async () => {})).rejects.toThrow(/idle/)
    expect(f.session.events.filter(event => event.type === 'team/execution')).toHaveLength(0)
    release.resolve(undefined)
    await expect(maintenance).rejects.toThrow('update failed')
    f.runtime.register(adapter(async () => ({ status: 'completed' })))
    expect((await f.runtime.execute(f.root, request)).phase).toBe('completed')
  })

  it('rejects maintenance while dispatch is still awaiting its readiness probe', async () => {
    const f = fixture()
    const entered = Promise.withResolvers<undefined>()
    const release = Promise.withResolvers<undefined>()
    f.runtime.register({ ...adapter(async () => ({ status: 'completed' })), probe: async () => {
      entered.resolve(undefined)
      await release.promise
      return status('codex')
    } })
    const running = f.runtime.execute(f.root, request)
    await entered.promise
    const operation = vi.fn(async () => {})
    await expect(f.runtime.withMaintenance(async () => {}, operation)).rejects.toThrow(/idle/)
    expect(operation).not.toHaveBeenCalled()
    release.resolve(undefined)
    await running
    await f.runtime.withMaintenance(async () => {}, operation)
    expect(operation).toHaveBeenCalledOnce()
  })

  it('does not interrupt another Team when cancellation names its execution identity', async () => {
    const f = fixture()
    const entered = Promise.withResolvers<AbortSignal>()
    const finish = Promise.withResolvers<{ status: 'completed' }>()
    f.runtime.register(adapter(async (context) => { entered.resolve(context.signal); return await finish.promise }))
    const running = f.runtime.execute(f.root, request)
    const signal = await entered.promise
    const current = f.runtime.list(f.root)[0]!
    const other = { ...f.root, id: SessionId('other'), session: Session.create(SessionId('other')) } as Agent
    await expect(f.runtime.cancel(other, current.id)).rejects.toThrow(/not found/)
    expect(signal.aborted).toBe(false)
    finish.resolve({ status: 'completed' })
    expect((await running).phase).toBe('completed')
  })

  it('fences a native completion emitted synchronously by mission cancellation', async () => {
    const f = fixture()
    const entered = Promise.withResolvers<undefined>()
    f.runtime.register(adapter(async (context) => {
      entered.resolve(undefined)
      await new Promise<void>(resolve => context.signal.addEventListener('abort', () => resolve(), { once: true }))
      return { status: 'completed' }
    }))
    const running = f.runtime.execute(f.root, request)
    await entered.promise
    const current = f.runtime.list(f.root)[0]!
    await f.runtime.cancelMission(f.root, current.missionId)
    expect((await running).phase).toBe('cancelled')
  })
  it('bounds unique progress receipts without charging duplicate native events twice', async () => {
    const f = fixture(1)
    f.runtime.register(adapter(async (context) => {
      await context.checkpoint('dispatching', { sessionId: 'native' })
      const event = { kind: 'reasoning' as const, nativeEventId: 'one' }
      await context.progress(event)
      await context.progress(event)
      await context.progress({ ...event, nativeEventId: 'two' })
      return { status: 'completed' }
    }))
    expect((await f.runtime.execute(f.root, request)).phase).toBe('uncertain')
    expect(f.session.events.filter(event => event.type === 'team/execution-progress')).toHaveLength(1)
  })
  it('reserves and flushes once before execution, deduplicating concurrent and later retries', async () => {
    const f = fixture()
    const run = vi.fn(async (context: ExecutionContext) => {
      expect(f.flush).toHaveBeenCalled()
      expect(context.snapshot.phase).toBe('reserved')
      await context.checkpoint('prepared', { sessionId: 'native-thread' })
      await context.checkpoint('dispatching', { sessionId: 'native-thread' })
      await context.checkpoint('running', { sessionId: 'native-thread', turnId: 'native-turn' })
      return { status: 'completed' as const, output: 'verified file' }
    })
    f.runtime.register(adapter(run))
    const [a, b] = await Promise.all([f.runtime.execute(f.root, request), f.runtime.execute(f.root, request)])
    expect(run).toHaveBeenCalledTimes(1)
    expect(a.id).toBe(b.id)
    expect(a.phase).toBe('completed')
    expect((await f.runtime.execute(f.root, request)).id).toBe(a.id)
    expect(f.missions.read(f.root)?.phase).toBe('running')
  })

  it('fences an abort that arrives after reservation before adapter dispatch', async () => {
    const f = fixture()
    const controller = new AbortController()
    let flushes = 0
    f.flush.mockImplementation(async () => {
      flushes += 1
      // Mission creation flushes once; abort while the execution reservation
      // is still crossing its durability barrier, before run() can dispatch.
      if (flushes === 2) controller.abort(new Error('cancel before dispatch'))
    })
    const run = vi.fn(async (_context: ExecutionContext) => ({ status: 'completed' as const }))
    f.runtime.register(adapter(run))

    const result = await f.runtime.execute(f.root, request, controller.signal)

    expect(run).not.toHaveBeenCalled()
    expect(result.phase).toBe('cancelled')
    expect(f.session.events.filter(event => event.type === 'team/execution').map(event => event.data.snapshot.phase))
      .toEqual(['reserved', 'cancelled'])
  })

  it('does not dispatch if the reservation cannot be flushed', async () => {
    const f = fixture()
    await f.missions.ensure(f.root, request.task, 1)
    f.flush.mockRejectedValueOnce(new Error('storage unavailable'))
    const run = vi.fn()
    f.runtime.register(adapter(run))
    await expect(f.runtime.execute(f.root, request)).rejects.toThrow('storage unavailable')
    expect(run).not.toHaveBeenCalled()
  })

  it('records uncertain dispatch and reuses its native identity during explicit recovery', async () => {
    const f = fixture()
    const recover = vi.fn(async (context: ExecutionContext) => {
      expect(context.snapshot.binding?.sessionId).toBe('durable-native')
      return { status: 'completed' as const, output: 'reconciled' }
    })
    f.runtime.register({ ...adapter(async (context) => {
      await context.checkpoint('dispatching', { sessionId: 'durable-native' })
      throw new Error('lost response with private contents')
    }), recover })
    const first = await f.runtime.execute(f.root, request)
    expect(first.phase).toBe('uncertain')
    expect(JSON.stringify(first)).not.toContain('private contents')
    const cold = new TeamExecutionRuntime(f.journal,
      f.missions,
      () => {},
      { maxOperations: 32,
        maxTaskBytes: 65536,
        maxOutputBytes: 65536 })
    await expect(cold.recover(f.root, first.id)).rejects.toThrow(/not registered/i)
    expect(cold.list(f.root)[0]?.phase).toBe('uncertain')
    cold.register({ ...adapter(vi.fn()), recover })
    expect((await cold.recover(f.root, first.id)).phase).toBe('completed')
    expect(recover).toHaveBeenCalledTimes(1)
  })

  it('fences cancellation before late native completion and refuses cross-root reads', async () => {
    const f = fixture()
    const entered = Promise.withResolvers<undefined>()
    const finish = Promise.withResolvers<{ status: 'completed' }>()
    f.runtime.register(adapter(async () => { entered.resolve(undefined); return finish.promise }))
    const running = f.runtime.execute(f.root, request)
    await entered.promise
    const current = f.runtime.list(f.root)[0]!
    await f.runtime.cancelMission(f.root, 'unrelated-mission')
    expect(f.runtime.list(f.root)[0]?.phase).not.toBe('cancelled')
    await f.runtime.cancelMission(f.root, current.missionId)
    finish.resolve({ status: 'completed' })
    expect((await running).phase).toBe('cancelled')
    const other = { ...f.root, id: SessionId('other'), session: Session.create(SessionId('other')) } as Agent
    expect(f.runtime.list(other)).toEqual([])
    await expect(f.runtime.recover(other, current.id)).rejects.toThrow(/not found/i)
  })

  it('persists progress only once per native event and refuses callbacks after mission cancellation', async () => {
    const f = fixture()
    f.runtime.register(adapter(async (context) => {
      const event = { kind: 'tool-started' as const, nativeEventId: 'tool-1', toolName: 'shell' }
      await context.progress(event)
      await context.progress(event)
      await f.missions.close(f.root, true)
      await expect(context.checkpoint('running', { sessionId: 'late' })).rejects.toThrow(/mission/i)
      return { status: 'completed' }
    }))
    const result = await f.runtime.execute(f.root, request)
    expect(result.phase).toBe('cancelled')
    expect(f.session.events.filter(e => e.type === 'team/execution-progress')).toHaveLength(1)
  })

  it('keeps uncertain native work open across a completed Lead turn and stops cleanly on Host disposal', async () => {
    const f = fixture()
    const entered = Promise.withResolvers<undefined>()
    f.runtime.register(adapter(async (context) => {
      await context.checkpoint('running', { sessionId: 'thread', turnId: 'turn' })
      entered.resolve(undefined)
      await new Promise<void>(resolve => context.signal.addEventListener('abort', () => resolve(), { once: true }))
      return { status: 'cancelled' }
    }))
    const run = f.runtime.execute(f.root, request)
    await entered.promise
    expect(unfinishedMissionWork(f.session.events)).toBe(true)
    await f.runtime.dispose()
    const stopped = await run
    expect(stopped.phase).toBe('uncertain')
    expect(stopped.errorCode).toBe('EXECUTION_HOST_STOPPED')
    expect(unfinishedMissionWork(f.session.events)).toBe(true)
  })

  it('freezes the resolved concrete worker model and records selective recall before native dispatch', async () => {
    const f = fixture()
    const memory = { content: '[memory:procedure-1] Prefer the verified build command.', memoryIds: ['procedure-1'] }
    const runtime = new TeamExecutionRuntime(f.journal, f.missions, () => {},
      { maxOperations: 32, maxTaskBytes: 65536, maxOutputBytes: 65536 }, () => memory)
    runtime.register(adapter(async (context) => {
      expect(context.snapshot.model).toBe('gpt-6.1-sol')
      expect(context.snapshot.reasoningEffort).toBeUndefined()
      expect(context.sharedMemory).toBe(memory.content)
      expect(f.session.events.find(e => e.type === 'team/execution-context')?.data).toMatchObject(memory)
      return { status: 'completed', output: 'verified' }
    }))
    const result = await runtime.execute(f.root, { ...request, selection: { provider: 'openai-codex', model: 'gpt-6.1-sol' } })
    expect(result.phase).toBe('completed')
    await expect(runtime.execute(f.root,
      { ...request,
        idempotencyKey: 'virtual',
        selection: { provider: 'openai-codex',
          model: 'phoenix-auto' } })).rejects.toThrow()
    await expect(runtime.execute(f.root, { ...request, task: 'Different request' })).rejects.toThrow(/idempotency key/i)
  })

  it('rejects explicit idempotency reuse with a different provider, model, or reasoning effort', async () => {
    const f = fixture()
    const run = vi.fn(async () => ({ status: 'completed' as const }))
    f.runtime.register(adapter(run))
    const selection = { provider: 'openai-codex', model: 'gpt-6-luna', reasoningEffort: 'high' }
    await f.runtime.execute(f.root, { ...request, selection })

    await expect(f.runtime.execute(f.root, {
      ...request,
      selection: { provider: 'anthropic', model: 'claude-sonnet', reasoningEffort: 'xhigh' },
    })).rejects.toThrow(/idempotency key/i)
    expect(run).toHaveBeenCalledTimes(1)
  })
})
