/** Privacy-safe token telemetry visible inside Settings, never a provider call. */
import { readFileSync, statSync } from 'node:fs'
import type { EventEmitter } from 'node:events'
import { writeFileAtomic } from '@phoenix-ai/dsh-atomic-write'
import { dshHomePath } from '@phoenix-ai/dsh-home-paths'
import type { TokenTelemetryRecord, TokenTelemetrySnapshot } from './types.ts'

const DEFAULT_PATH = dshHomePath('telemetry', 'token-usage.json')
const RECORD_LIMIT = 600
const FILE_BYTES_LIMIT = 1_000_000
const FLUSH_DELAY_MS = 2_000
const METRICS = [
  'systemChars', 'schemaChars', 'historyChars', 'humanChars', 'assistantChars',
  'toolResultChars', 'runtimeContextChars', 'otherHistoryChars',
  'messageCount', 'toolCount', 'approximateInputTokens',
] as const
const USAGE = ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens'] as const

type InputPayload = TokenTelemetryRecord & { readonly id: string }

function asRecord(input: unknown): Record<string, unknown> | undefined {
  return input !== null && typeof input === 'object' && !Array.isArray(input)
    ? input as Record<string, unknown> : undefined
}
function count(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0
}
function name(value: unknown): string {
  return typeof value === 'string' ? value.slice(0, 100).replace(/[^\w.:/-]/gu, '') : ''
}
function parseInput(raw: unknown): InputPayload | undefined {
  const input = asRecord(raw)
  if (!input || typeof input.id !== 'string' || input.id.length > 100) return undefined
  if (typeof input.at !== 'number' || !Number.isSafeInteger(input.at) || input.at < 0) return undefined
  const metrics = Object.fromEntries(METRICS.map(key => [key, count(input[key])]))
  return {
    ...metrics,
    ...input.prefixComparison === 'baseline' || input.prefixComparison === 'compared'
      ? { prefixComparison: input.prefixComparison } : {},
    ...input.reusedSystemPrefixChars === undefined ? {}
      : { reusedSystemPrefixChars: count(input.reusedSystemPrefixChars) },
    id: input.id,
    at: input.at,
    provider: name(input.provider),
    model: name(input.model),
    reasoningEffort: name(input.reasoningEffort),
    ...input.inputTokens === undefined ? {} : { inputTokens: count(input.inputTokens) },
    ...input.outputTokens === undefined ? {} : { outputTokens: count(input.outputTokens) },
    ...input.cacheReadTokens === undefined ? {} : { cacheReadTokens: count(input.cacheReadTokens) },
    ...input.cacheWriteTokens === undefined ? {} : { cacheWriteTokens: count(input.cacheWriteTokens) },
    ...input.reasoningTokens === undefined ? {} : { reasoningTokens: count(input.reasoningTokens) },
  } as InputPayload
}

/** One bounded, Host-owned observer. Stores counters only, never prompts or credentials. */
export class TokenTelemetryCollector {
  private enabled = true
  private records: InputPayload[] = []
  private timer: NodeJS.Timeout | undefined
  private saving: Promise<void> = Promise.resolve()

  constructor(private readonly path = DEFAULT_PATH) {
    try {
      if (statSync(this.path).size <= FILE_BYTES_LIMIT) {
        const data = asRecord(JSON.parse(readFileSync(this.path, 'utf8')) as unknown)
        if (typeof data?.enabled === 'boolean') this.enabled = data.enabled
        if (Array.isArray(data?.records)) {
          this.records = data.records.map(parseInput).filter((v): v is InputPayload => v !== undefined)
            .slice(-RECORD_LIMIT)
        }
      }
    } catch { /* Missing/invalid state is not allowed to block Host startup. */ }
    const telemetryEvents: EventEmitter = process
    telemetryEvents.on('phoenix:telemetry:input', this.receiveInput)
    telemetryEvents.on('phoenix:telemetry:usage', this.receiveUsage)
  }

  private readonly receiveInput = (raw: unknown): void => {
    if (!this.enabled) return
    const event = parseInput(raw)
    if (!event) return
    this.records.push(event)
    if (this.records.length > RECORD_LIMIT) this.records.splice(0, this.records.length - RECORD_LIMIT)
    this.schedule()
  }

  private readonly receiveUsage = (raw: unknown): void => {
    if (!this.enabled) return
    const usage = asRecord(raw)
    if (!usage || typeof usage.id !== 'string') return
    const event = this.records.findLast(record => record.id === usage.id)
    if (!event) return
    for (const field of USAGE) {
      if (usage[field] !== undefined) {
        (event as unknown as Record<string, unknown>)[field] = count(usage[field])
      }
    }
    this.schedule()
  }

  private schedule(): void {
    if (this.timer !== undefined) return
    this.timer = setTimeout(() => {
      this.timer = undefined
      void this.flush().catch(() => {
        // Disk failures must not crash a running model turn or create an unhandled rejection.
      })
    }, FLUSH_DELAY_MS)
    this.timer.unref()
  }

  private flush(): Promise<void> {
    const snapshot = JSON.stringify({ version: 1, enabled: this.enabled, records: this.records })
    this.saving = this.saving.catch(() => undefined).then(() =>
      writeFileAtomic(this.path, snapshot, { mode: 0o600, dirMode: 0o700 }))
    return this.saving
  }

  /**
   * Return only counters, model labels and dates; records are newest first.
   * @returns Current sanitized telemetry snapshot.
   */
  snapshot(): TokenTelemetrySnapshot {
    return { enabled: this.enabled, records: this.records.map(({ id: _id, ...record }) => record).reverse() }
  }

  /**
   * Persist collection preference without touching LLM routing or credentials.
   * @param enabled - Whether new requests should be collected.
   * @returns Updated sanitized telemetry snapshot.
   */
  async setEnabled(enabled: boolean): Promise<TokenTelemetrySnapshot> {
    this.enabled = enabled
    await this.flush()
    return this.snapshot()
  }

  /**
   * Clear retained counters but never erase sessions or cognitive memories.
   * @returns Empty sanitized telemetry snapshot.
   */
  async clear(): Promise<TokenTelemetrySnapshot> {
    this.records = []
    await this.flush()
    return this.snapshot()
  }

  /** Dispose listeners and wait for the final write before the Host/plugin is released. */
  async dispose(): Promise<void> {
    const telemetryEvents: EventEmitter = process
    telemetryEvents.off('phoenix:telemetry:input', this.receiveInput)
    telemetryEvents.off('phoenix:telemetry:usage', this.receiveUsage)
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
    await this.flush()
  }
}
