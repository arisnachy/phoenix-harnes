/**
 * Ephemeral, session-scoped efficiency signals from canonical Phoenix events.
 *
 * Never stores prompts, tool arguments, credentials, or speculative costs.
 * Advisory output is deliberately bounded and never changes authorizations,
 * model routing, quality gates, or the UI.
 */

interface SessionEfficiency {
  contextWindow?: number
  pressureTokens?: number
  toolCalls: number
  failedToolCalls: number
  retries: number
  pendingCalls: Map<string, string>
  failuresByTool: Map<string, number>
  cacheRatios: number[]
  firstChunkSlowness: boolean[]
  step?: { key: string; startedAt: number; sampled: boolean }
  lastUsageStep?: string
}

const MAX_ACTIVE_SESSIONS = 64
const MAX_PENDING_CALLS = 64
const MAX_CACHE_SAMPLES = 4
const MAX_LATENCY_SAMPLES = 3

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function nonNegative(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined
}

function stepKey(data: Record<string, unknown>): string | undefined {
  const turn = nonNegative(data.turn)
  const step = nonNegative(data.step)
  return turn === undefined || step === undefined ? undefined : `${turn}:${step}`
}

function failedResult(data: Record<string, unknown>): boolean {
  if (data.error !== undefined) return true
  const message = record(data.message)
  if (message?.isError === true) return true
  return Array.isArray(message?.content) && message.content.some(part => {
    const item = record(part)
    return item?.isError === true
  })
}

function freshState(contextWindow?: number): SessionEfficiency {
  return {
    ...contextWindow === undefined ? {} : { contextWindow },
    toolCalls: 0,
    failedToolCalls: 0,
    retries: 0,
    pendingCalls: new Map(),
    failuresByTool: new Map(),
    cacheRatios: [],
    firstChunkSlowness: [],
  }
}

/** Observe factual usage and recommend measured, quality-preserving adjustments. */
export class LiveEfficiencyMonitor {
  private readonly sessions = new Map<string, SessionEfficiency>()

  /** Start a direct human task; prior task friction must not contaminate it. */
  startTask(sessionId: string): void {
    const previous = this.sessions.get(sessionId)
    this.sessions.delete(sessionId)
    this.sessions.set(sessionId, freshState(previous?.contextWindow))
    if (this.sessions.size > MAX_ACTIVE_SESSIONS) {
      const oldest = this.sessions.keys().next().value
      if (oldest !== undefined) this.sessions.delete(oldest)
    }
  }

  /** Drop all task counters after completion or explicit cancellation. */
  clear(sessionId: string): void {
    this.sessions.delete(sessionId)
  }

  /** Fold only known event shapes; missing provider metrics remain unknown. */
  observe(sessionId: string, type: string, data: unknown, occurredAt?: number): void {
    const state = this.sessions.get(sessionId)
    const payload = record(data)
    if (state === undefined || payload === undefined) return

    if (type === 'request/context') {
      const window = nonNegative(payload.contextWindow)
      if (window !== undefined && window > 0) state.contextWindow = window
      else state.contextWindow = undefined
      state.pressureTokens = undefined
      return
    }

    if (type === 'step/start') {
      const key = stepKey(payload)
      if (key !== undefined && occurredAt !== undefined && Number.isFinite(occurredAt)) {
        state.step = { key, startedAt: occurredAt, sampled: false }
      }
      return
    }

    if (type === 'assistant/chunk') {
      const chunk = record(payload.chunk)
      if (chunk === undefined) return
      const key = stepKey(payload)
      if (state.step !== undefined && state.step.key === key && !state.step.sampled && chunk.type !== 'usage') {
        state.step.sampled = true
        if (occurredAt !== undefined && Number.isFinite(occurredAt)) {
          const duration = occurredAt - state.step.startedAt
          if (duration >= 0) {
            state.firstChunkSlowness.push(duration >= 8_000)
            if (state.firstChunkSlowness.length > MAX_LATENCY_SAMPLES) state.firstChunkSlowness.shift()
          }
        }
      }
      if (chunk.type === 'usage') this.observeUsage(state, chunk.usage, key)
      return
    }

    if (type === 'assistant/message') {
      this.observeUsage(state, payload.usage, stepKey(payload))
      return
    }

    if (type === 'tool/call') {
      state.toolCalls += 1
      if (typeof payload.callId === 'string' && typeof payload.name === 'string') {
        state.pendingCalls.set(payload.callId, payload.name.slice(0, 120))
        if (state.pendingCalls.size > MAX_PENDING_CALLS) {
          const oldest = state.pendingCalls.keys().next().value
          if (oldest !== undefined) state.pendingCalls.delete(oldest)
        }
      }
      return
    }

    if (type === 'tool/result') {
      const message = record(payload.message)
      const callId = message?.callId
      const toolName = typeof callId === 'string' ? state.pendingCalls.get(callId) : undefined
      if (typeof callId === 'string') state.pendingCalls.delete(callId)
      const failed = failedResult(payload)
      if (failed) state.failedToolCalls += 1
      if (toolName !== undefined) {
        state.failuresByTool.set(toolName, failed ? (state.failuresByTool.get(toolName) ?? 0) + 1 : 0)
      }
      return
    }

    if (type === 'llm/retry-started') state.retries += 1
    if (type === 'compaction/summary') state.pressureTokens = undefined
  }

  private observeUsage(state: SessionEfficiency, value: unknown, key?: string): void {
    const usage = record(value)
    if (usage === undefined) return
    const input = nonNegative(usage.inputTokens)
    if (input === undefined) return
    const read = nonNegative(usage.cacheReadTokens) ?? 0
    const write = nonNegative(usage.cacheWriteTokens) ?? 0
    const pressure = input + read + write
    if (Number.isSafeInteger(pressure)) state.pressureTokens = pressure

    // A streamed usage chunk and final assistant message describe one step.
    // Replace that step's cache observation instead of double counting it.
    if (usage.cacheReadTokens === undefined && usage.cacheWriteTokens === undefined) return
    if (pressure < 1_000) return
    const ratio = pressure === 0 ? 0 : read / pressure
    if (key !== undefined && state.lastUsageStep === key && state.cacheRatios.length > 0) {
      state.cacheRatios[state.cacheRatios.length - 1] = ratio
    } else {
      state.cacheRatios.push(ratio)
      state.lastUsageStep = key
      if (state.cacheRatios.length > MAX_CACHE_SAMPLES) state.cacheRatios.shift()
    }
  }

  /**
   * Supply short, session-local execution advice only when evidence warrants.
   * Never block tools, force a model change, or skip required verification.
   */
  guidance(sessionId: string): string {
    const state = this.sessions.get(sessionId)
    if (state === undefined) return ''
    const hints: string[] = []
    if (state.contextWindow !== undefined && state.pressureTokens !== undefined) {
      const ratio = state.pressureTokens / state.contextWindow
      if (ratio >= 0.9) {
        hints.push('Context pressure is high: preserve task decisions and verified evidence in the existing checkpoint/compaction mechanism before further expansion. Do not lose user instructions.')
      } else if (ratio >= 0.78) {
        hints.push('Context is nearing capacity: avoid unrelated history/tool output, and prepare to use existing context compaction if needed.')
      }
    }
    const repeatedFailures = [...state.failuresByTool.values()].some(count => count >= 3)
    if (repeatedFailures || (state.toolCalls >= 5 && state.failedToolCalls >= 3)) {
      hints.push('Repeated tool failures observed: inspect the error and change the approach; do not repeat the same failed call without new evidence.')
    } else if (state.toolCalls >= 24) {
      hints.push('Many tool calls observed: reuse validated results and batch independent safe checks where possible; keep necessary verification.')
    }
    if (state.firstChunkSlowness.filter(Boolean).length >= 2) {
      hints.push('Repeated slow provider first-chunk responses: reduce avoidable model round trips; do not skip essential work to appear faster.')
    }
    if (state.cacheRatios.length >= 3 && state.cacheRatios.slice(-3).every(ratio => ratio < 0.2)) {
      hints.push('Low reported prompt-cache reuse: keep stable instructions in a reusable prefix and avoid unnecessary tool schemas while retaining tools required by the task.')
    }
    if (hints.length === 0) return ''
    return 'Phoenix measured-efficiency guidance (silent; quality and permission rules take priority): '
      + hints.slice(0, 2).join(' ')
  }
}
