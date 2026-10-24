import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@phoenix-ai/cordis'
import {
  MemoryProactivityStore,
  ProactivityEngine,
} from '../src/proactivity-engine.ts'
import { installProactivityRuntime, parseBrowserTaskCreate } from '../src/proactivity-runtime.ts'

const future = '2027-05-01T12:00:00.000Z'
const input = {
  title: ' Prepare lessons ',
  prompt: ' Review the new master class ',
  nextRunAt: future,
  recurrence: { kind: 'once' },
  catchUp: 'latest',
  delivery: 'chat',
  createdBy: 'user',
  senderIdentity: 'user',
}

afterEach(() => { vi.useRealTimers() })

describe('Host-authorized scheduled task-center creation', () => {
  it('normalizes explicit user requests and supports bounded interval recurrence', () => {
    const now = Date.parse('2026-10-24T00:00:00.000Z')
    expect(parseBrowserTaskCreate(input, now)).toEqual({
      title: 'Prepare lessons',
      instruction: 'Review the new master class',
      runAt: future,
      recurrence: { kind: 'once' },
      catchUp: 'latest',
      delivery: 'chat',
      createdBy: 'user',
      senderIdentity: 'user',
    })
    expect(parseBrowserTaskCreate({ ...input, recurrence: { kind: 'interval', everyMs: 300_000 } }, now))
      .toMatchObject({ recurrence: { kind: 'interval', everyMs: 300_000 } })
  })

  it.each([
    null,
    [],
    'create',
    { ...input, extra: 'forged' },
    { ...input, title: '' },
    { ...input, title: 'A'.repeat(161) },
    { ...input, prompt: '' },
    { ...input, prompt: 'b'.repeat(8001) },
    { ...input, createdBy: 'system' },
    { ...input, senderIdentity: 'harness' },
    { ...input, delivery: 'email' },
    { ...input, catchUp: 'all' },
    { ...input, recurrence: { kind: 'interval', everyMs: 299_999 } },
    { ...input, recurrence: { kind: 'interval', everyMs: 300_000, extra: true } },
    { ...input, recurrence: { kind: 'yearly', everyYears: 1 } },
    { ...input, recurrence: { kind: 'once', extra: true } },
    { ...input, recurrence: null },
    { ...input, recurrence: [] },
    { ...input, nextRunAt: 'not a date' },
    { ...input, nextRunAt: '2027-02-30T12:00:00.000Z' },
    { ...input, nextRunAt: '2027-05-01T12:00:00+00:00' },
    { ...input, nextRunAt: '2026-01-01T00:00:00.000Z' },
  ])('rejects an unauthorized or malformed browser request %#', (candidate) => {
    expect(() => parseBrowserTaskCreate(candidate, Date.parse('2026-10-24T00:00:00.000Z')))
      .toThrow()
  })

  it('rejects missing or ambiguous owner selection without guessing', () => {
    expect(() => parseBrowserTaskCreate(input, Number.NaN)).toThrow(/future/)
    expect(() => parseBrowserTaskCreate(input, Date.parse(future))).toThrow(/future/)
    expect(() => parseBrowserTaskCreate({ ...input, nextRunAt: 42 }, 0)).toThrow(/canonical/)
  })

  it('commits a real Host-owned task before confirming RPC creation', async () => {
    const ctx = new Context()
    const store = new MemoryProactivityStore()
    const engine = new ProactivityEngine(store, { execute: async () => ({ summary: 'Done' }) }, { id: () => 'host-task-1' })
    let handler: ((endpoint: string, payload: unknown) => Promise<{ ok: boolean; value?: unknown; error?: unknown }>) | undefined
    const connection = {
      rpc: {
        handle(channel: string, callback: typeof handler, options: { authority?: string }) {
          expect(channel).toBe('/phoenix-tasks')
          expect(options.authority).toBe('loopback')
          handler = callback
          return async () => undefined
        },
      },
    }
    ctx.provide('connection', connection as never)
    ctx.provide('agents', { roots: () => [{ id: 'original-session' }], list: () => [] } as never)
    const dispose = installProactivityRuntime(ctx, engine, 60_000)
    const response = await handler!('create', input)
    expect(response.ok).toBe(true)
    expect(response.value).toMatchObject({
      id: 'host-task-1',
      title: 'Prepare lessons',
      status: 'scheduled',
      createdBy: 'user',
    })
    const persisted = await store.load()
    expect(persisted.tasks).toEqual([expect.objectContaining({
      id: 'host-task-1',
      instruction: 'Review the new master class',
      targetAgentId: 'original-session',
      createdBy: 'user',
    })])
    expect((await handler!('list', {})).value).toEqual([
      expect.objectContaining({ id: 'host-task-1' }),
    ])
    dispose()
    await ctx.fiber.dispose()
  })

  it('refuses global creation without exactly one rooted owner', async () => {
    for (const rootIds of [[], ['one', 'two']]) {
      const ctx = new Context()
      const engine = new ProactivityEngine(new MemoryProactivityStore(), { execute: async () => ({}) })
      let handler: ((endpoint: string, payload: unknown) => Promise<{ ok: boolean; value?: unknown; error?: unknown }>) | undefined
      ctx.provide('connection', { rpc: { handle(_channel: string, callback: typeof handler) {
        handler = callback
        return async () => undefined
      } } } as never)
      ctx.provide('agents', { roots: () => rootIds.map(id => ({ id })) } as never)
      const dispose = installProactivityRuntime(ctx, engine, 60_000)
      const result = await handler!('create', input)
      expect(result.ok).toBe(false)
      expect(await engine.list()).toEqual([])
      dispose()
      await ctx.fiber.dispose()
    }
  })
})
