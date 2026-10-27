/** Privacy-safe request size inventory. No prompt text, arguments or secrets are logged. */
import type { ContentBlock, Message } from '@phoenix-ai/dsh-llm'

/**
 * Mirror the pi-ai request estimator: source identity, memory section receipts,
 * timestamps and durable provenance are NOT model-visible content. Counting the
 * entire serialized harness Message can double-charge runtime context, because
 * its source.sections repeat the same text carried in its content block.
 */
function modelContentChars(blocks: readonly ContentBlock[]): number {
  let chars = 0
  for (const block of blocks) {
    switch (block.type) {
      case 'text':
      case 'reasoning':
        chars += block.text.length
        break
      case 'tool-call':
        chars += block.name.length + block.arguments.length
        break
      case 'tool-result':
        chars += modelContentChars(block.content)
        break
      case 'image':
        // Same rough image budget as the pi-ai Context estimator, not raw base64.
        chars += 4800
        break
      case 'file':
        // The adapter may limit inline text bytes at the provider boundary.
        chars += block.attachment.bytes
        break
    }
  }
  return chars
}

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
 * Estimate model-visible content sizes without retaining prompt text or source metadata.
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
    const size = modelContentChars(message.content)
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
