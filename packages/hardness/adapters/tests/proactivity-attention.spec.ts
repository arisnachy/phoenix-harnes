import { describe, expect, it } from 'vitest'
import { MemoryProactivityStore, ProactivityEngine, type ProactivityTask } from '../src/proactivity-engine.ts'
import { buildProactivityAttentionItems, ensureAmbientBriefingTask } from '../src/proactivity-runtime.ts'

const NOW = new Date('2026-09-29T16:00:00.000Z')

function task(overrides: Partial<ProactivityTask>): ProactivityTask {
  return {
    id: 'task-1',
    title: 'NBA intelligence',
    instruction: 'Analyze the slate.',
    createdBy: 'user',
    createdAt: '2026-09-20T12:00:00.000Z',
    updatedAt: '2026-09-29T15:30:00.000Z',
    nextRunAt: '2026-09-30T16:00:00.000Z',
    recurrence: { kind: 'interval', everyMs: 86_400_000 },
    catchUp: 'latest',
    visibility: 'visible',
    delivery: 'work',
    senderIdentity: 'auto',
    status: 'scheduled',
    history: [],
    ...overrides,
  }
}

describe('proactivity home attention ranking', () => {
  it('creates one quiet ambient briefing and respects later cancellation', async () => {
    const engine = new ProactivityEngine(
      new MemoryProactivityStore(),
      { execute: async () => ({ summary: 'NO_MATERIAL_UPDATE' }) },
      { id: () => 'ambient-briefing' },
    )

    const created = await ensureAmbientBriefingTask(engine, NOW)
    expect(created).toMatchObject({
      id: 'ambient-briefing',
      title: 'Pulso de Phoenix',
      createdBy: 'system',
      delivery: 'work',
      attentionMode: 'auto',
      recurrence: { kind: 'interval', everyMs: 21_600_000 },
    })
    expect(await ensureAmbientBriefingTask(engine, NOW)).toBeUndefined()

    await engine.cancel('ambient-briefing')
    expect(await ensureAmbientBriefingTask(engine, NOW)).toBeUndefined()
    expect((await engine.list({ includeHidden: true })).map(item => item.status)).toEqual(['cancelled'])
  })

  it('surfaces a material recurring background result and suppresses unchanged checks', () => {
    const material = task({
      history: [{
        phase: 'deliver', scheduledFor: '2026-09-29T15:00:00.000Z', idempotencyKey: 'a',
        startedAt: '2026-09-29T15:00:00.000Z', finishedAt: '2026-09-29T15:02:00.000Z',
        status: 'completed', summary: 'Two games now meet the user-defined value threshold.',
      }],
    })
    const unchanged = task({
      id: 'task-2',
      history: [{
        phase: 'deliver', scheduledFor: '2026-09-29T15:00:00.000Z', idempotencyKey: 'b',
        startedAt: '2026-09-29T15:00:00.000Z', finishedAt: '2026-09-29T15:03:00.000Z',
        status: 'completed', summary: 'NO_MATERIAL_UPDATE',
      }],
    })

    expect(buildProactivityAttentionItems([unchanged, material], NOW)).toEqual([
      expect.objectContaining({
        taskId: 'task-1', kind: 'result', title: 'NBA intelligence',
        detail: 'Two games now meet the user-defined value threshold.',
      }),
    ])
  })

  it('keeps recurring work quiet before results unless an upcoming cue is explicit', () => {
    const quiet = task({ id: 'quiet' })
    const classPrep = task({
      id: 'class', title: 'MGC-100', attentionText: 'Conviene preparar la próxima clase.',
      attentionPriority: 'high', nextRunAt: '2026-09-29T20:00:00.000Z',
    })
    const oneShot = task({
      id: 'trial', title: 'Sentry Business', delivery: 'chat', recurrence: { kind: 'once' },
      nextRunAt: '2026-09-30T14:00:00.000Z', attentionPriority: 'normal',
    })

    const items = buildProactivityAttentionItems([quiet, oneShot, classPrep], NOW)
    expect(items.map(item => item.taskId)).toEqual(['class', 'trial'])
    expect(items[0]).toMatchObject({ kind: 'upcoming', detail: 'Conviene preparar la próxima clase.' })
  })

  it('ranks actionable recent failures, suppresses contextless failures, and respects attention off', () => {
    const failure = task({
      id: 'failed', title: 'Inbox review', status: 'failed', delivery: 'chat',
      attentionText: 'La revisión del correo no pudo completarse; revisa la conexión de Gmail.',
      history: [{
        phase: 'deliver', scheduledFor: '2026-09-29T15:00:00.000Z', idempotencyKey: 'f',
        startedAt: '2026-09-29T15:00:00.000Z', finishedAt: '2026-09-29T15:01:00.000Z',
        status: 'failed', error: 'connector unavailable',
      }],
    })
    const contextless = task({
      id: 'test-failure', title: 'Prueba realizada', status: 'failed', delivery: 'chat',
      history: [{
        phase: 'deliver', scheduledFor: '2026-09-29T15:00:00.000Z', idempotencyKey: 'x',
        startedAt: '2026-09-29T15:00:00.000Z', finishedAt: '2026-09-29T15:01:00.000Z',
        status: 'failed', error: 'test failure',
      }],
    })
    const hidden = task({ id: 'hidden', attentionMode: 'off', attentionPriority: 'high' })

    expect(buildProactivityAttentionItems([hidden, contextless, failure], NOW)).toEqual([
      expect.objectContaining({
        taskId: 'failed',
        kind: 'failure',
        detail: 'La revisión del correo no pudo completarse; revisa la conexión de Gmail.',
      }),
    ])
  })

  it('suppresses a repeated background conclusion even when the worker forgot the sentinel', () => {
    const repeated = task({
      id: 'repeat',
      history: [
        {
          phase: 'deliver', scheduledFor: '2026-09-29T09:00:00.000Z', idempotencyKey: 'old',
          startedAt: '2026-09-29T09:00:00.000Z', finishedAt: '2026-09-29T09:02:00.000Z',
          status: 'completed', summary: 'No urgent mail; reply to the same pending message.',
        },
        {
          phase: 'deliver', scheduledFor: '2026-09-29T15:00:00.000Z', idempotencyKey: 'new',
          startedAt: '2026-09-29T15:00:00.000Z', finishedAt: '2026-09-29T15:02:00.000Z',
          status: 'completed', summary: '  No urgent mail; reply to the same pending message.  ',
        },
      ],
    })

    expect(buildProactivityAttentionItems([repeated], NOW)).toEqual([])
  })

  it('does not surface completed email/chat receipts as proactive intelligence', () => {
    const sentMail = task({
      id: 'mail-receipt',
      title: 'Enviar correo de prueba',
      delivery: 'email',
      attentionMode: 'result',
      recurrence: { kind: 'once' },
      history: [{
        phase: 'deliver', scheduledFor: '2026-09-29T15:00:00.000Z', idempotencyKey: 'mail',
        startedAt: '2026-09-29T15:00:00.000Z', finishedAt: '2026-09-29T15:02:00.000Z',
        status: 'completed', summary: 'Correo de prueba enviado correctamente.',
      }],
    })

    expect(buildProactivityAttentionItems([sentMail], NOW)).toEqual([])
  })

  it('does not keep old completed work on the Hero for days', () => {
    const stale = task({
      id: 'stale',
      history: [{
        phase: 'deliver', scheduledFor: '2026-09-27T13:00:00.000Z', idempotencyKey: 'stale',
        startedAt: '2026-09-27T13:00:00.000Z', finishedAt: '2026-09-27T13:02:00.000Z',
        status: 'completed', summary: 'A once-useful recommendation.',
      }],
    })

    expect(buildProactivityAttentionItems([stale], NOW)).toEqual([])
  })
})
