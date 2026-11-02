import { describe, expect, it } from 'vitest'
import { createAssistantMessage, createUserMessage } from '@phoenix-ai/dsh-llm'
import { tokenInputInventory } from '../src/token-audit.ts'

describe('privacy-safe token input audit', () => {
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
