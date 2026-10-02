import { describe, expect, it } from 'vitest'
import {
  ASSISTANT_PULSE_INSTRUCTION,
  ASSISTANT_PULSE_SYSTEM_KEY,
  ASSISTANT_PULSE_TITLE,
  reconcileAssistantPulse,
  type AssistantPulseAgentRegistry,
} from '../src/assistant-pulse.ts'
import { MemoryProactivityStore, ProactivityEngine } from '../src/proactivity-engine.ts'

const NOW = new Date('2026-10-01T18:00:00.000Z')

function registry(...ids: string[]): AssistantPulseAgentRegistry {
  const agents = ids.map(id => ({ id }) as never)
  return {
    roots: () => agents,
    list: () => agents,
  } as never
}

function engine() {
  return new ProactivityEngine(
    new MemoryProactivityStore(),
    { execute: async () => ({ summary: 'NO_MATERIAL_UPDATE' }) },
  )
}

describe('KIRA always-on assistant pulse', () => {
  it('waits for a durable root before creating the first pulse', async () => {
    const value = engine()
    await expect(reconcileAssistantPulse(
      value,
      registry(),
      { enabled: true, everyMinutes: 30 },
      NOW,
    )).resolves.toBeUndefined()
    expect(await value.list({ includeSystem: true })).toEqual([])
  })

  it('creates one quiet system pulse bound to a resumable root session', async () => {
    const value = engine()
    const pulse = await reconcileAssistantPulse(
      value,
      registry('root-a'),
      { enabled: true, everyMinutes: 30 },
      NOW,
    )

    expect(pulse).toMatchObject({
      title: ASSISTANT_PULSE_TITLE,
      instruction: ASSISTANT_PULSE_INSTRUCTION,
      createdBy: 'system',
      systemKey: ASSISTANT_PULSE_SYSTEM_KEY,
      recurrence: { kind: 'interval', everyMs: 1_800_000 },
      catchUp: 'skip',
      delivery: 'work',
      targetAgentId: 'root-a',
      attentionMode: 'result',
      attentionPriority: 'normal',
      status: 'scheduled',
    })
    expect(pulse?.nextRunAt).toBe('2026-10-01T18:30:00.000Z')
    expect(await value.list()).toEqual([])
    expect(await value.list({ includeSystem: true })).toHaveLength(1)
  })

  it('is idempotent and never duplicates a matching pulse', async () => {
    const value = engine()
    const first = await reconcileAssistantPulse(
      value,
      registry('root-a'),
      { enabled: true, everyMinutes: 30 },
      NOW,
    )
    const second = await reconcileAssistantPulse(
      value,
      registry('root-a'),
      { enabled: true, everyMinutes: 30 },
      new Date('2026-10-01T18:05:00.000Z'),
    )

    expect(second?.id).toBe(first?.id)
    expect(await value.list({ includeSystem: true })).toHaveLength(1)
  })

  it('retargets to a current live root and cancels the obsolete pulse', async () => {
    const value = engine()
    const first = await reconcileAssistantPulse(
      value,
      registry('root-a'),
      { enabled: true, everyMinutes: 30 },
      NOW,
    )
    const second = await reconcileAssistantPulse(
      value,
      registry('root-b'),
      { enabled: true, everyMinutes: 30 },
      new Date('2026-10-01T19:00:00.000Z'),
    )

    expect(second?.id).not.toBe(first?.id)
    expect(second?.targetAgentId).toBe('root-b')
    const all = await value.list({ includeSystem: true, includeHidden: true })
    expect(all.filter(task => task.systemKey === ASSISTANT_PULSE_SYSTEM_KEY && task.status === 'scheduled'))
      .toHaveLength(1)
    expect(all.find(task => task.id === first?.id)?.status).toBe('cancelled')
  })

  it('replaces the pulse when cadence changes and disables it cleanly', async () => {
    const value = engine()
    const first = await reconcileAssistantPulse(
      value,
      registry('root-a'),
      { enabled: true, everyMinutes: 30 },
      NOW,
    )
    const changed = await reconcileAssistantPulse(
      value,
      registry('root-a'),
      { enabled: true, everyMinutes: 60 },
      new Date('2026-10-01T19:00:00.000Z'),
    )
    expect(changed?.id).not.toBe(first?.id)
    expect(changed?.recurrence).toEqual({ kind: 'interval', everyMs: 3_600_000 })

    await expect(reconcileAssistantPulse(
      value,
      registry('root-a'),
      { enabled: false, everyMinutes: 60 },
      new Date('2026-10-01T19:05:00.000Z'),
    )).resolves.toBeUndefined()

    const all = await value.list({ includeSystem: true, includeHidden: true })
    expect(all.filter(task => task.systemKey === ASSISTANT_PULSE_SYSTEM_KEY && task.status === 'scheduled'))
      .toEqual([])
  })

  it('rejects a cadence that would turn the pulse into noisy polling', async () => {
    await expect(reconcileAssistantPulse(
      engine(),
      registry('root-a'),
      { enabled: true, everyMinutes: 5 },
      NOW,
    )).rejects.toThrow('between 15 and 1440')
  })
})
