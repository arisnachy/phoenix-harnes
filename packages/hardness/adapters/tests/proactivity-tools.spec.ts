import { describe, expect, it } from 'vitest'
import { MemoryProactivityStore, ProactivityEngine } from '../src/proactivity-engine.ts'
import { createProactivityCreateTool } from '../src/proactivity-tools.ts'

describe('phoenix_task_create timezone handling', () => {
  it('accepts timezone on a one-shot task when runAt already defines the instant', async () => {
    const engine = new ProactivityEngine(
      new MemoryProactivityStore(),
      { execute: async () => ({}) },
      { id: () => 'one-shot-timezone' },
    )
    const tool = createProactivityCreateTool(engine)

    const result = await tool.execute({
      instruction: 'Al ejecutarse, despiértate y envía al usuario exactamente: “PRUEBA WAKE SCHEDULER OK”.',
      runAt: '2026-09-27T22:45:24-04:00',
      requestedByUser: true,
      timezone: 'America/Santo_Domingo',
      delivery: 'chat',
      senderIdentity: 'harness',
      visibility: 'visible',
      title: 'Prueba del programador en 2 minutos',
    }, { agent: { id: 'agent-a' } } as never)

    expect(result).toMatchObject({
      id: 'one-shot-timezone',
      status: 'scheduled',
      next_run_at: '2026-09-28T02:45:24.000Z',
      recurrence: { kind: 'once' },
      delivery: 'chat',
    })

    const [task] = await engine.list({ includeHidden: true })
    expect(task?.recurrence).toEqual({ kind: 'once' })
    expect(task?.targetAgentId).toBe('agent-a')
  })

  it('continues to persist timezone for yearly calendar recurrence', async () => {
    const engine = new ProactivityEngine(
      new MemoryProactivityStore(),
      { execute: async () => ({}) },
      { id: () => 'yearly-timezone' },
    )
    const tool = createProactivityCreateTool(engine)

    const result = await tool.execute({
      title: 'Annual reminder',
      instruction: 'Remind me.',
      runAt: '2027-02-20T09:00:00-04:00',
      everyYears: 1,
      timezone: 'America/Santo_Domingo',
      requestedByUser: true,
    }, {} as never)

    expect(result).toMatchObject({
      recurrence: {
        kind: 'yearly',
        every_years: 1,
        timezone: 'America/Santo_Domingo',
      },
    })
  })
})
