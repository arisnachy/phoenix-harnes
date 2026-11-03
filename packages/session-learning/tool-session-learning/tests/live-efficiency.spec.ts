import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { LiveEfficiencyMonitor } from '../src/live-efficiency.ts'

const id = 'session-1'
const usage = (turn: number, step: number, inputTokens: number, cacheReadTokens = 0) => ({
  turn, step, usage: { inputTokens, outputTokens: 80, cacheReadTokens, cacheWriteTokens: 0 },
})

describe('LiveEfficiencyMonitor', () => {
  it('keeps the default experience silent without measurable pressure', () => {
    const monitor = new LiveEfficiencyMonitor()
    expect(monitor.guidance(id)).toBe('')
    monitor.startTask(id)
    monitor.observe(id, 'assistant/message', { turn: 1, step: 1, usage: { inputTokens: 20, outputTokens: 4 } })
    expect(monitor.guidance(id)).toBe('')
  })

  it('provides bounded, current-session context protection from provider-reported tokens', () => {
    const monitor = new LiveEfficiencyMonitor()
    monitor.startTask(id)
    monitor.observe(id, 'request/context', { contextWindow: 10_000 })
    monitor.observe(id, 'assistant/message', usage(1, 1, 6_000, 2_400))
    expect(monitor.guidance(id)).toContain('Context is nearing capacity')
    expect(monitor.guidance('other')).toBe('')
    monitor.observe(id, 'assistant/message', usage(1, 2, 8_200, 1_000))
    expect(monitor.guidance(id)).toContain('Context pressure is high')
    monitor.observe(id, 'compaction/summary', {})
    expect(monitor.guidance(id)).not.toContain('Context pressure')
    monitor.clear(id)
    expect(monitor.guidance(id)).toBe('')
  })

  it('does not confuse cumulative tool failures with repeatable successful results', () => {
    const monitor = new LiveEfficiencyMonitor()
    monitor.startTask(id)
    for (let i = 0; i < 3; i++) {
      monitor.observe(id, 'tool/call', { callId: 'call-' + i, name: 'filesystem', arguments: 'DO_NOT_STORE' })
      monitor.observe(id, 'tool/result', { message: { callId: 'call-' + i, isError: true } })
    }
    expect(monitor.guidance(id)).toContain('Repeated tool failures')
    expect(monitor.guidance(id)).not.toContain('DO_NOT_STORE')
    monitor.startTask(id)
    expect(monitor.guidance(id)).toBe('')
  })

  it('deduplicates streamed and finalized cache usage from one model step', () => {
    const monitor = new LiveEfficiencyMonitor()
    monitor.startTask(id)
    monitor.observe(id, 'assistant/chunk', { turn: 1, step: 1, chunk: { type: 'usage',
      usage: { inputTokens: 2_000, cacheReadTokens: 0, cacheWriteTokens: 0 } } })
    monitor.observe(id, 'assistant/message', usage(1, 1, 2_000))
    monitor.observe(id, 'assistant/message', usage(1, 2, 2_000))
    expect(monitor.guidance(id)).not.toContain('Low reported prompt-cache')
    monitor.observe(id, 'assistant/message', usage(1, 3, 2_000))
    expect(monitor.guidance(id)).toContain('Low reported prompt-cache')
  })

  it('uses measured first chunk latency rather than inventing provider TTFT', () => {
    const monitor = new LiveEfficiencyMonitor()
    monitor.startTask(id)
    for (let step = 1; step <= 2; step++) {
      monitor.observe(id, 'step/start', { turn: 1, step }, 1_000 * step)
      monitor.observe(id, 'assistant/chunk', { turn: 1, step, chunk: { type: 'text', delta: 'hi' } },
        1_000 * step + 9_000)
    }
    expect(monitor.guidance(id)).toContain('Repeated slow provider first-chunk')
  })

  it('only uses reported cache fields and never changes authorization or model routing', () => {
    const monitor = new LiveEfficiencyMonitor()
    monitor.startTask(id)
    for (let step = 1; step <= 4; step++) monitor.observe(id, 'assistant/message',
      { turn: 1, step, usage: { inputTokens: 3_000, outputTokens: 80 } })
    expect(monitor.guidance(id)).toBe('')
    const implementation = readFileSync(resolve('packages/session-learning/tool-session-learning/src/index.ts'), 'utf8')
    expect(implementation).toContain("name: 'context:live-efficiency'")
    expect(implementation).toContain('efficiency.guidance(String(agent.id))')
  })
})
