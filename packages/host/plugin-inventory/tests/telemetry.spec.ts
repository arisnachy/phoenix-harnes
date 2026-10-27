import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import type { EventEmitter } from 'node:events'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { TokenTelemetryCollector } from '../src/telemetry.ts'

const telemetryEvents: EventEmitter = process
const roots: string[] = []
const instances: TokenTelemetryCollector[] = []

afterEach(async () => {
  await Promise.all(instances.splice(0).map(async instance => instance.dispose()))
  await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe('Settings token telemetry collector', () => {
  it('records one input and its corresponding provider usage without storing private content', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'phoenix-telemetry-'))
    roots.push(folder)
    const collector = new TokenTelemetryCollector(join(folder, 'nested', 'usage.json'))
    instances.push(collector)
    expect(collector.snapshot().records).toHaveLength(0)

    telemetryEvents.emit('phoenix:telemetry:input', {
      id: 'request-1',
      at: Date.now(),
      provider: 'openai-codex',
      model: 'gpt-6-luna',
      reasoningEffort: 'high',
      systemChars: 1000,
      reusedSystemPrefixChars: 620,
      prefixComparison: 'compared',
      schemaChars: 180,
      historyChars: 3000,
      humanChars: 100,
      assistantChars: 700,
      toolResultChars: 400,
      runtimeContextChars: 120,
      otherHistoryChars: 1680,
      messageCount: 4,
      toolCount: 3,
      approximateInputTokens: 1045,
      text: 'SHOULD_NEVER_BE_STORED',
      secret: 'SHOULD_NEVER_BE_STORED',
    })
    telemetryEvents.emit('phoenix:telemetry:usage', {
      id: 'request-1', inputTokens: 927, outputTokens: 148,
      cacheReadTokens: 500, reasoningTokens: 70,
      prompt: 'SHOULD_NEVER_BE_STORED',
    })
    const record = collector.snapshot().records[0]
    expect(record).toMatchObject({ provider: 'openai-codex', model: 'gpt-6-luna',
      inputTokens: 927, outputTokens: 148, cacheReadTokens: 500, systemChars: 1000,
      reusedSystemPrefixChars: 620, prefixComparison: 'compared' })
    expect(JSON.stringify(collector.snapshot())).not.toContain('SHOULD_NEVER_BE_STORED')
    expect(JSON.stringify(collector.snapshot())).not.toContain('request-1')

    telemetryEvents.emit('phoenix:telemetry:input', {
      id: 'request-baseline', at: Date.now(), provider: 'openai-codex',
      model: 'gpt-6-sol', prefixComparison: 'baseline', systemChars: 700,
      // Malformed status is not copied into persistent telemetry.
      secret: 'SHOULD_NEVER_BE_STORED',
    })
    expect(collector.snapshot().records[0]?.prefixComparison).toBe('baseline')
    expect(collector.snapshot().records[0]?.reusedSystemPrefixChars).toBeUndefined()

    await collector.setEnabled(false)
    telemetryEvents.emit('phoenix:telemetry:input', { id: 'other', at: Date.now(), model: 'other' })
    expect(collector.snapshot().records).toHaveLength(2)
    const persisted = await readFile(join(folder, 'nested', 'usage.json'), 'utf8')
    expect(persisted).not.toContain('SHOULD_NEVER_BE_STORED')
    expect((JSON.parse(persisted) as { enabled: boolean }).enabled).toBe(false)

    await collector.clear()
    expect(collector.snapshot().records).toHaveLength(0)
    expect(collector.snapshot().enabled).toBe(false)
  })

  it('restores the persisted OFF switch and does not interfere with a new Host session', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'phoenix-telemetry-'))
    roots.push(folder)
    const filename = join(folder, 'usage.json')
    const collector = new TokenTelemetryCollector(filename)
    instances.push(collector)
    await collector.setEnabled(false)
    await collector.dispose()
    instances.pop()

    const restarted = new TokenTelemetryCollector(filename)
    instances.push(restarted)
    expect(restarted.snapshot().enabled).toBe(false)
    expect(restarted.snapshot().records).toHaveLength(0)
  })
})
