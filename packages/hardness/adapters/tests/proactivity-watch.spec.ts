import { describe, expect, it, vi } from 'vitest'
import { createProactivityExecutor } from '../src/proactivity-runtime.ts'
import type { ProactivityExecution, ProactivityTask } from '../src/proactivity-engine.ts'

function watchTask(): ProactivityTask {
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
    history: [],
  }
}

function execution(task: ProactivityTask): ProactivityExecution {
  return {
    phase: 'deliver',
    task,
    scheduledFor: task.nextRunAt,
    idempotencyKey: `${task.id}:deliver:${task.nextRunAt}`,
    instruction: task.instruction,
  }
}

function harness(structured: { met: boolean; evidence: string }) {
  const followup = vi.fn((_message: unknown) => undefined)
  const parent = { id: 'parent', followup } as never
  const dispose = vi.fn(async () => undefined)
  const start = vi.fn(async (_providerName: string, _request: unknown) => ({
    id: 'watch-child',
    localAgent: undefined,
    result: Promise.resolve({
      stopReason: 'completed' as const,
      output: [],
      structured,
    }),
    dispose,
  }))
  const provider = {
    name: 'spawn',
    inheritsParentContext: true,
    capabilities: { outputSchema: true, depthLimit: true, toolFilter: true, persona: true },
  }
  const agents = {
    get: () => parent,
    roots: () => [parent],
    list: () => [parent],
  }
  const subagents = {
    getProvider: () => provider,
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
    const test = harness({ met: false, evidence: 'The release page still says coming soon.' })
    const result = await test.executor.execute(execution(watchTask()))

    expect(result).toEqual({ summary: 'condition not met: The release page still says coming soon.' })
    expect(test.followup).not.toHaveBeenCalled()
    expect(test.start).toHaveBeenCalledOnce()
    const request = test.start.mock.calls[0]?.[1]
    expect(request?.outputSchema).toBeDefined()
    expect(request?.toolFilter).toEqual({
      allow: ['read', 'read_image', 'glob', 'grep', 'session_search', 'session_event_search', 'web_search', 'web_fetch'],
    })
    expect(test.dispose).toHaveBeenCalledOnce()
  })

  it('notifies once with verified evidence and marks the occurrence terminal', async () => {
    const test = harness({ met: true, evidence: 'The official release page now lists version 6.0 as available.' })
    const result = await test.executor.execute(execution(watchTask()))

    expect(result).toEqual({
      summary: 'condition met and notification accepted: The official release page now lists version 6.0 as available.',
      terminal: true,
    })
    expect(test.followup).toHaveBeenCalledOnce()
    const delivered = JSON.stringify(test.followup.mock.calls[0]?.[0])
    expect(delivered).toContain('Condition verified true')
    expect(delivered).toContain('official release page now lists version 6.0')
    expect(test.dispose).toHaveBeenCalledOnce()
  })
})
