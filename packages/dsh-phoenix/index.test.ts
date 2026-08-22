import { describe, expect, it } from 'vitest'
import { apply, getPhoenixSessionTelemetry } from './index.js'

type Handler = (...args: any[]) => any

function harness(tokens = 1_000) {
  const events = new Map<string, Handler[]>()
  const sections: any[] = []
  const guards: Handler[] = []
  const ctx = {
    systemPrompt: { section(value: any) { sections.push(value) } },
    tokenMeter: { measure() { return { totalTokens: tokens } } },
    tools: { guard(fn: Handler) { guards.push(fn); return () => undefined } },
    on(name: string, fn: Handler) {
      const list = events.get(name) ?? []
      list.push(fn)
      events.set(name, list)
      return () => undefined
    },
  }
  apply(ctx as any, { hardContextTokens: 8_000 })
  return { ctx, events, sections, guards }
}

describe('PHOENIX DSH bundle', () => {
  it('brands the request policy and rejects context beyond the configured hard budget', async () => {
    const low = harness(7_999)
    expect(low.sections[0]?.name).toBe('phoenix:runtime-policy')
    const lowHook = low.events.get('agent/pre-step')?.[0]
    const session = {}
    expect(await lowHook?.({ agent: { session } }, async () => ({ kind: 'enter', messages: [] })))
      .toEqual({ kind: 'enter', messages: [] })

    const high = harness(8_001)
    const highHook = high.events.get('agent/pre-step')?.[0]
    expect(await highHook?.({ agent: { session: {} } }, async () => ({ kind: 'enter', messages: [] })))
      .toEqual({ kind: 'reject' })
  })

  it('denies declared remote executable payloads and protected-path mutations monotonically', () => {
    const { guards } = harness()
    const guard = guards[0]!
    expect(guard({ name: 'run_command', arguments: { origin: 'remote', command: 'echo pwned' } }))
      .toMatch(/remote/i)
    expect(guard({ name: 'write_file', arguments: { path: '.github/workflows/ci.yml', content: 'x' } }))
      .toMatch(/protected-path/i)
    expect(guard({ name: 'read_file', arguments: { path: '.github/workflows/ci.yml' } }))
      .toBeUndefined()
  })

  it('records durable session activity without storing conversation content', () => {
    const { events } = harness()
    const hook = events.get('session/event')?.[0]!
    const session = {}
    hook(session, { type: 'step/start', data: {} })
    hook(session, { type: 'llm/retry', data: {} })
    hook(session, {
      type: 'assistant/message',
      data: { usage: { inputTokens: 10, outputTokens: 4, cacheReadTokens: 6, cacheWriteTokens: 2 } },
    })
    hook(session, { type: 'step/end', data: {} })
    hook(session, { type: 'turn/end', data: { reason: { kind: 'error' } } })
    expect(getPhoenixSessionTelemetry(session as any)).toMatchObject({
      stepsStarted: 1,
      stepsEnded: 1,
      retries: 1,
      failedTurns: 1,
      providerInputTokens: 10,
      providerOutputTokens: 4,
      cacheReadTokens: 6,
      cacheWriteTokens: 2,
    })
  })
})
