import { describe, expect, it, vi } from 'vitest'
import {
  MemoryWakeStore,
  WakeEngine,
  type WakeExecution,
} from '../src/wake-engine.ts'

function ids(...values: string[]) {
  let index = 0
  return () => values[index++] ?? `wake-${index}`
}

const event = {
  id: 'evt-1',
  source: 'gmail',
  eventType: 'email.received',
  occurredAt: '2026-09-27T20:00:00.000Z',
  summary: 'New mail',
  attributes: {
    sender: 'Boss@example.com',
    subject: 'Monthly Invoice ready',
    unread: true,
    attachments: 2,
  },
} as const

describe('Phoenix WakeEngine', () => {
  it('fires only matching durable triggers and records the event', async () => {
    const seen: WakeExecution[] = []
    const engine = new WakeEngine(
      new MemoryWakeStore(),
      { execute: async (input) => { seen.push(input); return { summary: 'accepted' } } },
      { id: ids('mail-trigger', 'github-trigger') },
    )
    await engine.create({
      title: 'Invoice mail',
      source: 'gmail',
      eventType: 'email.received',
      instruction: 'Review the invoice and notify me.',
      createdBy: 'user',
      matchers: [
        { field: 'sender', operator: 'equals', value: 'boss@example.com' },
        { field: 'subject', operator: 'contains', value: 'invoice' },
      ],
    })
    await engine.create({
      title: 'GitHub only',
      source: 'github',
      eventType: 'workflow.completed',
      instruction: 'Review CI.',
      createdBy: 'user',
    })

    const result = await engine.emit(event)

    expect(result).toEqual({ eventId: 'evt-1', matched: 1, fired: 1, failed: 0 })
    expect(seen).toHaveLength(1)
    expect(seen[0]?.idempotencyKey).toBe('mail-trigger:evt-1')
    const triggers = await engine.list()
    expect(triggers[0]).toMatchObject({
      id: 'mail-trigger',
      fireCount: 1,
      status: 'active',
      history: [{ eventId: 'evt-1', status: 'completed' }],
    })
    expect(triggers[1]?.fireCount).toBe(0)
  })

  it('deduplicates a completed event id for the same trigger', async () => {
    const execute = vi.fn(async () => ({}))
    const engine = new WakeEngine(new MemoryWakeStore(), { execute }, { id: ids('mail-trigger') })
    await engine.create({
      title: 'Wake on mail',
      source: 'gmail',
      eventType: 'email.received',
      instruction: 'Notify me.',
      createdBy: 'user',
    })

    await engine.emit(event)
    const second = await engine.emit(event)

    expect(execute).toHaveBeenCalledTimes(1)
    expect(second).toEqual({ eventId: 'evt-1', matched: 0, fired: 0, failed: 0 })
  })

  it('retries the same event after a failed execution', async () => {
    let attempt = 0
    const execute = vi.fn(async () => {
      attempt += 1
      if (attempt === 1) throw new Error('agent unavailable')
      return { summary: 'recovered' }
    })
    const engine = new WakeEngine(new MemoryWakeStore(), { execute }, { id: ids('retry-trigger') })
    await engine.create({
      title: 'Retry wake',
      source: 'gmail',
      eventType: 'email.received',
      instruction: 'Notify me.',
      createdBy: 'harness',
    })

    expect(await engine.emit(event)).toMatchObject({ matched: 1, fired: 0, failed: 1 })
    expect(await engine.emit(event)).toMatchObject({ matched: 1, fired: 1, failed: 0 })
    expect(execute).toHaveBeenCalledTimes(2)

    const [trigger] = await engine.list()
    expect(trigger?.history.map(row => row.status)).toEqual(['failed', 'completed'])
  })

  it('completes one-shot triggers after the first successful wake', async () => {
    const execute = vi.fn(async () => ({}))
    const engine = new WakeEngine(new MemoryWakeStore(), { execute }, { id: ids('once-trigger') })
    await engine.create({
      title: 'One mail only',
      source: 'gmail',
      eventType: 'email.received',
      instruction: 'Tell me once.',
      createdBy: 'user',
      once: true,
    })

    await engine.emit(event)
    await engine.emit({ ...event, id: 'evt-2', occurredAt: '2026-09-27T20:01:00.000Z' })

    expect(execute).toHaveBeenCalledTimes(1)
    expect((await engine.list())[0]?.status).toBe('completed')
  })

  it('preserves triggers across engine restart and supports wildcard plus scalar filters', async () => {
    const store = new MemoryWakeStore()
    const first = new WakeEngine(store, { execute: async () => ({}) }, { id: ids('durable') })
    await first.create({
      title: 'Any unread item with two attachments',
      source: '*',
      eventType: 'email.received',
      instruction: 'Handle it.',
      createdBy: 'user',
      matchers: [
        { field: 'unread', operator: 'equals', value: true },
        { field: 'attachments', operator: 'equals', value: 2 },
        { field: 'subject', operator: 'exists' },
      ],
    })

    const execute = vi.fn(async () => ({}))
    const restarted = new WakeEngine(store, { execute })
    const result = await restarted.emit(event)

    expect(result.fired).toBe(1)
    expect(execute).toHaveBeenCalledTimes(1)
  })
})
