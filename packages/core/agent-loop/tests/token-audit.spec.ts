import { describe, expect, it } from 'vitest'
import { createAssistantMessage, createUserMessage } from '@phoenix-ai/dsh-llm'
import type { Message } from '@phoenix-ai/dsh-llm'
import { tokenInputInventory } from '../src/token-audit.ts'

describe('privacy-safe token input audit', () => {
  it('counts visible text, reasoning, calls, nested results, image and file budgets', () => {
    const visibleBlocks = [
      { type: 'text', text: 'hello' },
      { type: 'reasoning', text: 'thinking' },
      { type: 'tool-call', name: 'read', arguments: '{"path":"a"}' },
      { type: 'tool-result', content: [{ type: 'text', text: 'output' }] },
      { type: 'image' },
      { type: 'file', attachment: { bytes: 256 } },
    ] as unknown as Message['content']
    const message = { content: visibleBlocks, source: { kind: 'user' } } as unknown as Message
    const expectedChars = 'hello'.length + 'thinking'.length + 'read'.length
      + '{"path":"a"}'.length + 'output'.length + 4800 + 256
    const inventory = tokenInputInventory('', [], [message])
    expect(inventory.historyChars).toBe(expectedChars)
    expect(inventory.toolResultChars).toBe(expectedChars)
    expect(inventory.humanChars).toBe(0)
    expect(inventory.approximateInputTokens).toBe(Math.ceil(expectedChars / 4))
  })

  it('excludes duplicate runtime-context provenance while preserving its full content', () => {
    const fullMemory = 'Relevant clinical and technical memory.'
    const sourceOnlyReceipt = 'NOT_SENT_TO_THE_MODEL_'.repeat(5_000)
    const memory = createUserMessage({
      content: [{ type: 'text', text: fullMemory }],
      source: {
        kind: 'plugin',
        plugin: '@phoenix-ai/dsh-system-prompt',
        form: 'snapshot',
        sections: [{ name: 'memory:runtime', text: sourceOnlyReceipt }],
      },
    })
    const inventory = tokenInputInventory('Permanent policy', [], [memory])
    expect(inventory.runtimeContextChars).toBe(fullMemory.length)
    expect(inventory.historyChars).toBe(fullMemory.length)
    expect(inventory.systemChars).toBe('Permanent policy'.length)
    expect(inventory.approximateInputTokens).toBe(
      Math.ceil(('Permanent policy'.length + fullMemory.length) / 4),
    )
    expect(JSON.stringify(inventory)).not.toContain(sourceOnlyReceipt)
    // Telemetry-only projection; the journal's actual memory is untouched.
    expect(memory.content[0]).toMatchObject({ type: 'text', text: fullMemory })
    expect(memory.source).toHaveProperty('sections')
  })

  it('attributes system, schemas, history and runtime memory without exposing private text', () => {
    const secret = 'private-clinical-token-example'
    const messages = [
      createUserMessage({ content: [{ type: 'text', text: secret }], source: { kind: 'user' } }),
      createAssistantMessage({
        content: [{ type: 'text', text: 'response' }],
        source: { provider: 'mock', model: 'mock' },
      }),
      createUserMessage({
        content: [{ type: 'text', text: 'previous validated memory' }],
        source: { kind: 'plugin', plugin: '@phoenix-ai/dsh-system-prompt' },
      }),
    ]
    const inventory = tokenInputInventory('system instruction', [
      { name: 'read', description: 'File read tool', parameters: {} },
    ], messages)
    expect(inventory.systemChars).toBe('system instruction'.length)
    expect(inventory.toolCount).toBe(1)
    expect(inventory.messageCount).toBe(3)
    expect(inventory.humanChars).toBeGreaterThan(0)
    expect(inventory.assistantChars).toBeGreaterThan(0)
    expect(inventory.runtimeContextChars).toBeGreaterThan(0)
    expect(inventory.historyChars).toBe(
      inventory.humanChars + inventory.assistantChars + inventory.toolResultChars
      + inventory.runtimeContextChars + inventory.otherHistoryChars,
    )
    expect(inventory.approximateInputTokens).toBeGreaterThan(0)
    expect(JSON.stringify(inventory)).not.toContain(secret)
  })
})
