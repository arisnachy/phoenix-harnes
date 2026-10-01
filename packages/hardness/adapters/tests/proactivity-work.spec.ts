import { describe, expect, it, vi } from 'vitest'
import { createProactivityExecutor } from '../src/proactivity-runtime.ts'
import type { ProactivityExecution, ProactivityTask } from '../src/proactivity-engine.ts'

function recurringTask(summary: string): ProactivityTask {
  return {
    id: 'pulse',
    title: 'KIRA assistant pulse',
    instruction: 'Review ambient signals.',
    createdBy: 'system',
    systemKey: 'kira.assistant-pulse.v1',
    createdAt: '2026-10-01T17:00:00.000Z',
    updatedAt: '2026-10-01T17:30:00.000Z',
    nextRunAt: '2026-10-01T18:00:00.000Z',
    recurrence: { kind: 'interval', everyMs: 1_800_000 },
    catchUp: 'skip',
    visibility: 'visible',
    delivery: 'work',
    senderIdentity: 'auto',
    targetAgentId: 'root-a',
    attentionMode: 'result',
    status: 'scheduled',
    history: [{
      phase: 'deliver',
      scheduledFor: '2026-10-01T17:30:00.000Z',
      idempotencyKey: 'pulse:deliver:2026-10-01T17:30:00.000Z',
      startedAt: '2026-10-01T17:30:00.000Z',
      finishedAt: '2026-10-01T17:30:02.000Z',
      status: 'completed',
      summary,
    }],
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

function executor(output: string) {
  const start = vi.fn(async () => ({
    id: 'worker',
    result: Promise.resolve({
      output: [{ type: 'text' as const, text: output }],
      stopReason: 'completed' as const,
    }),
    dispose: async () => {},
  }))
  const parent = { id: 'root-a' }
  return {
    start,
    value: createProactivityExecutor(
      {
        get: vi.fn(() => parent),
        roots: vi.fn(() => [parent]),
        list: vi.fn(() => [parent]),
      } as never,
      {
        getProvider: vi.fn(() => ({ capabilities: {} })),
        start,
      } as never,
      {
        pollMs: 15_000,
        privateWorkProvider: 'spawn',
        privateWorkResultChars: 12_000,
      },
    ),
  }
}

describe('recurring proactive work quieting', () => {
  it('turns an exact repeated result into NO_MATERIAL_UPDATE', async () => {
    const task = recurringTask('Gmail remains clear; no urgent messages.')
    const run = executor('  Gmail   remains clear; no urgent messages.  ')

    await expect(run.value.execute(execution(task))).resolves.toEqual({
      summary: 'NO_MATERIAL_UPDATE',
    })
    expect(run.start).toHaveBeenCalledOnce()
  })

  it('keeps a materially different recurring result', async () => {
    const task = recurringTask('Gmail remains clear; no urgent messages.')
    const run = executor('Calendar changed: tomorrow\'s clinic moved to 08:00.')

    await expect(run.value.execute(execution(task))).resolves.toEqual({
      summary: "Calendar changed: tomorrow's clinic moved to 08:00.",
    })
  })

  it('preserves explicit NO_MATERIAL_UPDATE as the canonical quiet marker', async () => {
    const task = recurringTask('Previous material result.')
    const run = executor('NO_MATERIAL_UPDATE.')

    await expect(run.value.execute(execution(task))).resolves.toEqual({
      summary: 'NO_MATERIAL_UPDATE',
    })
  })
})
