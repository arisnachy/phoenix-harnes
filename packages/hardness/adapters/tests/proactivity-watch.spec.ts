import { describe, expect, it, vi } from 'vitest'
import { createProactivityExecutor } from '../src/proactivity-runtime.ts'
import type {
  ProactivityExecution,
  ProactivityHistoryEntry,
  ProactivityTask,
} from '../src/proactivity-engine.ts'

function watchTask(history: readonly ProactivityHistoryEntry[] = []): ProactivityTask {
  return {
    id: 'watch-1',
    title: 'Release watch',
    instruction: 'Tell the user the release is available.',
    condition: 'The release is publicly available.',
    createdBy: 'user',
    createdAt: '2026-09-18T11:00:00.000Z',
    updatedAt: '2026-09-18T11:00:00.000Z',
    nextRunAt: '2026-09-18T12:00:00.000Z',
    recurrence: { kind: 'interval', everyMs: 3_600_000 },
    catchUp: 'latest',
    visibility: 'visible',
    delivery: 'chat',
    senderIdentity: 'auto',
    targetAgentId: 'parent',
    status: 'scheduled',
    history,
  }
}

function ordinaryTask(): ProactivityTask {
  const task = watchTask()
  const { condition: _condition, ...ordinary } = task
  return ordinary
}

function execution(task: ProactivityTask, phase: 'prepare' | 'deliver' = 'deliver'): ProactivityExecution {
  return {
    phase,
    task,
    scheduledFor: task.nextRunAt,
    idempotencyKey: `${task.id}:${phase}:${task.nextRunAt}`,
    instruction: task.instruction,
  }
}

interface HarnessOptions {
  readonly structured?: unknown
  readonly stopReason?: 'completed' | 'error'
  readonly diagnostic?: string
  readonly subagents?: boolean
  readonly provider?: boolean
  readonly outputSchema?: boolean
  readonly toolFilter?: boolean
  readonly output?: readonly { type: 'text'; text: string }[]
}

function harness(options: HarnessOptions = {}) {
  const followup = vi.fn((_message: unknown) => undefined)
  const parent = { id: 'parent', followup } as never
  const dispose = vi.fn(async () => undefined)
  const start = vi.fn(async (_providerName: string, _request: unknown) => ({
    id: 'watch-child',
    localAgent: undefined,
    result: Promise.resolve({
      stopReason: options.stopReason ?? 'completed',
      output: options.output ?? [],
      ...(options.structured === undefined ? {} : { structured: options.structured }),
      ...(options.diagnostic === undefined ? {} : { diagnostic: options.diagnostic }),
    }),
    dispose,
  }))
  const provider = {
    name: 'spawn',
    inheritsParentContext: true,
    capabilities: {
      outputSchema: options.outputSchema ?? true,
      depthLimit: true,
      toolFilter: options.toolFilter ?? true,
      persona: true,
    },
  }
  const agents = {
    get: () => parent,
    roots: () => [parent],
    list: () => [parent],
  }
  const subagents = options.subagents === false ? undefined : {
    getProvider: () => options.provider === false ? undefined : provider,
    start,
  }

  return {
    followup,
    start,
    dispose,
    executor: createProactivityExecutor(agents as never, subagents as never, {
      pollMs: 15_000,
      privateWorkProvider: 'spawn',
      privateWorkResultChars: 2_000,
    }),
  }
}

describe('PHOENIX condition-watch executor', () => {
  it('keeps false checks private and silent', async () => {
    const test = harness({ structured: { met: false, evidence: 'The release page still says coming soon.' } })
    const result = await test.executor.execute(execution(watchTask()))

    expect(result).toEqual({ summary: 'condition not met: The release page still says coming soon.' })
    expect(test.followup).not.toHaveBeenCalled()
    expect(test.start).toHaveBeenCalledOnce()
    const request = test.start.mock.calls[0]?.[1] as Record<string, unknown> | undefined
    expect(request?.outputSchema).toBeDefined()
    expect(request?.toolFilter).toEqual({
      allow: ['read', 'read_image', 'glob', 'grep', 'session_search', 'session_event_search', 'web_search', 'web_fetch'],
    })
    expect(test.dispose).toHaveBeenCalledOnce()
  })

  it('notifies once with verified evidence and marks the occurrence terminal', async () => {
    const test = harness({ structured: { met: true, evidence: 'The official release page now lists version 6.0 as available.' } })
    const result = await test.executor.execute(execution(watchTask()))

    expect(result).toEqual({
      summary: 'condition met and notification accepted: The official release page now lists version 6.0 as available.',
      terminal: true,
    })
    expect(test.followup).toHaveBeenCalledOnce()
    const delivered = JSON.stringify(test.followup.mock.calls[0]?.[0])
    expect(delivered).toContain('Condition verified true')
    expect(delivered).toContain('official release page now lists version 6.0')
    expect(delivered).toContain('Condition met: Release watch')
    expect(test.dispose).toHaveBeenCalledOnce()
  })

  it('preserves only relevant recent delivery evidence in the private checker prompt', async () => {
    const history: ProactivityHistoryEntry[] = [
      {
        phase: 'prepare',
        scheduledFor: '2026-09-18T09:00:00.000Z',
        idempotencyKey: 'prepare',
        startedAt: '2026-09-18T09:00:00.000Z',
        finishedAt: '2026-09-18T09:00:01.000Z',
        status: 'completed',
        summary: 'private prep',
      },
      {
        phase: 'deliver',
        scheduledFor: '2026-09-18T10:00:00.000Z',
        idempotencyKey: 'deliver-no-summary',
        startedAt: '2026-09-18T10:00:00.000Z',
        finishedAt: '2026-09-18T10:00:01.000Z',
        status: 'completed',
      },
      {
        phase: 'deliver',
        scheduledFor: '2026-09-18T11:00:00.000Z',
        idempotencyKey: 'deliver-summary',
        startedAt: '2026-09-18T11:00:00.000Z',
        finishedAt: '2026-09-18T11:00:01.000Z',
        status: 'completed',
        summary: 'condition not met: still pending',
      },
    ]
    const test = harness({ structured: { met: false, evidence: 'Still pending.' } })
    await test.executor.execute(execution(watchTask(history)))

    const request = test.start.mock.calls[0]?.[1] as { prompt?: unknown } | undefined
    const prompt = JSON.stringify(request?.prompt)
    expect(prompt).toContain('condition not met: still pending')
    expect(prompt).not.toContain('private prep')
    expect(prompt).not.toContain('deliver-no-summary')
  })

  it('fails closed when the private checker infrastructure is unavailable or insufficient', async () => {
    await expect(harness({ subagents: false }).executor.execute(execution(watchTask())))
      .rejects.toThrow(/provider is not available/)
    await expect(harness({ provider: false }).executor.execute(execution(watchTask())))
      .rejects.toThrow(/provider is not available/)
    await expect(harness({ outputSchema: false }).executor.execute(execution(watchTask())))
      .rejects.toThrow(/lacks structured output/)
    await expect(harness({ toolFilter: false }).executor.execute(execution(watchTask())))
      .rejects.toThrow(/lacks read-only tool filtering/)
  })

  it('disposes a failed checker and surfaces its diagnostic', async () => {
    const test = harness({ stopReason: 'error', diagnostic: 'provider transport failed' })
    await expect(test.executor.execute(execution(watchTask()))).rejects.toThrow('provider transport failed')
    expect(test.dispose).toHaveBeenCalledOnce()
  })

  it.each([
    null,
    'not-an-object',
    [],
    { met: 'yes', evidence: 'x' },
    { met: true, evidence: 7 },
    { met: true, evidence: '   ' },
    { met: true, evidence: 'x'.repeat(2_001) },
  ])('rejects invalid structured checker output %#', async (structured) => {
    const test = harness({ structured })
    await expect(test.executor.execute(execution(watchTask())))
      .rejects.toThrow(/invalid structured output/)
    expect(test.dispose).toHaveBeenCalledOnce()
  })

  it('leaves ordinary chat delivery on the original path', async () => {
    const test = harness()
    const result = await test.executor.execute(execution(ordinaryTask()))
    expect(result).toEqual({ summary: 'accepted by the live Phoenix agent inbox' })
    expect(test.followup).toHaveBeenCalledOnce()
    expect(test.start).not.toHaveBeenCalled()
  })

  it('keeps non-delivery phases out of condition evaluation', async () => {
    const task = watchTask()
    const test = harness({ output: [{ type: 'text', text: 'prepared' }] })
    const result = await test.executor.execute(execution({
      ...task,
      preparationInstruction: 'Prepare privately.',
      prepareLeadMs: 60_000,
    }, 'prepare'))
    expect(result).toEqual({ summary: 'prepared' })
    expect(test.followup).not.toHaveBeenCalled()
    expect(test.start).toHaveBeenCalledOnce()
  })
})
