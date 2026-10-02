import { describe, expect, it } from 'vitest'
import {
  MemoryProactivityStore,
  ProactivityEngine,
  type ProactivityExecutionResult,
} from '../src/proactivity-engine.ts'
import {
  ASSISTANT_PULSE_INSTRUCTION,
  ASSISTANT_PULSE_TITLE,
  DEFAULT_ASSISTANT_PULSE_MS,
  ensureAssistantPulse,
} from '../src/assistant-pulse.ts'

function engine() {
  return new ProactivityEngine(
    new MemoryProactivityStore(),
    { execute: async (): Promise<ProactivityExecutionResult> => ({ summary: 'ok' }) },
    { id: (() => {
      let n = 0
      return () => `pulse-${++n}`
    })() },
  )
}

describe('Phoenix Assistant Pulse', () => {
  it('creates one quiet system-owned recurring assistant pulse', async () => {
    const scheduler = engine()
    const now = new Date('2026-10-01T16:00:00.000Z')

    const task = await ensureAssistantPulse(scheduler, {
      enabled: true,
      intervalMs: DEFAULT_ASSISTANT_PULSE_MS,
      now,
    })

    expect(task).toMatchObject({
      id: 'pulse-1',
      title: ASSISTANT_PULSE_TITLE,
      createdBy: 'system',
      catchUp: 'skip',
      delivery: 'work',
      senderIdentity: 'harness',
      attentionMode: 'result',
      attentionPriority: 'normal',
      recurrence: { kind: 'interval', everyMs: DEFAULT_ASSISTANT_PULSE_MS },
      status: 'scheduled',
    })
    expect(task?.nextRunAt).toBe('2026-10-01T16:30:00.000Z')
    expect(task?.instruction).toBe(ASSISTANT_PULSE_INSTRUCTION)
    expect(task?.instruction).toContain('NO_MATERIAL_UPDATE')
    expect(task?.instruction).toContain('already-authorized connectors')
    expect(task?.instruction).toContain('not standing permission')
  })

  it('is idempotent and respects a user-paused or cancelled pulse', async () => {
    const scheduler = engine()
    const first = await ensureAssistantPulse(scheduler, {
      enabled: true,
      intervalMs: DEFAULT_ASSISTANT_PULSE_MS,
      now: new Date('2026-10-01T16:00:00.000Z'),
    })
    if (first === undefined) throw new Error('pulse was not created')

    await scheduler.cancel(first.id)

    const second = await ensureAssistantPulse(scheduler, {
      enabled: true,
      intervalMs: DEFAULT_ASSISTANT_PULSE_MS,
      now: new Date('2026-10-02T16:00:00.000Z'),
    })

    expect(second?.id).toBe(first.id)
    expect(second?.status).toBe('cancelled')
    expect((await scheduler.list({ includeHidden: true }))
      .filter(task => task.title === ASSISTANT_PULSE_TITLE)).toHaveLength(1)
  })

  it('does nothing when ambient assistant presence is disabled', async () => {
    const scheduler = engine()

    await expect(ensureAssistantPulse(scheduler, {
      enabled: false,
      intervalMs: DEFAULT_ASSISTANT_PULSE_MS,
    })).resolves.toBeUndefined()

    expect(await scheduler.list({ includeHidden: true })).toEqual([])
  })

  it('rejects intervals that would create noisy high-frequency model work', async () => {
    const scheduler = engine()

    await expect(ensureAssistantPulse(scheduler, {
      enabled: true,
      intervalMs: 60_000,
    })).rejects.toThrow('assistant pulse interval')
  })
})
