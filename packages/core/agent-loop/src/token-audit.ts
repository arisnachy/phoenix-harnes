/** Privacy-safe request size inventory. No prompt text, arguments or secrets are logged. */
import type { Message } from '@phoenix-ai/dsh-llm'

export interface TokenInputInventory {
  readonly systemChars: number
  readonly schemaChars: number
  readonly historyChars: number
  readonly humanChars: number
  readonly assistantChars: number
  readonly toolResultChars: number
  readonly runtimeContextChars: number
  readonly otherHistoryChars: number
  readonly messageCount: number
  readonly toolCount: number
  /** Rough size comparison, NOT a provider token count or billing measurement. */
  readonly approximateInputTokens: number
}

/**
 * Count request component sizes without retaining any model-visible content.
 * @param system - Fully rendered system prompt.
 * @param tools - Complete wire tool schemas for this model step.
 * @param messages - Model-visible conversation history after projection.
 * @returns Size breakdown and rough, non-billing token estimate.
 */
export function tokenInputInventory(
  system: string,
  tools: readonly unknown[],
  messages: readonly Message[],
): TokenInputInventory {
  let humanChars = 0
  let assistantChars = 0
  let toolResultChars = 0
  let runtimeContextChars = 0
  let otherHistoryChars = 0
  for (const message of messages) {
    const size = JSON.stringify(message).length
    if (message.content.some(block => block.type === 'tool-result')) toolResultChars += size
    else if (message.source.kind === 'user') humanChars += size
    else if (message.source.kind === 'model') assistantChars += size
    else if (message.source.kind === 'plugin'
      && message.source.plugin === '@phoenix-ai/dsh-system-prompt') runtimeContextChars += size
    else otherHistoryChars += size
  }
  const schemaChars = tools.reduce<number>((sum, schema) => sum + JSON.stringify(schema).length, 0)
  const historyChars = humanChars + assistantChars + toolResultChars + runtimeContextChars + otherHistoryChars
  return {
    systemChars: system.length,
    schemaChars,
    historyChars,
    humanChars,
    assistantChars,
    toolResultChars,
    runtimeContextChars,
    otherHistoryChars,
    messageCount: messages.length,
    toolCount: tools.length,
    approximateInputTokens: Math.ceil((system.length + schemaChars + historyChars) / 4),
  }
}
