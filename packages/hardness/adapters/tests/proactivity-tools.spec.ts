import { describe, expect, it } from 'vitest'
import { MemoryProactivityStore, ProactivityEngine } from '../src/proactivity-engine.ts'
import { createProactivityCreateTool } from '../src/proactivity-tools.ts'

describe('phoenix_task_create email delivery', () => {
  it('resolves and persists the connected account email before accepting the task', async () => {
    const engine = new ProactivityEngine(
      new MemoryProactivityStore(),
      { execute: async () => ({}) },
      { id: () => 'email-self' },
    )
    const tool = createProactivityCreateTool(engine, {
      resolveDefaultEmailRecipient: async () => 'owner@example.com',
    })

    const result = await tool.execute({
      title: 'Self email',
      instruction: 'Send the scheduled test email.',
      runAt: '2026-09-27T22:53:29-04:00',
      requestedByUser: true,
      delivery: 'email',
      senderIdentity: 'harness',
    }, { agent: { id: 'agent-a' } } as never)

    expect(result).toMatchObject({
      id: 'email-self',
      status: 'scheduled',
      delivery: 'email',
    })
    const [task] = await engine.list({ includeHidden: true })
    expect(task?.recipient).toBe('owner@example.com')
  })

  it('refuses to claim an email task is scheduled when no recipient can be resolved', async () => {
    const engine = new ProactivityEngine(
      new MemoryProactivityStore(),
      { execute: async () => ({}) },
      { id: () => 'email-missing-recipient' },
    )
    const tool = createProactivityCreateTool(engine, {
      resolveDefaultEmailRecipient: async () => undefined,
    })

    await expect(tool.execute({
      title: 'Impossible email',
      instruction: 'Send it.',
      runAt: '2026-09-27T22:53:29-04:00',
      requestedByUser: true,
      delivery: 'email',
    }, {} as never)).rejects.toThrow(/requires a recipient or a connected Google account/)

    expect(await engine.list({ includeHidden: true })).toEqual([])
  })
})

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

describe('phoenix_task_create home attention metadata', () => {
  it('persists presentation policy for recurring background intelligence', async () => {
    const engine = new ProactivityEngine(
      new MemoryProactivityStore(),
      { execute: async () => ({}) },
      { id: () => 'interest-mission' },
    )
    const tool = createProactivityCreateTool(engine)

    const result = await tool.execute({
      title: 'NBA intelligence',
      instruction: 'Recalculate the slate and report only material changes.',
      runAt: '2026-09-29T18:00:00-04:00',
      everyMinutes: 360,
      requestedByUser: true,
      delivery: 'work',
      attentionMode: 'auto',
      attentionPriority: 'normal',
      attentionText: 'Actualiza el análisis antes de los partidos.',
    }, { agent: { id: 'agent-a' } } as never)

    expect(result).toMatchObject({
      attention_mode: 'auto',
      attention_priority: 'normal',
      attention_text: 'Actualiza el análisis antes de los partidos.',
    })
    const [task] = await engine.list({ includeHidden: true })
    expect(task).toMatchObject({
      attentionMode: 'auto',
      attentionPriority: 'normal',
      attentionText: 'Actualiza el análisis antes de los partidos.',
    })
  })
})
